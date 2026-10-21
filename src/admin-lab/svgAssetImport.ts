/** Sanitized full-SVG asset import for the admin design library (future model v3).
 *
 * Unlike svgGeometryImport (which projects controlled geometry and rejects
 * anything it cannot represent), this module ACCEPTS arbitrary
 * externally-prepared SVG (Illustrator/Corel/PicSVG/Fiverr exports) and
 * returns the full SANITIZED document string to be stored as ONE vector asset.
 *
 * Posture: never eval / regex-reconstruct markup. Output comes ONLY from the
 * parsed tree via XMLSerializer. Hostile body content is stripped (elements
 * removed, dangerous attributes dropped) while the file is still accepted;
 * only the prologue (entities, stylesheet PIs, non-canonical DTD) fails
 * closed, exactly like the trusted geometry importer. Budgets mirror
 * TRUSTED_IMPORT_LIMITS (file bytes, node/attribute count, depth).
 *
 * Standard W3C SVG DTD references are dropped, not rejected: the DOCTYPE is
 * an inert identifier, never a network request (DOMParser never fetches
 * external DTDs), it is never rendered, and the serializer drops it so no
 * DOCTYPE ever reaches stored output. Only the exact known W3C SVG DTD
 * identifiers are tolerated (SVG 1.0, SVG 1.1, SVG 1.1 Basic, SVG 1.1 Tiny,
 * bare); any internal subset or unknown identifier still fails closed.
 */
import { TRUSTED_IMPORT_LIMITS as LIMITS } from "./importedGeometry";

export type SvgAssetImportCode =
  "OK" | "SECURITY" | "TECHNICAL" | "MALFORMED" | "LIMIT";

export interface SvgAssetViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgAsset {
  svg: string;
  width: number | null;
  height: number | null;
  viewBox: SvgAssetViewBox | null;
}

export type SvgAssetImportOutcome =
  | { ok: true; asset: SvgAsset }
  | { ok: false; code: SvgAssetImportCode; reason: string };

const SVG_NS = "http://www.w3.org/2000/svg";
/** Cap for data: image/* URIs kept on <image> (~1MB, spec). */
const MAX_DATA_URI_CHARS = 1_000_000;

class ImportFailure extends Error {
  constructor(
    readonly code: SvgAssetImportCode,
    reason: string,
  ) {
    super(reason);
  }
}

function fail(code: SvgAssetImportCode, reason: string): never {
  throw new ImportFailure(code, reason);
}

const security = (
  reason = "El SVG contiene contenido activo o referencias externas no seguras.",
): never => fail("SECURITY", reason);

/** Elements removed WITH their entire subtree (never unwrapped). */
const DENY_ELEMENTS = new Set(
  `script foreignobject iframe object embed link a
animate animatetransform animatemotion set discard handler
audio video canvas portal`.split(/\s+/),
);

/** Elements kept (after the attribute pass). Everything else in the SVG
 * namespace is unwrapped (element dropped, children kept); metadata is
 * dropped entirely because it never renders. <style> is kept only under a
 * strict audit (see styleElementClean); every fe* primitive is kept except
 * feImage with a non-conforming href (see resourceValueAllowed). */
const ALLOW_ELEMENTS = new Set(
  `svg g defs symbol title desc style
path rect circle ellipse line polyline polygon
text tspan textpath
lineargradient radialgradient stop pattern clippath mask marker use filter image`.split(
    /\s+/,
  ),
);

/** Kept attributes (compared lowercased on the qualified name). href/src and
 * style have their own audit; xmlns declarations pass the kept-value audit
 * (F4). Anything else is stripped silently, never a rejection. */
const ATTRIBUTE_ALLOW = new Set(
  `id class transform d x y x1 y1 x2 y2 cx cy r rx ry width height points
viewbox preserveaspectratio xmlns xmlns:xlink version
fill stroke fill-opacity stroke-opacity fill-rule clip-rule
stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit
opacity display visibility color
gradientunits gradienttransform spreadmethod fx fy offset
stop-color stop-opacity
patternunits patterncontentunits patterntransform
clip-path mask filter marker-start marker-mid marker-end
clippathunits maskunits maskcontentunits
markerwidth markerheight markerunits refx refy orient
text-anchor font-family font-size font-style font-weight dx dy rotate
letter-spacing word-spacing text-decoration vector-effect mix-blend-mode isolation
dominant-baseline xml:space aria-hidden role`.split(/\s+/),
);

