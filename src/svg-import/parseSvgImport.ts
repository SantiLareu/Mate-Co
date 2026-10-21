/**
 * `parseSvgImport`: importación directa y segura de SVG (laboratorio V1).
 *
 * Camino explícito, SIN raster: texto SVG → DOMParser → validación /
 * sanitización → representación propia → geometría normalizada.
 * Nunca toca Canvas, máscaras, estrategias ni VTracer.
 *
 * Seguridad:
 * - Parseo con DOMParser (el XML hostil nunca se inserta al DOM con
 *   innerHTML; no se ejecuta nada).
 * - Blacklist dura: script, foreignObject, iframe/object/embed, image,
 *   texto vivo, handlers on*, URLs externas/remotas, javascript:.
 * - Whitelist de elementos geométricos + contenedores documentados.
 * - `<!ENTITY` en el DOCTYPE se rechaza (expansión de entidades).
 * - Lo no soportado (use, style, paint servers, strokes visibles, ...)
 *   devuelve error claro: nunca se interpreta en silencio.
 */

import { circleToPath, ellipseToPath, lineToPath, polylineToPath, readLength, rectToPath } from './geometry';
import { SVG_IMPORT_LIMITS } from './limits';
import { transformedPathBounds, unionBoxes } from './measure';
import { IDENTITY_MATRIX, multiplyMatrices, parseTransformList, serializeMatrix, type SvgMatrix } from './transforms';
import type {
  SvgImportBox,
  SvgImportError,
  SvgImportOutcome,
  SvgImportPath,
  SvgImportViewBox,
  SvgPrimitiveKind,
} from './types';

/** Elementos que aportan geometría renderizable (whitelist V1). */
const GEOMETRY_ELEMENTS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);

/**
 * Contenedores ignorados: no aportan geometría visible y su subárbol no se
 * recorre para geometría (defs solo podría contener geometría NO renderizada;
 * incluirla falsearía el normalizado). Se auditan igual por seguridad.
 */
const IGNORED_CONTAINERS = new Set(['defs', 'title', 'desc', 'metadata']);

/** Rechazo inmediato con mensaje conceptual propio. */
const HARD_DENY: Record<string, Omit<SvgImportError, 'message'> & { message: string }> = {
  script: { code: 'CONTAINS_SCRIPT', message: 'El SVG contiene <script>. Por seguridad no se importan SVG con código ejecutable.' },
  foreignobject: {
    code: 'CONTAINS_FOREIGN_OBJECT',
    message: 'El SVG contiene <foreignObject> (HTML incrustado). No se puede importar de forma segura.',
  },
  iframe: { code: 'CONTAINS_ACTIVE_CONTENT', message: 'El SVG contiene <iframe>. No se importan documentos incrustados.' },
  object: { code: 'CONTAINS_ACTIVE_CONTENT', message: 'El SVG contiene <object>. No se importan documentos incrustados.' },
  embed: { code: 'CONTAINS_ACTIVE_CONTENT', message: 'El SVG contiene <embed>. No se importan documentos incrustados.' },
  image: {
    code: 'CONTAINS_RASTER_IMAGE',
    message: 'El SVG contiene una imagen raster (<image>). Para Mate&Co eso no cuenta como vector puro.',
  },
  text: {
    code: 'CONTAINS_LIVE_TEXT',
    message: 'El SVG contiene texto editable. Convertí el texto a curvas antes de subirlo.',
  },
  textpath: {
    code: 'CONTAINS_LIVE_TEXT',
    message: 'El SVG contiene texto editable. Convertí el texto a curvas antes de subirlo.',
  },
  use: {
    code: 'UNSUPPORTED_USE',
    message: 'El SVG usa <use> (instancias/referencias). Aplaná las instancias a geometría antes de subirlo.',
  },
  style: {
    code: 'UNSUPPORTED_STYLE',
    message: 'El SVG usa <style> (CSS). Convertí los estilos a atributos de presentación antes de subirlo.',
  },
  lineargradient: {
    code: 'UNSUPPORTED_PAINT_SERVER',
    message: 'El SVG usa degradados (paint servers). Para grabado se necesita geometría plana: aplaná los rellenos.',
  },
  radialgradient: {
    code: 'UNSUPPORTED_PAINT_SERVER',
    message: 'El SVG usa degradados (paint servers). Para grabado se necesita geometría plana: aplaná los rellenos.',
  },
  pattern: {
    code: 'UNSUPPORTED_PAINT_SERVER',
    message: 'El SVG usa patrones de relleno. Para grabado se necesita geometría plana: aplaná los rellenos.',
  },
  clippath: {
    code: 'UNSUPPORTED_ELEMENT',
    message: 'El SVG usa <clipPath> (recortes). Expandé los recortes a geometría antes de subirlo.',
  },
  mask: {
    code: 'UNSUPPORTED_ELEMENT',
    message: 'El SVG usa <mask> (máscaras vectoriales). Aplaná las máscaras a geometría antes de subirlo.',
  },
  filter: {
    code: 'UNSUPPORTED_ELEMENT',
    message: 'El SVG usa <filter> (filtros). Aplaná los efectos a geometría antes de subirlo.',
  },
};

