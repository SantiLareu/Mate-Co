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
 *   arco. El navegador, en cambio, sólo pinta los clusters cuya posición de
 *   arco cae dentro del path (la "ventana de visibilidad"). Este adaptador
 *   reproduce esa ventana: el texto que el motor compone y el que el
 *   navegador pinta son el mismo. Medido en Chromium (ver
 *   `odd/tasks/stage4-client-export-E2.md`): con la ventana aplicada, la
 *   paridad de tinta es de píxel (0 píxeles sin pareja); sin ella, el SVG
 *   exportado tendría texto que el cliente no ve.
 *
 * NORMALIZACIÓN NFC (E3.0)
 *   El texto se normaliza a NFC **en la entrada**, y sólo ahí. La
 *   equivalencia visual está medida para el conjunto español con las tres
 *   fuentes del catálogo (navegador descompuesta ≡ precompuesta, 0 u de
 *   desviación). No se generaliza a otros caracteres: si el texto
 *   normalizado no se puede componer, el motor falla de forma explícita
 *   (`GLYPH_MISSING`) y no se sustituye nada.
 */
import { clampTextRadius, clampTextScale } from "../components/CurvedText";
import { renderCurvedText, type TypographyResultOk } from "../typography";
import { catalogueFontForFamily } from "../typography/catalogue";
import { textFitsPath } from "../typography/textFit";
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
 * El texto compuesto con el motor, listo para convertirlo en trazo.
 *
 * Separar la COMPOSICIÓN (el motor) de la CONSTRUCCIÓN del trazo (la
 * geometría) permite que un pre-flight componga una sola vez y que la
 * exportación reutilice esa composición: no se ejecuta dos veces una
 * conversión completa (E3.1).
 */
export type ComposedVectorText = {
  ok: true;
  /** El resultado del motor (glifos y clusters ya colocados). */
  result: TypographyResultOk;
  /** Escala efectiva del texto. */
  scale: number;
  /** Radio del elemento (unidades de diseño). */
  radius: number;
  /** Radio base del recorrido (`radius - 14 * escala`). */
  baselineRadius: number;
  /** El texto que se compuso (normalizado a NFC). */
  text: string;
} | {
  ok: false;
  /** Código explícito del fallo (`FONT_NOT_IN_CATALOGUE`, `GLYPH_MISSING`…). */
  code: string;
  /** Mensaje accionable en español. */
  message: string;
};

/**
 * Compone el texto con el motor de HarfBuzz (E3.1: sin geometría de salida).
 *
 * No lanza: devuelve el fallo explícito, para que quien llame decida
 * (el pre-flight lo muestra; el trazador lo convierte en `Error`).
 */
