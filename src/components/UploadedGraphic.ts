import { ICON_CENTER, clampIconScaleAtRadius, iconRadiusBounds } from './IconElement';
import type { VectorizedResult } from '../vectorization/vectorize/vectorizeMask';

export type UploadedGraphicPath = { d: string; transform?: string };

export type UploadedGraphicElement = {
  id: string;
  type: 'uploaded-graphic';
  paths: UploadedGraphicPath[];
  sourceWidth: number;
  sourceHeight: number;
  /** True artwork bounds in source (mask pixel) space, union of path data + transforms. */
  artBounds: { x: number; y: number; width: number; height: number };
  angle: number;
  radius: number;
  scale: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
};

/** Target size (SVG units) for the longest side of uploaded art. Icons are ~45 units wide; uploads get a slightly larger presence. */
export const UPLOADED_ART_SIZE = 64;

export type ArtBounds = { x: number; y: number; width: number; height: number };

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

/** Parses translate/scale/matrix/rotate transforms (VTracer emits translate). Unknown parts are ignored. */
export function parseSvgTransform(transform?: string): Matrix {
  if (!transform) return { ...IDENTITY };
  let result = { ...IDENTITY };
  const pattern = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g;
  let match = pattern.exec(transform);
  while (match) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
    const [p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0] = args;
    if (match[1] === 'translate') result = multiply(result, { ...IDENTITY, e: p0, f: args.length > 1 ? p1 : 0 });
    else if (match[1] === 'scale') result = multiply(result, { a: p0 === 0 ? 1 : p0, b: 0, c: 0, d: args.length > 1 ? p1 : p0, e: 0, f: 0 });
    else if (match[1] === 'matrix' && args.length >= 6) result = multiply(result, { a: p0, b: p1, c: p2, d: p3, e: p4, f: p5 });
    else if (match[1] === 'rotate') {
      const angle = p0 * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const cx = args.length > 2 ? p1 : 0, cy = args.length > 2 ? p2 : 0;
      result = multiply(result, multiply(multiply({ ...IDENTITY, e: cx, f: cy }, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }), { ...IDENTITY, e: -cx, f: -cy }));
    }
    match = pattern.exec(transform);
  }
  return result;
}

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function numbersIn(segment: string): number[] {
  return (segment.match(NUMBER) ?? []).map(Number).filter(Number.isFinite);
}

/** Bounding box of raw path data (controls included, so curves stay inside). */
export function parsePathBounds(d: string): ArtBounds | null {
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const dot = (px: number, py: number) => {
    x0 = Math.min(x0, px); y0 = Math.min(y0, py);
    x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  };
  const tokens = d.split(/(?=[MmLlHhVvCcSsQqTtAaZz])/);
  for (const token of tokens) {
    if (!token) continue;
    const command = token[0];
    const relative = command >= 'a' && command <= 'z';
    const values = numbersIn(token.slice(1));
    const upper = command.toUpperCase();
    const pair = (index: number) => {
      const px = values[index] + (relative ? x : 0);
      const py = values[index + 1] + (relative ? y : 0);
      return [px, py] as const;
    };
    if (upper === 'Z') { x = startX; y = startY; continue; }
    if (upper === 'H') {
      for (const v of values) { x = v + (relative ? x : 0); dot(x, y); }
      continue;
    }
    if (upper === 'V') {
      for (const v of values) { y = v + (relative ? y : 0); dot(x, y); }
      continue;
    }
    const size = upper === 'A' ? 7 : upper === 'C' ? 6 : upper === 'S' || upper === 'Q' ? 4 : upper === 'T' ? 2 : 2;
    for (let index = 0; index + size <= values.length; index += size) {
      for (let point = 0; point < size; point += 2) {
        const [px, py] = pair(index + point);
        dot(px, py);
      }
      const [ex, ey] = pair(index + size - 2);
      x = ex; y = ey;
      if (upper === 'M') { startX = x; startY = y; }
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

/** Union of every path's bounds through its own transform. VTracer paths live in local boxes positioned by translate. */
export function artworkBounds(paths: UploadedGraphicPath[]): ArtBounds | null {
  let union: ArtBounds | null = null;
  for (const path of paths) {
    const local = parsePathBounds(path.d);
    if (!local) continue;
    const matrix = parseSvgTransform(path.transform);
    const corners = [
      transformPoint(matrix, local.x, local.y),
      transformPoint(matrix, local.x + local.width, local.y),
      transformPoint(matrix, local.x, local.y + local.height),
      transformPoint(matrix, local.x + local.width, local.y + local.height),
    ];
    const xs = corners.map(corner => corner.x);
    const ys = corners.map(corner => corner.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    union = union
      ? { x: Math.min(union.x, box.x), y: Math.min(union.y, box.y), width: Math.max(union.x + union.width, box.x + box.width) - Math.min(union.x, box.x), height: Math.max(union.y + union.height, box.y + box.height) - Math.min(union.y, box.y) }
      : box;
  }
  return union;
}

/**
 * Normalization for one artwork box: uniform scale so the longest side
 * measures UPLOADED_ART_SIZE, plus the translation that maps the box center
 * onto the local origin. Combined SVG wrapper: translate(tx, ty) scale(s).
 */
export function artTransformForBounds(box: ArtBounds) {
  const scale = UPLOADED_ART_SIZE / Math.max(1, box.width, box.height);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return { scale, translateX: -centerX * scale, translateY: -centerY * scale };
}

export function normalizeUploadedGraphic(graphic: UploadedGraphicElement): UploadedGraphicElement {
  const scale = clampIconScaleAtRadius(graphic.scale);
  const bounds = iconRadiusBounds();
  return { ...graphic, scale, radius: Math.max(bounds.min, Math.min(bounds.max, graphic.radius)) };
}

export function uploadedGraphicFromVectorized(result: VectorizedResult, angle: number): UploadedGraphicElement {
  const paths = result.paths.map(path => ({ d: path.d, transform: path.transform }));
  // True artwork bounds (path data + per-path transforms); fall back to the
  // source frame when the vector carries no measurable geometry.
  const artBounds = artworkBounds(paths) ?? { x: 0, y: 0, width: Math.max(1, result.width), height: Math.max(1, result.height) };
  return normalizeUploadedGraphic({
    id: crypto.randomUUID(),
    type: 'uploaded-graphic',
    paths,
    sourceWidth: result.width,
    sourceHeight: result.height,
    artBounds,
    angle,
    radius: ICON_CENTER,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  });
}
