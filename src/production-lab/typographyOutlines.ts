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
 * LA PARIDAD (y su condición)
 *   La vista previa del laboratorio (PhysicalComposition.tsx) pinta el texto con
 *   `source.fontFamily`, y desde la Etapa 4 el catálogo del personalizador ES el
 *   catálogo empaquetado: las dos superficies usan la misma fuente real, el
 *   mismo peso (600) y la misma geometría (letter-spacing, radio base, ángulo y
 *   dy). Eso es lo que hace posible que el SVG exportado coincida con la vista
 *   previa (ver tests/production-lab-typography-parity.spec.ts).
 *   El mapeo de familia sigue siendo EXPRESO: si una familia no está en el
 *   catálogo (por ejemplo un trabajo antiguo con una fuente del sistema), se
 *   devuelve `null` y quien llama decide. No hay sustitución silenciosa.
 */
import {
  renderCurvedText,
  type TypographyFontId,
  TYPOGRAPHY_FONTS,
} from "../typography";
import { catalogueFontForFamily } from "../typography/catalogue";
import type { LabTextOutline, PhysicalReport } from "./types";
import type { TextElement } from "../components/CurvedText";

/**
 * El mapa familia → fuente del catálogo vive en `src/typography/catalogue.ts`
 * (es una decisión del catálogo, no del laboratorio) y se re-exporta aquí para
 * no romper a los consumidores que ya lo usaban desde este módulo.
 */
export { catalogueFontForFamily };

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

/**
 * Prepara los contornos vectoriales de TODOS los textos del reporte.
 *
 * Es el punto asíncrono de la cadena: el motor (WASM) tarda, el serializador
 * del exportador es síncrono. La UI llama a esta función y le pasa el
 * resultado como datos.
 *
 * Falla cerrado (nunca sustituye): si un texto no está en el catálogo, no
 * tiene glifo o no está en NFC, se devuelve el motivo y la exportación queda
 * bloqueada.
 */
export async function prepareLabTextOutlines(
  report: PhysicalReport,
  sourceTexts: readonly TextElement[],
): Promise<
  | { ok: true; outlines: Record<string, LabTextOutline> }
  | { ok: false; reason: string }
> {
  const outlines: Record<string, LabTextOutline> = {};
  for (const placed of report.texts) {
    const element = sourceTexts.find((entry) => entry.id === placed.id);
    if (!element) {
      return {
        ok: false,
        reason: `No se encontró el texto de origen «${placed.id}»: no se inventa su contenido.`,
      };
    }
    const fontId = catalogueFontForFamily(element.fontFamily);
    if (!fontId) {
      return {
        ok: false,
        reason: `La tipografía «${element.fontFamily}» no está en el catálogo empaquetado: no se sustituye por otra.`,
      };
    }
    if (placed.baselineRadiusMm === null) {
      return {
        ok: false,
        reason:
          placed.baselineIssue ??
          `El radio base del texto «${placed.id}» no es positivo: sin geometría no hay contornos.`,
      };
    }
    const result = await labTextOutlines(element.text, fontId, {
      fontSizeMm: placed.fontSizeMm,
      letterSpacingMm: placed.letterSpacingMm,
      baselineRadiusMm: placed.baselineRadiusMm,
      angle: placed.angle,
      inverted: placed.sweep === 0,
      invertedDyMm: placed.invertedDyMm ?? 0,
    });
    if (!result.ok) {
      return { ok: false, reason: `Texto «${placed.id}»: ${result.reason}` };
    }
    outlines[placed.id] = {
      paths: result.paths.map((p) => p.d),
      shaperVersion: result.shaperVersion,
      advanceMm: result.totalAdvanceMm,
    };
  }
  return { ok: true, outlines };
}