export async function composeVectorText(
  request: VectorTextTraceRequest,
): Promise<ComposedVectorText> {
  if (!request.text) {
    return { ok: false, code: "TEXT_EMPTY", message: "El texto está vacío." };
  }

  const fontId = catalogueFontForFamily(request.fontFamily);
  if (!fontId) {
    return {
      ok: false,
      code: "FONT_NOT_IN_CATALOGUE",
      message: `La tipografía «${request.fontFamily}» no está en el catálogo tipográfico: no se sustituye por otra.`,
    };
  }

  const scale = clampTextScale(request.scale);
  const radius = clampTextRadius(request.radius, scale);
  const baselineRadius = radius - 14 * scale;
  if (!(baselineRadius > 0)) {
    return {
      ok: false,
      code: "INVALID_RADIUS",
      message: `El radio base (${baselineRadius}) no es positivo: sin geometría no hay contornos.`,
    };
  }

  // E3.0: la normalización NFC ocurre SÓLO en la entrada (equivalencia
  // visual medida, ver `odd/tasks/stage4-client-export-E2.md` §1.5). El
  // motor recibe el texto ya normalizado; si aun así no se puede componer,
  // el error del motor se propaga (sin sustitución ni normalización
  // silenciosa).
  const text = request.text.normalize("NFC");

  const result = await renderCurvedText({
    text,
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
    return { ok: false, code: result.code, message: result.reason };
  }
  // E4.1: la geometría se devuelve tal cual; el ENCJE se comprueba en la
  // frontera de exportación (`traceVectorText` y el pre-flight), que es
  // donde un texto que no cabe debe bloquear la generación del archivo.
  return { ok: true, result, scale, radius, baselineRadius, text };
}

/**
 * Construye el trazo a partir de una composición (E3.1).
 *
 * Devuelve `null` cuando no hay tinta que trazar (texto vacío o sólo
 * espacios): es lo que hace el trazador rasterizo actual y evita bandas
 * fantasma.
 */
export function buildVectorTrace(
  composed: ComposedVectorText,
): VectorTextTrace | null {
  if (!composed.ok) return null;
  const { result, baselineRadius } = composed;

  // VENTANA DE VISIBILIDAD (E3.0).
  //
  // El path de la vista previa es una circunferencia CERRADA de radio
  // `baselineRadius` (longitud 2*pi*R). El navegador centra el texto en
  // `startOffset="50%"` y pinta SÓLO los clusters cuyo CENTRO de avance
  // cae dentro del path: un cluster cuyo avance cruza el borde se pinta a
  // medias, y uno cuyo centro queda fuera no se pinta.
  //
  // La regla se midió contra el DOM real de Chromium en cinco escenarios
  // (texto de 119 y 239 caracteres, escala 3, radios 305 y 410): la ventana
  // `|sMid| <= pi*R` coincide exactamente con el rango de caracteres que el
  // navegador pinta. Los criterios por inicio o por final no coinciden (ver
  // `odd/tasks/stage4-client-export-E2.md`).
  //
  // Se mantiene la centración: no se desplaza el texto, sólo se descartan
  // los clusters que el navegador no pintaría.
  const halfWindow = Math.PI * baselineRadius;
  const visible = result.clusters.filter(
    (cluster) => cluster.sMidMm >= -halfWindow && cluster.sMidMm <= halfWindow,
  );

  // Cada cluster conserva su geometría; un glifo sin contornos (el espacio)
  // no aporta tinta.
  const visibleClusters = visible
    .map((cluster) => ({
      // Ángulo central del cluster (radianes, sentido horario desde arriba):
      // sirve para desenvolver los ángulos de su tinta sin saltos.
      centerAngle: cluster.sMidMm / baselineRadius,
      paths: cluster.glyphs
        .filter((glyph) => glyph.d !== "")
        .map((glyph) => ({ d: glyph.d })),
    }))
    .filter((cluster) => cluster.paths.length > 0);

  const paths: VectorTextPath[] = visibleClusters.flatMap(
    (cluster) => cluster.paths,
  );
  // Texto con sólo espacios: hay avance, pero no hay tinta que trazar.
  if (!paths.length) return null;

  const geometry = inkGeometry(visibleClusters, baselineRadius);
  return {
    paths,
    cropX: EXPORT_CENTER,
    cropY: EXPORT_CENTER,
    pixelScale: 1,
    // El motor centra los contornos en (0,0); el exportador trabaja en el
    // espacio 900, así que la caja se traslada al centro del diseño.
    inkBox: {
      x: geometry.box.x + EXPORT_CENTER,
      y: geometry.box.y + EXPORT_CENTER,
      width: geometry.box.width,
      height: geometry.box.height,
    },
    // E3.0: el arco de la TINTA visible, no el avance total. Es la misma
    // semántica que el trazador raster (`textOutlines.ts`), de la que el
    // exportador deriva la banda de protección del texto.
    arcLength: geometry.arcLength,
  };
}

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
  // Sin texto no hay nada que trazar: `null` (no un error).
  if (!request.text) return null;
  const composed = await composeVectorText(request);
  if (!composed.ok) {
    throw new Error(`${composed.code}: ${composed.message}`);
  }
  // E4.1 — protección de exportación: ningún camino puede generar un archivo
  // con el texto parcialmente oculto. El texto debe entrar COMPLETO en el
  // recorrido circular; si no, el editor ya lo ha reducido (E4.1) y aquí se
  // bloquea con un error explícito (nunca un SVG con texto cortado).
  if (!textFitsPath(composed.result.totalAdvanceMm, composed.radius, composed.scale)) {
    throw new Error(
      `TEXT_DOES_NOT_FIT: el texto «${request.text}» es más largo que el recorrido de la virola ` +
      `(avance ${Math.round(composed.result.totalAdvanceMm)} u sobre un recorrido de ` +
      `${Math.round(2 * Math.PI * composed.baselineRadius)} u); reducilo o acortalo.`,
    );
  }
  return buildVectorTrace(composed);
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

/** Un cluster visible y el ángulo central con el que se desenvuelve su tinta. */
type VisibleCluster = {
  /** Ángulo central del cluster, en radianes (horario desde arriba). */
  centerAngle: number;
  paths: readonly VectorTextPath[];
};

/**
 * Geometría de la tinta VISIBLE: caja exacta y arco angular.
 *
 * `arcLength` es la extensión angular de la tinta, no el avance del texto:
 * es la magnitud de la que el exportador deriva la banda de protección
 * (`productionSvg.ts`), y el trazador raster la mide igual (sobre los píxeles
 * de tinta) PERO sobre la tipografía de reserva que sustituye a la del
 * catálogo, así que los dos valores no son comparables (ver el aviso de
 * `src/export/textOutlines.ts`). Medirla sobre el avance daría una banda
 * más ancha que el texto grabado.
 *
 * La caja es la EXACTA de las curvas: para cada segmento cuadrático y cúbico
 * se calculan sus extremos reales (no los puntos de control, que en un glifo
 * pueden quedar bastante fuera de la tinta). Una caja demasiado grande agranda
 * el viewBox del SVG exportado; una demasiado chica recorta la geometría.
 */
function inkGeometry(
  clusters: readonly VisibleCluster[],
  radius: number,
): { box: Box; arcLength: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  for (const cluster of clusters) {
    for (const { d } of cluster.paths) {
      for (const point of pathPoints(d)) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
        // Ángulo horario desde arriba (0 = tope del círculo), en radianes.
        // Se desenvuelve alrededor del centro del cluster: sin ese
        // desarrollo, un punto que cruza los ±180° daría un salto y
        // falsearía la extensión angular.
        const raw = Math.atan2(point.x, -point.y);
        const angle =
          raw +
          2 * Math.PI * Math.round((cluster.centerAngle - raw) / (2 * Math.PI));
        if (angle < minAngle) minAngle = angle;
        if (angle > maxAngle) maxAngle = angle;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { box: { x: 0, y: 0, width: 0, height: 0 }, arcLength: 0 };
  }
  return {
    box: {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    },
    arcLength: (maxAngle - minAngle) * radius,
  };
}

/**
 * Los puntos que determinan la caja de un path: los extremos de cada
 * segmento y los extremos reales de las curvas.
 *
 * El motor serializa con M/L/Q/C/Z y números separados por espacios (unidades
 * de diseño). El bloque de números se detiene en cualquier otra letra
 * mayúscula (un comando que el motor no emite) para no mezclar sus valores
 * con los del comando anterior.
 */
function pathPoints(d: string): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  const commands = /([MLQCZ])([^A-Z]*)/g;
  let match: RegExpExecArray | null;
  while ((match = commands.exec(d)) !== null) {
    const command = match[1];
    const values = (match[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (command === "M") {
      current = { x: values[0], y: values[1] };
      points.push(current);
    } else if (command === "L") {
      current = { x: values[0], y: values[1] };
      points.push(current);
    } else if (command === "Q") {
      const control: Point = { x: values[0], y: values[1] };
      const end: Point = { x: values[2], y: values[3] };
      points.push(end);
      for (const point of quadraticExtrema(current, control, end)) {
        points.push(point);
      }
      current = end;
    } else if (command === "C") {
      const first: Point = { x: values[0], y: values[1] };
      const second: Point = { x: values[2], y: values[3] };
      const end: Point = { x: values[4], y: values[5] };
      points.push(end);
      for (const point of cubicExtrema(current, first, second, end)) {
        points.push(point);
      }
      current = end;
    }
  }
  return points;
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