const EXTERNAL_VALUE = /^\s*(https?:|\/\/|javascript:|vbscript:|data:|blob:|file:|ftp:)/i;
const JAVASCRIPT_URL = /^\s*javascript:/i;
const UNSAFE_CSS = /(@import|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding)/i;

function externalReferenceError(detail: string): SvgImportError {
  return {
    code: 'EXTERNAL_REFERENCE',
    message: `El SVG referencia recursos externos (${detail}). No se cargan recursos externos.`,
  };
}

/** Atributo style="..." limitado a un subconjunto seguro; `url()` solo local. */
function parseInlineStyle(style: string): { ok: true; props: Map<string, string> } | { ok: false; error: SvgImportError } {
  const props = new Map<string, string>();
  if (UNSAFE_CSS.test(style)) {
    return { ok: false, error: { code: 'UNSUPPORTED_STYLE', message: 'El atributo style contiene CSS no soportado (@import, expressions o URLs).' } };
  }
  for (const declaration of style.split(';')) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      return { ok: false, error: { code: 'UNSUPPORTED_STYLE', message: `Declaración CSS inválida: "${trimmed.slice(0, 40)}".` } };
    }
    const name = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (value.includes('url(') && !/^url\(\s*#[^)]+\)\s*$/.test(value)) {
      return { ok: false, error: externalReferenceError(`url() en style: ${name}`) };
    }
    if (JAVASCRIPT_URL.test(value)) {
      return { ok: false, error: externalReferenceError('javascript: en style') };
    }
    props.set(name, value);
  }
  return { ok: true, props };
}

type InheritedStyle = {
  matrix: SvgMatrix;
  fill: string;
  stroke: string;
  strokeWidth: string;
  fillRule: string;
  opacity: number;
  display: string;
  visibility: string;
};

const DEFAULT_STYLE: InheritedStyle = {
  matrix: { ...IDENTITY_MATRIX },
  fill: 'black',
  stroke: 'none',
  strokeWidth: '1',
  fillRule: 'nonzero',
  opacity: 1,
  display: 'inline',
  visibility: 'visible',
};

function resolveOpacity(value: string | null, parent: number): number | null {
  if (value == null || value.trim() === '') return parent;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parent * parsed;
}

type WalkState = {
  paths: Array<{ d: string; transform?: string }>;
  boxes: SvgImportBox[];
  fills: Set<string>;
  strokes: Set<string>;
  fillRules: Set<string>;
  opacities: Set<number>;
  transformsUsed: Set<string>;
  transformedElementCount: number;
  primitiveCounts: Record<SvgPrimitiveKind | 'g', number>;
  skippedInvisibleCount: number;
  ignoredDefsCount: number;
  opacityFlattened: boolean;
  warnings: string[];
};

