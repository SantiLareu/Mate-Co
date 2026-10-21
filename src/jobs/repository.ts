/**
 * J1 — Native IndexedDB jobs repository (Stage 2, S2/S3/S6).
 *
 * Own database/object store (`mateco.jobs.v1` / `jobs`, version 1): never
 * the admin catalog key, never localStorage, no catalog reads or writes.
 * Jobs are immutable and read-only with a single `pending` status — no
 * order states, no edit/delete, no migrations in this stage.
 *
 * Reliability contract:
 * - Explicit error codes (UNAVAILABLE/DENIED/QUOTA/BLOCKED/
 *   TRANSACTION_ABORTED/UNSUPPORTED/CORRUPT/INVALID/NOT_FOUND/CONFLICT);
 *   success is reported ONLY on transaction `oncomplete`, never on
 *   request `onsuccess`.
 * - Unknown or corrupt databases are never deleted/recreated
 *   automatically; corrupt RECORDS are isolated per job and reported as
 *   skipped, so one bad record never hides its neighbors and a failed
 *   storage read never returns an empty success.
 * - Reads are bounded cursor pages (default 20, max 100) plus get-by-id,
 *   never an unbounded full load; large v3 assets page like any record.
 * - Idempotent create is keyed by the stable confirmation-attempt identity
 *   inside ONE atomic readwrite transaction: same key + same canonical
 *   payload returns the existing job untouched (stable id/date); same key
 *   + different payload is an explicit CONFLICT, never an overwrite.
 *   Different keys may hold identical compositions (no content dedup).
 * - Concurrent creates on the same key yield ONE record. IndexedDB
 *   serializes same-store readwrite transactions, so the second create
 *   normally observes the winner through its initial get; the
 *   ConstraintError add path is retained defensively for orderings that
 *   surface it instead. Either path returns the winner untouched for the
 *   same payload and CONFLICT (never an overwrite) for a different one.
 * - Customer metadata is prebound before any canonical stringify: name
 *   and note are capped at 200 chars up front and guarded again as a
 *   typed INVALID, so identity comparison stays bounded.
 * - Icon frame/paint stays version 1: the canonical v1 rewrite is
 *   intentional (documented at rejectUnknownIconPaint). A stored
 *   definition carrying a differing frame/paint is rejected
 *   fail-closed, never silently rewritten.
 * - Existing records revalidate before any success is claimed; an
 *   error-after-commit retry simply reads the winner back.
 * - `onversionchange`/late opens/transaction aborts resolve as explicit
 *   errors, never a hung promise or a false write.
 *
 * Local-only, same-origin browser storage: not shared backend storage.
 * Read subscriptions are in-process + BroadcastChannel (same origin).
 */
import {
  JOB_SNAPSHOT_VERSION,
  canonicalCompositionPayload,
  validateComposition,
  type JobCompositionSnapshot,
  type JobCustomer,
} from "./snapshot";

export const JOBS_DB_NAME = "mateco.jobs.v1";
export const JOBS_STORE_NAME = "jobs";
export const JOBS_DB_VERSION = 1 as const;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export type JobsErrorCode =
  | "UNAVAILABLE"
  | "DENIED"
  | "QUOTA"
  | "BLOCKED"
  | "TRANSACTION_ABORTED"
  | "UNSUPPORTED"
  | "CORRUPT"
  | "INVALID"
  | "NOT_FOUND"
  | "CONFLICT";

export interface JobsError {
  code: JobsErrorCode;
  message: string;
}

export interface StoredJob {
  version: typeof JOB_SNAPSHOT_VERSION;
  attemptKey: string;
  id: string;
  createdAt: string;
  status: "pending";
  composition: JobCompositionSnapshot;
  customer?: JobCustomer;
}

export interface CreateInput {
  attemptKey: string;
  composition: unknown;
  customer?: JobCustomer;
  createdAt?: string;
}

export type CreateResult =
  { ok: true; job: StoredJob } | { ok: false; error: JobsError };

