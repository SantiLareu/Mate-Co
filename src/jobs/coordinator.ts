/**
 * J1 — Idempotent confirmation coordinator (Stage 2, S2; no UI).
 *
 * Small helper for the next App handler: the ONLY thing that captures the
 * current composition is an explicit `confirm()` invocation. Visiting,
 * previewing, going back or reloading never writes — `previewAttempt`
 * merely derives the stable attempt identity without any I/O.
 *
 * Contract:
 * - The immutable payload (validated snapshot + canonical form) is
 *   captured BEFORE any async work.
 * - A synchronous inflight guard caches the promise per attempt key, so a
 *   double click issues ONE durable write.
 * - The same unchanged draft (retry, back-then-confirm) reuses its stable
 *   attempt key; a changed composition mints a new key. Comparison lives
 *   only within the coordinator lifetime — independent drafts are never
 *   merged by content at the repository layer.
 * - A failed attempt retains its key, so the retry is idempotent.
 * - A late completion never falsely confirms a changed composition: every
 *   result carries its `attemptKey`/`revision`, and the UI checks them
 *   against `currentKey()`/`currentRevision()` before showing success.
 * - Durable write success is required: the writer must persist before the
 *   coordinator reports a job.
 */
import {
  canonicalCompositionPayload,
  captureComposition,
  type CompositionInput,
  type JobCompositionSnapshot,
  type JobCustomer,
} from "./snapshot";

export interface ConfirmWriterInput {
  attemptKey: string;
  composition: JobCompositionSnapshot;
  customer?: JobCustomer;
}

export interface ConfirmWriterJob {
  id: string;
  attemptKey: string;
  /**
   * Honest durable metadata for the confirmation state. Optional so
   * existing writers keep working; the App writer fills both.
   */
  status?: string;
  createdAt?: string;
}

export type ConfirmWriter = (
  input: ConfirmWriterInput,
) => Promise<
  | { ok: true; job: ConfirmWriterJob }
  | { ok: false; error: { code: string; message?: string } }
>;

export interface AttemptPreview {
  attemptKey: string;
  revision: number;
  isRetry: boolean;
}

export type ConfirmResult =
  | { ok: true; job: ConfirmWriterJob; attemptKey: string; revision: number }
  | {
      ok: false;
      error: { code: string; message?: string };
      attemptKey: string;
      revision: number;
    };

export interface ConfirmationCoordinator {
  currentKey(): string | null;
  currentRevision(): number;
  previewAttempt(
    draft: CompositionInput,
    customer?: JobCustomer,
  ): AttemptPreview;
  confirm(
    draft: CompositionInput,
    customer: JobCustomer | undefined,
    writer: ConfirmWriter,
  ): Promise<ConfirmResult>;
}

/**
 * F4 decision: attempt identity needs unpredictable keys. crypto.randomUUID
 * is used whenever available; the Date.now()+Math.random fallback exists
 * ONLY for environments without it (older browsers, non-secure contexts)
 * and is never preferred. Keys are always validated as non-empty bounded
 * strings downstream, so a weak fallback can never become an empty key.
 */
function randomKey(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    )
      return crypto.randomUUID();
  } catch {
    // fall through to the Math fallback below
  }
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createConfirmationCoordinator(options?: {
  keyFactory?: () => string;
}): ConfirmationCoordinator {
  const mint = options?.keyFactory ?? randomKey;
  let lastCanonical: string | null = null;
  let lastKey: string | null = null;
  let revision = 0;
  const inflight = new Map<string, Promise<ConfirmResult>>();

  const canonicalOf = (
    draft: CompositionInput,
    customer?: JobCustomer,
  ): string | null => {
    try {
      // Change detection runs on the raw draft fields: cheap, bounded and
      // synchronous. Unstringifiable drafts never merge — they mint fresh.
      const raw = {
        texts: draft.texts,
        icons: draft.icons,
        graphics: draft.graphics,
        approved: draft.approved,
        circularLines: draft.circularLines,
        customer: customer ?? draft.customer ?? null,
      };
      const seen = new Set<object>();
      const text = JSON.stringify(raw, (_key, value: unknown) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) throw new Error("cyclic");
          seen.add(value);
        }
        return value as unknown;
      });
      if (typeof text !== "string" || text.length > 8_000_000) return null;
      return text;
    } catch {
      return null;
    }
  };

  const previewAttempt = (
    draft: CompositionInput,
    customer?: JobCustomer,
  ): AttemptPreview => {
    const canonical = canonicalOf(draft, customer);
    if (canonical !== null && canonical === lastCanonical && lastKey !== null)
      return { attemptKey: lastKey, revision, isRetry: true };
    lastCanonical = canonical;
    lastKey = mint();
    revision += 1;
    return { attemptKey: lastKey, revision, isRetry: false };
  };

  const confirm = (
    draft: CompositionInput,
    customer: JobCustomer | undefined,
    writer: ConfirmWriter,
  ): Promise<ConfirmResult> => {
    // Capture the immutable payload BEFORE any async operation.
    const preview = previewAttempt(draft, customer);
    const cached = inflight.get(preview.attemptKey);
    if (cached) return cached;
    const captured = captureComposition({
      texts: draft.texts,
      icons: draft.icons,
      graphics: draft.graphics,
      approved: draft.approved,
      circularLines: draft.circularLines,
      resolveIcon: draft.resolveIcon,
      customer: customer ?? draft.customer,
    });
    if (!captured.ok) {
      return Promise.resolve({
        ok: false as const,
        error: { code: "INVALID", message: captured.reason },
        attemptKey: preview.attemptKey,
        revision: preview.revision,
      });
    }
    const canonical = canonicalCompositionPayload(
      captured.composition,
      captured.composition.customer,
    );
    if (!canonical.ok) {
      return Promise.resolve({
        ok: false as const,
        error: { code: "INVALID", message: canonical.reason },
        attemptKey: preview.attemptKey,
        revision: preview.revision,
      });
    }
    const pending = (async (): Promise<ConfirmResult> => {
      try {
        const written = await writer({
          attemptKey: preview.attemptKey,
          composition: captured.composition,
          ...(captured.composition.customer
            ? { customer: captured.composition.customer }
            : {}),
        });
        if (!written.ok)
          return {
            ok: false as const,
            error: written.error,
            attemptKey: preview.attemptKey,
            revision: preview.revision,
          };
        return {
          ok: true as const,
          job: written.job,
          attemptKey: preview.attemptKey,
          revision: preview.revision,
        };
      } finally {
        inflight.delete(preview.attemptKey);
      }
    })();
    inflight.set(preview.attemptKey, pending);
    return pending;
  };

  return {
    currentKey: () => lastKey,
    currentRevision: () => revision,
    previewAttempt,
    confirm,
  };
}
