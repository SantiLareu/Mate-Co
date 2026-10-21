/**
 * Render seguro del SVG original para el panel "Original" del laboratorio.
 *
 * Estrategia en dos capas:
 * 1. El archivo ya pasó `parseSvgImport` (rechaza scripts, imágenes, texto,
 *    handlers y referencias externas). Solo se genera preview de aceptados.
 * 2. Defensa en profundidad: se re-parsea, se reconstruye un documento que
 *    contiene ÚNICAMENTE elementos/atributos de la whitelist, se serializa
 *    y se sirve como Blob URL dentro de un `<img>`.
 *
 * Un SVG dentro de `<img>` nunca ejecuta scripts ni handlers, y el contexto
 * de imagen bloquea la carga de subrecursos externos. Nunca se usa innerHTML.
 */

const ALLOWED_ELEMENTS: Record<string, string[]> = {
  svg: ['viewBox', 'width', 'height', 'xmlns', 'preserveAspectRatio', 'x', 'y'],
  g: ['transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  path: ['d', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  circle: ['cx', 'cy', 'r', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  line: ['x1', 'y1', 'x2', 'y2', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'display', 'visibility'],
  polyline: ['points', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
  polygon: ['points', 'transform', 'opacity', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'fill-rule', 'display', 'visibility'],
};

const UNSAFE_ATTRIBUTE_VALUE = /(javascript:|vbscript:|data:|blob:|https?:|\/\/|@import|expression\s*\()/i;

function cleanElement(source: Element, document_: Document): Element | null {
  const tag = source.tagName.toLowerCase();
  const allowed = ALLOWED_ELEMENTS[tag];
  if (!allowed) return null;
  const clean = document_.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const name of allowed) {
    // style se excluye a propósito: el preview usa solo atributos auditados.
    const value = source.getAttribute(name);
    if (value == null) continue;
    // xmlns es ligadura de namespace, nunca un recurso descargable.
    if (name !== 'xmlns' && UNSAFE_ATTRIBUTE_VALUE.test(value)) continue;
    if (name === 'href' || name === 'src' || name.toLowerCase().startsWith('on')) continue;
    if (value.includes('url(') && !/^url\(\s*#[^)]+\)\s*$/.test(value)) continue;
    clean.setAttribute(name, value);
  }
  for (let index = 0; index < source.children.length; index += 1) {
    const child = cleanElement(source.children[index], document_);
    if (child) clean.appendChild(child);
  }
  return clean;
}

/** Serializa una versión sanitizada del SVG original (solo whitelist). */
export function buildSanitizedOriginalMarkup(svgText: string): string {
  const parser = new DOMParser();
  const source = parser.parseFromString(svgText, 'image/svg+xml');
  if (source.getElementsByTagName('parsererror').length > 0) {
    throw new Error('El SVG original no pudo re-parsearse para el preview.');
  }
  const root = source.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    throw new Error('El SVG original no tiene raíz <svg>.');
  }
  const cleanDocument = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
  const cleanRoot = cleanDocument.documentElement;
  for (const name of ALLOWED_ELEMENTS.svg) {
    const value = root.getAttribute(name);
    if (value != null && !UNSAFE_ATTRIBUTE_VALUE.test(value)) cleanRoot.setAttribute(name, value);
  }
  if (!cleanRoot.getAttribute('xmlns')) cleanRoot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  for (let index = 0; index < root.children.length; index += 1) {
    const child = cleanElement(root.children[index], cleanDocument);
    if (child) cleanRoot.appendChild(child);
  }
  return new XMLSerializer().serializeToString(cleanDocument);
}

/** Crea una Blob URL (contexto `<img>`: sin scripts ni recursos externos). */
export function buildOriginalPreviewUrl(svgText: string): string {
  const markup = buildSanitizedOriginalMarkup(svgText);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}

export function revokePreviewUrl(url: string | null): void {
  if (url) URL.revokeObjectURL(url);
}
