/** Safe, bounded SVG admission for the admin's editable art (not a laser suitability check).
 * Parse into detached XML, audit the ENTIRE document, then project controlled
 * geometry. Never retain source DOM/markup, and never call parseSvgImport.
 */
import {
  circleToPath,
  ellipseToPath,
  rectToPath,
  lineToPath,
  polylineToPath,
  readLength,
} from "../svg-import/geometry";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  parseTransformList,
  type SvgMatrix,
} from "../svg-import/transforms";
import {
  ADMIN_SVG_NAMESPACE,
  estimateSvgTextWork,
  measureControlledPaths,
} from "./geometry";
import {
  DEFAULT_CONTROLLED_STYLE,
  TRUSTED_IMPORT_LIMITS as LIMITS,
  isSafePaint,
  type ControlledNode,
  type ControlledPath,
  type ControlledStyle,
  type TrustedImportCode,
  type TrustedImportOutcome,
} from "./importedGeometry";

class ImportFailure extends Error {
  constructor(
    readonly code: TrustedImportCode,
    reason: string,
  ) {
    super(reason);
  }
}
function fail(code: TrustedImportCode, reason: string): never {
  throw new ImportFailure(code, reason);
}
const unsupported = (what: string): never =>
  fail(
    "UNSUPPORTED",
    `Este SVG usa ${what}, que todavía no podemos representar como geometría editable.`,
  );
const security = (): never =>
  fail(
    "SECURITY",
    "El SVG contiene contenido activo o referencias externas no seguras.",
  );
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Decode URI percent escapes and CSS escapes BEFORE security classification.
 * XML character references have already been resolved by DOMParser.
 */
function stripComments(value: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("/*", cursor);
    if (start < 0) break;
    const end = value.indexOf("*/", start + 2);
    // Fail closed instead of rescanning each unterminated opening prefix.
    if (end < 0) security();
    parts.push(value.slice(cursor, start));
    cursor = end + 2;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}
