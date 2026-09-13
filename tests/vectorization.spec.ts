import { expect, test } from '@playwright/test';
import { analyzeBackground } from '../src/vectorization/backgroundAnalysis';
import { groupSimilarCandidates, isViableCandidate, selectBestCandidates } from '../src/vectorization/candidateSelection';
import { cleanMask, fillSmallHoles, removeSmallComponents } from '../src/vectorization/cleanup';
import { hasSignificantTransparency } from '../src/vectorization/imageLoader';
import { calculateMaskMetrics, isSuspiciouslyFull } from '../src/vectorization/metrics';
import { createAutoGraphicMask, createBackgroundAwareMask, createLuminanceMask, estimateBorderBackground, generateMaskCandidates, pixelLuminance } from '../src/vectorization/masks';
import { normalizeRaster, normalizedDimensions } from '../src/vectorization/normalize';
import { createPhotoEngravingMask } from '../src/vectorization/photoEngraving';
import { recommendCandidate, scoreMask } from '../src/vectorization/scoring';
import { areMasksVisuallySimilar, compareMasks } from '../src/vectorization/maskSimilarity';
import type { BinaryMask, MaskCandidate, MaskStrategy, RasterImage } from '../src/vectorization/types';

const raster = (width: number, height: number, pixels: number[][]): RasterImage => ({
  width,
  height,
  data: new Uint8ClampedArray(pixels.flat()),
});

const graphic = (background: number[], content: number[], transparentBackground = false) => raster(9, 9,
  Array.from({ length: 81 }, (_, index) => {
    const x = index % 9;
    const y = Math.floor(index / 9);
    if (x >= 3 && x <= 5 && y >= 2 && y <= 6) return content;
    return transparentBackground ? [background[0], background[1], background[2], 0] : background;
  }),
);

const binaryMask = (width: number, height: number, blackPixels: number[]): BinaryMask => {
  const data = new Uint8Array(width * height);
  for (const pixel of blackPixels) data[pixel] = 1;
  return { width, height, data };
};

const maskCandidate = (strategy: MaskStrategy, mask: BinaryMask): MaskCandidate => {
  const metrics = calculateMaskMetrics(mask);
  return { strategy, label: strategy, description: strategy, mask, metrics, score: scoreMask(metrics) };
};

test('detects meaningful alpha without treating fully opaque images as transparent', () => {
  const transparent = raster(2, 1, [[0, 0, 0, 255], [0, 0, 0, 0]]);
  const opaque = raster(2, 1, [[0, 0, 0, 255], [255, 255, 255, 255]]);
  expect(hasSignificantTransparency(transparent)).toBe(true);
  expect(hasSignificantTransparency(opaque)).toBe(false);
});

test('calculates luminance and creates normal and inverted binary masks', () => {
  expect(pixelLuminance(0, 0, 0)).toBe(0);
  expect(pixelLuminance(255, 255, 255)).toBeCloseTo(255, 5);
  const image = raster(2, 1, [[0, 0, 0, 255], [255, 255, 255, 255]]);
  expect(Array.from(createLuminanceMask(image, false, 127).data)).toEqual([1, 0]);
  expect(Array.from(createLuminanceMask(image, true, 127).data)).toEqual([0, 1]);
});

test('estimates the border background and separates a differently colored center', () => {
  const pixels = Array.from({ length: 25 }, (_, index) => index === 12 ? [210, 30, 30, 255] : [245, 245, 240, 255]);
  const image = raster(5, 5, pixels);
  const background = estimateBorderBackground(image);
  expect(background.red).toBeCloseTo(245, 1);
  expect(background.green).toBeCloseTo(245, 1);
  const mask = createBackgroundAwareMask(image, 40);
  expect(mask.data[12]).toBe(1);
  expect(mask.data[0]).toBe(0);
});

test('background analysis reports robust border characteristics for a uniform color', () => {
  const image = graphic([32, 92, 178, 255], [238, 190, 28, 255]);
  const analysis = analyzeBackground(image);
  expect(analysis.color.red).toBeCloseTo(32, 0);
  expect(analysis.color.green).toBeCloseTo(92, 0);
  expect(analysis.borderUniformityPercentage).toBe(100);
  expect(analysis.connectedBorderPercentage).toBe(100);
  expect(analysis.hasChromaticSeparation).toBe(true);
  expect(analysis.confidence).toBeGreaterThan(80);
  const autoGraphic = createAutoGraphicMask(image);
  expect(autoGraphic.mask.data[4 * 9 + 4]).toBe(1);
  expect(autoGraphic.mask.data[0]).toBe(0);
});