export type GetResult =
  { ok: true; job: StoredJob } | { ok: false; error: JobsError };

export interface SkippedJob {
  attemptKey?: string;
  reason: string;
}

export type ListResult =
  | {
      ok: true;
      jobs: StoredJob[];
      skipped: SkippedJob[];
      nextCursor: string | null;
    }
  | { ok: false; error: JobsError };

export interface JobsRepository {
  create(input: CreateInput): Promise<CreateResult>;
  get(attemptKey: string): Promise<GetResult>;
  list(page?: { limit?: number; cursor?: string | null }): Promise<ListResult>;
  subscribe(listener: () => void): () => void;
}

const invalid = (message: string): JobsError => ({ code: "INVALID", message });

function cleanKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 200) return null;
  return trimmed;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  if (Number.isNaN(Date.parse(value))) return null;
  return value;
}

/** v1 canonical icon frame/paint (mirrors the snapshot normalization). */
const ICON_FRAME_V1 = { width: 32, height: 32 };
const ICON_PAINT_V1 = {
  fill: "none",
  stroke: "#171717",
  strokeWidth: 1.7,
  linecap: "round",
  linejoin: "round",
  innerTransform: "scale(1.4) translate(-16 -16)",
};

function sameIconFrame(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    frame.width === ICON_FRAME_V1.width && frame.height === ICON_FRAME_V1.height
  );
}

function sameIconPaint(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const paint = value as Record<string, unknown>;
  return (
    paint.fill === ICON_PAINT_V1.fill &&
    paint.stroke === ICON_PAINT_V1.stroke &&
    paint.strokeWidth === ICON_PAINT_V1.strokeWidth &&
    paint.linecap === ICON_PAINT_V1.linecap &&
    paint.linejoin === ICON_PAINT_V1.linejoin &&
    paint.innerTransform === ICON_PAINT_V1.innerTransform
  );
}

/**
 * F7 fail-closed paint gate (snapshot version stays 1). Every v1 icon
 * definition is normalized to the canonical frame/paint above — that
 * rewrite is intentional and versioned, not silent drift. A record that
 * carries a DIFFERING frame/paint (a future version's semantics) is
 * rejected here instead of being rewritten; an absent frame/paint is
 * treated as v1. Accepts a stored record envelope or a bare
 * composition. Total: invalid input yields a reason, never a throw.
 */
function rejectUnknownIconPaint(record: unknown): string | null {
  try {
    if (typeof record !== "object" || record === null) return null;
    const holder = record as Record<string, unknown>;
    const composition =
      holder.composition !== undefined ? holder.composition : record;
    if (typeof composition !== "object" || composition === null) return null;
    const icons = (composition as Record<string, unknown>).icons;
    if (!Array.isArray(icons)) return null;
    for (const icon of icons) {
      if (typeof icon !== "object" || icon === null) continue;
      const definition = (icon as Record<string, unknown>).definition;
      if (typeof definition !== "object" || definition === null) continue;
      const raw = definition as Record<string, unknown>;
      const label =
        typeof raw.id === "string" && raw.id.trim() !== ""
          ? raw.id.trim()
          : "desconocido";
      if (raw.frame !== undefined && !sameIconFrame(raw.frame))
        return `Ícono "${label}": marco incorporado de versión desconocida; se rechaza en lugar de reescribirlo.`;
      if (raw.paint !== undefined && !sameIconPaint(raw.paint))
        return `Ícono "${label}": pintura incorporada de versión desconocida; se rechaza en lugar de reescribirla.`;
    }
    return null;
  } catch {
    return "Definición de ícono incorporada ilegible.";
  }
}