/** Presentation attributes whose values may carry url() paint/server refs. */
const URL_ATTRIBUTES = new Set(
  `fill stroke clip-path mask filter marker-start marker-mid marker-end marker`.split(
    /\s+/,
  ),
);

/** CSS properties kept inside style="..." (mirrors the trusted importer's
 * controlled/inert property set). Unknown properties are dropped silently. */
const STYLE_PROPERTIES = new Set(
  `fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit
stroke-dasharray stroke-dashoffset stroke-opacity
fill-rule fill-opacity clip-rule opacity display visibility color
stop-color stop-opacity font-family font-size font-style font-weight
letter-spacing word-spacing text-decoration
text-anchor dominant-baseline clip-path mask filter vector-effect
mix-blend-mode isolation
marker-start marker-mid marker-end marker cursor pointer-events`.split(/\s+/),
);

/* ---------- Audit decoding (mirrors svgGeometryImport, sanitize variant) ----------
 * XML character references are already resolved by DOMParser. Percent and CSS
 * escapes are decoded BEFORE classification so `java&#x73;cript:` /
 * `%6a%61vascript:` / `u\72l(` cannot smuggle active content. Unterminated
 * comments or malformed url( make the VALUE unsafe (attribute dropped) but
 * never fail the file: this importer strips, it does not reject body content.
 */

