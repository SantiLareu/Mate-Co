/**
 * Motor tipográfico vectorial de Mate&Co (Etapa 4).
 *
 * Convierte un texto curvo en contornos SVG reales, en milímetros, con la misma
 * geometría y las mismas fuentes que el laboratorio físico. Todo es
 * determinista: la misma entrada produce siempre los mismos bytes.
 *
 * Comportamientos deliberados:
 *   - **fallo explícito**: si la fuente no tiene el glifo, si el texto no está
 *     en NFC o si el shaper no está disponible, se devuelve un error tipado.
 *     Nunca se sustituye una fuente ni un glifo;
 *   - **carga diferida**: el WASM de HarfBuzz se carga la primera vez que se
 *     compone un texto; el bundle inicial no lo incluye;
 *   - **independiente del producto**: este módulo no sabe nada del editor, del
 *     admin, de los trabajos ni de los exportadores.
 */
import {
  layoutCurveItems,
  outlineToPathData,
  type CurvedTextRequest,
} from "./curved";
import {
  loadHarfBuzz,
  shapeText,
  shaperVersion,
  type ShapedRun,
} from "./harfbuzz";
import {
  loadFontBytes,
  TYPOGRAPHY_FONTS,
  type TypographyFontId,
} from "./fonts";

export type { CurvedTextRequest } from "./curved";
export type { TypographyFont, TypographyFontId } from "./fonts";
export { TYPOGRAPHY_FONT_LIST, TYPOGRAPHY_FONTS } from "./fonts";

/** Un glifo ya colocado sobre el arco, con su contorno en milímetros. */
export type TypographyGlyph = {
  /** Caracteres que cubre el glifo (un cluster puede cubrir varios). */
  char: string;
  /** Id del glifo en la fuente. */
  gid: number;
  /** Path absoluto en milímetros (coordenadas del centro de la virola). */
  d: string;
};

export type TypographyResult =
  | {
      ok: true;
      fontId: TypographyFontId;
      /** Peso con el que se compuso (para fuentes variables). */
      weight: number;
      glyphs: TypographyGlyph[];
      /** Longitud total del texto en el arco, mm. */
      totalAdvanceMm: number;
      /** Extensión angular del texto, grados. */
      spanDegrees: number;
      unitsPerEm: number;
      /** Versión de HarfBuzz usada (para reproducibilidad). */
      shaperVersion: string;
    }
  | {
      ok: false;
      code:
        | "FONT_UNAVAILABLE"
        | "FONT_INVALID"
        | "GLYPH_MISSING"
        | "TEXT_NOT_NFC"
        | "SHAPER_UNAVAILABLE";
      reason: string;
    };

export type CurvedTextSpec = CurvedTextRequest & {
  fontId: TypographyFontId;
  /** Peso a composición (sólo tiene efecto en fuentes variables). */
  weight?: number;
};

/**
 * Compone un texto curvo y devuelve sus contornos en milímetros.
 *
 * Es la única entrada pública del motor: no toca el DOM, no escribe estado y
 * no depende del laboratorio ni del editor.
 */
export async function renderCurvedText(
  spec: CurvedTextSpec,
): Promise<TypographyResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await loadFontBytes(spec.fontId);
  } catch (error) {
    return {
      ok: false,
      code: "FONT_UNAVAILABLE",
      reason: (error as Error).message,
    };
  }

  let shaped: Awaited<ReturnType<typeof shapeText>>;
  try {
    // El eje de peso sólo se aplica a fuentes VARIABLES: en una fuente
    // estática (Poppins, Lato) el binario no tiene tabla fvar y el peso es
    // el nominal.
    const font = TYPOGRAPHY_FONTS[spec.fontId];
    const variations =
      font.variable && spec.weight !== undefined
        ? [{ tag: "wght", value: spec.weight }]
        : undefined;
    shaped = await shapeText(bytes, spec.text, {
      cacheKey: spec.fontId,
      variations,
    });
  } catch (error) {
    return {
      ok: false,
      code: "SHAPER_UNAVAILABLE",
      reason: `El motor tipográfico no está disponible: ${(error as Error).message}`,
    };
  }
  if (!shaped.ok) {
    return { ok: false, code: shaped.code, reason: shaped.reason };
  }

  return {
    ok: true,
    fontId: spec.fontId,
    weight: spec.weight ?? 600,
    ...layoutShapedRun(shaped.run, spec),
    unitsPerEm: shaped.run.unitsPerEm,
    shaperVersion: shaperVersion(),
  };
}

/**
 * Coloca una run ya compuesta sobre el arco y devuelve los contornos.
 *
 * Un cluster (una ligadura) es un grupo rígido: se coloca por el punto medio
 * de su avance y sus glifos se reparten dentro de él.
 */
function layoutShapedRun(
  run: ShapedRun,
  req: CurvedTextRequest,
): { glyphs: TypographyGlyph[]; totalAdvanceMm: number; spanDegrees: number } {
  const scale = req.fontSizeMm / run.unitsPerEm;
  const items = run.clusters.map((c) => ({
    advanceMm: c.advanceUnits * scale,
    kernBeforeMm: 0,
  }));  const curve = layoutCurveItems(items, req);
  const glyphs: TypographyGlyph[] = [];
  run.clusters.forEach((cluster, ci) => {
    const placement = curve.placements[ci];
    const rot = (placement.rotationDegrees * Math.PI) / 180;
    let penMm = 0;
    for (const g of cluster.glyphs) {
      const advanceMm = g.advanceUnits * scale;
      // El glifo se coloca dentro del cluster (rígido): su origen es el
      // origen del cluster más el desplazamiento acumulado, en el marco
      // rotado del cluster.
      const offX = penMm + g.xOffsetUnits * scale;
      const offY = -g.yOffsetUnits * scale;
      const origin = {
        x: placement.origin.x + offX * Math.cos(rot) - offY * Math.sin(rot),
        y: placement.origin.y + offX * Math.sin(rot) + offY * Math.cos(rot),
      };
      // El contorno se centra en el punto medio del AVANCE del glifo.
      const mid = {
        x: origin.x + (advanceMm / 2) * Math.cos(rot),
        y: origin.y + (advanceMm / 2) * Math.sin(rot),
      };
      glyphs.push({
        char: cluster.text,
        gid: g.gid,
        d: g.commands
          ? outlineToPathData(
              g.commands,
              { advanceMm, mid, rotationDegrees: placement.rotationDegrees },
              scale,
              req.inverted ? req.invertedDyMm : 0,
            )
          : "",
      });
      penMm += advanceMm;
    }
  });
  return {
    glyphs,
    totalAdvanceMm: curve.totalAdvanceMm,
    spanDegrees: curve.spanDegrees,
  };
}

/** Precarga del WASM (opcional; la primera composición lo carga igual). */
export async function warmUpTypography(): Promise<void> {
  await loadHarfBuzz();
}