function decodeCss(value: string): string {
  return value
    .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) =>
      String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)),
    )
    .replace(/\\([^\r\n])/g, "$1");
}
function decoded(value: string): string {
  let result = decodeCss(stripComments(value));
  for (let pass = 0; pass < 4 && /%[\da-f]{2}/i.test(result); pass++) {
    result = result.replace(/%([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
  // Encodings can reconstruct comments/escapes: audit the reconstructed CSS too.
  return stripComments(decodeCss(stripComments(result)));
}

/** Each search advances past the inspected span: no suffix is retried for
 * every opening url( prefix. Malformed functions fail closed, including in
 * ignored attributes; well-formed local fragments remain safe to audit.
 */
function auditUrls(text: string): void {
  // ASCII folding preserves indices (Unicode lowercasing can expand characters).
  const lower = text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  let cursor = 0;
  while (cursor < text.length) {
    const start = lower.indexOf("url", cursor);
    if (start < 0) return;
    cursor = start + 3;
    while (/\s/.test(text.charAt(cursor)) && cursor < text.length) cursor++;
    if (text[cursor] !== "(") continue;
    cursor++;
    while (/\s/.test(text.charAt(cursor)) && cursor < text.length) cursor++;
    const quote =
      text[cursor] === "'" || text[cursor] === '"' ? text[cursor++] : null;
    const end = text.indexOf(quote ?? ")", cursor);
    if (end < 0) security();
    const uri = text.slice(cursor, end).trim();
    if (!uri.startsWith("#")) security();
    cursor = end + 1;
    if (quote) {
      while (/\s/.test(text.charAt(cursor)) && cursor < text.length) cursor++;
      if (text[cursor] !== ")") security();
      cursor++;
    }
  }
}
function auditValue(value: string, resource: boolean, raster: boolean): void {
  const text = decoded(value);
  if (
    /javascript\s*:|vbscript\s*:|expression\s*\(/i.test(
      text.replace(/[\x00-\x20]/g, ""),
    )
  )
    security();
  if (/@import\b/i.test(text)) security();
  auditUrls(text);
  if (resource) {
    const uri = text.trim();
    if (
      uri &&
      !uri.startsWith("#") &&
      !(raster && /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);/i.test(uri))
    )
      security();
  }
}

/** Full iterative audit; ignored metadata/defs cannot hide active content.
 * Vendor namespace declarations themselves are identifiers, not fetched URLs.
 */
function auditDocument(document: Document): void {
  const stack: Array<{ node: Node; depth: number }> = [
    { node: document, depth: -1 },
  ];
  let count = 0;
  let unsupportedFeature: string | null = null;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > LIMITS.MAX_NODES || depth > LIMITS.MAX_DEPTH)
      fail("LIMIT", "El SVG excede los límites de estructura.");
    if (node.nodeType === 7 && /^xml-stylesheet$/i.test(node.nodeName))
      security();
    if (node.nodeType === 1) {
      const el = node as Element;
      const name = el.localName.toLowerCase();
      count += el.attributes.length;
      if (count > LIMITS.MAX_NODES)
        fail("LIMIT", "El SVG excede el límite de nodos y atributos.");
      // Effect tags, even in foreign namespaces, cannot be silently dropped
      // from ignored subtrees. Harmless vendor metadata remains allowed.
      // Defer technical failure until the COMPLETE security audit finishes.
      if (
        [
          "style",
          "animate",
          "animatetransform",
          "animatemotion",
          "set",
          "discard",
        ].includes(name)
      ) {
        unsupportedFeature = name;
      }
      if (
        [
          "script",
          "foreignobject",
          "iframe",
          "object",
          "embed",
          "link",
        ].includes(name)
      )
        security();
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === "xmlns" || attr.prefix === "xmlns") continue;
        if (/^on/i.test(attr.localName)) security();
        const resource =
          ["href", "src", "poster", "data"].includes(
            attr.localName.toLowerCase(),
          ) ||
          (attr.namespaceURI === "http://www.w3.org/XML/1998/namespace" &&
            attr.localName === "base");
        auditValue(attr.value, resource, name === "image");
      }
      if (name === "style") auditValue(el.textContent ?? "", false, false);
    }
    // Count before pushing: a single huge sibling list cannot amplify the stack.
    for (let child = node.lastChild; child; child = child.previousSibling) {
      if (count + stack.length >= LIMITS.MAX_NODES)
        fail("LIMIT", "El SVG excede el límite de nodos.");
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  if (unsupportedFeature) unsupported(`el elemento ${unsupportedFeature}`);
}

/** SVG absolute lengths -> source user units. Percentages depend on viewport
 * and are technical exclusions; this is not a physical placement/mm adapter.
 */
function length(text: string | null, fallback = 0): number {
  if (text === null) return fallback;
  if (text.includes("%")) unsupported("longitudes porcentuales");
  const match =
    /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|in|cm|mm|q)?$/i.exec(
      text.trim(),
    );
  if (!match) fail("INVALID_GEOMETRY", "Una longitud del SVG no es válida.");
  const factors: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
  };
  // Reuse the public primitive length reader after strict lexical/unit validation.
  const parsed = readLength(match[1]);
  if (!parsed.ok)
    fail("INVALID_GEOMETRY", "Una longitud del SVG no es válida.");
  const value = parsed.value * (factors[match[2]?.toLowerCase()] ?? 1);
  if (!Number.isFinite(value) || Math.abs(value) > LIMITS.MAX_COORD)
    fail("INVALID_GEOMETRY", "Una longitud excede el rango admitido.");
  return value;
}
function numeric(text: string): number {
  if (!numberPattern.test(text.trim()))
    unsupported("un valor de estilo no numérico");
  const value = Number(text);
  if (!Number.isFinite(value) || Math.abs(value) > LIMITS.MAX_COORD)
    unsupported("un valor de estilo fuera de rango");
  return value;
}
function opacity(text: string): number {
  const value = text.trim().endsWith("%")
    ? numeric(text.trim().slice(0, -1)) / 100
    : numeric(text);
  if (value < 0 || value > 1) unsupported("opacidad fuera de rango");
  return value;
}
function numbers(text: string): number[] {
  // Complete consumption prevents the shared polyline helper's permissive regex
  // from silently discarding junk. Also bounds conversion BEFORE string expansion.
  if (!text.trim() || text.length > LIMITS.MAX_D_CHARS)
    fail("INVALID_GEOMETRY", "La lista de puntos no es válida.");
  if (/^\s*,|,\s*(?:,|$)/.test(text))
    fail("INVALID_GEOMETRY", "La lista de puntos tiene separadores inválidos.");
  const tokens = text.trim().split(/[\s,]+/);
  if (tokens.length > LIMITS.MAX_POINTS)
    fail("LIMIT", "La lista de puntos excede el trabajo admitido.");
  if (!tokens.every((t) => numberPattern.test(t)))
    fail("INVALID_GEOMETRY", "La lista de puntos no es válida.");
  const values = tokens.map(Number);
  if (
    !values.every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.MAX_COORD)
  )
    fail("INVALID_GEOMETRY", "La lista de puntos excede el rango admitido.");
  return values;
}