function stripCommentsSafe(value: string): string | null {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("/*", cursor);
    if (start < 0) break;
    const end = value.indexOf("*/", start + 2);
    if (end < 0) return null;
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

function decodedSafe(value: string): string | null {
  let result = stripCommentsSafe(value);
  if (result === null) return null;
  result = decodeCss(result);
  for (let pass = 0; pass < 4 && /%[\da-f]{2}/i.test(result); pass++) {
    result = result.replace(/%([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
  // Encodings can reconstruct comments/escapes: audit the reconstructed value too.
  result = decodeCss(result);
  return stripCommentsSafe(result);
}

/** Every kept attribute value must survive this: no script schemes, CSS
 * expression/behavior, stylesheet imports or HTML data payloads. */
function keptValueSafe(raw: string): boolean {
  const text = decodedSafe(raw);
  if (text === null) return false;
  if (
    /javascript\s*:|vbscript\s*:|expression\s*\(|behavior/i.test(
      text.replace(/[\x00-\x20]/g, ""),
    )
  )
    return false;
  if (/@import\b/i.test(text)) return false;
  if (/data\s*:\s*text\/html/i.test(text.replace(/[\x00-\x20]/g, "")))
    return false;
  return true;
}

/** url() targets inside kept values must be empty or local (#fragment).
 * Allow decision (F1) reads the RAW value before decoding: a target such as
 * `%23g` is stripped even though it decodes to `#g`. Decoding stays for the
 * malformedness probe only. Linear scan that always advances. */
function urlsAreLocal(raw: string): boolean {
  if (decodedSafe(raw) === null) return false;
  const lower = raw.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  let cursor = 0;
  while (cursor < raw.length) {
    const start = lower.indexOf("url", cursor);
    if (start < 0) return true;
    cursor = start + 3;
    while (cursor < raw.length && /\s/.test(raw.charAt(cursor))) cursor++;
    if (raw[cursor] !== "(") continue;
    cursor++;
    while (cursor < raw.length && /\s/.test(raw.charAt(cursor))) cursor++;
    const quote =
      raw[cursor] === "'" || raw[cursor] === '"' ? raw[cursor++] : null;
    const end = raw.indexOf(quote ?? ")", cursor);
    if (end < 0) return false;
    const uri = raw.slice(cursor, end).trim();
    if (uri !== "" && !uri.startsWith("#")) return false;
    cursor = end + 1;
    if (quote) {
      while (cursor < raw.length && /\s/.test(raw.charAt(cursor))) cursor++;
      if (raw[cursor] !== ")") return false;
      cursor++;
    }
  }
  return true;
}

/** Broad data:image shape for the RAW gate (F1); the raster restriction
 * (F3) applies to the decoded payload below. */
const DATA_IMAGE_PATTERN = /^data:image\/[\w.+_-]+[;,]/i;
/** Raster subtypes only: nested SVG (or text/html) payloads are denied. */
const RASTER_IMAGE_PATTERN = /^data:image\/(png|jpe?g|gif|webp|bmp|avif)[;,]/i;

/** href/src/xlink:href survival rule (F1+F3). The allow decision reads the
 * RAW value before decoding: it must be empty, a local #fragment, or — on
 * image/feImage content only — a data:image URI. Percent-encoded smuggling
 * such as `%23x` or `%64ata:image/...` is therefore stripped even though it
 * decodes to an innocent-looking value. Decoding stays for the deny-audit
 * (keptValueSafe) and the raster check only. Anything else (http/https,
 * protocol-relative, other schemes, javascript:, data:text/html,
 * data:image/svg+xml) is dropped. */
function resourceValueAllowed(elementName: string, raw: string): boolean {
  if (raw.length > MAX_DATA_URI_CHARS) return false;
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  const dataAllowed = elementName === "image" || elementName === "feimage";
  if (trimmed.startsWith("#")) return keptValueSafe(raw);
  if (dataAllowed && DATA_IMAGE_PATTERN.test(trimmed)) {
    if (!keptValueSafe(raw)) return false;
    const text = decodedSafe(raw);
    if (text === null) return false;
    const uri = text.trim();
    return RASTER_IMAGE_PATTERN.test(uri) && uri.length <= MAX_DATA_URI_CHARS;
  }
  return false;
}

/* ---------- Prologue (same policy as the trusted importer) ----------
 * Entity declarations and stylesheet PIs fail closed anywhere in the raw
 * text. Only inert standard W3C SVG DTD references are tolerated (see the
 * exact list above), and each tolerated header is dropped before parsing
 * so it never reaches the output. */

/** Inert standard W3C SVG DTD identifiers tolerated by withoutExternalDtd
 * (EXACT-LIST ONLY: no generic http:// bypass, no wildcard). PUBLIC pairs
 * bind the formal public identifier to its exact system URL; SYSTEM-only
 * headers must carry one of the same exact known URLs. */
const KNOWN_SVG_DTD_URLS = new Set([
  "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd",
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd",
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd",
  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd",
]);
const KNOWN_SVG_DTD_PUBLIC_IDS = new Map([
  [
    "-//W3C//DTD SVG 20010904//EN",
    "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd",
  ],
  [
    "-//W3C//DTD SVG 1.1//EN",
    "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd",
  ],
  [
    "-//W3C//DTD SVG 1.1 Basic//EN",
    "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd",
  ],
  [
    "-//W3C//DTD SVG 1.1 Tiny//EN",
    "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd",
  ],
]);

/** Prologue scan noise (finding 9): comments and CDATA sections cannot
 * carry prologue attacks, so they are blanked before the ENTITY /
 * stylesheet-PI scan. A real declaration or PI still fails closed. */
function stripXmlNoise(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("<!--", cursor)) {
      const end = text.indexOf("-->", cursor + 4);
      cursor = end < 0 ? text.length : end + 3;
    } else if (text.startsWith("<![CDATA[", cursor)) {
      const end = text.indexOf("]]>", cursor + 9);
      cursor = end < 0 ? text.length : end + 3;
    } else {
      parts.push(text[cursor]);
      cursor++;
    }
  }
  return parts.join("");
}

function withoutExternalDtd(text: string): string {
  const starts = /<!DOCTYPE\b/gi;
  const parts: string[] = [];
  let cursor = 0;
  for (let match = starts.exec(text); match; match = starts.exec(text)) {
    // Explicit internal-subset detection: a `[` before the terminating `>`
    // opens an internal subset (entity declarations live there). The naive
    // first-`>` header extraction below already fail-closes on such input
    // (the `>` inside the subset truncates the header into a non-canonical
    // shape), but the `[` check runs first so the failure carries the
    // precise internal-subset reason instead of the generic one.
    const rest = text.slice(match.index);
    const gtPos = rest.indexOf(">");
    const bracketPos = rest.indexOf("[");
    if (bracketPos >= 0 && (gtPos < 0 || bracketPos < gtPos))
      security(
        "El SVG declara un DOCTYPE con subconjunto interno (DOCTYPE con subconjunto interno): las declaraciones internas pueden definir entidades XML.",
      );
    const end = text.indexOf(">", match.index + match[0].length);
    if (end < 0)
      security(
        "El SVG declara un DOCTYPE no estándar (DOCTYPE no estándar): solo se admiten referencias DTD SVG estándar del W3C.",
      );
    const header = text.slice(match.index, end + 1);
    if (header.includes("["))
      security(
        "El SVG declara un DOCTYPE con subconjunto interno (DOCTYPE con subconjunto interno): las declaraciones internas pueden definir entidades XML.",
      );
    let allowed = /^<!DOCTYPE\s+svg\s*>$/i.test(header);
    if (!allowed) {
      const pub =
        /^<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])([^"']*)\1\s+(["'])([^"']*)\3\s*>$/i.exec(
          header,
        );
      const sys = /^<!DOCTYPE\s+svg\s+SYSTEM\s+(["'])([^"']*)\1\s*>$/i.exec(
        header,
      );
      if (pub) {
        const systemId = KNOWN_SVG_DTD_PUBLIC_IDS.get(pub[2]);
        allowed = systemId !== undefined && systemId === pub[4];
      } else if (sys) {
        allowed = KNOWN_SVG_DTD_URLS.has(sys[2]);
      }
    }
    if (!allowed)
      security(
        "El SVG declara un DOCTYPE no estándar (DOCTYPE no estándar): solo se admiten referencias DTD SVG estándar del W3C.",
      );
    parts.push(text.slice(cursor, match.index), "<!DOCTYPE svg>");
    cursor = end + 1;
    starts.lastIndex = cursor;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/* ---------- Tree pruning ---------- */

interface Budget {
  count: number;
}

/* ---------- <style> element audit (fidelity finding 1) ----------
 * A <style> element survives only when its whole text is a sequence of CSS
 * rules with SIMPLE selectors (type, .class, #id, comma groups, descendant
 * and child combinators — no attributes, pseudos, universal selector or
 * sibling combinators) whose declarations all pass the STYLE_PROPERTIES
 * allowlist. Any @-rule, any url() (even local), expression()/behavior or
 * script scheme drops the element. Anything else → element dropped, file kept. */

function simpleSelectorGroupOk(selectorText: string): boolean {
  for (const group of selectorText.split(",")) {
    const token = group.trim();
    if (!token) return false;
    if (/>>/.test(token) || /^>/.test(token) || />$/.test(token)) return false;
    const parts = token.split(/\s*>\s*|\s+/).filter((part) => part.length > 0);
    if (!parts.length) return false;
    for (const part of parts) {
      if (
        !/^(?:[a-zA-Z][\w-]*|\.[a-zA-Z_-][\w-]*|#[a-zA-Z_-][\w-]*)+$/.test(part)
      )
        return false;
    }
  }
  return true;
}

function styleElementClean(text: string): boolean {
  if (!text.trim()) return true;
  const stripped = stripCommentsSafe(text);
  if (stripped === null) return false;
  const decoded = stripCommentsSafe(decodeCss(stripped));
  if (decoded === null) return false;
  if (/@/.test(decoded)) return false;
  if (/url\s*\(/i.test(decoded)) return false;
  if (!keptValueSafe(decoded)) return false;
  const chunks = decoded.split("}");
  const trailing = chunks.pop() ?? "";
  if (trailing.trim() !== "" || !chunks.length) return false;
  for (const chunk of chunks) {
    const brace = chunk.indexOf("{");
    if (brace < 0 || chunk.indexOf("{", brace + 1) >= 0) return false;
    if (!simpleSelectorGroupOk(chunk.slice(0, brace))) return false;
    for (const declaration of chunk.slice(brace + 1).split(";")) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(":");
      if (colon < 1) return false;
      const prop = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!value || !STYLE_PROPERTIES.has(prop)) return false;
      if (!keptValueSafe(value)) return false;
      const payload = decodedSafe(value);
      if (payload === null || /url\s*\(/i.test(payload)) return false;
    }
  }
  return true;
}

function scrubStyleAttribute(el: Element, attr: Attr): void {
  const kept: string[] = [];
  for (const part of attr.value.split(";")) {
    if (!part.trim()) continue;
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!value || !STYLE_PROPERTIES.has(prop)) continue;
    if (!keptValueSafe(value)) continue;
    if (!urlsAreLocal(value)) continue;
    kept.push(`${prop}:${value}`);
  }
  if (!kept.length) el.removeAttributeNode(attr);
  else attr.value = kept.join(";");
}

function scrubAttributes(el: Element): void {
  const elementName = (el.localName ?? "").toLowerCase();
  for (const attr of Array.from(el.attributes)) {
    const qualified = (attr.name ?? "").toLowerCase();
    const local = (attr.localName ?? "").toLowerCase();
    // Namespace declarations are identifiers, not active content — but a
    // hostile value (javascript:/vbscript:/data:text/html after decoding)
    // is stripped like any other attribute (F4).
    if (
      qualified === "xmlns" ||
      (attr.prefix ?? "").toLowerCase() === "xmlns"
    ) {
      if (!keptValueSafe(attr.value)) el.removeAttributeNode(attr);
      continue;
    }
    if (/^on/i.test(attr.localName ?? "")) {
      el.removeAttributeNode(attr);
      continue;
    }
    if (local === "href" || local === "src") {
      if (
        !resourceValueAllowed(elementName, attr.value) ||
        !keptValueSafe(attr.value)
      )
        el.removeAttributeNode(attr);
      continue;
    }
    if (qualified === "style") {
      scrubStyleAttribute(el, attr);
      continue;
    }
    if (!ATTRIBUTE_ALLOW.has(qualified)) {
      el.removeAttributeNode(attr);
      continue;
    }
    if (!keptValueSafe(attr.value)) {
      el.removeAttributeNode(attr);
      continue;
    }
    if (URL_ATTRIBUTES.has(qualified) && !urlsAreLocal(attr.value)) {
      el.removeAttributeNode(attr);
    }
  }
}

function imageResourceFailed(image: Element): boolean {
  for (const attr of Array.from(image.attributes)) {
    const local = (attr.localName ?? "").toLowerCase();
    if (local !== "href" && local !== "src") continue;
    if (
      !resourceValueAllowed("image", attr.value) ||
      !keptValueSafe(attr.value)
    )
      return true;
  }
  return false;
}

function pruneChildren(parent: Element, depth: number, budget: Budget): void {
  if (depth > LIMITS.MAX_DEPTH)
    fail("LIMIT", "El SVG excede la profundidad admitida.");
  for (let child = parent.firstChild; child;) {
    const next = child.nextSibling;
    if (child.nodeType === 8 || child.nodeType === 7) {
      parent.removeChild(child);
    } else if (child.nodeType === 3) {
      // Text: inert content, kept (script/style text dies with them).
    } else if (child.nodeType === 4) {
      // CDATA channel (F2): convert to a plain text node so the serializer
      // escapes it; no `<![CDATA[` may ever appear in sanitized output.
      const data = (child as CDATASection).data;
      parent.replaceChild(parent.ownerDocument.createTextNode(data), child);
    } else if (child.nodeType === 1) {
      budget.count += 1;
      if (budget.count > LIMITS.MAX_NODES)
        fail("LIMIT", "El SVG excede el límite de nodos.");
      pruneElement(parent, child as Element, depth, budget);
    } else {
      parent.removeChild(child);
    }
    child = next;
  }
}

function pruneElement(
  parent: Node,
  el: Element,
  depth: number,
  budget: Budget,
): void {
  budget.count += el.attributes.length;
  if (budget.count > LIMITS.MAX_NODES)
    fail("LIMIT", "El SVG excede el límite de nodos y atributos.");
  // Only SVG-namespace elements can render as vector content. Anything from
  // another namespace is dropped with its subtree (metadata never survives
  // long enough for this to matter for editor namespaces).
  if (el.namespaceURI !== SVG_NS) {
    parent.removeChild(el);
    return;
  }
  const name = (el.localName ?? "").toLowerCase();
  if (DENY_ELEMENTS.has(name) || name === "metadata") {
    parent.removeChild(el);
    return;
  }
  // Fidelity finding 1: <style> survives only under the strict audit.
  if (name === "style") {
    if (!styleElementClean(el.textContent ?? "")) {
      parent.removeChild(el);
      return;
    }
    scrubAttributes(el);
    pruneChildren(el, depth + 1, budget);
    return;
  }
  // Fidelity finding 2: every fe* primitive is kept; only feImage with a
  // non-conforming href/src is removed (same resource policy as <image>).
  if (name.startsWith("fe")) {
    if (name === "feimage" && imageResourceFailed(el)) {
      parent.removeChild(el);
      return;
    }
    scrubAttributes(el);
    pruneChildren(el, depth + 1, budget);
    return;
  }
  if (!ALLOW_ELEMENTS.has(name)) {
    // Unknown SVG-namespace container: sanitize children, then unwrap.
    pruneChildren(el, depth + 1, budget);
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }
  if (name === "image" && imageResourceFailed(el)) {
    parent.removeChild(el);
    return;
  }
  scrubAttributes(el);
  pruneChildren(el, depth + 1, budget);
}

/* ---------- Single sanitize pass: raw text -> serialized clean SVG ---------- */

function sanitizeOnce(text: string): string {
  if (typeof text !== "string" || !text.trim())
    fail("MALFORMED", "El archivo SVG está vacío.");
  if (
    text.length > LIMITS.MAX_FILE_BYTES ||
    new TextEncoder().encode(text).length > LIMITS.MAX_FILE_BYTES
  )
    fail("LIMIT", "El archivo SVG es demasiado grande.");
  // No XML expansion or external stylesheet processing, even in ignored data.
  // Each prologue cause carries its own precise internal reason (the UI
  // keeps mapping by code only): ENTITY declarations, xml-stylesheet PIs,
  // DOCTYPE internal subsets and non-standard DOCTYPEs are distinguished.
  // The DOCTYPE pass runs first so an internal subset (which textually
  // contains `<!ENTITY`) reports the explicit internal-subset reason
  // instead of the generic ENTITY one.
  const parseText = withoutExternalDtd(text);
  const noiseStripped = stripXmlNoise(parseText);
  if (/<!ENTITY\b/i.test(noiseStripped))
    security("El SVG declara entidades XML (ENTITY) y no puede admitirse.");
  if (/<\?xml-stylesheet\b/i.test(noiseStripped))
    security(
      "El SVG referencia una hoja de estilo XML (xml-stylesheet) y no puede admitirse.",
    );
  let tags = 0;
  for (const _ of parseText.matchAll(/<[A-Za-z_]/g)) {
    if (++tags > LIMITS.MAX_NODES)
      fail("LIMIT", "El SVG excede el trabajo admitido.");
  }
  const document = new DOMParser().parseFromString(parseText, "image/svg+xml");
  if (document.getElementsByTagName("parsererror").length)
    fail("MALFORMED", "El archivo SVG no es XML válido.");
  const root = document.documentElement;
  if (
    !root ||
    (root.localName ?? "").toLowerCase() !== "svg" ||
    root.namespaceURI !== SVG_NS
  )
    fail("MALFORMED", "El archivo no es un SVG válido.");
  const budget: Budget = { count: 1 + root.attributes.length };
  scrubAttributes(root);
  pruneChildren(root, 1, budget);
  if (!root.hasAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);
  const svg = new XMLSerializer().serializeToString(root);
  if (!svg.startsWith("<svg"))
    fail("TECHNICAL", "No pudimos procesar este SVG. Probá con otro archivo.");
  if (!svg.includes("xmlns"))
    fail("TECHNICAL", "No pudimos procesar este SVG. Probá con otro archivo.");
  return svg;
}

/* ---------- Derived placement fields ---------- */

const LENGTH_PATTERN =
  /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|in|cm|mm|q)?$/i;

function absoluteLength(raw: string): number | null {
  const match = LENGTH_PATTERN.exec(raw.trim());
  if (!match) return null;
  const factors: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
  };
  const value =
    Number(match[1]) * (factors[(match[2] ?? "").toLowerCase()] ?? 1);
  return Number.isFinite(value) ? value : null;
}

function parseViewBox(root: Element): SvgAssetViewBox | null {
  const raw = root.getAttribute("viewBox");
  if (raw === null) return null;
  const tokens = raw
    .trim()
    .split(/[\s,]+/)
    .filter((token) => token !== "");
  if (tokens.length !== 4) return null;
  const numbers = tokens.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [x, y, width, height] = numbers;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

function dimension(
  root: Element,
  name: string,
  viewBox: SvgAssetViewBox | null,
): number | null {
  const raw = root.getAttribute(name);
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.endsWith("%")) {
    // Percent extents scale the viewBox extent by the parsed percentage
    // (width="50%" over viewBox width 200 → 100). Unparsable percents,
    // and zero/negative results, yield null for that field.
    if (!viewBox) return null;
    const percent = Number(text.slice(0, -1).trim());
    if (!Number.isFinite(percent)) return null;
    const extent = name === "width" ? viewBox.width : viewBox.height;
    const value = (extent * percent) / 100;
    return value > 0 ? value : null;
  }
  const value = absoluteLength(text);
  if (value === null || !(value > 0)) return null;
  return value;
}

function deriveFields(svg: string): SvgAsset {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.getElementsByTagName("parsererror").length)
    fail("TECHNICAL", "No pudimos procesar este SVG. Probá con otro archivo.");
  const root = document.documentElement;
  const viewBox = parseViewBox(root);
  const width = dimension(root, "width", viewBox);
  const height = dimension(root, "height", viewBox);
  if (width === null && height === null && viewBox === null)
    fail("TECHNICAL", "El SVG no trae tamaño ni viewBox para ubicarlo.");
  return { svg, width, height, viewBox };
}

/* ---------- Public API ---------- */

export function importSvgAsset(text: string): SvgAssetImportOutcome {
  try {
    const first = sanitizeOnce(text);
    const second = sanitizeOnce(first);
    let svg = first;
    if (second !== first) {
      const third = sanitizeOnce(second);
      if (third !== second)
        fail(
          "TECHNICAL",
          "No pudimos procesar este SVG. Probá con otro archivo.",
        );
      svg = second;
    }
    return { ok: true, asset: deriveFields(svg) };
  } catch (error) {
    if (error instanceof ImportFailure)
      return { ok: false, code: error.code, reason: error.message };
    return {
      ok: false,
      code: "TECHNICAL",
      reason: "No pudimos procesar este SVG. Probá con otro archivo.",
    };
  }
}

/** Repository read-validation (finding 11): shape check → full re-parse +
 * re-sanitize → stable fixed point → derived-field consistency. Byte
 * identity with the stored string is NOT required (cross-engine lockout
 * fix): safety comes from re-sanitization, and the returned asset is the
 * canonical re-sanitized document for callers to render. */
export function sanitizeStoredSvgAsset(asset: unknown): SvgAsset | null {
  try {
    if (typeof asset !== "object" || asset === null || Array.isArray(asset))
      return null;
    const record = asset as Record<string, unknown>;
    if (typeof record.svg !== "string") return null;
    const stored = record.svg;
    if (!stored.trim()) return null;
    if (
      stored.length > LIMITS.MAX_FILE_BYTES ||
      new TextEncoder().encode(stored).length > LIMITS.MAX_FILE_BYTES
    )
      return null;
    const first = sanitizeOnce(stored);
    const second = sanitizeOnce(first);
    let canonical = first;
    if (second !== first) {
      if (sanitizeOnce(second) !== second) return null;
      canonical = second;
    }
    const fresh = deriveFields(canonical);
    if (record.width !== fresh.width || record.height !== fresh.height)
      return null;
    const claimed = record.viewBox as SvgAssetViewBox | null;
    if (fresh.viewBox === null || claimed === null) {
      if (fresh.viewBox !== claimed) return null;
    } else if (
      typeof claimed !== "object" ||
      claimed.x !== fresh.viewBox.x ||
      claimed.y !== fresh.viewBox.y ||
      claimed.width !== fresh.viewBox.width ||
      claimed.height !== fresh.viewBox.height
    ) {
      return null;
    }
    return fresh;
  } catch {
    return null;
  }
}