test('Auto Graphic keeps dark content on white and light content on black', () => {
  const darkOnWhite = createAutoGraphicMask(graphic([255, 255, 255, 255], [0, 0, 0, 255]));
  expect(darkOnWhite.mask.data[4 * 9 + 4]).toBe(1);
  expect(darkOnWhite.mask.data[0]).toBe(0);
  expect(darkOnWhite.method).toBe('polaridad oscura');

  const lightOnBlack = createAutoGraphicMask(graphic([0, 0, 0, 255], [255, 255, 255, 255]));
  expect(lightOnBlack.mask.data[4 * 9 + 4]).toBe(1);
  expect(lightOnBlack.mask.data[0]).toBe(0);
  expect(lightOnBlack.method).toBe('polaridad clara');
});

test('useful alpha is diagnostic and does not force Alpha to be recommended', () => {
  const image = graphic([255, 255, 255, 0], [245, 204, 0, 255], true);
  const candidates = generateMaskCandidates(image);
  expect(analyzeBackground(image).hasUsefulAlpha).toBe(true);
  expect(recommendCandidate(candidates)?.strategy).not.toBe('alpha');
});

test('removes tiny black components and fills only small enclosed holes', () => {
  const noisy: BinaryMask = { width: 5, height: 5, data: new Uint8Array(25) };
  noisy.data[0] = 1;
  for (const index of [6, 7, 11, 12]) noisy.data[index] = 1;
  const cleaned = removeSmallComponents(noisy, 2);
  expect(cleaned.data[0]).toBe(0);
  expect([6, 7, 11, 12].every(index => cleaned.data[index] === 1)).toBe(true);

  const withHole: BinaryMask = { width: 5, height: 5, data: new Uint8Array(25).fill(1) };
  withHole.data[12] = 0;
  expect(fillSmallHoles(withHole, 1).data[12]).toBe(1);
  expect(cleanMask(noisy, 2, 1).data[0]).toBe(0);
});

test('reports coverage, giant border masses and suspiciously full masks', () => {
  const full: BinaryMask = { width: 10, height: 10, data: new Uint8Array(100).fill(1) };
  const metrics = calculateMaskMetrics(full);
  expect(metrics.blackPercentage).toBe(100);
  expect(metrics.componentCount).toBe(1);
  expect(metrics.largestComponentTouchesBorder).toBe(true);
  expect(metrics.suspicious).toBe(true);
  expect(isSuspiciouslyFull(full)).toBe(true);
});

test('scoring strongly penalizes full, empty and border-connected giant masks', () => {
  const full = calculateMaskMetrics({ width: 10, height: 10, data: new Uint8Array(100).fill(1) });
  const empty = calculateMaskMetrics({ width: 10, height: 10, data: new Uint8Array(100) });
  const giantData = new Uint8Array(100);
  for (let index = 0; index < 70; index += 1) giantData[index] = 1;
  const giant = calculateMaskMetrics({ width: 10, height: 10, data: giantData });
  expect(scoreMask(full).value).toBeLessThan(25);
  expect(scoreMask(empty).value).toBeLessThan(25);
  expect(scoreMask(giant).value).toBeLessThan(50);
  expect(scoreMask(giant).summary).toContain('Penalizada');
});

test('scoring does not reject a signature merely for having separate small strokes', () => {
  const data = new Uint8Array(400);
  for (const index of [42, 87, 232, 337]) data[index] = 1;
  const score = scoreMask(calculateMaskMetrics({ width: 20, height: 20, data }));
  expect(score.value).toBeGreaterThan(50);
  expect(score.penalties.every(penalty => !penalty.includes('componentes'))).toBe(true);
});

