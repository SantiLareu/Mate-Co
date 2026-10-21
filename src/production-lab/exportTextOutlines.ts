/**
 * E1 font gate (Stage 3, fonts-block-gate, user decision L2).
 * Pure, sync, DOM-free. Returns the export blocker today; a future
 * bundled-OFL-font + outline-parser stage replaces this module's verdict
 * without touching the core serializer.
 */
import type { LabExportCode, PlacedText } from "./types";

export const LAB_FONT_BLOCK_CODE = "FONT_OUTLINES_UNAVAILABLE";

/**
 * Documented evidence for the fonts blocker (audit mvf6jiu8-1-68sb, L2):
 * the editor paints text only with proprietary system fonts
 * (DesignPanel: Georgia/Arial/Times New Roman/Trebuchet MS/Verdana); no
 * @font-face/font files/parser dependencies exist anywhere; the browser
 * exposes no glyph outlines; the only existing outlines path is
 * raster->VTracer (textOutlines.ts), which is non-deterministic and
 * forbidden for engraving. Per user decision "A: Bloqueo claro para
 * textos (recomendado)", compositions containing text fail export instead
 * of silently substituting fonts or faking equivalence.
 */
export const LAB_FONT_BLOCK_EVIDENCE =
  "Bloqueo claro para textos (decisión de usuario L2): el editor usa solo " +
  "fuentes propietarias del sistema (Georgia/Arial/Times New Roman/Trebuchet " +
  "MS/Verdana, sin @font-face ni archivos de fuente ni parser en el proyecto); " +
  "el navegador no expone contornos de glifos y la única vía existente " +
  "(raster→VTracer) es no determinista y está prohibida. Solución futura " +
  "segura propuesta (no implementada): fuente OFL empaquetada + parser de " +
  "contornos (Stage 4, decisión de licencia).";

export function labFontBlockReason(count: number): string {
  return (
    `La composición contiene ${count} texto(s): ${LAB_FONT_BLOCK_EVIDENCE}`
  );
}

export function checkLabTextsBlocked(
  texts: readonly PlacedText[],
): { ok: true } | { ok: false; code: LabExportCode; reason: string } {
  if (texts.length === 0) return { ok: true };
  return {
    ok: false,
    code: LAB_FONT_BLOCK_CODE,
    reason: labFontBlockReason(texts.length),
  };
}