function auditAttributes(element: Element): SvgImportError | null {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attr = attributes[index];
    const name = attr.name.toLowerCase();
    const value = attr.value;
    // xmlns / xmlns:* son ligaduras de namespace, nunca recursos descargables.
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    if (name.startsWith('on')) {
      return {
        code: 'CONTAINS_EVENT_HANDLER',
        message: `El SVG contiene un manejador de eventos (${attr.name}). No se importan SVG con comportamiento activo.`,
      };
    }
    if (EXTERNAL_VALUE.test(value)) {
      return externalReferenceError(`atributo ${attr.name}`);
    }
    if (name === 'href' || name.endsWith(':href') || name === 'src') {
      const ref = value.trim();
      if (ref !== '' && !ref.startsWith('#')) {
        return externalReferenceError(`referencia ${ref.slice(0, 60)}`);
      }
    }
    if (value.includes('url(')) {
      const urls = value.match(/url\(\s*([^)]+?)\s*\)/g) ?? [];
      for (const url of urls) {
        if (!/^url\(\s*#[^)]+\)\s*$/.test(url)) {
          return externalReferenceError(`url() en ${attr.name}`);
        }
      }
      // url(#...) local = paint server / clip / mask: solo se acepta si no
      // define el pintado (fill/stroke) ni recortes.
      if ((name === 'fill' || name === 'stroke' || name === 'clip-path' || name === 'mask' || name === 'filter') && urls.length > 0) {
        if (name === 'fill' || name === 'stroke') {
          return {
            code: 'UNSUPPORTED_PAINT_SERVER',
            message: `El SVG usa rellenos por referencia (${name}="${value.slice(0, 40)}"). Para grabado se necesita geometría plana.`,
          };
        }
        return {
          code: 'UNSUPPORTED_ELEMENT',
          message: `El SVG usa ${name} por referencia. Expandé el efecto a geometría antes de subirlo.`,
        };
      }
    }
  }
  const style = element.getAttribute('style');
  if (style != null && style.trim() !== '') {
    const parsed = parseInlineStyle(style);
    if (!parsed.ok) return parsed.error;
  }
  return null;
}

function presentation(element: Element, name: string, styleProps: Map<string, string>, fallback: string): string {
  const fromStyle = styleProps.get(name);
  if (fromStyle != null && fromStyle !== '') return fromStyle;
  const fromAttr = element.getAttribute(name);
  if (fromAttr != null && fromAttr !== '') return fromAttr;
  return fallback;
}

const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 1.25, pc: 15, in: 96, mm: 96 / 25.4, cm: 96 / 2.54, q: 96 / 101.6 };

function parseAbsoluteLength(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.includes('%')) return null;
  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]*)$/.exec(trimmed);
  if (!match) return null;
  const factor = match[2] === '' ? 1 : PX_PER_UNIT[match[2].toLowerCase()];
  if (factor == null) return null;
  const parsed = Number(match[1]) * factor;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseViewBox(value: string | null): SvgImportViewBox | null {
  if (value == null || value.trim() === '') return null;
  const numbers = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number))) return null;
  const [, , width, height] = numbers;
  if (!(width > 0) || !(height > 0)) return null;
  return { x: numbers[0], y: numbers[1], width, height };
}

