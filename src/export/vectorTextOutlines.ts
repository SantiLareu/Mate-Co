/**
 * Adaptador VECTORIAL del cliente: implementa el contrato `TraceTextFn`
 * (`src/export/productionSvg.ts`) con el motor tipográfico de
 * `src/typography`, en lugar de con el rasterizado + VTracer.
 *
 * QUÉ ES
 *   Una pieza nueva, probada y **sin conectar**: el exportador del cliente
 *   sigue usando su trazador rasterizo por defecto. Este módulo existe para
 *   demostrar que el motor vectorial puede cumplir el contrato con la misma
 *   geometría que la vista previa, y para dejar preparada la integración.
 *
 * UNIDADES
 *   Todo se calcula en **unidades de diseño del cliente (espacio 900×900)**,
 *   igual que la vista previa (`src/components/CurvedText.tsx`) y que el
 *   exportador. El motor llama a sus magnitudes "mm" porque en el
 *   laboratorio físico 1 unidad = 1 mm; aquí se le pasan unidades de diseño
 *   sin convertir, porque TODAS las medidas de la vista previa (tamaño de
 *   fuente, espaciado, radio base, dy) están en ese mismo espacio 900.
 *
 * GEOMETRÍA (idéntica a la de la vista previa)
 *   - `fontSize`      = 35 × escala
 *   - `letterSpacing` = 2 × escala
 *   - radio base      = radio − 14 × escala (el `pathRadius` de la vista previa)
 *   - `dy` invertido  = 26 × escala
 *   - peso            = 600 siempre (Dancing Script es variable)
 *   - ángulo          = 0: el exportador ya gira el grupo por `element.angle`
 *     (`productionSvg.ts`); duplicar el giro aquí dejaría el texto girado dos
 *     veces.
 *
 * POSICIÓN DE LOS CONTORNOS
 *   El motor centra los contornos en (0,0) (el centro del círculo base). El
 *   exportador envuelve los paths en `translate(cropX cropY)`, así que el
 *   adaptador devuelve `cropX = cropY = 450` (el centro del diseño) y
 *   `pixelScale = 1`: los paths quedan en el espacio 900 sin transformaciones
 *   extra (un path por glifo, sin `transform`).
 *
 * FALLO EXPLÍCITO (nunca sustitución)
 *   - familia fuera del catálogo → `Error` con `FONT_NOT_IN_CATALOGUE`;
 *   - glifo ausente, texto no NFC, fuente no disponible o motor no cargado →
 *     `Error` con el código del motor (`GLYPH_MISSING`, `TEXT_NOT_NFC`,
 *     `FONT_UNAVAILABLE`, `FONT_INVALID`, `SHAPER_UNAVAILABLE`);
 *   - texto vacío o texto con sólo espacios → `null` (no hay trazo: es lo
 *     que hace el trazador rasterizo actual y evita bandas fantasma).
 *
 * TEXTO LARGO
 *   El motor NO recorta: compone el texto completo aunque no quepa en el
 *   arco (el navegador, en cambio, recorta lo que sobresale del path). Con
 *   el catálogo del cliente el caso no aparece —el editor limita el texto a
 *   80 caracteres y a escala 1 el arco completo mide 2262 unidades de
 *   diseño, de sobra— pero a escala 3 (105 u de fuente) un texto de 80
 *   caracteres sí excede la vuelta completa: ahí el motor daría más geometría
 *   que la vista previa. No se recorta a propósito: callar el recorte sería
 *   mentir sobre la composición.
 */
import { clampTextRadius, clampTextScale } from "../components/CurvedText";
import { renderCurvedText } from "../typography";
import { catalogueFontForFamily } from "../typography/catalogue";
import { EXPORT_CENTER, type Box } from "./geometry";
import type { TraceTextFn } from "./productionSvg";
import type { TextTrace } from "./textOutlines";

/** Petición del trazador: la misma que usa el exportador del cliente. */
export type VectorTextTraceRequest = {
  text: string;
  fontFamily: string;
  scale: number;
  radius: number;
  inverted: boolean;
};

/** Resultado del trazador vectorial (mismo contrato que el rasterizado). */
export type VectorTextTrace = TextTrace;

/** Un path del trazador (sin `transform`: la traslación la hace el exportador). */
export type VectorTextPath = { d: string };

/**
 * Traza un texto del cliente como contornos vectoriales.
 *
 * Devuelve `null` cuando no hay tinta que trazar (texto vacío o sólo
 * espacios) y lanza `Error` —con un código explícito— cuando el texto no se
 * puede componer fielmente.
 */