test('identical and nearly identical masks are similar while different masks are not', () => {
  const base = binaryMask(10, 10, Array.from({ length: 25 }, (_, index) => (Math.floor(index / 5) + 2) * 10 + index % 5 + 2));
  const identical = binaryMask(10, 10, Array.from(base.data.entries()).filter(([, value]) => value === 1).map(([index]) => index));
  const nearly = { ...base, data: new Uint8Array(base.data) };
  nearly.data[22] = 0;
  const different = binaryMask(10, 10, [77, 78, 87, 88]);
  expect(compareMasks(base, identical).intersectionOverUnion).toBe(1);
  expect(areMasksVisuallySimilar(base, identical)).toBe(true);
  expect(areMasksVisuallySimilar(base, nearly)).toBe(true);
  expect(areMasksVisuallySimilar(base, different)).toBe(false);
});

test('candidate selection filters invalid masks and deduplicates identical good results', () => {
  const goodMask = binaryMask(12, 12, Array.from({ length: 16 }, (_, index) => (Math.floor(index / 4) + 4) * 12 + index % 4 + 4));
  const invalid = maskCandidate('alpha', { width: 12, height: 12, data: new Uint8Array(144).fill(1) });
  const duplicates = [
    maskCandidate('luminance', goodMask),
    maskCandidate('background-aware', { ...goodMask, data: new Uint8Array(goodMask.data) }),
    maskCandidate('auto-graphic', { ...goodMask, data: new Uint8Array(goodMask.data) }),
  ];
  expect(isViableCandidate(invalid)).toBe(false);
  expect(groupSimilarCandidates(duplicates)).toHaveLength(1);
  const selected = selectBestCandidates([invalid, ...duplicates]);
  expect(selected).toHaveLength(1);
  expect(selected[0].label).toBe('Recomendada');
  expect(selected.some(option => option.candidate === invalid)).toBe(false);
});

test('candidate selection returns up to three viable and visually different options', () => {
  const filled = maskCandidate('auto-graphic', binaryMask(20, 20, Array.from({ length: 64 }, (_, index) => (Math.floor(index / 8) + 6) * 20 + index % 8 + 6)));
  const outlinePixels: number[] = [];
  for (let coordinate = 4; coordinate <= 15; coordinate += 1) {
    outlinePixels.push(4 * 20 + coordinate, 15 * 20 + coordinate, coordinate * 20 + 4, coordinate * 20 + 15);
  }
  const outline = maskCandidate('edge', binaryMask(20, 20, [...new Set(outlinePixels)]));
  const bars = maskCandidate('photo-engraving', binaryMask(20, 20, [
    ...Array.from({ length: 50 }, (_, index) => (Math.floor(index / 10) + 3) * 20 + index % 10 + 5),
    ...Array.from({ length: 40 }, (_, index) => (Math.floor(index / 10) + 13) * 20 + index % 10 + 5),
  ]));
  const dot = maskCandidate('luminance', binaryMask(20, 20, [210, 211, 230, 231]));
  const options = selectBestCandidates([filled, outline, bars, dot]);
  expect(options.length).toBeGreaterThanOrEqual(2);
  expect(options.length).toBeLessThanOrEqual(3);
  expect(options[0].label).toBe('Recomendada');
  expect(new Set(options.map(option => option.label)).size).toBe(options.length);
  expect(options[0].candidate.mask.width).toBe(20);
  expect(options[0].candidate.mask.data).toBeInstanceOf(Uint8Array);
  expect(selectBestCandidates([filled, outline, bars, dot], 10)).toHaveLength(3);
});

test('Photo engraving combines binary shadow masses and important edges without filling a uniform background', () => {
  const pixels = Array.from({ length: 32 * 32 }, (_, index) => {
    const x = index % 32;
    const y = Math.floor(index / 32);
    if (x >= 9 && x <= 22 && y >= 9 && y <= 22) return [35, 35, 35, 255];
    if (x === 25 && y >= 7 && y <= 24) return [105, 105, 105, 255];
    return [245, 245, 245, 255];
  });
  const result = createPhotoEngravingMask(raster(32, 32, pixels));
  const black = result.mask.data.reduce((sum, value) => sum + value, 0);
  expect(result.shadowMask.data.some(Boolean)).toBe(true);
  expect(result.importantEdges.data.some(Boolean)).toBe(true);
  expect(result.mask.data.every(value => value === 0 || value === 1)).toBe(true);
  expect(black).toBeGreaterThan(0);
  expect(black).toBeLessThan(32 * 32 * .6);
  expect(result.mask.data[0]).toBe(0);
});