const styleKeys: Record<string, keyof ControlledStyle> = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "linecap",
  "stroke-linejoin": "linejoin",
  "stroke-miterlimit": "miterlimit",
  "stroke-dasharray": "dasharray",
  "stroke-dashoffset": "dashoffset",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
};
// Rendering effects we cannot faithfully represent. This is NOT a normal
// attribute whitelist: id/class/data/ARIA/editor/root attributes are inert.
const effectAttributes = new Set(
  `clip-path clip mask filter marker marker-start marker-mid marker-end
vector-effect paint-order transform-origin transform-box mix-blend-mode isolation
overflow stroke-alignment stroke-position stroke-dashcorner stroke-dashadjust
requiredFeatures requiredExtensions systemLanguage`.split(/\s+/),
);
const neutralEffects: Record<string, string> = {
  "paint-order": "normal",
  isolation: "auto",
  clip: "auto",
  overflow: "visible",
};
const inertCss = new Set([
  "color",
  "cursor",
  "pointer-events",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
]);

function inertClipRule(value: string): void {
  if (
    !["nonzero", "evenodd", "inherit", "initial", "unset"].includes(
      value.toLowerCase(),
    )
  )
    unsupported("clip-rule no representable");
  // Actual clipping is rejected separately; the rule alone changes no paint.
}