/** Estilo heredado resuelto para un elemento (atributos + style inline seguro). */
function inheritStyle(element: Element, parent: InheritedStyle): { ok: true; style: InheritedStyle } | { ok: false; error: SvgImportError } {
  const styleAttr = element.getAttribute('style');
  let styleProps = new Map<string, string>();
  if (styleAttr != null && styleAttr.trim() !== '') {
    const parsed = parseInlineStyle(styleAttr);
    if (!parsed.ok) return parsed;
    styleProps = parsed.props;
  }
  const opacity = resolveOpacity(
    styleProps.get('opacity') ?? element.getAttribute('opacity'),
    parent.opacity,
  );
  if (opacity === null) {
    return { ok: false, error: { code: 'INVALID_GEOMETRY', message: 'Valor de opacity inválido (esperado 0–1).' } };
  }
  const transformAttr = element.getAttribute('transform');
  const transform = parseTransformList(transformAttr);
  if (!transform.ok) {
    return { ok: false, error: { code: transform.error.code, message: transform.error.message } };
  }
  return {
    ok: true,
    style: {
      matrix: multiplyMatrices(parent.matrix, transform.matrix),
      fill: presentation(element, 'fill', styleProps, parent.fill),
      stroke: presentation(element, 'stroke', styleProps, parent.stroke),
      strokeWidth: presentation(element, 'stroke-width', styleProps, parent.strokeWidth),
      fillRule: presentation(element, 'fill-rule', styleProps, parent.fillRule),
      opacity,
      display: presentation(element, 'display', styleProps, parent.display),
      visibility: presentation(element, 'visibility', styleProps, parent.visibility),
    },
  };
}

function isVisible(style: InheritedStyle): boolean {
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (style.opacity === 0) return false;
  return true;
}

function hasVisibleStroke(style: InheritedStyle): boolean {
  const stroke = style.stroke.trim().toLowerCase();
  if (stroke === '' || stroke === 'none') return false;
  const width = Number(style.strokeWidth.trim());
  if (style.strokeWidth.trim() !== '' && !(width > 0)) return false;
  return true;
}

function geometryToPath(element: Element, tag: string): { ok: true; d: string | null } | { ok: false; error: SvgImportError } {
  const invalid = (message: string): { ok: false; error: SvgImportError } => ({ ok: false, error: { code: 'INVALID_GEOMETRY', message } });
  if (tag === 'path') {
    const d = element.getAttribute('d') ?? '';
    if (d.length > SVG_IMPORT_LIMITS.MAX_D_CHARS) {
      return invalid('Un path supera el largo máximo permitido.');
    }
    return { ok: true, d };
  }
  const length = (name: string, fallback: number): number | null => {
    const parsed = readLength(element.getAttribute(name), fallback);
    return parsed.ok ? parsed.value : null;
  };
  if (tag === 'circle') {
    const cx = length('cx', 0);
    const cy = length('cy', 0);
    const r = length('r', 0);
    if (cx === null || cy === null || r === null) {
      return invalid('La primitiva <circle> usa valores no soportados (porcentajes o inválidos).');
    }
    return { ok: true, d: circleToPath(cx, cy, r) };
  }
  if (tag === 'ellipse') {
    const cx = length('cx', 0);
    const cy = length('cy', 0);
    const rx = length('rx', 0);
    const ry = length('ry', 0);
    if (cx === null || cy === null || rx === null || ry === null) {
      return invalid('La primitiva <ellipse> usa valores no soportados (porcentajes o inválidos).');
    }
    return { ok: true, d: ellipseToPath(cx, cy, rx, ry) };
  }
  if (tag === 'rect') {
    const x = length('x', 0);
    const y = length('y', 0);
    const width = length('width', 0);
    const height = length('height', 0);
    const rx = length('rx', 0);
    const ryAttr = element.getAttribute('ry');
    const ry = ryAttr == null || ryAttr.trim() === '' ? rx : length('ry', 0);
    if (x === null || y === null || width === null || height === null || rx === null || ry === null) {
      return invalid('La primitiva <rect> usa valores no soportados (porcentajes o inválidos).');
    }
    return { ok: true, d: rectToPath(x, y, width, height, rx, ry) };
  }
  if (tag === 'line') {
    const x1 = length('x1', 0);
    const y1 = length('y1', 0);
    const x2 = length('x2', 0);
    const y2 = length('y2', 0);
    if (x1 === null || y1 === null || x2 === null || y2 === null) {
      return invalid('La primitiva <line> usa valores no soportados (porcentajes o inválidos).');
    }
    return { ok: true, d: lineToPath(x1, y1, x2, y2) };
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const points = element.getAttribute('points') ?? '';
    if (/%/.test(points)) {
      return {
        ok: false,
        error: {
          code: 'UNSUPPORTED_PERCENTAGE',
          message: `La primitiva <${tag}> usa porcentajes. Convertí las coordenadas a unidades absolutas.`,
        },
      };
    }
    return { ok: true, d: polylineToPath(points, tag === 'polygon') };
  }
  return invalid(`Elemento geométrico no soportado: <${tag}>.`);
}

