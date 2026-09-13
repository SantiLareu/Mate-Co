import type { RasterImage } from './types';

export const DEFAULT_MAX_DIMENSION = 900;

export function normalizedDimensions(width: number, height: number, maxDimension = DEFAULT_MAX_DIMENSION) {
  if (width <= 0 || height <= 0 || maxDimension <= 0) throw new Error('Dimensiones inválidas.');
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export function normalizeRaster(source: RasterImage, maxDimension = DEFAULT_MAX_DIMENSION): RasterImage {
  const size = normalizedDimensions(source.width, source.height, maxDimension);
  if (size.width === source.width && size.height === source.height) {
    return { ...source, data: new Uint8ClampedArray(source.data) };
  }
  const output = new Uint8ClampedArray(size.width * size.height * 4);
  for (let y = 0; y < size.height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y + .5) * source.height / size.height));
    for (let x = 0; x < size.width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x + .5) * source.width / size.width));
      const inputIndex = (sourceY * source.width + sourceX) * 4;
      const outputIndex = (y * size.width + x) * 4;
      output[outputIndex] = source.data[inputIndex];
      output[outputIndex + 1] = source.data[inputIndex + 1];
      output[outputIndex + 2] = source.data[inputIndex + 2];
      output[outputIndex + 3] = source.data[inputIndex + 3];
    }
  }
  return { ...size, data: output };
}