function resolvedStyle(
  el: Element,
  inherited: ControlledStyle,
  parentAlpha: number,
): { style: ControlledStyle; alpha: number; hidden: boolean } {
  const declarations = new Map<string, string>();
  for (const attr of Array.from(el.attributes)) {
    if (attr.namespaceURI && attr.namespaceURI !== ADMIN_SVG_NAMESPACE)
      continue;
    const name = attr.localName;
    const value = attr.value.trim().toLowerCase();
    if (name === "clip-rule") inertClipRule(value);
    if (
      effectAttributes.has(name) &&
      value !== "none" &&
      value !== neutralEffects[name]
    )
      unsupported(`el efecto ${name}`);
    if (styleKeys[name] || ["opacity", "display", "visibility"].includes(name))
      declarations.set(name, attr.value.trim());
  }
  const css = el.getAttribute("style");
  if (css) {
    if (/[\\{}@]/.test(css) || /\/\*/.test(css)) unsupported("CSS complejo");
    const importantKeys = new Set<string>();
    for (const declaration of css.split(";")) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(":");
      if (colon < 1) unsupported("una declaración CSS inválida");
      const key = declaration.slice(0, colon).trim().toLowerCase();
      let value = declaration.slice(colon + 1).trim();
      const important = /\s*!important\s*$/i.test(value);
      value = value
        .replace(/\s*!important\s*$/i, "")
        .trim()
        .toLowerCase();
      if (!important && importantKeys.has(key)) continue;
      if (important) importantKeys.add(key);
      if (inertCss.has(key)) continue;
      if (key === "clip-rule") {
        inertClipRule(value);
        continue;
      }
      if (
        effectAttributes.has(key) &&
        (value === "none" || value === neutralEffects[key])
      )
        continue;
      if (
        !styleKeys[key] &&
        !["opacity", "display", "visibility"].includes(key)
      )
        unsupported(`la propiedad CSS ${key}`);
      declarations.set(key, value);
    }
  }
  const style: ControlledStyle = {
    ...inherited,
    dasharray: inherited.dasharray.slice(),
  };
  let alpha = 1;
  let hidden = false;
  for (const [name, value] of declarations) {
    const raw = value.toLowerCase();
    if (name === "opacity") {
      alpha =
        raw === "inherit"
          ? parentAlpha
          : ["initial", "unset"].includes(raw)
            ? 1
            : opacity(raw);
      continue;
    }
    if (name === "display") {
      if (raw === "none") hidden = true;
      else if (
        !["inline", "block", "inherit", "initial", "unset"].includes(raw)
      )
        unsupported("display no representable");
      continue;
    }
    if (name === "visibility") {
      // Hidden visibility is inherited but descendants can override it. Avoid
      // silently dropping such descendants until a visibility model exists.
      if (!["visible", "inherit", "initial", "unset"].includes(raw))
        unsupported("visibility no representable");
      continue;
    }
    if (raw === "inherit" || raw === "unset") continue;
    if (raw === "initial") {
      const key = styleKeys[name];
      Object.assign(style, { [key]: DEFAULT_CONTROLLED_STYLE[key] });
      continue;
    }
    switch (name) {
      case "fill":
      case "stroke":
        if (!isSafePaint(raw))
          unsupported(
            `pintura ${name} no concreta o servidor de pintura local`,
          );
        style[name] = raw.toLowerCase();
        break;
      case "stroke-width":
        style.strokeWidth = length(raw);
        if (style.strokeWidth < 0) unsupported("ancho de trazo negativo");
        break;
      case "stroke-dashoffset":
        style.dashoffset = length(raw);
        break;
      case "stroke-miterlimit":
        style.miterlimit = numeric(raw);
        if (style.miterlimit < 1) unsupported("stroke-miterlimit inválido");
        break;
      case "fill-opacity":
        style.fillOpacity = opacity(raw);
        break;
      case "stroke-opacity":
        style.strokeOpacity = opacity(raw);
        break;
      case "fill-rule":
        if (raw !== "nonzero" && raw !== "evenodd")
          unsupported("fill-rule no representable");
        style.fillRule = raw as ControlledStyle["fillRule"];
        break;
      case "stroke-linecap":
        if (!["butt", "round", "square"].includes(raw))
          unsupported("stroke-linecap no representable");
        style.linecap = raw as ControlledStyle["linecap"];
        break;
      case "stroke-linejoin":
        if (!["miter", "round", "bevel"].includes(raw))
          unsupported("stroke-linejoin no representable");
        style.linejoin = raw as ControlledStyle["linejoin"];
        break;
      case "stroke-dasharray": {
        if (/^\s*,|,\s*(?:,|$)/.test(raw))
          unsupported("un patrón de trazo con separadores inválidos");
        const parts = raw === "none" ? [] : raw.split(/[\s,]+/);
        if (parts.length > LIMITS.MAX_DASH_VALUES)
          fail("LIMIT", "El patrón de trazo es demasiado largo.");
        style.dasharray = parts.map((x) => length(x));
        if (style.dasharray.some((x) => x < 0))
          unsupported("patrón de trazo negativo");
        break;
      }
    }
  }
  const pathLength = el.getAttribute("pathLength");
  if (pathLength !== null) {
    if (numeric(pathLength) < 0) unsupported("pathLength negativo");
    // Calibration changes dash-to-distance mapping, not centerline geometry.
    if (style.stroke !== "none" && style.dasharray.length)
      unsupported("pathLength con un patrón de trazo");
  }
  return { style, alpha, hidden };
}

