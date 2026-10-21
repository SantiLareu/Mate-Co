import type { TextElement } from "../components/CurvedText";
import { scaleToPhysical } from "./geometry";
import type { PhysicalFrame, TextMeasurement } from "./types";

/**
 * Text advance plumbing for the lab (P2, S5). The lab measures the
 * straight-text ADVANCE (getComputedTextLength) of the real render at
 * SOURCE units, once per source text, then converts with scaleToPhysical
 * per frame — so a diameter change never leaves stale mm metrics behind.
 * Advance is never an ink bbox: provenance says so on every measurement.
 */
export const MEASURE_PROVENANCE =
  "browser-getComputedTextLength straight-text advance scaled to physical; font-dependent, not ink bbox";

/** Stable identity for the source texts being measured (content/font/scale). */
export function sourceAdvanceKey(texts: readonly TextElement[]): string {
  return texts
    .map(
      (item) => `${item.id}|${item.text}|${item.fontFamily}|${item.scale ?? 1}`,
    )
    .join(";");
}

/**
 * J3 — Parent-owned measurement identity: the source composition id
 * ("demo" or the job attemptKey) prefixes the text content/font/scale
 * fingerprint, so switching sources (job A → demo → job A) always yields
 * a fresh measurement key even when two compositions share identical
 * texts. The lab uses it as the measurer remount key and as the
 * completion-closure identity: no child/parent key-ref race, no stale
 * mm reuse across sources, no permanent "measuring" state.
 */
export function labSourceMeasureKey(
  sourceId: string,
  texts: readonly TextElement[],
): string {
  const clean = sourceId.trim() === "" ? "demo" : sourceId.trim();
  return `${clean}|${sourceAdvanceKey(texts)}`;
}

/** Memoized source-unit advances converted to mm for the current frame. */
export function toPhysicalMeasurements(
  advances: ReadonlyMap<string, number>,
  frame: PhysicalFrame,
): Map<string, TextMeasurement> {
  const out = new Map<string, TextMeasurement>();
  for (const [id, advance] of advances) {
    out.set(id, {
      lengthMm: scaleToPhysical(advance, frame),
      provenance: MEASURE_PROVENANCE,
    });
  }
  return out;
}

/**
 * Per-id completion status once the probe has published: ids absent from the
 * completed advance map have NO browser advance (unavailable/empty/throw),
 * which the UI labels explicitly instead of pending forever. Advance
 * unavailable is distinct from ink unknown (the report's
 * text-ink-unmeasured, which holds even for measured advances).
 */
export function missingAdvanceIds(
  texts: readonly TextElement[],
  advances: ReadonlyMap<string, number>,
): string[] {
  return texts.filter((item) => !advances.has(item.id)).map((item) => item.id);
}