test('normalizes large rasters without changing aspect ratio or source pixels', () => {
  expect(normalizedDimensions(2400, 1200, 900)).toEqual({ width: 900, height: 450 });
  const source = raster(4, 2, Array.from({ length: 8 }, () => [10, 20, 30, 255]));
  const normalized = normalizeRaster(source, 2);
  expect(normalized.width).toBe(2);
  expect(normalized.height).toBe(1);
  expect(normalized.data).not.toBe(source.data);
  expect(source.width).toBe(4);
});

test('keeps the five original strategies and adds two strictly binary candidates', () => {
  const image = raster(3, 3, Array.from({ length: 9 }, (_, index) => index === 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const candidates = generateMaskCandidates(image);
  expect(candidates.map(candidate => candidate.strategy).slice(0, 5)).toEqual(['alpha', 'luminance', 'luminance-inverted', 'background-aware', 'edge']);
  expect(candidates.map(candidate => candidate.strategy)).toContain('auto-graphic');
  expect(candidates.map(candidate => candidate.strategy)).toContain('photo-engraving');
  for (const candidate of candidates) {
    expect(Array.from(candidate.mask.data).every(value => value === 0 || value === 1)).toBe(true);
  }
});

test('vector lab is isolated at /vector-lab and processes a local PNG', async ({ page }) => {
  await page.goto('/vector-lab');
  await expect(page.getByRole('heading', { name: 'Laboratorio de máscaras para grabado' })).toBeVisible();
  await expect(page.locator('.customizer')).toHaveCount(0);
  await page.locator('input[type="file"]').evaluate(async input => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.fillRect(3, 2, 6, 4);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG unavailable')), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'logo-transparente.png', { type: 'image/png' }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByText('12 × 8 px')).toHaveCount(2);
  await expect(page.getByText('Detectada', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lectura automática del fondo' })).toBeVisible();
  await expect(page.getByText('Alpha útil', { exact: true })).toBeVisible();
  const clientView = page.locator('.client-results');
  await expect(clientView.getByRole('heading', { name: 'Resultado para grabado' })).toBeVisible();
  await expect(clientView.getByText('Auto Graphic', { exact: true })).toHaveCount(0);
  await expect(clientView.getByText('Background-aware', { exact: true })).toHaveCount(0);
  const clientOptions = clientView.locator('.client-option');
  const clientOptionCount = await clientOptions.count();
  expect(clientOptionCount).toBeGreaterThanOrEqual(2);
  expect(clientOptionCount).toBeLessThanOrEqual(3);
  await expect(clientOptions.first()).toHaveAttribute('aria-pressed', 'true');
  await clientOptions.nth(1).click();
  await expect(clientOptions.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(clientOptions.first()).toHaveAttribute('aria-pressed', 'false');
  await clientView.getByRole('button', { name: 'Usar este resultado' }).click();
  await expect(clientView.getByRole('status')).toContainText('La máscara binaria quedó preparada para la siguiente etapa');
  const vectorSection = page.locator('.vector-result');
  await expect(vectorSection.getByRole('heading', { name: 'Resultado vectorial' })).toBeVisible();
  await vectorSection.getByRole('button', { name: 'Vectorizar resultado seleccionado' }).click();
  await expect(vectorSection.getByRole('status')).toHaveText('Vectorización completada.');
  await expect(vectorSection.getByRole('img', { name: 'Preview del resultado vectorial' })).toBeVisible();
  await expect(clientOptions.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(vectorSection.getByText('Paths', { exact: true })).toBeVisible();
  await clientOptions.first().click();
  await expect(vectorSection.getByRole('status')).toHaveText('Pendiente de vectorización.');
  await expect(vectorSection.getByRole('img', { name: 'Preview del resultado vectorial' })).toHaveCount(0);
  await expect(page.getByText('Auto Graphic', { exact: true })).toBeVisible();
  await expect(page.getByText('Photo engraving', { exact: true })).toBeVisible();
  await expect(page.getByText('Recomendada por métricas')).toHaveCount(1);
  await expect(page.locator('.candidate-card')).toHaveCount(7);
  await expect(page.locator('.candidate-card canvas')).toHaveCount(14);
  await expect(page.getByText('Score', { exact: true })).toHaveCount(7);
});

test('the main application still opens the unchanged editor flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Diseño', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.vector-lab')).toHaveCount(0);
});