function walk(
  element: Element,
  inherited: InheritedStyle,
  depth: number,
  state: WalkState,
  isRoot = false,
): SvgImportError | null {
  const tag = element.tagName.toLowerCase();
  // Defensa en profundidad: el walk niega por sí mismo sin depender del pre-barrido.
  // Precedencia unificada con el pre-barrido: primero el tag (mensaje más
  // específico), después los atributos.
  const denied = HARD_DENY[tag];
  if (denied) return { ...denied };
  const audit = auditAttributes(element);
  if (audit) return audit;

  if (IGNORED_CONTAINERS.has(tag)) {
    state.ignoredDefsCount += tag === 'defs' ? 1 : 0;
    return null;
  }

  const resolved = inheritStyle(element, inherited);
  if (!resolved.ok) return resolved.error;
  const style = resolved.style;

  if (GEOMETRY_ELEMENTS.has(tag)) {
    const kind = tag as SvgPrimitiveKind;
    state.primitiveCounts[kind] += 1;
    if (state.paths.length >= SVG_IMPORT_LIMITS.MAX_PATHS) {
      return {
        code: 'TOO_MANY_PATHS',
        message: `El SVG supera el máximo de ${SVG_IMPORT_LIMITS.MAX_PATHS} geometrías. Simplificá el archivo antes de subirlo.`,
      };
    }
    const converted = geometryToPath(element, tag);
    if (!converted.ok) return converted.error;
    if (converted.d == null || converted.d.trim() === '') {
      state.skippedInvisibleCount += 1;
      return null;
    }
    const fill = style.fill.trim().toLowerCase();
    const fillNone = fill === '' || fill === 'none';
    const strokeNone = !hasVisibleStroke(style);
    if (!isVisible(style) || (fillNone && strokeNone)) {
      state.skippedInvisibleCount += 1;
      return null;
    }
    if (hasVisibleStroke(style)) {
      return {
        code: 'CONTAINS_VISIBLE_STROKE',
        message: 'El SVG usa trazos visibles (stroke). Convertí los trazos a contornos rellenos antes de subirlo.',
      };
    }
    const box = transformedPathBounds(converted.d, style.matrix);
    if (!box || !(box.width > 0) || !(box.height > 0)) {
      state.skippedInvisibleCount += 1;
      return null;
    }
    state.fills.add(fill);
    state.strokes.add(style.stroke.trim().toLowerCase());
    state.fillRules.add(style.fillRule.trim().toLowerCase());
    const roundedOpacity = Math.round(style.opacity * 1000) / 1000;
    state.opacities.add(roundedOpacity);
    if (roundedOpacity < 1) state.opacityFlattened = true;
    const transform = serializeMatrix(style.matrix);
    if (transform) {
      const local = parseTransformList(element.getAttribute('transform'));
      if (local.ok) {
        for (const name of local.functions) state.transformsUsed.add(name);
      }
      state.transformedElementCount += 1;
    }
    state.paths.push(transform ? { d: converted.d, transform } : { d: converted.d });
    state.boxes.push(box);
    return null;
  }

  if (tag === 'g' || tag === 'svg') {
    let containerStyle = style;
    if (tag === 'svg' && !isRoot) {
      // Un <svg> anidado desplaza su viewport según x/y: se modela como translate.
      const parsedX = readLength(element.getAttribute('x'), 0);
      const parsedY = readLength(element.getAttribute('y'), 0);
      if (!parsedX.ok || !parsedY.ok) {
        return {
          code: 'UNSUPPORTED_PERCENTAGE',
          message: 'Un <svg> anidado usa x/y en porcentaje. Convertí las coordenadas a unidades absolutas.',
        };
      }
      containerStyle = {
        ...style,
        matrix: multiplyMatrices(style.matrix, { ...IDENTITY_MATRIX, e: parsedX.value, f: parsedY.value }),
      };
    }
    if (tag === 'g') {
      state.primitiveCounts.g += 1;
      if (depth > SVG_IMPORT_LIMITS.MAX_GROUP_DEPTH) {
        return {
          code: 'GROUP_DEPTH_EXCEEDED',
          message: `El SVG supera la profundidad máxima de ${SVG_IMPORT_LIMITS.MAX_GROUP_DEPTH} grupos anidados. Aplaná los grupos antes de subirlo.`,
        };
      }
      const local = parseTransformList(element.getAttribute('transform'));
      if (local.ok && local.functions.length > 0) {
        for (const name of local.functions) state.transformsUsed.add(name);
        state.transformedElementCount += 1;
      }
    }
    const children = element.children;
    for (let index = 0; index < children.length; index += 1) {
      const error = walk(children[index], containerStyle, tag === 'g' ? depth + 1 : depth, state);
      if (error) return error;
    }
    return null;
  }

  return {
    code: 'UNSUPPORTED_ELEMENT',
    message: `El SVG contiene <${element.tagName}> que no está soportado en esta versión del laboratorio.`,
  };
}

