import { hasSignificantTransparency } from './imageLoader';
import type { BackgroundAnalysis, RasterImage } from './types';

type Color = BackgroundAnalysis['color'];
type ColorBucket = { count: number; red: number; green: number; blue: number };

const luminance = ({ red, green, blue }: Color) => .2126 * red + .7152 * green + .0722 * blue;
const distance = (left: Color, right: Color) => Math.hypot(left.red - right.red, left.green - right.green, left.blue - right.blue);
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function colorAt(image: RasterImage, pixel: number): Color {
  const index = pixel * 4;
  const alpha = image.data[index + 3] / 255;
  return {
    red: image.data[index] * alpha + 255 * (1 - alpha),
    green: image.data[index + 1] * alpha + 255 * (1 - alpha),
    blue: image.data[index + 2] * alpha + 255 * (1 - alpha),
  };
}

function borderIndices(width: number, height: number) {
  const indices: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) indices.push(y * width + x);
    }
  }
  return indices;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dominantBorderColor(colors: Color[]) {
  const buckets = new Map<string, ColorBucket>();
  for (const color of colors) {
    const key = `${Math.floor(color.red / 32)}:${Math.floor(color.green / 32)}:${Math.floor(color.blue / 32)}`;
    const bucket = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += color.red;
    bucket.green += color.green;
    bucket.blue += color.blue;
    buckets.set(key, bucket);
  }
  const dominant = [...buckets.values()].reduce<ColorBucket | undefined>((best, bucket) => !best || bucket.count > best.count ? bucket : best, undefined);
  return dominant ? { red: dominant.red / dominant.count, green: dominant.green / dominant.count, blue: dominant.blue / dominant.count } : { red: 255, green: 255, blue: 255 };
}

export function analyzeBackground(image: RasterImage): BackgroundAnalysis {
  const total = image.width * image.height;
  const edgePixels = borderIndices(image.width, image.height);
  const edgeColors = edgePixels.map(pixel => colorAt(image, pixel));
  const initialColor = dominantBorderColor(edgeColors);
  const initialDistances = edgeColors.map(color => distance(color, initialColor));
  const medianDistance = median(initialDistances);
  const deviation = median(initialDistances.map(value => Math.abs(value - medianDistance)));
  const tolerance = clamp(24 + medianDistance * .45 + deviation * 2, 24, 72);
  const robustColors = edgeColors.filter(color => distance(color, initialColor) <= tolerance);
  const color = robustColors.length ? {
    red: median(robustColors.map(sample => sample.red)),
    green: median(robustColors.map(sample => sample.green)),
    blue: median(robustColors.map(sample => sample.blue)),
  } : initialColor;

  const connectedBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (const pixel of edgePixels) {
    if (connectedBackground[pixel] || distance(colorAt(image, pixel), color) > tolerance) continue;
    connectedBackground[pixel] = 1;
    queue[tail++] = pixel;
  }
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % image.width;
    const neighbors = [pixel - 1, pixel + 1, pixel - image.width, pixel + image.width];
    for (let direction = 0; direction < neighbors.length; direction += 1) {
      const next = neighbors[direction];
      if (next < 0 || next >= total || connectedBackground[next]) continue;
      if ((direction === 0 && x === 0) || (direction === 1 && x === image.width - 1)) continue;
      if (distance(colorAt(image, next), color) > tolerance) continue;
      connectedBackground[next] = 1;
      queue[tail++] = next;
    }
  }

  const backgroundBorderColors = edgeColors.filter(sample => distance(sample, color) <= tolerance);
  const borderLuminances = backgroundBorderColors.map(luminance);
  const borderMeanLuminance = borderLuminances.length ? borderLuminances.reduce((sum, value) => sum + value, 0) / borderLuminances.length : luminance(color);
  const borderLuminanceVariation = borderLuminances.length
    ? Math.sqrt(borderLuminances.reduce((sum, value) => sum + (value - borderMeanLuminance) ** 2, 0) / borderLuminances.length)
    : 0;
  const borderUniformityPercentage = edgePixels.length ? backgroundBorderColors.length / edgePixels.length * 100 : 0;
  const connectedBorderPixels = edgePixels.reduce((sum, pixel) => sum + connectedBackground[pixel], 0);
  const connectedBorderPercentage = edgePixels.length ? connectedBorderPixels / edgePixels.length * 100 : 0;

  let separatedPixels = 0;
  let separationSum = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (connectedBackground[pixel]) continue;
    const alpha = image.data[pixel * 4 + 3];
    if (alpha < 24) continue;
    separationSum += distance(colorAt(image, pixel), color);
    separatedPixels += 1;
  }
  const contentColorSeparation = separatedPixels ? separationSum / separatedPixels : 0;
  const hasChromaticSeparation = separatedPixels / Math.max(1, total) >= .002 && contentColorSeparation >= 42;
  const hasUsefulAlpha = hasSignificantTransparency(image);
  const confidence = clamp(
    borderUniformityPercentage * .55
      + connectedBorderPercentage * .2
      + clamp(100 - borderLuminanceVariation * 2, 0, 100) * .15
      + clamp(contentColorSeparation / 1.2, 0, 100) * .1,
    0,
    100,
  );
  const backgroundTone = borderMeanLuminance >= 178 ? 'claro' : borderMeanLuminance <= 78 ? 'oscuro' : 'intermedio';

  return {
    color,
    borderMeanLuminance,
    borderLuminanceVariation,
    borderUniformityPercentage,
    connectedBorderPercentage,
    backgroundTone,
    hasUsefulAlpha,
    contentColorSeparation,
    hasChromaticSeparation,
    confidence,
    complexBackground: confidence < 58 || borderUniformityPercentage < 58 || borderLuminanceVariation > 34,
    connectedBackground,
  };
}