function errorForRequest(error: unknown, action: string): JobsError {
  const name =
    error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : "";
  if (name === "QuotaExceededError")
    return {
      code: "QUOTA",
      message: `No se pudo ${action}: se agotó la cuota de almacenamiento. Nada se guardó.`,
    };
  if (
    name === "SecurityError" ||
    name === "NotAllowedError" ||
    name === "DeniedError"
  )
    return {
      code: "DENIED",
      message: `No se pudo ${action}: el navegador denegó el almacenamiento.`,
    };
  if (name === "ConstraintError")
    return {
      code: "CONFLICT",
      message: `No se pudo ${action}: el trabajo ya existe con otro contenido y no se sobrescribe.`,
    };
  if (name === "AbortError" || name === "TransactionInactiveError")
    return {
      code: "TRANSACTION_ABORTED",
      message: `No se pudo ${action}: la transacción se interrumpió. Nada se guardó.`,
    };
  if (name === "VersionError" || name === "InvalidStateError")
    return {
      code: "BLOCKED",
      message: `No se pudo ${action}: la base de trabajos está bloqueada por otra pestaña.`,
    };
  return {
    code: "UNAVAILABLE",
    message: `No se pudo ${action}: el almacenamiento no está disponible. Nada se guardó.`,
  };
}

/** Total per-record validation: invalid is returned, never thrown. */
function validateStoredJob(value: unknown): ValidateResultOfJob {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return { ok: false as const, reason: "Registro ilegible." };
    // F7: fail-closed paint gate before any normalizing validation.
    const paintError = rejectUnknownIconPaint(value);
    if (paintError) return { ok: false as const, reason: paintError };
    const record = value as Record<string, unknown>;
    if (record.version !== JOB_SNAPSHOT_VERSION)
      return {
        ok: false as const,
        reason: `Versión de trabajo desconocida (${String(record.version)}).`,
      };
    const attemptKey = cleanKey(record.attemptKey);
    if (!attemptKey)
      return {
        ok: false as const,
        reason: "Registro sin clave de intento válida.",
      };
    const id = cleanKey(record.id);
    if (!id)
      return {
        ok: false as const,
        reason: `Registro "${attemptKey}": sin identificador válido.`,
      };
    const createdAt = cleanDate(record.createdAt);
    if (!createdAt)
      return {
        ok: false as const,
        reason: `Registro "${attemptKey}": fecha inválida.`,
      };
    if (record.status !== "pending")
      return {
        ok: false as const,
        reason: `Registro "${attemptKey}": estado no admitido.`,
      };
    const checked = validateComposition(record.composition);
    if (!checked.ok)
      return {
        ok: false as const,
        reason: `Registro "${attemptKey}": ${checked.reason}`,
      };
    const job: StoredJob = {
      version: JOB_SNAPSHOT_VERSION,
      attemptKey,
      id,
      createdAt,
      status: "pending",
      composition: checked.composition,
    };
    if (record.customer !== undefined) {
      const customer = record.customer as Record<string, unknown>;
      if (
        typeof customer !== "object" ||
        customer === null ||
        Array.isArray(customer)
      )
        return {
          ok: false as const,
          reason: `Registro "${attemptKey}": cliente inválido.`,
        };
      const out: JobCustomer = {};
      if (customer.name !== undefined) {
        if (typeof customer.name !== "string" || customer.name.length > 200)
          return {
            ok: false as const,
            reason: `Registro "${attemptKey}": cliente inválido.`,
          };
        if (customer.name.trim() !== "") out.name = customer.name.trim();
      }
      if (customer.note !== undefined) {
        if (typeof customer.note !== "string" || customer.note.length > 200)
          return {
            ok: false as const,
            reason: `Registro "${attemptKey}": cliente inválido.`,
          };
        if (customer.note.trim() !== "") out.note = customer.note.trim();
      }
      if (out.name !== undefined || out.note !== undefined) job.customer = out;
    }
    return { ok: true as const, job };
  } catch {
    return { ok: false as const, reason: "El registro no se pudo revisar." };
  }
}

type ValidateResultOfJob =
  { ok: true; job: StoredJob } | { ok: false; reason: string };

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("request failed"));
  });
}

function indexedDBHandle(): IDBFactory | null {
  try {
    if (typeof indexedDB === "undefined" || indexedDB === null) return null;
    return indexedDB;
  } catch {
    return null;
  }
}