/**
 * Importa un SVG como geometría vectorial directa. No rasteriza, no usa
 * Canvas, no pasa por máscaras/estrategias/VTracer.
 */
export function parseSvgImport(svgText: string): SvgImportOutcome {
  if (svgText == null || svgText.trim() === '') {
    return { ok: false, error: { code: 'EMPTY', message: 'El archivo SVG está vacío.' } };
  }
  if (svgText.length > SVG_IMPORT_LIMITS.MAX_FILE_CHARS) {
    return {
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `El archivo supera el máximo de ${(SVG_IMPORT_LIMITS.MAX_FILE_CHARS / 1_000_000).toFixed(0)} MB de texto.`,
      },
    };
  }
  if (/<!ENTITY/i.test(svgText)) {
    return {
      ok: false,
      error: {
        code: 'UNSAFE_DOCTYPE',
        message: 'El SVG declara entidades XML (<!ENTITY>). Por seguridad no se procesan.',
      },
    };
  }
  let document_: Document;
  try {
    const parser = new DOMParser();
    document_ = parser.parseFromString(svgText, 'image/svg+xml');
  } catch {
    return { ok: false, error: { code: 'MALFORMED', message: 'El SVG está malformado y no pudo parsearse como XML.' } };
  }
  const parserErrors = document_.getElementsByTagName('parsererror');
  if (parserErrors.length > 0) {
    return { ok: false, error: { code: 'MALFORMED', message: 'El SVG está malformado y no pudo parsearse como XML.' } };
  }
  const root = document_.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { ok: false, error: { code: 'NOT_SVG', message: 'El documento no tiene raíz <svg>.' } };
  }

  const allElements = root.getElementsByTagName('*');
  if (allElements.length > SVG_IMPORT_LIMITS.MAX_ELEMENT_NODES) {
    return {
      ok: false,
      error: {
        code: 'TOO_MANY_NODES',
        message: `El SVG supera el máximo de ${SVG_IMPORT_LIMITS.MAX_ELEMENT_NODES} nodos. Simplificá el archivo antes de subirlo.`,
      },
    };
  }

  // Barrido de seguridad previo: ningún elemento prohibido llega al walk.
  for (let index = 0; index < allElements.length; index += 1) {
    const tag = allElements[index].tagName.toLowerCase();
    const denied = HARD_DENY[tag];
    if (denied) return { ok: false, error: { ...denied } };
    const audit = auditAttributes(allElements[index]);
    if (audit) return { ok: false, error: audit };
  }
  const rootAudit = auditAttributes(root);
  if (rootAudit) return { ok: false, error: rootAudit };

  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const widthPx = parseAbsoluteLength(root.getAttribute('width'));
  const heightPx = parseAbsoluteLength(root.getAttribute('height'));
  const resolvedViewBox: SvgImportViewBox | null =
    viewBox ?? (widthPx != null && heightPx != null && widthPx > 0 && heightPx > 0
      ? { x: 0, y: 0, width: widthPx, height: heightPx }
      : null);
  if (!resolvedViewBox) {
    return {
      ok: false,
      error: {
        code: 'INVALID_DIMENSIONS',
        message: 'El SVG no declara viewBox ni dimensiones válidas. Agregá un viewBox antes de subirlo.',
      },
    };
  }

  const state: WalkState = {
    paths: [],
    boxes: [],
    fills: new Set(),
    strokes: new Set(),
    fillRules: new Set(),
    opacities: new Set(),
    transformsUsed: new Set(),
    transformedElementCount: 0,
    primitiveCounts: { path: 0, circle: 0, ellipse: 0, rect: 0, line: 0, polyline: 0, polygon: 0, g: 0 },
    skippedInvisibleCount: 0,
    ignoredDefsCount: 0,
    opacityFlattened: false,
    warnings: [],
  };
  const walkError = walk(root, DEFAULT_STYLE, 0, state, true);
  if (walkError) return { ok: false, error: walkError };

  if (state.paths.length === 0) {
    return { ok: false, error: { code: 'NO_GEOMETRY', message: 'El SVG no contiene geometría vectorial utilizable.' } };
  }
  const boundingBox = unionBoxes(state.boxes);
  if (!boundingBox) {
    return { ok: false, error: { code: 'NO_GEOMETRY', message: 'El SVG no contiene geometría vectorial utilizable.' } };
  }

  if (state.skippedInvisibleCount > 0) {
    state.warnings.push(`${state.skippedInvisibleCount} geometrías invisibles se omitieron (sin relleno ni trazo, u ocultas).`);
  }
  if (state.ignoredDefsCount > 0) {
    state.warnings.push('Se ignoró contenido de <defs> no renderizado.');
  }
  if (state.opacityFlattened) {
    state.warnings.push('El normalizado aplana la opacidad a opaco (modelo de grabado).');
  }

  const finalWidth = widthPx != null && widthPx > 0 ? widthPx : resolvedViewBox.width;
  const finalHeight = heightPx != null && heightPx > 0 ? heightPx : resolvedViewBox.height;
  const paths: SvgImportPath[] = state.paths.map(entry =>
    entry.transform ? { d: entry.d, transform: entry.transform } : { d: entry.d },
  );
  return {
    ok: true,
    result: {
      paths,
      viewBox: resolvedViewBox,
      widthPx: finalWidth,
      heightPx: finalHeight,
      pathCount: paths.length,
      normalizedBoundingBox: boundingBox,
      diagnostics: {
        sourceChars: svgText.length,
        viewBox: resolvedViewBox,
        widthPx: finalWidth,
        heightPx: finalHeight,
        pathCount: paths.length,
        primitiveCounts: { ...state.primitiveCounts },
        transformsUsed: [...state.transformsUsed].sort(),
        transformedElementCount: state.transformedElementCount,
        fills: [...state.fills].sort(),
        strokes: [...state.strokes].sort(),
        fillRules: [...state.fillRules].sort(),
        opacities: [...state.opacities].sort((a, b) => a - b),
        opacityFlattened: state.opacityFlattened,
        hasRaster: false,
        hasText: false,
        hasExternalRefs: false,
        skippedInvisibleCount: state.skippedInvisibleCount,
        ignoredDefsCount: state.ignoredDefsCount,
        normalizedBoundingBox: boundingBox,
        warnings: [...state.warnings],
      },
    },
  };
}
