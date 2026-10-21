/**
 * Medición de bounding boxes sobre path data, con aplanado de curvas.
 *
 * Se usa para el bounding box REAL (puntos transformados por la matriz
 * compuesta de cada path, no las esquinas de la caja local: así las
 * rotaciones no inflan el resultado). Incluye controles de curva en el
 * muestreo, de modo que la caja siempre contiene la geometría visible.
 * Todo el muestreo es determinista (subdivisión fija).
 */

import type { SvgImportBox } from './types';
import type { SvgMatrix } from './transforms';
import { applyMatrix } from './transforms';

export type FlatPoint = { x: number; y: number };

const NUMBER_PATTERN = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const COMMAND_PATTERN = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

function splitCommands(d: string): Array<{ command: string; values: number[] }> {
  const out: Array<{ command: string; values: number[] }> = [];
  COMMAND_PATTERN.lastIndex = 0;
  let match = COMMAND_PATTERN.exec(d);
  while (match) {
    const values = (match[2].match(NUMBER_PATTERN) ?? []).map(Number).filter(Number.isFinite);
    out.push({ command: match[1], values });
    match = COMMAND_PATTERN.exec(d);
  }
  return out;
}

function cubicPoint(p0: FlatPoint, p1: FlatPoint, p2: FlatPoint, p3: FlatPoint, t: number): FlatPoint {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function quadraticPoint(p0: FlatPoint, p1: FlatPoint, p2: FlatPoint, t: number): FlatPoint {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** Endpoint → center parameterization del arco SVG (spec W3C, sin corrección). */
function arcPoints(
  from: FlatPoint,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: number,
  sweep: number,
  to: FlatPoint,
): FlatPoint[] {
  const out: FlatPoint[] = [];
  const radiiX = Math.abs(rx);
  const radiiY = Math.abs(ry);
  if (radiiX === 0 || radiiY === 0) return [to];
  const phi = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let lambda = (x1 * x1) / (radiiX * radiiX) + (y1 * y1) / (radiiY * radiiY);
  let rX = radiiX;
  let rY = radiiY;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rX *= scale;
    rY *= scale;
    lambda = 1;
  }
  void lambda;
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rX * rX * rY * rY - rX * rX * y1 * y1 - rY * rY * x1 * x1;
  const denominator = rX * rX * y1 * y1 + rY * rY * x1 * x1;
  const factor = sign * Math.sqrt(Math.max(0, numerator / Math.max(denominator, 1e-12)));
  const cx1 = (factor * rX * y1) / rY;
  const cy1 = (-factor * rY * x1) / rX;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angleBetween = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const clamped = Math.max(-1, Math.min(1, lengths === 0 ? 1 : dot / lengths));
    const angle = Math.acos(clamped);
    return ux * vy - uy * vx < 0 ? -angle : angle;
  };
  const startAngle = angleBetween(1, 0, (x1 - cx1) / rX, (y1 - cy1) / rY);
  let sweepAngle = angleBetween((x1 - cx1) / rX, (y1 - cy1) / rY, (-x1 - cx1) / rX, (-y1 - cy1) / rY);
  if (sweep === 0 && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep === 1 && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  const steps = 24;
  for (let index = 1; index <= steps; index += 1) {
    const t = startAngle + (sweepAngle * index) / steps;
    const ex = rX * Math.cos(t);
    const ey = rY * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  return out;
}

/**
 * Aplana un `d` a puntos (incluye controles de curva y muestreo de arcos).
 * Devuelve `null` si el `d` no contiene geometría medible o es inválido.
 */
export function flattenPathData(d: string): FlatPoint[] | null {
  if (!d || d.trim() === '') return null;
  const points: FlatPoint[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevCubic: FlatPoint | null = null;
  let prevQuadratic: FlatPoint | null = null;
  const push = (point: FlatPoint) => {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
  };
  const move = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    startX = nx;
    startY = ny;
    push({ x, y });
  };
  const line = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    push({ x, y });
  };
  for (const { command, values } of splitCommands(d)) {
    const relative = command >= 'a' && command <= 'z';
    const upper = command.toUpperCase();
    const offset = (index: number) => (relative ? (index === 0 ? x : y) : 0);
    if (upper === 'Z') {
      x = startX;
      y = startY;
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (upper === 'H') {
      for (const value of values) line(value + (relative ? x : 0), y);
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (upper === 'V') {
      for (const value of values) line(x, value + (relative ? y : 0));
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    const arity = upper === 'A' ? 7 : upper === 'C' ? 6 : upper === 'S' || upper === 'Q' ? 4 : upper === 'T' ? 2 : 2;
    if (values.length === 0 || values.length % arity !== 0) return null;
    for (let index = 0; index < values.length; index += arity) {
      const group = values.slice(index, index + arity);
      if (upper === 'M') {
        const nx = group[0] + offset(0);
        const ny = group[1] + (relative ? y : 0);
        // Los pares extra tras M son L implícitos (spec SVG).
        if (index === 0) move(nx, ny);
        else line(nx, ny);
        prevCubic = null;
        prevQuadratic = null;
      } else if (upper === 'L') {
        line(group[0] + offset(0), group[1] + (relative ? y : 0));
        prevCubic = null;
        prevQuadratic = null;
      } else if (upper === 'C') {
        const p0 = { x, y };
        const p1 = { x: group[0] + offset(0), y: group[1] + (relative ? y : 0) };
        const p2 = { x: group[2] + offset(0), y: group[3] + (relative ? y : 0) };
        const p3 = { x: group[4] + offset(0), y: group[5] + (relative ? y : 0) };
        push(p1);
        push(p2);
        for (let step = 1; step <= 16; step += 1) push(cubicPoint(p0, p1, p2, p3, step / 16));
        prevCubic = p2;
        prevQuadratic = null;
        x = p3.x;
        y = p3.y;
      } else if (upper === 'S') {
        const p0 = { x, y };
        const p1 = prevCubic ? { x: 2 * x - prevCubic.x, y: 2 * y - prevCubic.y } : { x, y };
        const p2 = { x: group[0] + offset(0), y: group[1] + (relative ? y : 0) };
        const p3 = { x: group[2] + offset(0), y: group[3] + (relative ? y : 0) };
        push(p1);
        push(p2);
        for (let step = 1; step <= 16; step += 1) push(cubicPoint(p0, p1, p2, p3, step / 16));
        prevCubic = p2;
        prevQuadratic = null;
        x = p3.x;
        y = p3.y;
      } else if (upper === 'Q') {
        const p0 = { x, y };
        const p1 = { x: group[0] + offset(0), y: group[1] + (relative ? y : 0) };
        const p2 = { x: group[2] + offset(0), y: group[3] + (relative ? y : 0) };
        push(p1);
        for (let step = 1; step <= 16; step += 1) push(quadraticPoint(p0, p1, p2, step / 16));
        prevCubic = null;
        prevQuadratic = p1;
        x = p2.x;
        y = p2.y;
      } else if (upper === 'T') {
        const p0 = { x, y };
        const p1: FlatPoint = prevQuadratic ? { x: 2 * x - prevQuadratic.x, y: 2 * y - prevQuadratic.y } : { x, y };
        const p2 = { x: group[0] + offset(0), y: group[1] + (relative ? y : 0) };
        push(p1);
        for (let step = 1; step <= 16; step += 1) push(quadraticPoint(p0, p1, p2, step / 16));
        prevCubic = null;
        prevQuadratic = p1;
        x = p2.x;
        y = p2.y;
      } else if (upper === 'A') {
        const to = { x: group[5] + offset(0), y: group[6] + (relative ? y : 0) };
        for (const point of arcPoints({ x, y }, group[0], group[1], group[2], group[3], group[4], to)) push(point);
        prevCubic = null;
        prevQuadratic = null;
        x = to.x;
        y = to.y;
      } else {
        return null;
      }
    }
  }
  return points.length > 0 ? points : null;
}

export function boundsOfPoints(points: FlatPoint[]): SvgImportBox | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** Caja local (sin transforms) de un `d`. */
export function pathDataBounds(d: string): SvgImportBox | null {
  const points = flattenPathData(d);
  return points ? boundsOfPoints(points) : null;
}

/** Caja de un `d` a través de una matriz (punto por punto: exacto ante rotación). */
export function transformedPathBounds(d: string, matrix: SvgMatrix): SvgImportBox | null {
  const points = flattenPathData(d);
  if (!points) return null;
  return boundsOfPoints(points.map(point => applyMatrix(matrix, point.x, point.y)));
}

export function unionBoxes(boxes: SvgImportBox[]): SvgImportBox | null {
  let union: SvgImportBox | null = null;
  for (const box of boxes) {
    union = union
      ? {
          x: Math.min(union.x, box.x),
          y: Math.min(union.y, box.y),
          width: Math.max(union.x + union.width, box.x + box.width) - Math.min(union.x, box.x),
          height: Math.max(union.y + union.height, box.y + box.height) - Math.min(union.y, box.y),
        }
      : { ...box };
  }
  return union;
}