/** Shared converters round to four decimals. Keep their grammar/conversion,
 * but restore exact source arithmetic where that rounding would alter art.
 * This applies only to generated primitives; original path d is never touched.
 */
function exactNumbers(d: string | null, values: number[]): string | null {
  if (d === null) return null;
  let index = 0;
  const restored = d.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, () => {
    if (index >= values.length)
      fail("INVALID_GEOMETRY", "La conversión de la primitiva no es válida.");
    return String(values[index++]);
  });
  if (index !== values.length)
    fail("INVALID_GEOMETRY", "La conversión de la primitiva no es válida.");
  return restored;
}
function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  circle: boolean,
): string | null {
  const converted = circle
    ? circleToPath(cx, cy, rx)
    : ellipseToPath(cx, cy, rx, ry);
  return exactNumbers(converted, [
    cx - rx,
    cy,
    rx,
    ry,
    0,
    1,
    0,
    2 * rx,
    0,
    rx,
    ry,
    0,
    1,
    0,
    -2 * rx,
    0,
  ]);
}

function primitive(el: Element): string | null {
  const get = (name: string, fallback = 0) =>
    length(el.getAttribute(name), fallback);
  const nonnegative = (name: string, fallback = 0) => {
    const value = get(name, fallback);
    if (value < 0)
      fail("INVALID_GEOMETRY", `La dimensión ${name} es negativa.`);
    return value;
  };
  switch (el.localName) {
    case "path": {
      const d = el.getAttribute("d");
      return d?.trim() ? d : null;
    }
    case "circle": {
      const r = nonnegative("r");
      return ellipsePath(get("cx"), get("cy"), r, r, true);
    }
    case "ellipse":
      return ellipsePath(
        get("cx"),
        get("cy"),
        nonnegative("rx"),
        nonnegative("ry"),
        false,
      );
    case "rect": {
      const rx = nonnegative(
        "rx",
        el.hasAttribute("ry") ? nonnegative("ry") : 0,
      );
      const ry = nonnegative("ry", rx);
      const x = get("x"),
        y = get("y"),
        width = nonnegative("width"),
        height = nonnegative("height");
      const radiusX = Math.min(rx, width / 2),
        radiusY = Math.min(ry, height / 2);
      const converted = rectToPath(x, y, width, height, rx, ry);
      const values =
        radiusX === 0 || radiusY === 0
          ? [x, y, x + width, y + height, x]
          : [
              x + radiusX,
              y,
              x + width - radiusX,
              radiusX,
              radiusY,
              0,
              0,
              1,
              x + width,
              y + radiusY,
              y + height - radiusY,
              radiusX,
              radiusY,
              0,
              0,
              1,
              x + width - radiusX,
              y + height,
              x + radiusX,
              radiusX,
              radiusY,
              0,
              0,
              1,
              x,
              y + height - radiusY,
              y + radiusY,
              radiusX,
              radiusY,
              0,
              0,
              1,
              x + radiusX,
              y,
            ];
      return exactNumbers(converted, values);
    }
    case "line": {
      const x1 = get("x1"),
        y1 = get("y1"),
        x2 = get("x2"),
        y2 = get("y2");
      // The public helper omits zero-length lines, but round/square stroke caps
      // can paint them. Keep their actual segment instead of silently losing it.
      return (
        exactNumbers(lineToPath(x1, y1, x2, y2), [x1, y1, x2, y2]) ??
        `M${x1} ${y1}L${x2} ${y2}`
      );
    }
    case "polygon":
    case "polyline": {
      const points = el.getAttribute("points") ?? "";
      if (!points.trim()) return null;
      const values = numbers(points);
      if (values.length < 4 || values.length % 2)
        fail("INVALID_GEOMETRY", "La lista de puntos no es válida.");
      if (
        values.length / 2 > LIMITS.MAX_COMMANDS_PER_PATH ||
        values.reduce((chars, value) => chars + String(value).length + 1, 0) +
          1 >
          LIMITS.MAX_D_CHARS
      ) {
        fail(
          "LIMIT",
          "La lista de puntos excede el volumen de geometría admitido.",
        );
      }
      return exactNumbers(
        polylineToPath(values.join(" "), el.localName === "polygon"),
        values,
      );
    }
    default:
      return unsupported(`el elemento ${el.localName}`);
  }
}

