import { analyzeBackground } from './backgroundAnalysis';
import { cleanMask, removeSmallComponents } from './cleanup';
import type { BackgroundAnalysis, BinaryMask, RasterImage } from './types';

export type IllustrationStencilResult = {
  mask: BinaryMask;
  smoothedLuminance: Uint8Array;
  posterizedLuminance: Uint8Array;
  shadowMask: BinaryMask;
  stylizedEdges: BinaryMask;
};

const luminance = (red: number, green: number, blue: number) => .2126 * red + .7152 * green + .0722 * blue;

function rasterLuminance(image: RasterImage) {
  const values = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    const alpha = image.data[offset + 3] / 255;
    values[pixel] = Math.round(luminance(
      image.data[offset] * alpha + 255 * (1 - alpha),
      image.data[offset + 1] * alpha + 255 * (1 - alpha),
      image.data[offset + 2] * alpha + 255 * (1 - alpha),
    ));
  }
  return values;
}

export function smoothLuminanceEdgeAware(values: Uint8Array, width: number, height: number, range = 44) {
  const output = new Uint8Array(values.length);
  const spatialWeights = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = values[y * width + x];
      let sum = 0;
      let weightSum = 0;
      let weightIndex = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          const sample = values[sampleY * width + sampleX];
          const tonalWeight = Math.max(0, 1 - Math.abs(sample - center) / range);
          const weight = spatialWeights[weightIndex] * tonalWeight;
          sum += sample * weight;
          weightSum += weight;
          weightIndex += 1;
        }
      }
      output[y * width + x] = Math.round(weightSum ? sum / weightSum : center);
    }
  }
  return output;
}

export function posterizeLuminance(values: Uint8Array, levels = 5) {
  const safeLevels = Math.max(2, Math.min(16, Math.round(levels)));
  const step = 255 / (safeLevels - 1);
  return Uint8Array.from(values, value => Math.round(Math.round(value / step) * step));
}

function gaussianKernel(sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index ** 2) / (2 * sigma ** 2));
    kernel[index + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= total;
  return { kernel, radius };
}

function gaussianBlur(values: Uint8Array, width: number, height: number, sigma: number) {
  const { kernel, radius } = gaussianKernel(sigma);
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        sum += values[y * width + sampleX] * kernel[offset + radius];
      }
      horizontal[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        sum += horizontal[sampleY * width + x] * kernel[offset + radius];
      }
      output[y * width + x] = sum;
    }
  }
  return output;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
}

export function createStylizedEdgeMask(values: Uint8Array, width: number, height: number): BinaryMask {
  const narrow = gaussianBlur(values, width, height, .8);
  const wide = gaussianBlur(values, width, height, 1.65);
  const response = new Float32Array(values.length);
  const active: number[] = [];
  for (let pixel = 0; pixel < response.length; pixel += 1) {
    response[pixel] = Math.max(0, wide[pixel] - narrow[pixel]);
    if (response[pixel] > 1) active.push(response[pixel]);
  }
  const threshold = Math.max(4, percentile(active, .72));
  const data = new Uint8Array(values.length);
  for (let pixel = 0; pixel < data.length; pixel += 1) data[pixel] = Number(response[pixel] >= threshold);
  return { width, height, data };
}

function quantile(values: number[], ratio: number, fallback: number) {
  return values.length ? percentile(values, ratio) : fallback;
}

export function createIllustrationStencilMask(image: RasterImage, suppliedAnalysis?: BackgroundAnalysis): IllustrationStencilResult {
  const analysis = suppliedAnalysis ?? analyzeBackground(image);
  const area = image.width * image.height;
  const rawLuminance = rasterLuminance(image);
  const smoothedLuminance = smoothLuminanceEdgeAware(rawLuminance, image.width, image.height);
  const posterizedLuminance = posterizeLuminance(smoothedLuminance, 5);
  const localMean = gaussianBlur(posterizedLuminance, image.width, image.height, 3);
  const canRemoveBackground = !analysis.complexBackground && analysis.confidence >= 55;
  const subjectValues: number[] = [];
  for (let pixel = 0; pixel < area; pixel += 1) {
    if (!canRemoveBackground || !analysis.connectedBackground[pixel]) subjectValues.push(posterizedLuminance[pixel]);
  }

  const darkBackground = analysis.backgroundTone === 'oscuro';
  const lowTone = quantile(subjectValues, .3, 80);
  const middleTone = quantile(subjectValues, .55, 144);
  const highTone = quantile(subjectValues, .7, 176);
  const shadowData = new Uint8Array(area);
  for (let pixel = 0; pixel < area; pixel += 1) {
    if (canRemoveBackground && analysis.connectedBackground[pixel]) continue;
    const value = posterizedLuminance[pixel];
    const localContrast = darkBackground ? value - localMean[pixel] : localMean[pixel] - value;
    const strongMass = darkBackground
      ? value >= Math.max(176, highTone)
      : value <= Math.min(96, lowTone);
    const structuralMidtone = darkBackground
      ? value >= Math.max(112, middleTone) && localContrast >= 9
      : value <= Math.min(160, middleTone) && localContrast >= 9;
    shadowData[pixel] = Number(strongMass || structuralMidtone);
  }

  const shadowMask = cleanMask(
    { width: image.width, height: image.height, data: shadowData },
    Math.max(2, Math.round(area * .000025)),
    Math.max(1, Math.round(area * .000002)),
  );
  const rawEdges = createStylizedEdgeMask(posterizedLuminance, image.width, image.height);
  if (canRemoveBackground) {
    for (let pixel = 0; pixel < area; pixel += 1) {
      if (analysis.connectedBackground[pixel]) rawEdges.data[pixel] = 0;
    }
  }
  const stylizedEdges = removeSmallComponents(rawEdges, Math.max(2, Math.round(area * .000012)));
  const combined = new Uint8Array(area);
  for (let pixel = 0; pixel < area; pixel += 1) combined[pixel] = Number(shadowMask.data[pixel] || stylizedEdges.data[pixel]);
  const mask = cleanMask(
    { width: image.width, height: image.height, data: combined },
    Math.max(2, Math.round(area * .000015)),
    Math.max(1, Math.round(area * .000002)),
  );
  return { mask, smoothedLuminance, posterizedLuminance, shadowMask, stylizedEdges };
}