export async function traceVectorText(
  request: VectorTextTraceRequest,
): Promise<VectorTextTrace | null> {
  if (!request.text) return null;

  const fontId = catalogueFontForFamily(request.fontFamily);
  if (!fontId) {
    throw new Error(
      `FONT_NOT_IN_CATALOGUE: la tipografía «${request.fontFamily}» no está en el catálogo tipográfico: no se sustituye por otra.`,
    );
  }

  const scale = clampTextScale(request.scale);
  const radius = clampTextRadius(request.radius, scale);
  const baselineRadius = radius - 14 * scale;
  if (!(baselineRadius > 0)) {
    throw new Error(
      `INVALID_RADIUS: el radio base (${baselineRadius}) no es positivo: sin geometría no hay contornos.`,
    );
  }

  const result = await renderCurvedText({
    text: request.text,
    fontId,
    // 600 siempre: las tres fuentes del catálogo se componen en ese peso
    // (Dancing Script lo interpola en su eje variable).
    weight: 600,
    fontSizeMm: 35 * scale,
    letterSpacingMm: 2 * scale,
    baselineRadiusMm: baselineRadius,
    // El giro lo aplica el exportador (`rotate(element.angle 450 450)`).
    angleDegrees: 0,
    inverted: request.inverted,
    invertedDyMm: request.inverted ? 26 * scale : 0,
  });
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.reason}`);
  }

  // Un glifo sin contornos (el espacio) no produce geometría: se descarta.
  const paths: VectorTextPath[] = result.glyphs
    .filter((glyph) => glyph.d !== "")
    .map((glyph) => ({ d: glyph.d }));
  // Texto con sólo espacios: hay avance, pero no hay tinta que trazar.
  if (!paths.length) return null;

  const inkBox = inkBoxOfPaths(paths);
  return {
    paths,
    cropX: EXPORT_CENTER,
    cropY: EXPORT_CENTER,
    pixelScale: 1,
    // El motor centra los contornos en (0,0); el exportador trabaja en el
    // espacio 900, así que la caja se traslada al centro del diseño.
    inkBox: {
      x: inkBox.x + EXPORT_CENTER,
      y: inkBox.y + EXPORT_CENTER,
      width: inkBox.width,
      height: inkBox.height,
    },
    // El avance total del texto en el arco (unidades de diseño).
    arcLength: result.totalAdvanceMm,
  };
}

/**
 * El adaptador, con el tipo exacto del contrato del exportador.
 *
 * `TraceTextFn` es el contrato de `src/export/productionSvg.ts`: asignarlo aquí
 * hace que el compilador verifique la conformidad (petición, resultado y
 * `null` incluidos).
 */
export const vectorTextTrace: TraceTextFn = traceVectorText;

/* ------------------------------------------------------------------ */
/* Caja de tinta                                                        */
/* ------------------------------------------------------------------ */

type Point = { x: number; y: number };

/**
 * Caja que envuelve los contornos de los paths (en el espacio centrado del
 * motor, es decir, con el centro del círculo base en (0,0)).
 *
 * Es la caja EXACTA de las curvas: para cada segmento cuadrático y cúbico se
 * calculan sus extremos reales (no los puntos de control, que en un glifo
 * pueden quedar bastante fuera de la tinta). Una caja demasiado grande
 * agranda el viewBox del SVG exportado; una demasiado chica recorta la
 * geometría.
 */
function inkBoxOfPaths(paths: readonly VectorTextPath[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const { d } of paths) {
    let current: Point = { x: 0, y: 0 };
    let subpathStart: Point = { x: 0, y: 0 };
    // El motor serializa con M/L/Q/C/Z y números separados por espacios. El
    // bloque de números se detiene en cualquier otra letra mayúscula (un
    // comando que el motor no emite) para no mezclar sus valores con los
    // del comando anterior.
    const commands = /([MLQCZ])([^A-Z]*)/g;
    let match: RegExpExecArray | null;
    while ((match = commands.exec(d)) !== null) {
      const command = match[1];
      const values = (match[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
      if (command === "M") {
        current = { x: values[0], y: values[1] };
        subpathStart = current;
        include(current.x, current.y);
      } else if (command === "L") {
        current = { x: values[0], y: values[1] };
        include(current.x, current.y);
      } else if (command === "Q") {
        const control: Point = { x: values[0], y: values[1] };
        const end: Point = { x: values[2], y: values[3] };
        include(end.x, end.y);
        for (const point of quadraticExtrema(current, control, end)) {
          include(point.x, point.y);
        }
        current = end;
      } else if (command === "C") {
        const first: Point = { x: values[0], y: values[1] };
        const second: Point = { x: values[2], y: values[3] };
        const end: Point = { x: values[4], y: values[5] };
        include(end.x, end.y);
        for (const point of cubicExtrema(current, first, second, end)) {
          include(point.x, point.y);
        }
        current = end;
      } else if (command === "Z") {
        current = subpathStart;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/** Extremos (x e y) de una curva cuadrática de Bézier. */
function quadraticExtrema(p0: Point, p1: Point, p2: Point): Point[] {
  const points: Point[] = [];
  for (const axis of ["x", "y"] as const) {
    const a = p0[axis];
    const b = p1[axis];
    const c = p2[axis];
    const denominator = a - 2 * b + c;
    if (denominator === 0) continue;
    const t = (a - b) / denominator;
    if (t <= 0 || t >= 1) continue;
    const u = 1 - t;
    points.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return points;
}

/** Extremos (x e y) de una curva cúbica de Bézier. */
function cubicExtrema(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const points: Point[] = [];
  for (const axis of ["x", "y"] as const) {
    const a0 = p1[axis] - p0[axis];
    const a1 = p2[axis] - p1[axis];
    const a2 = p3[axis] - p2[axis];
    const qa = a0 - 2 * a1 + a2;
    const qb = -2 * a0 + 2 * a1;
    const qc = a0;
    const roots: number[] = [];
    if (Math.abs(qa) < 1e-12) {
      if (Math.abs(qb) > 1e-12) roots.push(-qc / qb);
    } else {
      const discriminant = qb * qb - 4 * qa * qc;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
      }
    }
    for (const t of roots) {
      if (t <= 0 || t >= 1) continue;
      const u = 1 - t;
      points.push({
        x:
          u * u * u * p0.x +
          3 * u * u * t * p1.x +
          3 * u * t * t * p2.x +
          t * t * t * p3.x,
        y:
          u * u * u * p0.y +
          3 * u * u * t * p1.y +
          3 * u * t * t * p2.y +
          t * t * t * p3.y,
      });
    }
  }
  return points;
}