function checkRoot(root: Element): void {
  if (root.localName !== "svg" || root.namespaceURI !== ADMIN_SVG_NAMESPACE)
    fail("MALFORMED", "El archivo no es un SVG válido.");
  const viewBox = root.getAttribute("viewBox");
  if (viewBox) {
    const values = numbers(viewBox);
    if (values.length !== 4 || values[2] <= 0 || values[3] <= 0)
      fail("INVALID_GEOMETRY", "El viewBox del SVG no es válido.");
  }
  for (const key of ["width", "height"]) {
    const raw = root.getAttribute(key)?.trim();
    if (raw === undefined) continue;
    // Root viewport percentages do not alter normalized source-user-unit art
    // when a valid viewBox exists. Geometry lengths remain absolute-only.
    const value =
      viewBox && raw.endsWith("%") ? numeric(raw.slice(0, -1)) : length(raw);
    if (value <= 0) fail("INVALID_GEOMETRY", "El tamaño del SVG no es válido.");
  }
  const aspect = root.getAttribute("preserveAspectRatio");
  if (
    aspect &&
    !/^(?:defer\s+)?(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(
      aspect.trim(),
    )
  )
    unsupported("preserveAspectRatio no representable");
}

/** Remove the external portion of ONLY the canonical inert SVG 1.1 header.
 * Retain an empty doctype so XML still rejects misplaced/duplicate declarations.
 * No DTD reaches DOMParser; internal subsets and arbitrary external IDs fail.
 */
function withoutExternalDtd(text: string): string {
  const starts = /<!DOCTYPE\b/gi;
  const parts: string[] = [];
  let cursor = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    const end = text.indexOf(">", match.index + match[0].length);
    if (end < 0) security();
    const header = text.slice(match.index, end + 1);
    if (
      !/^<!DOCTYPE\s+svg\s*>$/i.test(header) &&
      !/^<!DOCTYPE[ \t\r\n]+svg[ \t\r\n]+PUBLIC[ \t\r\n]+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\1[ \t\r\n]+(["'])http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\2[ \t\r\n]*>$/.test(
        header,
      )
    )
      security();
    parts.push(text.slice(cursor, match.index), "<!DOCTYPE svg>");
    cursor = end + 1;
    starts.lastIndex = cursor;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

export function importTrustedSvg(text: string): TrustedImportOutcome {
  try {
    if (typeof text !== "string" || !text.trim())
      fail("MALFORMED", "El archivo SVG está vacío.");
    if (
      text.length > LIMITS.MAX_FILE_BYTES ||
      new TextEncoder().encode(text).length > LIMITS.MAX_FILE_BYTES
    )
      fail("LIMIT", "El archivo SVG es demasiado grande.");
    // No XML expansion or external DTD/stylesheet processing, even in ignored data.
    if (/<!ENTITY\b|<\?xml-stylesheet\b/i.test(text)) security();
    const parseText = withoutExternalDtd(text);
    const estimate = estimateSvgTextWork(text);
    if (
      estimate.paths > LIMITS.MAX_PATHS ||
      estimate.dChars > LIMITS.MAX_TOTAL_D_CHARS ||
      estimate.cost > LIMITS.MAX_POINTS
    )
      fail("LIMIT", "El SVG excede el trabajo admitido.");
    let tags = 0;
    for (const _ of text.matchAll(/<[A-Za-z_]/g)) {
      if (++tags > LIMITS.MAX_NODES)
        fail("LIMIT", "El SVG excede el trabajo admitido.");
    }
    const document = new DOMParser().parseFromString(
      parseText,
      "image/svg+xml",
    );
    if (document.getElementsByTagName("parsererror").length)
      fail("MALFORMED", "El archivo SVG no es XML válido.");
    auditDocument(document);
    const root = document.documentElement;
    checkRoot(root);
    const paths: ControlledPath[] = [];
    const nodes: ControlledNode[] = [];
    let totalChars = 0;
    const walk = (
      el: Element,
      parentMatrix: SvgMatrix,
      inherited: ControlledStyle,
      depth: number,
      parentAlpha: number,
    ): number | null => {
      if (depth > LIMITS.MAX_DEPTH)
        fail("LIMIT", "El SVG excede la profundidad admitida.");
      if (el.namespaceURI !== ADMIN_SVG_NAMESPACE)
        unsupported(`el elemento de otro namespace ${el.localName}`);
      const name = el.localName;
      if (["title", "desc", "metadata", "defs"].includes(name)) return null;
      if (name === "image")
        fail(
          "RASTER",
          "Este SVG contiene una imagen raster y no puede usarse como geometría editable.",
        );
      if (["text", "tspan", "textPath"].includes(name))
        fail(
          "LIVE_TEXT",
          "Convertí el texto a curvas antes de subir este SVG.",
        );
      if (["use", "style"].includes(name) || (name === "svg" && el !== root))
        unsupported(`el elemento ${name}`);
      const resolved = resolvedStyle(el, inherited, parentAlpha);
      // display:none cannot paint, but its entire subtree was already audited.
      if (resolved.hidden) return null;
      const transform = parseTransformList(el.getAttribute("transform"));
      if (!transform.ok) fail("INVALID_GEOMETRY", transform.error.message);
      const matrix = multiplyMatrices(parentMatrix, transform.matrix);
      if (
        !Object.values(matrix).every(
          (x) => Number.isFinite(x) && Math.abs(x) <= LIMITS.MAX_COORD,
        )
      )
        fail(
          "INVALID_GEOMETRY",
          "Un transform compuesto excede el rango admitido.",
        );
      const index = nodes.length;
      if (index >= LIMITS.MAX_NODES)
        fail("LIMIT", "El SVG excede el límite de nodos.");
      if (name === "svg" || name === "g") {
        const children: number[] = [];
        nodes.push({ kind: "group", opacity: resolved.alpha, children });
        for (const child of Array.from(el.children)) {
          const ref = walk(
            child,
            matrix,
            resolved.style,
            depth + 1,
            resolved.alpha,
          );
          if (ref !== null) children.push(ref);
        }
        return index;
      }
      if (el.children.length)
        unsupported("elementos hijos dentro de una primitiva");
      if (paths.length >= LIMITS.MAX_PATHS)
        fail("LIMIT", "El SVG excede el límite de paths.");
      const d = primitive(el);
      if (d === null) return null; // area-zero circle/ellipse/rect paints nothing
      totalChars += d.length;
      if (
        d.length > LIMITS.MAX_D_CHARS ||
        totalChars > LIMITS.MAX_TOTAL_D_CHARS
      )
        fail("LIMIT", "El SVG excede el volumen de geometría admitido.");
      nodes.push({ kind: "path", opacity: resolved.alpha, path: paths.length });
      paths.push({ d, matrix, style: resolved.style });
      return index;
    };
    walk(root, IDENTITY_MATRIX, DEFAULT_CONTROLLED_STYLE, 0, 1);
    if (!paths.length)
      fail("INVALID_GEOMETRY", "El SVG no contiene geometría editable.");
    const measured = measureControlledPaths(paths, nodes);
    if (!measured.ok)
      fail(
        measured.code === "DESIGN_TOO_LARGE" ? "LIMIT" : "INVALID_GEOMETRY",
        measured.reason,
      );
    return {
      ok: true,
      geometry: {
        version: 2,
        root: 0,
        paths,
        nodes,
        centerlineBounds: measured.centerlineBounds,
        artBounds: measured.artBounds,
      },
    };
  } catch (error) {
    if (error instanceof ImportFailure)
      return { ok: false, code: error.code, reason: error.message };
    // Detached malformed XML must not throw through the file-upload boundary.
    return {
      ok: false,
      code: "MALFORMED",
      reason: "No pudimos leer la geometría de este SVG.",
    };
  }
}
