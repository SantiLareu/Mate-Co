/**
 * Adaptador AISLADO entre el laboratorio físico y el motor tipográfico.
 *
 * QUÉ ES Y QUÉ NO ES
 *   - Convierte un texto del laboratorio en contornos vectoriales (mm) con el
 *     motor de `src/typography`, usando EXACTAMENTE las medidas que el
 *     laboratorio ya calculó (fontSizeMm, letterSpacingMm, baselineRadiusMm,
 *     ángulo, dy de invertido).
 *   - NO está conectado al exportador: el gate `FONT_OUTLINES_UNAVAILABLE`
 *     sigue vigente para el uso real. Este módulo existe para demostrar la
 *     paridad de geometría y dejar preparada la integración cuando se autorice.
 *
 * LA PARIDAD Y SU LÍMITE (documentado, no oculto)
 *   La vista previa del laboratorio (PhysicalComposition.tsx) pinta el texto con
 *   `source.fontFamily`: las fuentes del EDITOR (Georgia, Arial, Times New Roman,
 *   Trebuchet MS, Verdana), que son propietarias y no se pueden empaquetar. Un
 *   SVG exportado con contornos vectoriales NUNCA puede ser idéntico a esa
 *   vista previa mientras use esas fuentes.
 *   Por eso aquí el mapeo de familia es EXPRESO: si la familia pedida no está
 *   en el catálogo empaquetado, se devuelve `null` y quien llama decide. No hay
 *   sustitución silenciosa.
 */
import {
  renderCurvedText,
  type TypographyFontId,
  TYPOGRAPHY_FONTS,
} from "../typography";

/** Familias del catálogo empaquetado, por nombre visible. */
const FAMILY_TO_ID = new Map<string, TypographyFontId>(
  Object.values(TYPOGRAPHY_FONTS).map((f) => [f.family, f.id]),
);

/**
 * Mapea una familia de texto del laboratorio al catálogo empaquetado.
 *
 * Devuelve `null` si la familia no está en el catálogo: el llamante debe
 * bloquear el caso explícitamente (nunca sustituir la fuente).
 */
export function catalogueFontForFamily(family: string): TypographyFontId | null {
  return FAMILY_TO_ID.get(family.trim()) ?? null;
}

/** Medidas del laboratorio que el motor necesita para colocar el texto. */
export type LabTextGeometry = {
  fontSizeMm: number;
  letterSpacingMm: number;
  baselineRadiusMm: number;
  /** Ángulo del elemento: 0 arriba, grados horarios. */
  angle: number;
  /** Texto invertido (progresión antihoraria). */
  inverted: boolean;
  /** Desplazamiento local en la dirección radial (0 si no está invertido). */
  invertedDyMm: number;
};

export type LabOutlineResult =
  | {
      ok: true;
      fontId: TypographyFontId;
      /** Paths de cada glifo, en milímetros absolutos. */
      paths: { char: string; d: string }[];
      /** Longitud total del texto en el arco, mm. */
      totalAdvanceMm: number;
      /** Versión de HarfBuzz usada (reproducibilidad). */
      shaperVersion: string;
    }
  | {
      ok: false;
      code:
        | "FONT_NOT_IN_CATALOGUE"
        | "FONT_UNAVAILABLE"
        | "FONT_INVALID"
        | "GLYPH_MISSING"
        | "TEXT_NOT_NFC"
        | "SHAPER_UNAVAILABLE";
      reason: string;
    };

/**
 * Contornos vectoriales de un texto del laboratorio.
 *
 * `fontId` debe venir de una decisión explícita (idealmente
 * `catalogueFontForFamily`); este módulo NO elige la fuente por el llamante.
 */
export async function labTextOutlines(
  text: string,
  fontId: TypographyFontId,
  geometry: LabTextGeometry,
): Promise<LabOutlineResult> {
  if (!TYPOGRAPHY_FONTS[fontId]) {
    return {
      ok: false,
      code: "FONT_NOT_IN_CATALOGUE",
      reason: `La fuente ${fontId} no está en el catálogo empaquetado.`,
    };
  }
  const result = await renderCurvedText({
    text,
    fontId,
    weight: TYPOGRAPHY_FONTS[fontId].variable ? 600 : undefined,
    fontSizeMm: geometry.fontSizeMm,
    letterSpacingMm: geometry.letterSpacingMm,
    baselineRadiusMm: geometry.baselineRadiusMm,
    angleDegrees: geometry.angle,
    inverted: geometry.inverted,
    invertedDyMm: geometry.invertedDyMm,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, reason: result.reason };
  }
  return {
    ok: true,
    fontId,
    paths: result.glyphs
      .filter((g) => g.d !== "")
      .map((g) => ({ char: g.char, d: g.d })),
    totalAdvanceMm: result.totalAdvanceMm,
    shaperVersion: result.shaperVersion,
  };
}
