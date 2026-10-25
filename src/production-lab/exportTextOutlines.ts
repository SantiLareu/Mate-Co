/**
 * Gate de fuentes del exportador del laboratorio (Etapa 3 -> Etapa 4).
 * Pure, sync, DOM-free.
 *
 * HISTORIA
 *   - Etapa 3 (decisión L2 del usuario): el bloqueo era técnico; no había
 *     ninguna fuente empaquetada ni parser de contornos, y la única vía
 *     (raster -> VTracer) era no determinista y prohibida para grabado.
 *   - Etapa 4: el motor vectorial (src/typography, HarfBuzz) y el catálogo
 *     empaquetado YA EXISTEN y están validados contra el navegador. Este
 *     módulo sigue bloqueando, pero ahora el bloqueo es DELIBERADO: la
 *     exportación con contornos reales se habilita en un paso posterior,
 *     después de revisar la paridad entre la vista previa y el SVG exportado.
 *
 * El veredicto se sustituye sin tocar el serializador del exportador.
 */
import type { LabExportCode, PlacedText } from "./types";

export const LAB_FONT_BLOCK_CODE = "FONT_OUTLINES_UNAVAILABLE";

/**
 * Evidencia del bloqueo (Etapa 4).
 *
 * El catálogo empaquetado (Poppins SemiBold, Lato SemiBold, Dancing Script)
 * y el motor de contornos vectoriales (src/typography) ya están disponibles y
 * verificados contra el navegador; la exportación con texto sigue bloqueada
 * por decisión de secuencia: primero se valida la paridad entre la vista
 * previa del laboratorio y el SVG exportado, después se habilita.
 *
 * Mientras tanto, las composiciones con texto fallan el export con un código
 * explícito, en vez de exportar con una fuente sustituida o una equivalencia
 * fingida.
 */
export const LAB_FONT_BLOCK_EVIDENCE =
  "Bloqueo deliberado de la exportación con texto (Etapa 4): el catálogo " +
  "empaquetado (Poppins SemiBold, Lato SemiBold, Dancing Script) y el motor " +
  "de contornos vectoriales (src/typography) ya existen y están validados " +
  "contra el navegador; la exportación con texto se habilita en un paso " +
  "posterior, tras revisar la paridad entre la vista previa y el SVG " +
  "exportado. Mientras tanto la composición falla con un código explícito, " +
  "sin sustituir fuentes ni fingir equivalencias.";

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
