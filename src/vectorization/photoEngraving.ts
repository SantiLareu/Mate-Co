import { analyzeBackground } from './backgroundAnalysis';
import { cleanMask, closeMask, dilateMask, removeSmallComponents } from './cleanup';
import type { BackgroundAnalysis, BinaryMask, RasterImage } from './types';

export type PhotoEngravingResult = {
  mask: BinaryMask;
  shadowMask: BinaryMask;
  importantEdges: BinaryMask;
};

const pixelLuminance = (red: number, green: number, blue: number) => .2126 * red + .7152 * green + .0722 * blue;

function luminanceValues(image: RasterImage) {
  const values = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const index = pixel * 4;
    const alpha = image.data[index + 3] / 255;
    values[pixel] = Math.round(pixelLuminance(
      image.data[index] * alpha + 255 * (1 - alpha),
      image.data[index + 1] * alpha + 255 * (1 - alpha),
      image.data[index + 2] * alpha + 255 * (1 - alpha),
    ));
  }
  return values;
}

function boxBlur(values: Uint8Array, width: number, height: number, radius: number) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const blurred = new Uint8Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const stride = width + 1;
      const sum = integral[(bottom + 1) * stride + right + 1] - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left] + integral[top * stride + left];
      blurred[y * width + x] = Math.round(sum / ((right - left + 1) * (bottom - top + 1)));
    }
  }
  return blurred;
}

function sobelMagnitudes(values: Uint8Array, width: number, height: number) {
  const magnitudes = new Uint8Array(values.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (dx: number, dy: number) => values[(y + dy) * width + x + dx];
      const horizontal = -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) + 2 * at(1, 0) - at(-1, 1) + at(1, 1);
      const vertical = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      magnitudes[y * width + x] = Math.min(255, Math.hypot(horizontal, vertical));
    }
  }
  return magnitudes;
}

function percentile(values: Uint8Array, ratio: number) {
  const nonZero = Array.from(values).filter(Boolean).sort((left, right) => left - right);
  return nonZero.length ? nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * ratio))] : 255;
}

export function createPhotoEngravingMask(image: RasterImage, suppliedAnalysis?: BackgroundAnalysis): PhotoEngravingResult {
  const analysis = suppliedAnalysis ?? analyzeBackground(image);
  const area = image.width * image.height;
  const rawLuminance = luminanceValues(image);
  const denoised = boxBlur(rawLuminance, image.width, image.height, 1);
  const localMean = boxBlur(denoised, image.width, image.height, Math.max(2, Math.round(Math.min(image.width, image.height) / 28)));
  const shadowData = new Uint8Array(area);
  const darkBackground = analysis.backgroundTone === 'oscuro';
  const backgroundLuminance = analysis.borderMeanLuminance;

  for (let pixel = 0; pixel < area; pixel += 1) {
    if (analysis.connectedBackground[pixel]) continue;
    const value = denoised[pixel];
    const localDifference = darkBackground ? value - localMean[pixel] : localMean[pixel] - value;
    const backgroundDifference = darkBackground ? value - backgroundLuminance : backgroundLuminance - value;
    const strongMass = darkBackground
      ? value > 150 && backgroundDifference > 30
      : value < 116 && backgroundDifference > 28;
    const midtoneStructure = localDifference > 12 && backgroundDifference > 14;
    shadowData[pixel] = Number(strongMass || midtoneStructure);
  }

  const shadowBase = { width: image.width, height: image.height, data: shadowData };
  const shadowMask = closeMask(shadowBase, 1);
  const magnitudes = sobelMagnitudes(denoised, image.width, image.height);
  const edgeThreshold = Math.max(64, percentile(magnitudes, .8));
  const edgeData = new Uint8Array(area);
  for (let pixel = 0; pixel < area; pixel += 1) {
    const minimumStrength = analysis.connectedBackground[pixel] ? Math.min(255, edgeThreshold * 1.3) : edgeThreshold;
    edgeData[pixel] = Number(magnitudes[pixel] >= minimumStrength);
  }
  const minimumEdgePixels = Math.max(3, Math.round(area * .00002));
  const edgeBase = removeSmallComponents({ width: image.width, height: image.height, data: edgeData }, minimumEdgePixels);
  const importantEdges = Math.min(image.width, image.height) >= 24 ? dilateMask(edgeBase, 1) : edgeBase;

  const combined = new Uint8Array(area);
  for (let pixel = 0; pixel < area; pixel += 1) combined[pixel] = Number(shadowMask.data[pixel] || importantEdges.data[pixel]);
  const mask = cleanMask(
    { width: image.width, height: image.height, data: combined },
    Math.max(3, Math.round(area * .000018)),
    Math.max(2, Math.round(area * .000006)),
  );
  return { mask, shadowMask, importantEdges };
}
