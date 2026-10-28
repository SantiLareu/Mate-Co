/**
 * Layout curvo y serialización en milímetros (motor compartido).
 *
 * Geometría idéntica a la del spike validado (Etapa 4): el punto medio del
 * avance de cada elemento cae sobre el círculo de la línea base, el elemento
 * se rota a la tangente allí y el letter-spacing se suma después de cada
 * elemento. Ángulo 0 arriba, sentido horario, y hacia abajo, centro (0,0) mm.
 *
 * El motor no decide fuentes ni pesos: recibe medidas y devuelve paths
 * absolutos en milímetros.
 */
import type { OutlineCommand } from "./harfbuzz";

export type CurveItem = {
  /** Avance del elemento en mm. */
  advanceMm: number;
  /** Kerning aplicado ANTES del elemento (0 si el shaper ya lo-foldió). */
  kernBeforeMm: number;
};

export type CurvePlacement = {
  /** Coordenada de arco del punto medio del avance, desde el centro (mm). */
  sMidMm: number;
  /**
   * Coordenada de arco del INICIO del avance del elemento, desde el centro
   * del texto (mm). Es la posición de la pluma con la que se compone el
   * primer carácter del elemento.
   */
  sStartMm: number;
  /** Coordenada de arco del FINAL del avance del elemento (mm). */
  sEndMm: number;
  /** Punto medio del avance sobre el círculo base (mm). */
  mid: { x: number; y: number };
  /** Rotación del eje x del elemento, grados (horario, y hacia abajo). */
  rotationDegrees: number;
  /** Origen (posición de la pluma sobre la línea base, sin dy), mm. */
  origin: { x: number; y: number };
};

export type CurvedTextRequest = {
  text: string;
  /** Tamaño de em en mm. */
  fontSizeMm: number;
  /** Espaciado entre caracteres en mm. */
  letterSpacingMm: number;
  /** Radio del círculo base en mm. */
  baselineRadiusMm: number;
  /** Ángulo del elemento: 0 arriba, grados horarios. */
  angleDegrees: number;
  /** Texto invertido (progresión antihoraria, glifos hacia el centro). */
  inverted: boolean;
  /** Desplazamiento local del glifo en la dirección radial (mm). */
  invertedDyMm: number;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Serialización canónica en mm: 3 decimales (1 µm), sin "-0". */
export function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return rounded.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Punto del círculo base a una coordenada de arco (mm). */
export function baselinePoint(
  sMm: number,
  req: CurvedTextRequest,
): { x: number; y: number } {
  const dir = req.inverted ? -1 : 1;
  const t = toRad(req.angleDegrees) + (dir * sMm) / req.baselineRadiusMm;
  return {
    x: req.baselineRadiusMm * Math.sin(t),
    y: -req.baselineRadiusMm * Math.cos(t),
  };
}

/**
 * COLOCA una serie de elementos sobre el círculo base.
 *
 * Es la geometría del spike, reutilizada literalmente: el total incluye el
 * letter-spacing de cada elemento y el texto queda centrado en el arco.
 */
export function layoutCurveItems(
  items: CurveItem[],
  req: CurvedTextRequest,
): {
  placements: CurvePlacement[];
  totalAdvanceMm: number;
  spanDegrees: number;
} {
  const dir = req.inverted ? -1 : 1;
  let total = 0;
  for (const item of items) {
    total += item.kernBeforeMm + item.advanceMm + req.letterSpacingMm;
  }
  const placements: CurvePlacement[] = [];
  let pen = -total / 2; // coordenada de arco del siguiente origen
  for (const item of items) {
    pen += item.kernBeforeMm;
    const sStartMm = pen;
    const sMid = pen + item.advanceMm / 2;
    const theta = toRad(req.angleDegrees) + (dir * sMid) / req.baselineRadiusMm;
    const rotation = (theta * 180) / Math.PI + (req.inverted ? 180 : 0);
    const mid = baselinePoint(sMid, req);
    const r = toRad(rotation);
    placements.push({
      sMidMm: sMid,
      sStartMm,
      sEndMm: sStartMm + item.advanceMm,
      mid,
      rotationDegrees: rotation,
      origin: {
        x: mid.x - (item.advanceMm / 2) * Math.cos(r),
        y: mid.y - (item.advanceMm / 2) * Math.sin(r),
      },
    });
    pen += item.advanceMm + req.letterSpacingMm;
  }
  return {
    placements,
    totalAdvanceMm: total,
    spanDegrees: (total / req.baselineRadiusMm) * (180 / Math.PI),
  };
}

/**
 * Transforma rígida de un contorno (unidades de fuente) a milímetros
 * absolutos: escala, giro, desplazamiento local y traslación. Las curvas
 * siguen siendo curvas (Q/C nunca se aplanan).
 */
export function outlineToPathData(
  commands: readonly OutlineCommand[],
  placement: {
    advanceMm: number;
    mid: { x: number; y: number };
    rotationDegrees: number;
  },
  scale: number,
  dyMm: number,
): string {
  const rot = toRad(placement.rotationDegrees);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const map = (x: number, y: number): string => {
    // local en mm: x a lo largo del avance centrado en su punto medio, y abajo
    const lx = x * scale - placement.advanceMm / 2;
    const ly = -y * scale + dyMm;
    const px = placement.mid.x + lx * cos - ly * sin;
    const py = placement.mid.y + lx * sin + ly * cos;
    return `${mm(px)} ${mm(py)}`;
  };
  const parts: string[] = [];
  for (const c of commands) {
    if (c.type === "M") parts.push(`M${map(c.x, c.y)}`);
    else if (c.type === "L") parts.push(`L${map(c.x, c.y)}`);
    else if (c.type === "Q") parts.push(`Q${map(c.x1, c.y1)} ${map(c.x, c.y)}`);
    else if (c.type === "C")
      parts.push(`C${map(c.x1, c.y1)} ${map(c.x2, c.y2)} ${map(c.x, c.y)}`);
    else parts.push("Z");
  }
  return parts.join("");
}
