import type { LoadedImage, RasterImage } from './types';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function hasSignificantTransparency(image: RasterImage, alphaThreshold = 250, minimumRatio = .001) {
  const pixels = image.width * image.height;
  if (!pixels) return false;
  let transparent = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] < alphaThreshold) transparent += 1;
  }
  return transparent / pixels >= minimumRatio;
}

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('El archivo no produjo una imagen válida.'));
  reader.readAsDataURL(file);
});

const decodeImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
  image.src = source;
});

export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
    throw new Error('Formato no compatible. Usá PNG, JPG/JPEG o WebP.');
  }
  const originalDataUrl = await readAsDataUrl(file);
  const image = await decodeImage(originalDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) throw new Error('La imagen no tiene dimensiones válidas.');
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const raster = { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(imageData.data) };
  return {
    name: file.name,
    mimeType: file.type,
    originalDataUrl,
    originalWidth: image.naturalWidth,
    originalHeight: image.naturalHeight,
    hasTransparency: hasSignificantTransparency(raster),
    raster,
  };
}
