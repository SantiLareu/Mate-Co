import { cleanMask } from './cleanup';
import { analyzeBackground } from './backgroundAnalysis';
import { calculateMaskMetrics } from './metrics';
import { createPhotoEngravingMask } from './photoEngraving';
import { createIllustrationStencilMask } from './illustrationStencil';
import { scoreMask } from './scoring';
import type { BackgroundAnalysis, BinaryMask, MaskCandidate, RasterImage } from './types';

export const pixelLuminance = (red: number, green: number, blue: number) => .2126 * red + .7152 * green + .0722 * blue;

const compositeChannel = (channel: number, alpha: number) => channel * alpha + 255 * (1 - alpha);

export function rasterLuminance(image: RasterImage) {
  const values = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const index = pixel * 4;
    const alpha = image.data[index + 3] / 255;
    values[pixel] = Math.round(pixelLuminance(
      compositeChannel(image.data[index], alpha),
      compositeChannel(image.data[index + 1], alpha),
      compositeChannel(image.data[index + 2], alpha),
    ));
  }
  return values;
}

export function otsuThreshold(values: Uint8Array) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) totalSum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maximumVariance = -1;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = values.length - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > maximumVariance) {
      maximumVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

export function createAlphaMask(image: RasterImage, threshold = 32): BinaryMask {
  const data = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = image.data[pixel * 4 + 3] >= threshold ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

export function createLuminanceMask(image: RasterImage, inverted = false, threshold?: number): BinaryMask {
  const luminance = rasterLuminance(image);
  const cutoff = threshold ?? otsuThreshold(luminance);
  const data = new Uint8Array(luminance.length);
  for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = inverted ? Number(luminance[pixel] > cutoff) : Number(luminance[pixel] <= cutoff);
  return { width: image.width, height: image.height, data };
}

export type BackgroundColor = { red: number; green: number; blue: number };

export function estimateBorderBackground(image: RasterImage): BackgroundColor {
  return analyzeBackground(image).color;
}

export function createBackgroundAwareMask(image: RasterImage, tolerance = 48, suppliedAnalysis?: BackgroundAnalysis): BinaryMask {
  const analysis = suppliedAnalysis ?? analyzeBackground(image);
  const background = analysis.color;
  const data = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    const index = pixel * 4;
    const alpha = image.data[index + 3] / 255;
    const red = compositeChannel(image.data[index], alpha);
    const green = compositeChannel(image.data[index + 1], alpha);
    const blue = compositeChannel(image.data[index + 2], alpha);
    const distance = Math.hypot(red - background.red, green - background.green, blue - background.blue);
    data[pixel] = Number(!analysis.connectedBackground[pixel] && distance > tolerance);
  }
  return { width: image.width, height: image.height, data };
}

function gateWithUsefulAlpha(mask: BinaryMask, image: RasterImage, analysis: BackgroundAnalysis) {
  if (!analysis.hasUsefulAlpha) return mask;
  const data = new Uint8Array(mask.data);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    if (image.data[pixel * 4 + 3] < 32) data[pixel] = 0;
  }
  return { ...mask, data };
}

function assessed(mask: BinaryMask) {
  const metrics = calculateMaskMetrics(mask);
  return { mask, score: scoreMask(metrics) };
}

export function createAutoGraphicMask(image: RasterImage, suppliedAnalysis?: BackgroundAnalysis): { mask: BinaryMask; method: string } {
  const analysis = suppliedAnalysis ?? analyzeBackground(image);
  const area = image.width * image.height;
  const minimumComponentPixels = Math.max(2, Math.round(area * .000004));
  const maximumHolePixels = Math.max(2, Math.round(area * .000004));
  const prepare = (mask: BinaryMask) => cleanMask(gateWithUsefulAlpha(mask, image, analysis), minimumComponentPixels, maximumHolePixels);
  const adaptiveDistance = Math.max(34, Math.min(72, 30 + analysis.borderLuminanceVariation * 1.4));
  const variants = [
    { method: 'polaridad oscura', ...assessed(prepare(createLuminanceMask(image))) },
    { method: 'polaridad clara', ...assessed(prepare(createLuminanceMask(image, true))) },
    { method: 'separación del fondo', ...assessed(prepare(createBackgroundAwareMask(image, adaptiveDistance, analysis))) },
  ];
  const best = variants.reduce((current, candidate) => candidate.score.value > current.score.value ? candidate : current);
  return { mask: best.mask, method: best.method };
}

export function createEdgeMask(image: RasterImage): BinaryMask {
  const luminance = rasterLuminance(image);
  const magnitudes = new Uint8Array(luminance.length);
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const at = (dx: number, dy: number) => luminance[(y + dy) * image.width + x + dx];
      const horizontal = -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) + 2 * at(1, 0) - at(-1, 1) + at(1, 1);
      const vertical = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      magnitudes[y * image.width + x] = Math.min(255, Math.hypot(horizontal, vertical));
    }
  }
  const cutoff = Math.max(36, otsuThreshold(magnitudes));
  const data = new Uint8Array(magnitudes.length);
  for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = magnitudes[pixel] >= cutoff ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

export function generateMaskCandidates(image: RasterImage, suppliedAnalysis?: BackgroundAnalysis): MaskCandidate[] {
  const analysis = suppliedAnalysis ?? analyzeBackground(image);
  const area = image.width * image.height;
  const minimumComponentPixels = Math.max(2, Math.round(area * .000004));
  const maximumHolePixels = Math.max(2, Math.round(area * .000005));
  const autoGraphic = createAutoGraphicMask(image, analysis);
  const photoEngraving = createPhotoEngravingMask(image, analysis);
  const illustrationStencil = createIllustrationStencilMask(image, analysis);
  const candidates = [
    { strategy: 'alpha', label: 'Alpha', description: 'Separa figura y fondo usando transparencia.', mask: createAlphaMask(image) },
    { strategy: 'luminance', label: 'Luminancia', description: 'Detecta contenido oscuro mediante umbral automático.', mask: createLuminanceMask(image) },
    { strategy: 'luminance-inverted', label: 'Luminancia invertida', description: 'Detecta contenido claro sobre fondos oscuros.', mask: createLuminanceMask(image, true) },
    { strategy: 'background-aware', label: 'Background-aware', description: 'Compara cada píxel con el fondo conectado a los bordes.', mask: createBackgroundAwareMask(image, 48, analysis) },
    { strategy: 'edge', label: 'Edge / line-art', description: 'Extrae bordes y detalles internos mediante Sobel.', mask: createEdgeMask(image) },
    { strategy: 'auto-graphic', label: 'Auto Graphic', description: `Compara polaridades y fondo; eligió ${autoGraphic.method}.`, mask: autoGraphic.mask },
    { strategy: 'photo-engraving', label: 'Photo engraving', description: analysis.complexBackground ? 'Combina sombras y bordes. Fondo complejo / baja confianza.' : 'Combina sombras importantes con contornos fuertes.', mask: photoEngraving.mask },
    { strategy: 'illustration-stencil', label: 'Illustration / Stencil', description: analysis.complexBackground ? 'Simplifica tonos y contornos. Fondo complejo / baja confianza.' : 'Posteriza tonos y combina sombras estructurales con contornos estilizados.', mask: illustrationStencil.mask },
  ] as const;
  return candidates.map(candidate => {
    const mask = cleanMask(candidate.mask, minimumComponentPixels, maximumHolePixels);
    const metrics = calculateMaskMetrics(mask);
    return { ...candidate, mask, metrics, score: scoreMask(metrics) };
  });
}
