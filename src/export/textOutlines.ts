import { clampTextRadius, clampTextScale } from '../components/CurvedText';
import { vectorizeWithVTracer } from '../vectorization/vectorize/vtracerAdapter';
import type { BinaryMask } from '../vectorization/types';
import type { Box } from './geometry';
import { EXPORT_CENTER } from './geometry';

export type TextTraceRequest = {
  text: string;
  fontFamily: string;
  scale: number;
  radius: number;
  inverted: boolean;
};

export type TracedGlyphPaths = { d: string; transform?: string };

export type TextTrace = {
  paths: TracedGlyphPaths[];
  /** Crop origin in unrotated design units; paths live in canvas pixels. */
  cropX: number;
  cropY: number;
  pixelScale: number;
  /** Measured ink bounds in unrotated design units. */
  inkBox: Box;
  /** Measured arc length along the text path, in design units. */
  arcLength: number;
};

const RENDER_SCALE = 3;

const wrapAngle = (degrees: number) => ((degrees + 540) % 360) - 180;

/**
 * Espera a que la fuente real del catálogo esté disponible.
 *
 * Sin esto, el canvas mediría con la fuente por defecto del navegador y el
 * trazado de texto se haría con una tipografía distinta de la que se ve en el
 * editor (sustitución silenciosa, justo lo que la Etapa 4 prohíbe).
 */
async function ensureFontLoaded(family: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  if (document.fonts.check(`600 16px "${family}"`)) return;
  try {
    await document.fonts.load(`600 16px "${family}"`);
    await document.fonts.ready;
  } catch {
    // La fuente no se pudo cargar: el llamante decide (sin sustituto).
  }
}

/**
 * Renders one curved text offscreen from state (same arc, font size, spacing
 * and dy as the editor), thresholds it and traces real glyph outlines with
 * the existing VTracer. The result is genuine path geometry shaped by the
 * OS font engine: no <text>, no font dependency in the output.
 */
export async function traceTextElement(request: TextTraceRequest): Promise<TextTrace | null> {
  if (typeof document === 'undefined') throw new Error('El trazado de texto requiere un navegador.');
  if (!request.text) return null;
  const scale = clampTextScale(request.scale);
  const radius = clampTextRadius(request.radius, scale);
  const pathRadius = radius - 14 * scale;
  const fontSize = 35 * scale;
  const letterSpacing = 2 * scale;
  const sweep = request.inverted ? 0 : 1;

  const measurer = document.createElement('canvas').getContext('2d');
  let estimatedLength = 150;
  if (measurer) {
    // SIN familia de reserva del sistema: si la fuente del catálogo no está
    // cargada, el canvas usaría la tipografía por defecto del navegador y el
    // trazado sería de OTRA fuente (sustitución silenciosa). Se mide con la
    // fuente exacta o no se dibuja nada.
    await ensureFontLoaded(request.fontFamily);
    measurer.font = `600 ${fontSize}px "${request.fontFamily}"`;
    estimatedLength = measurer.measureText(request.text).width + letterSpacing * request.text.length;
  }
  const estimatedHalfSpan = Math.min(135, Math.max(7, (estimatedLength / 2 + 14) / radius * 180 / Math.PI)) + 18;

  // Crop around the unrotated arc. The text path is a full circle starting at
  // the bottom, so startOffset="50%" with text-anchor="middle" centers the
  // glyphs at the TOP (standard angle 270°), same as the editor.
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let offset = -estimatedHalfSpan; offset <= estimatedHalfSpan; offset += 2) {
    const radians = (270 + offset) * Math.PI / 180;
    const x = EXPORT_CENTER + pathRadius * Math.cos(radians);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
  }
  const vertical = fontSize * 2.6;
  const cropX = Math.max(0, Math.floor(x0 - fontSize));
  const cropY = Math.max(0, Math.floor(EXPORT_CENTER - pathRadius - vertical));
  const cropWidth = Math.min(900 - cropX, Math.ceil(x1 - x0 + fontSize * 2));
  const cropHeight = Math.min(900 - cropY, Math.ceil(vertical * 2));
  if (cropWidth <= 0 || cropHeight <= 0) return null;

  const curveId = 'export-curve';
  const dy = request.inverted ? ` dy="${26 * scale}"` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="900" height="900" viewBox="0 0 900 900">` +
    `<defs><path id="${curveId}" d="M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 - pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 + pathRadius}"/></defs>` +
    `<rect width="900" height="900" fill="#fff"/>` +
    `<text font-family="${request.fontFamily}" font-size="${fontSize}" font-weight="600" letter-spacing="${letterSpacing}" text-anchor="middle"${dy} fill="#000">` +
    `<textPath href="#${curveId}" xlink:href="#${curveId}" startOffset="50%">${escapeXml(request.text)}</textPath></text></svg>`;

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth * RENDER_SCALE));
    canvas.height = Math.max(1, Math.round(cropHeight * RENDER_SCALE));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D no está disponible para exportar el texto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, -cropX * RENDER_SCALE, -cropY * RENDER_SCALE, 900 * RENDER_SCALE, 900 * RENDER_SCALE);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const mask: BinaryMask = { width: canvas.width, height: canvas.height, data: new Uint8Array(canvas.width * canvas.height) };
    let ink = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let minAngle = Infinity;
    let maxAngle = -Infinity;
    for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
      const offset = pixel * 4;
      const luminance = 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
      if (luminance < 128) {
        mask.data[pixel] = 1;
        ink += 1;
        const px = pixel % canvas.width;
        const py = Math.floor(pixel / canvas.width);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        const dx = cropX + px / RENDER_SCALE - EXPORT_CENTER;
        const dyDesign = cropY + py / RENDER_SCALE - EXPORT_CENTER;
        // Deviation from the top of the circle (standard angle -90°).
        const relative = wrapAngle(Math.atan2(dyDesign, dx) * 180 / Math.PI + 90);
        minAngle = Math.min(minAngle, relative);
        maxAngle = Math.max(maxAngle, relative);
      }
    }
    if (!ink) return null;
    const traced = await vectorizeWithVTracer(mask);
    const inkBox: Box = {
      x: cropX + minX / RENDER_SCALE,
      y: cropY + minY / RENDER_SCALE,
      width: Math.max(0.5, (maxX - minX + 1) / RENDER_SCALE),
      height: Math.max(0.5, (maxY - minY + 1) / RENDER_SCALE),
    };
    const arcLength = Math.max(1, (maxAngle - minAngle) * Math.PI / 180 * pathRadius);
    return {
      paths: traced.paths.map(path => ({ d: path.d, transform: path.transform })),
      cropX,
      cropY,
      pixelScale: RENDER_SCALE,
      inkBox,
      arcLength,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo rasterizar el texto para exportarlo.'));
    image.src = url;
  });
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
