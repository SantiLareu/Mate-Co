/**
 * Matrices 2D para transforms SVG.
 *
 * Decisión de diseño (opción B del laboratorio): componer las listas de
 * transforms heredadas en UNA matriz normalizada `matrix(a b c d e f)` por
 * path. Es la forma más robusta para la futura integración con
 * `UploadedGraphicElement`, cuyo `parseSvgTransform` ya entiende `matrix()`.
 * Conservar cadenas de transforms anidadas obligaría al editor a resolver
 * herencia de grupos que ya no existirían como DOM.
 *
 * Orden de composición: en SVG `transform="T1 T2"` equivale a grupos
 * anidados (T1 afuera). El CTM del hijo es `padre × local` y dentro de una
 * lista el plegado es por izquierda: `resultado = resultado × siguiente`.
 * Las escalas negativas (p. ej. `scale(0.1,-0.1)` de PicSVG) se preservan
 * tal cual: la orientación vertical NO se "corrige".
 */

import { SVG_IMPORT_LIMITS } from './limits';
import type { SvgImportError } from './types';

export type SvgMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export const IDENTITY_MATRIX: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export type TransformParseError = { code: 'INVALID_TRANSFORM'; message: string };

export function multiplyMatrices(parent: SvgMatrix, child: SvgMatrix): SvgMatrix {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  };
}

export function isIdentityMatrix(matrix: SvgMatrix): boolean {
  return matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0;
}

export function applyMatrix(matrix: SvgMatrix, x: number, y: number): { x: number; y: number } {
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

const FUNCTION_PATTERN = /([A-Za-z]+)\s*\(([^)]*)\)/g;

function fail(message: string): TransformParseError {
  return { code: 'INVALID_TRANSFORM', message };
}

function toNumbers(args: string): number[] | null {
  if (args.trim() === '') return [];
  const parts = args.split(/[\s,]+/).filter(part => part.length > 0);
  const values = parts.map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  return values;
}

/**
 * Parsea una lista de transforms SVG de forma estricta. Toda la cadena debe
 * consumirse con funciones conocidas; cualquier resto o función desconocida
 * es error (nunca se ignora silenciosamente).
 */
export function parseTransformList(
  transform: string | null | undefined,
): { ok: true; matrix: SvgMatrix; functions: string[] } | { ok: false; error: TransformParseError } {
  if (transform == null || transform.trim() === '') {
    return { ok: true, matrix: { ...IDENTITY_MATRIX }, functions: [] };
  }
  if (transform.length > SVG_IMPORT_LIMITS.MAX_TRANSFORM_CHARS) {
    return { ok: false, error: fail('Lista de transforms excesivamente larga.') };
  }
  const functions: string[] = [];
  let matrix: SvgMatrix = { ...IDENTITY_MATRIX };
  let consumed = 0;
  FUNCTION_PATTERN.lastIndex = 0;
  let match = FUNCTION_PATTERN.exec(transform);
  if (!match) return { ok: false, error: fail(`Transform no reconocido: "${transform.slice(0, 80)}".`) };
  while (match) {
    // Entre funciones solo puede haber espacios o comas.
    const gap = transform.slice(consumed, match.index);
    if (!/^[\s,]*$/.test(gap)) {
      return { ok: false, error: fail(`Contenido inesperado en transform cerca de "${gap.slice(0, 40)}".`) };
    }
    const name = match[1];
    const values = toNumbers(match[2]);
    if (values === null) {
      return { ok: false, error: fail(`Argumentos no numéricos en ${name}().`) };
    }
    const [p0 = 0, p1 = 0, p2 = 0] = values;
    let local: SvgMatrix | null = null;
    if (name === 'translate') {
      if (values.length < 1 || values.length > 2) return { ok: false, error: fail('translate() espera 1 o 2 argumentos.') };
      local = { ...IDENTITY_MATRIX, e: p0, f: values.length > 1 ? p1 : 0 };
    } else if (name === 'scale') {
      if (values.length < 1 || values.length > 2) return { ok: false, error: fail('scale() espera 1 o 2 argumentos.') };
      local = { a: p0, b: 0, c: 0, d: values.length > 1 ? p1 : p0, e: 0, f: 0 };
    } else if (name === 'rotate') {
      if (values.length !== 1 && values.length !== 3) {
        return { ok: false, error: fail('rotate() espera 1 o 3 argumentos.') };
      }
      const angle = (p0 * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: SvgMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (values.length === 3) {
        const cx = p1;
        const cy = p2;
        local = multiplyMatrices(
          multiplyMatrices({ ...IDENTITY_MATRIX, e: cx, f: cy }, rotation),
          { ...IDENTITY_MATRIX, e: -cx, f: -cy },
        );
      } else {
        local = rotation;
      }
    } else if (name === 'skewX') {
      if (values.length !== 1) return { ok: false, error: fail('skewX() espera 1 argumento.') };
      local = { a: 1, b: 0, c: Math.tan((p0 * Math.PI) / 180), d: 1, e: 0, f: 0 };
    } else if (name === 'skewY') {
      if (values.length !== 1) return { ok: false, error: fail('skewY() espera 1 argumento.') };
      local = { a: 1, b: Math.tan((p0 * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
    } else if (name === 'matrix') {
      if (values.length !== 6) return { ok: false, error: fail('matrix() espera 6 argumentos.') };
      local = { a: values[0], b: values[1], c: values[2], d: values[3], e: values[4], f: values[5] };
    } else {
      return { ok: false, error: fail(`Función de transform no soportada: ${name}().`) };
    }
    if (![local.a, local.b, local.c, local.d, local.e, local.f].every(Number.isFinite)) {
      return { ok: false, error: fail(`Transform ${name}() produce valores no finitos.`) };
    }
    functions.push(name);
    matrix = multiplyMatrices(matrix, local);
    consumed = match.index + match[0].length;
    match = FUNCTION_PATTERN.exec(transform);
  }
  if (!/^[\s,]*$/.test(transform.slice(consumed))) {
    return { ok: false, error: fail('Contenido residual al final del transform.') };
  }
  return { ok: true, matrix, functions };
}

function round6(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return rounded === 0 ? 0 : rounded;
}

/** Serializa a `matrix(a b c d e f)`; la identidad se representa como ausente. */
export function serializeMatrix(matrix: SvgMatrix): string | undefined {
  if (isIdentityMatrix(matrix)) return undefined;
  const parts = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round6);
  return `matrix(${parts.join(' ')})`;
}

export function asImportError(error: TransformParseError): SvgImportError {
  return { code: error.code, message: error.message };
}