export function createJobsRepository(options?: {
  name?: string;
}): JobsRepository {
  const dbName = options?.name ?? JOBS_DB_NAME;
  const channelName = `mateco-jobs:${dbName}`;
  const listeners = new Set<() => void>();
  let broadcast: BroadcastChannel | null = null;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A failing subscriber never breaks the repository.
      }
    }
    try {
      if (broadcast === null && typeof BroadcastChannel !== "undefined")
        broadcast = new BroadcastChannel(channelName);
      broadcast?.postMessage({ type: "jobs-changed" });
    } catch {
      // Broadcast is best-effort only.
    }
  };

  const ensureBroadcast = (): void => {
    if (broadcast !== null) return;
    try {
      if (typeof BroadcastChannel === "undefined") return;
      broadcast = new BroadcastChannel(channelName);
      broadcast.onmessage = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            // ignore
          }
        }
      };
    } catch {
      broadcast = null;
    }
  };

  const openDatabase = (): Promise<
    { ok: true; db: IDBDatabase } | { ok: false; error: JobsError }
  > =>
    new Promise((resolve) => {
      const factory = indexedDBHandle();
      if (!factory)
        return resolve({
          ok: false,
          error: {
            code: "UNSUPPORTED",
            message:
              "Este navegador no ofrece IndexedDB para guardar trabajos.",
          },
        });
      let settled = false;
      const done = (
        result: { ok: true; db: IDBDatabase } | { ok: false; error: JobsError },
      ) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      // A blocked upgrade must surface as an explicit error, never a hang.
      const watchdog = setTimeout(() => {
        done({
          ok: false,
          error: {
            code: "BLOCKED",
            message: "La base de trabajos está bloqueada por otra pestaña.",
          },
        });
      }, 10_000);
      if (
        typeof watchdog === "object" &&
        typeof (watchdog as { unref?: () => void }).unref === "function"
      )
        (watchdog as unknown as { unref: () => void }).unref();
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(dbName, JOBS_DB_VERSION);
      } catch (error) {
        clearTimeout(watchdog);
        return done({
          ok: false,
          error: errorForRequest(error, "abrir la base de trabajos"),
        });
      }
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        // Fresh database: create our own store. Anything else (older
        // version without our store, newer version) is left alone and
        // reported — never deleted or recreated automatically.
        if (
          oldVersion === 0 &&
          !db.objectStoreNames.contains(JOBS_STORE_NAME)
        ) {
          db.createObjectStore(JOBS_STORE_NAME, { keyPath: "attemptKey" });
          return;
        }
        if (!db.objectStoreNames.contains(JOBS_STORE_NAME)) {
          request.transaction?.abort();
          clearTimeout(watchdog);
          try {
            db.close();
          } catch {
            // ignore
          }
          done({
            ok: false,
            error: {
              code: "CORRUPT",
              message:
                "La base de trabajos tiene un formato desconocido y se conserva intacta.",
            },
          });
        }
      };
      request.onsuccess = () => {
        // F2: the watchdog may already have resolved BLOCKED while this
        // open was still pending. A late arrival must close its
        // connection immediately so no handle leaks — the BLOCKED result
        // stands, it is never replaced by a misleading late success.
        if (settled) {
          try {
            request.result.close();
          } catch {
            // ignore: the close itself is best-effort.
          }
          return;
        }
        clearTimeout(watchdog);
        const db = request.result;
        if (!db.objectStoreNames.contains(JOBS_STORE_NAME)) {
          try {
            db.close();
          } catch {
            // ignore
          }
          return done({
            ok: false,
            error: {
              code: "CORRUPT",
              message:
                "La base de trabajos tiene un formato desconocido y se conserva intacta.",
            },
          });
        }
        db.onversionchange = () => {
          // Another connection wants to upgrade: close promptly so the UI
          // never hangs on a versionchange-blocked open.
          try {
            db.close();
          } catch {
            // ignore
          }
        };
        done({ ok: true, db });
      };
      request.onerror = () => {
        clearTimeout(watchdog);
        done({
          ok: false,
          error: errorForRequest(request.error, "abrir la base de trabajos"),
        });
      };
      request.onblocked = () => {
        clearTimeout(watchdog);
        done({
          ok: false,
          error: {
            code: "BLOCKED",
            message:
              "La base de trabajos está bloqueada por otra pestaña. Cerrala e intentá de nuevo.",
          },
        });
      };
    });

  const create = async (input: CreateInput): Promise<CreateResult> => {
    const attemptKey = cleanKey(input.attemptKey);
    if (!attemptKey)
      return {
        ok: false,
        error: invalid("Falta la clave de intento de confirmación."),
      };
    // Validate BEFORE any storage work; the canonical payload is captured
    // before async operations for the conflict comparison.
    const checked = validateComposition(input.composition);
    if (!checked.ok) return { ok: false, error: invalid(checked.reason) };
    // F7: fail-closed paint gate on the raw input (version stays 1).
    const paintError = rejectUnknownIconPaint(input.composition);
    if (paintError) return { ok: false, error: invalid(paintError) };
    let customer: JobCustomer | undefined;
    if (input.customer !== undefined) {
      if (typeof input.customer !== "object" || input.customer === null)
        return { ok: false, error: invalid("Datos del cliente inválidos.") };
      const out: JobCustomer = {};
      if (input.customer.name !== undefined) {
        if (
          typeof input.customer.name !== "string" ||
          input.customer.name.length > 200
        )
          return { ok: false, error: invalid("Datos del cliente inválidos.") };
        if (input.customer.name.trim() !== "")
          out.name = input.customer.name.trim();
      }
      if (input.customer.note !== undefined) {
        if (
          typeof input.customer.note !== "string" ||
          input.customer.note.length > 200
        )
          return { ok: false, error: invalid("Datos del cliente inválidos.") };
        if (input.customer.note.trim() !== "")
          out.note = input.customer.note.trim();
      }
      if (out.name !== undefined || out.note !== undefined) customer = out;
    }
    const createdAt =
      input.createdAt !== undefined
        ? cleanDate(input.createdAt)
        : new Date().toISOString();
    if (!createdAt) return { ok: false, error: invalid("Fecha inválida.") };
    // F6: the customer fragment is prebound BEFORE the canonical
    // stringify. captureComposition already caps name/note at 200 chars;
    // this guard keeps the identity comparison bounded even for
    // hand-built inputs. Oversized customer data is a typed INVALID,
    // never silently trimmed.
    if (customer !== undefined) {
      let customerChars = -1;
      try {
        customerChars = JSON.stringify(customer)?.length ?? -1;
      } catch {
        customerChars = -1;
      }
      if (customerChars < 0 || customerChars > 1024)
        return { ok: false, error: invalid("Datos del cliente inválidos.") };
    }
    const canonical = canonicalCompositionPayload(
      checked.composition,
      customer,
    );
    if (!canonical.ok) return { ok: false, error: invalid(canonical.reason) };

    const opened = await openDatabase();
    if (!opened.ok) return opened;
    const db = opened.db;
    try {
      // ONE atomic readwrite transaction: get, then add only when absent.
      const outcome = await new Promise<
        | { ok: true; job: StoredJob }
        | { ok: false; error: JobsError; conflictWinner?: StoredJob }
      >((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(JOBS_STORE_NAME, "readwrite");
        } catch (error) {
          return resolve({
            ok: false,
            error: errorForRequest(error, "guardar el trabajo"),
          });
        }
        let finished = false;
        const finish = (
          result:
            { ok: true; job: StoredJob } | { ok: false; error: JobsError },
        ) => {
          if (finished) return;
          finished = true;
          resolve(result);
        };
        // Success is claimed ONLY on transaction complete, never on
        // request success: an abort after request success must not read
        // as a save. `racing` marks the ConstraintError handoff so the
        // settling transaction cannot mask the winner read.
        let pendingJob: StoredJob | null = null;
        let racing = false;
        tx.oncomplete = () => {
          if (racing) return;
          if (pendingJob) finish({ ok: true, job: pendingJob });
          else
            finish({
              ok: false,
              error: errorForRequest(tx.error, "guardar el trabajo"),
            });
        };
        tx.onerror = () => {
          if (!racing)
            finish({
              ok: false,
              error: errorForRequest(tx.error, "guardar el trabajo"),
            });
        };
        tx.onabort = () => {
          if (!racing && !finished)
            finish({
              ok: false,
              error: errorForRequest(tx.error, "guardar el trabajo"),
            });
        };
        let table: IDBObjectStore;
        try {
          table = tx.objectStore(JOBS_STORE_NAME);
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "guardar el trabajo"),
          });
        }
        let getRequest: IDBRequest<unknown>;
        try {
          getRequest = table.get(attemptKey);
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "guardar el trabajo"),
          });
        }
        getRequest.onsuccess = () => {
          const existing = getRequest.result as StoredJob | undefined;
          if (existing !== undefined) {
            // Revalidate the stored record before claiming success.
            const revalidated = validateStoredJob(existing);
            if (!revalidated.ok) {
              try {
                tx.abort();
              } catch {
                // ignore
              }
              return finish({
                ok: false,
                error: {
                  code: "CORRUPT",
                  message: `El trabajo guardado está dañado: ${revalidated.reason}`,
                },
              });
            }
            const same = canonicalCompositionPayload(
              revalidated.job.composition,
              revalidated.job.customer,
            );
            if (!same.ok || same.canonical !== canonical.canonical) {
              try {
                tx.abort();
              } catch {
                // ignore
              }
              return finish({
                ok: false,
                error: {
                  code: "CONFLICT",
                  message:
                    "Ese intento de confirmación ya guardó otro contenido y no se sobrescribe.",
                },
              });
            }
            // Same key + same payload: existing job, no duplicate, no
            // rewrite, stable id/date. The transaction commits empty and
            // oncomplete claims the success.
            pendingJob = revalidated.job;
            return;
          }
          const record: StoredJob = {
            version: JOB_SNAPSHOT_VERSION,
            attemptKey,
            id: attemptKey,
            createdAt,
            status: "pending",
            composition: checked.composition,
          };
          if (customer) record.customer = customer;
          let addRequest: IDBRequest<IDBValidKey>;
          try {
            addRequest = table.add(
              record as unknown as Record<string, unknown>,
            );
          } catch (error) {
            return finish({
              ok: false,
              error: errorForRequest(error, "guardar el trabajo"),
            });
          }
          addRequest.onsuccess = () => {
            pendingJob = record;
          };
          addRequest.onerror = () => {
            const error = addRequest.error;
            if (
              error instanceof DOMException &&
              error.name === "ConstraintError"
            ) {
              // Defensive path: IndexedDB serializes same-store writers,
              // so the second create normally observes the winner through
              // its initial get and never reaches this branch. When an
              // ordering surfaces ConstraintError instead, hand off to a
              // fresh winner read rather than overwriting; the settling
              // transaction is ignored via `racing`.
              racing = true;
              const winner = async (): Promise<void> => {
                try {
                  const fresh = await readWinnerJob(db, attemptKey);
                  if (!fresh.ok)
                    return finish({ ok: false, error: fresh.error });
                  const same = canonicalCompositionPayload(
                    fresh.job.composition,
                    fresh.job.customer,
                  );
                  if (!same.ok || same.canonical !== canonical.canonical)
                    return finish({
                      ok: false,
                      error: {
                        code: "CONFLICT",
                        message:
                          "Ese intento de confirmación ya guardó otro contenido y no se sobrescribe.",
                      },
                    });
                  finish({ ok: true, job: fresh.job });
                } catch (error_) {
                  finish({
                    ok: false,
                    error: errorForRequest(error_, "guardar el trabajo"),
                  });
                }
              };
              void winner();
              return;
            }
            finish({
              ok: false,
              error: errorForRequest(error, "guardar el trabajo"),
            });
          };
        };
        getRequest.onerror = () =>
          finish({
            ok: false,
            error: errorForRequest(getRequest.error, "guardar el trabajo"),
          });
      });
      if (outcome.ok) {
        notify();
        return outcome;
      }
      return outcome;
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  };

  const getJob = async (attemptKey: string): Promise<GetResult> => {
    const key = cleanKey(attemptKey);
    if (!key)
      return { ok: false, error: invalid("Clave de trabajo inválida.") };
    const opened = await openDatabase();
    if (!opened.ok) return opened;
    const db = opened.db;
    try {
      // F1: reads resolve ok ONLY on tx.oncomplete (mirror of the write
      // path). A request success followed by an abort must never read
      // as a fetch; request/abort failures yield typed errors, never a
      // false empty success.
      const outcome = await new Promise<GetResult>((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(JOBS_STORE_NAME, "readonly");
        } catch (error) {
          return resolve({
            ok: false,
            error: errorForRequest(error, "leer el trabajo"),
          });
        }
        let finished = false;
        const finish = (result: GetResult) => {
          if (finished) return;
          finished = true;
          resolve(result);
        };
        let pending: GetResult | null = null;
        tx.oncomplete = () => {
          if (pending) finish(pending);
          else
            finish({
              ok: false,
              error: errorForRequest(tx.error, "leer el trabajo"),
            });
        };
        tx.onerror = () => {
          if (!finished)
            finish({
              ok: false,
              error: errorForRequest(tx.error, "leer el trabajo"),
            });
        };
        tx.onabort = () => {
          if (!finished)
            finish({
              ok: false,
              error: errorForRequest(tx.error, "leer el trabajo"),
            });
        };
        let table: IDBObjectStore;
        try {
          table = tx.objectStore(JOBS_STORE_NAME);
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "leer el trabajo"),
          });
        }
        let request: IDBRequest<unknown>;
        try {
          request = table.get(key);
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "leer el trabajo"),
          });
        }
        request.onsuccess = () => {
          if (finished) return;
          const stored = request.result as StoredJob | undefined;
          if (stored === undefined) {
            pending = {
              ok: false,
              error: { code: "NOT_FOUND", message: "Ese trabajo no existe." },
            };
            return;
          }
          const checked = validateStoredJob(stored);
          if (!checked.ok) {
            pending = {
              ok: false,
              error: {
                code: "CORRUPT",
                message: `El trabajo guardado está dañado: ${checked.reason}`,
              },
            };
            return;
          }
          pending = { ok: true, job: checked.job };
        };
        request.onerror = () => {
          pending = {
            ok: false,
            error: errorForRequest(request.error, "leer el trabajo"),
          };
        };
      });
      return outcome;
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  };

  const list = async (page?: {
    limit?: number;
    cursor?: string | null;
  }): Promise<ListResult> => {
    const limit = Math.max(
      1,
      Math.min(page?.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT),
    );
    const cursor = page?.cursor ?? null;
    if (cursor !== null && cleanKey(cursor) === null)
      return { ok: false, error: invalid("Cursor de listado inválido.") };
    const opened = await openDatabase();
    if (!opened.ok) return opened;
    const db = opened.db;
    try {
      const jobs: StoredJob[] = [];
      const skipped: SkippedJob[] = [];
      // Bounded cursor walk: read limit+1 to know whether a next page
      // exists, never an unbounded getAll over multi-MB assets.
      // F1: like the write path and get, this walk resolves ok ONLY on
      // tx.oncomplete. The cursor handler only stages a pending outcome;
      // an abort after the last cursor yields a typed error, never a
      // false empty success.
      const walked = await new Promise<
        | { ok: true; nextCursor: string | null }
        | { ok: false; error: JobsError }
      >((resolve) => {
        let tx: IDBTransaction;
        try {
          tx = db.transaction(JOBS_STORE_NAME, "readonly");
        } catch (error) {
          return resolve({
            ok: false,
            error: errorForRequest(error, "listar los trabajos"),
          });
        }
        let finished = false;
        const finish = (
          result:
            | { ok: true; nextCursor: string | null }
            | { ok: false; error: JobsError },
        ) => {
          if (finished) return;
          finished = true;
          resolve(result);
        };
        let pending: { ok: true; nextCursor: string | null } | null = null;
        let failed: JobsError | null = null;
        tx.oncomplete = () => {
          if (failed) finish({ ok: false, error: failed });
          else if (pending) finish(pending);
          else
            finish({
              ok: false,
              error: errorForRequest(tx.error, "listar los trabajos"),
            });
        };
        tx.onerror = () =>
          finish({
            ok: false,
            error: errorForRequest(tx.error, "listar los trabajos"),
          });
        tx.onabort = () => {
          if (!finished)
            finish({
              ok: false,
              error: errorForRequest(tx.error, "listar los trabajos"),
            });
        };
        let table: IDBObjectStore;
        try {
          table = tx.objectStore(JOBS_STORE_NAME);
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "listar los trabajos"),
          });
        }
        const range =
          cursor === null ? null : IDBKeyRange.lowerBound(cursor, true);
        let request: IDBRequest<IDBCursorWithValue | null>;
        try {
          request = table.openCursor(range, "next");
        } catch (error) {
          return finish({
            ok: false,
            error: errorForRequest(error, "listar los trabajos"),
          });
        }
        let lastKey: string | null = null;
        let over = false;
        request.onsuccess = () => {
          if (finished) return;
          const cursorValue: IDBCursorWithValue | null = request.result;
          if (!cursorValue) {
            // Stage, do not resolve: only tx.oncomplete claims success.
            pending = { ok: true, nextCursor: null };
            return;
          }
          if (jobs.length > limit) {
            over = true;
            pending = { ok: true, nextCursor: lastKey };
            return;
          }
          const key = String(cursorValue.key);
          const checked = validateStoredJob(cursorValue.value);
          if (!checked.ok) {
            skipped.push({ attemptKey: key, reason: checked.reason });
          } else if (jobs.length === limit) {
            // One past the page: there is more to read.
            over = true;
            lastKey = key;
            pending = { ok: true, nextCursor: key };
            return;
          } else {
            jobs.push(checked.job);
            lastKey = key;
          }
          if (over) return;
          try {
            cursorValue.continue();
          } catch (error) {
            failed = errorForRequest(error, "listar los trabajos");
          }
        };
        request.onerror = () => {
          failed = errorForRequest(request.error, "listar los trabajos");
        };
      });
      if (!walked.ok) return walked;
      return { ok: true, jobs, skipped, nextCursor: walked.nextCursor };
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  };

  const get = (attemptKey: string): Promise<GetResult> => getJob(attemptKey);

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    ensureBroadcast();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        try {
          broadcast?.close();
        } catch {
          // ignore
        }
        broadcast = null;
      }
    };
  };

  return { create, get, list, subscribe };
}

async function readWinnerJob(
  db: IDBDatabase,
  attemptKey: string,
): Promise<GetResult> {
  try {
    const tx = db.transaction(JOBS_STORE_NAME, "readonly");
    const table = tx.objectStore(JOBS_STORE_NAME);
    const stored = await requestToPromise<unknown>(table.get(attemptKey));
    if (stored === undefined)
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "Ese trabajo no existe." },
      };
    const checked = validateStoredJob(stored);
    if (!checked.ok)
      return {
        ok: false,
        error: {
          code: "CORRUPT",
          message: `El trabajo guardado está dañado: ${checked.reason}`,
        },
      };
    return { ok: true, job: checked.job };
  } catch (error) {
    return { ok: false, error: errorForRequest(error, "leer el trabajo") };
  }
}
