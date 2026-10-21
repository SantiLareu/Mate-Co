/**
 * Tests Node del núcleo puro del importador SVG aislado (sin DOM).
 * El parser completo (DOMParser) se prueba en navegador en svg-import-lab.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  circleToPath,
  ellipseToPath,
  lineToPath,
  polylineToPath,
  readLength,
  rectToPath,
} from '../src/svg-import/geometry';
import { SVG_IMPORT_LIMITS } from '../src/svg-import/limits';
import { boundsOfPoints, flattenPathData, pathDataBounds, transformedPathBounds, unionBoxes } from '../src/svg-import/measure';
import {
  applyMatrix,
  isIdentityMatrix,
  multiplyMatrices,
  parseTransformList,
  serializeMatrix,
} from '../src/svg-import/transforms';

const matrixOf = (transform: string) => {
  const parsed = parseTransformList(transform);
  if (!parsed.ok) throw new Error(`Transform inválido en test: ${transform}`);
  return parsed.matrix;
};

test('translate compone desplazamiento en e/f', () => {
  expect(matrixOf('translate(10 20)')).toMatchObject({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  expect(matrixOf('translate(10)')).toMatchObject({ e: 10, f: 0 });
});

test('scale uniforme y no uniforme', () => {
  expect(matrixOf('scale(2)')).toMatchObject({ a: 2, d: 2 });
  expect(matrixOf('scale(2,3)')).toMatchObject({ a: 2, d: 3 });
});

test('escala Y negativa de PicSVG se conserva (orientación intacta)', () => {
  const matrix = matrixOf('translate(60 840) scale(0.1,-0.1)');
  expect(matrix.a).toBeCloseTo(0.1, 10);
  expect(matrix.d).toBeCloseTo(-0.1, 10);
  expect(matrix.e).toBeCloseTo(60, 10);
  expect(matrix.f).toBeCloseTo(840, 10);
  // La componente Y negativa es la que preserva la orientación vertical.
  expect(matrix.d).toBeLessThan(0);
  expect(serializeMatrix(matrix)).toBe('matrix(0.1 0 0 -0.1 60 840)');
});

test('rotate de 90 grados y con centro', () => {
  const quarter = matrixOf('rotate(90)');
  expect(quarter.a).toBeCloseTo(0, 10);
  expect(quarter.b).toBeCloseTo(1, 10);
  expect(quarter.c).toBeCloseTo(-1, 10);
  expect(quarter.d).toBeCloseTo(0, 10);
  const centered = matrixOf('rotate(30 10 20)');
  const expected = multiplyMatrices(
    multiplyMatrices({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }, matrixOf('rotate(30)')),
    { a: 1, b: 0, c: 0, d: 1, e: -10, f: -20 },
  );
  expect(centered).toMatchObject({
    a: expect.closeTo(expected.a, 10),
    e: expect.closeTo(expected.e, 10),
    f: expect.closeTo(expected.f, 10),
  });
});

test('matrix directa y skew', () => {
  expect(matrixOf('matrix(1 2 3 4 5 6)')).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
  expect(matrixOf('skewX(45)')).toMatchObject({ a: 1, c: expect.closeTo(1, 10) });
  expect(matrixOf('skewY(45)')).toMatchObject({ d: 1, b: expect.closeTo(1, 10) });
});

test('orden de composición: translate(10 0) scale(2) aplica scale primero', () => {
  const matrix = matrixOf('translate(10 0) scale(2)');
  expect(applyMatrix(matrix, 1, 1)).toMatchObject({ x: 12, y: 2 });
});

test('transforms anidados componen padre × hijo', () => {
  const parent = matrixOf('translate(60 840) scale(0.1,-0.1)');
  const child = matrixOf('translate(1800 900) rotate(12)');
  const composed = multiplyMatrices(parent, child);
  const direct = applyMatrix(composed, 100, 50);
  const stepwise = applyMatrix(parent, ...(() => {
    const inner = applyMatrix(child, 100, 50);
    return [inner.x, inner.y] as const;
  })());
  expect(direct.x).toBeCloseTo(stepwise.x, 9);
  expect(direct.y).toBeCloseTo(stepwise.y, 9);
});

test('identidad se serializa como ausente y el redondeo es determinista', () => {
  expect(serializeMatrix(matrixOf(''))).toBeUndefined();
  expect(serializeMatrix(matrixOf('translate(0 0) scale(1)'))).toBeUndefined();
  expect(isIdentityMatrix(matrixOf('matrix(1 0 0 1 0 0)'))).toBe(true);
  const first = serializeMatrix(matrixOf('matrix(0.123456789 0 0 0.123456789 0 0)'));
  const second = serializeMatrix(matrixOf('matrix(0.123456789 0 0 0.123456789 0 0)'));
  expect(first).toBe('matrix(0.123457 0 0 0.123457 0 0)');
  expect(first).toBe(second);
});

test('transforms inválidos se rechazan, nunca se ignoran', () => {
  for (const bad of ['foo(1)', 'translate(1 2 3)', 'scale()', 'rotate(1 2)', 'matrix(1 2 3)', 'translate(1) resto', 'translate(nan)', '']) {
    const parsed = parseTransformList(bad === '' ? undefined : bad);
    if (bad === '') expect(parsed.ok).toBe(true);
    else expect(parsed.ok).toBe(false);
  }
});

test('primitivas se convierten a path de forma determinista', () => {
  expect(circleToPath(0, 0, 10)).toBe('M-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z');
  expect(circleToPath(0, 0, 10)).toBe(circleToPath(0, 0, 10));
  expect(circleToPath(0, 0, 0)).toBeNull();
  expect(ellipseToPath(5, 5, 4, 2)).toContain('a4 2');
  expect(ellipseToPath(5, 5, 0, 2)).toBeNull();
  expect(rectToPath(1, 2, 10, 6, 0, 0)).toBe('M1 2H11V8H1Z');
  // Radios que exceden la mitad se recortan de forma determinista.
  expect(rectToPath(0, 0, 10, 6, 99, 0)).toBe('M0 0H10V6H0Z');
  expect(rectToPath(0, 0, 10, 10, 2, 2)).toContain('A2 2');
  expect(rectToPath(0, 0, 0, 10, 0, 0)).toBeNull();
  expect(lineToPath(0, 0, 10, 10)).toBe('M0 0L10 10');
  expect(lineToPath(1, 1, 1, 1)).toBeNull();
  expect(polylineToPath('0,0 10,0 10,10', false)).toBe('M0 0L10 0L10 10');
  expect(polylineToPath('0,0 10,0 10,10', true)).toBe('M0 0L10 0L10 10Z');
  expect(polylineToPath('0,0 10', false)).toBeNull();
  expect(polylineToPath('', false)).toBeNull();
});

test('readLength rechaza porcentajes e inválidos', () => {
  expect(readLength('10')).toEqual({ ok: true, value: 10 });
  expect(readLength('10px')).toEqual({ ok: true, value: 10 });
  expect(readLength(null)).toEqual({ ok: true, value: 0 });
  expect(readLength('50%')).toEqual({ ok: false });
  expect(readLength('abc')).toEqual({ ok: false });
});

test('medición de bounds: comandos absolutos, relativos e implícitos', () => {
  expect(pathDataBounds('M0 0H10V10H0Z')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  expect(pathDataBounds('m5 5l10 0l0 10z')).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  expect(pathDataBounds('M0 0 10 10')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  expect(pathDataBounds('M0 0C10 0 10 20 20 20')).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  // Los controles de curva se incluyen (caja conservadora, como parsePathBounds).
  expect(pathDataBounds('M1 1Q5 9 9 1')).toEqual({ x: 1, y: 1, width: 8, height: 8 });
  expect(pathDataBounds('')).toBeNull();
  expect(pathDataBounds('M0 0L10')).toBeNull();
});

test('medición de arcos y bounds transformados punto por punto', () => {
  const arc = pathDataBounds('M10 0A10 10 0 0 1 0 10');
  expect(arc).not.toBeNull();
  expect(arc!.x).toBeCloseTo(0, 6);
  expect(arc!.y).toBeCloseTo(0, 6);
  expect(arc!.width).toBeCloseTo(10, 6);
  expect(arc!.height).toBeCloseTo(10, 6);
  // Flip vertical estilo PicSVG: la caja sigue siendo válida y positiva.
  const flipped = transformedPathBounds('M0 0H10V10H0Z', { a: 1, b: 0, c: 0, d: -1, e: 0, f: 10 });
  expect(flipped).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  const rotated = transformedPathBounds('M0 0H10V0', { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
  expect(rotated).toEqual({ x: 0, y: 0, width: 0, height: 10 });
  expect(flattenPathData('M0 0H10V10H0Z')).not.toBeNull();
  expect(boundsOfPoints([])).toBeNull();
  expect(
    unionBoxes([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100, y: 50, width: 10, height: 10 },
    ]),
  ).toEqual({ x: 0, y: 0, width: 110, height: 60 });
});

test('límites defensivos aceptan los fixtures reales con margen', () => {
  expect(SVG_IMPORT_LIMITS.MAX_PATHS).toBeGreaterThanOrEqual(1000);
  expect(SVG_IMPORT_LIMITS.MAX_ELEMENT_NODES).toBeGreaterThanOrEqual(2000);
  expect(SVG_IMPORT_LIMITS.MAX_GROUP_DEPTH).toBeGreaterThanOrEqual(8);
  expect(SVG_IMPORT_LIMITS.MAX_FILE_CHARS).toBeGreaterThanOrEqual(1_000_000);
});

test('módulo aislado: sin dependencias del pipeline raster ni DOM ejecutable', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'svg-import');
  const files = readdirSync(dir).filter(name => name.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  const forbidden = [
    '../vectorization',
    '../components',
    '../export',
    '../data',
    'vtracer',
    'VTracer',
    'innerHTML',
    'dangerouslySetInnerHTML',
    'eval(',
    'Function(',
  ];
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const file of files) {
    const source = stripComments(readFileSync(join(dir, file), 'utf8'));
    for (const token of forbidden) {
      expect(source, `${file} no debe contener ${token}`).not.toContain(token);
    }
  }
  const parserSource = readFileSync(join(dir, 'parseSvgImport.ts'), 'utf8');
  expect(parserSource).toContain('DOMParser');
  expect(parserSource).toContain('CONTAINS_SCRIPT');
  expect(parserSource).toContain('CONTAINS_RASTER_IMAGE');
  expect(parserSource).toContain('CONTAINS_LIVE_TEXT');
});
