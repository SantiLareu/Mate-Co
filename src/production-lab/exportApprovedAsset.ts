/**
 * E2 approved-asset DOM module (Stage 3 S4). Browser-only: DOMParser +
 * XMLSerializer. ISOLATED: the pure core (exportSvg.ts) never imports this
 * module; callers (ProductionLab UI) scan + embed first and hand the core
 * plain strings + flags. No Date/random/Blob/network here (the download
 * helper lives lab-local in the UI). Same input -> byte-identical output:
 * traversal is document order and XMLSerializer is deterministic per tree.
 *
 * Scan semantics decision (fail-closed, exact per E1 contract):
 * - hasRaster: an <image>/<feImage> whose href/src (or xlink:href) is a
 *   raster data:image payload (png/jpeg/jpg/gif/webp/bmp/avif) or an
 *   http(s)/protocol-relative external URL. Rationale: vector export never
 *   converts approved art to PNG/JPEG/canvas, and external bytes are
 *   unverifiable offline. (The sanitizer already strips non-local hrefs,
 *   but the scan re-checks the exact string being embedded: defense in
 *   depth, never trust-by-pipeline.)
 * - hasUnsupportedFeature: any <filter> element, or any fe* primitive OTHER
 *   than feImage (feGaussianBlur, feOffset, ...). Rationale: filter
 *   pipelines are pixel effects, not engraving geometry, and cannot be
 *   verified resolvable; feImage is an image source so it follows the
 *   raster rule instead. An http(s)/protocol-relative href/src on a
 *   NON-image element is likewise unsupported (external ref, unverifiable).
 * - KEEP (namespaced + verified resolvable): linearGradient/radialGradient/
 *   stop, clipPath, mask, pattern, marker, use, and <style> blocks with
 *   simple class/id selectors. Rationale: pure vector referencing with
 *   sanitizer-enforced local-only refs; per-instance id prefixing removes
 *   cross-asset collisions and the post-rewrite dangling check proves every
 *   url(#ref) and href="#ref" resolves inside its own asset. Per the task
 *   rule (enumerate-and-block when uncertain): these constructs are certain
 *   — refs are local, closed over the asset tree, mechanically verifiable —
 *   while filters are blocked for the documented reason above.
 * - hasText: any <text>/<tspan>/<textPath> element, any font-family
 *   attribute, any style="...font-family..." value, or any <style> block
 *   mentioning font-family. Same fonts-block-gate (L2) as report texts: no
 *   outlines exist, no substitution, never silent.
 * - hasUnsupportedFeature (E3 preview parity): a root preserveAspectRatio
 *   present but not xMidYMid-meet (none/slice/off-center meets), or a root
 *   transform attribute. Rationale: the preview renders v3 through
 *   <image preserveAspectRatio="xMidYMid meet"> with no root transform,
 *   so either survivor would diverge from the preview; both fail closed
 *   (UNSUPPORTED_ASSET_FEATURE via the core) instead of being stripped
 *   or reinterpreted silently. xMidYMid-meet and absent stay allowed.
 * - Unparseable input fails closed as unsupported (never scans clean).
 *
 * Embedding guarantees (embedApprovedAsset):
 * - DOM-based rewrite, never regex on markup: ids are remapped through the
 *   parsed tree (id, href/src/xlink:href, url(#) paint/server refs,
 *   style="" values, <style> selectors + bodies, class attributes +
 *   class selectors) with the prefix `lab-x-<placedId>-`.
 * - Returns the standalone nested <svg> element string, centered on its
 *   fit-64 display box (x/y = -w/2/-h/2, mirroring approvedDisplaySize +
 *   APPROVED_ART_SIZE exactly). Its own viewBox is kept verbatim when
 *   present; when absent or malformed it is SYNTHESIZED as
 *   "0 0 <displayW> <displayH>" from the same rootSourceBox-derived fit
 *   dimensions (E3, documented mirror of approvedDisplaySize logic): a
 *   width/height-only asset has no intrinsic user space, so without
 *   synthesis the nested svg would lay its source units (e.g. 300x225)
 *   inside the 64x48 fit box (oversize + clipping vs the preview
 *   <image>). Synthesis makes nested user space == fit box. The caller nests it inside the
 *   <g transform=translate/rotate/scale> pose wrapper at placed size
 *   (v3 display box source units x localScale, exactly like the
 *   PhysicalApproved/image box), so pose math stays single-sourced.
 * - Blocks (never degrades) on: parse errors, non-default root
 *   preserveAspectRatio (anything but absent/xMidYMid-meet) or a root
 *   transform attribute (E3 preview parity), non-local url() targets,
 *   data:/external hrefs, dangling url(#ref)/href="#ref" after rewrite,
 *   and <style> rules with bare type selectors (e.g. `rect{...}`), which
 *   would bleed paint document-wide after inlining and therefore cannot be
 *   namespaced safely. Class attributes are prefixed together with their
 *   selectors as anti-collision hardening (same reason as ids).
 */
import { APPROVED_ART_SIZE } from "../approved-designs/approvedDesign";
import type { LabExportAssetFlags } from "./types";

export type ApprovedEmbedResult =
  { ok: true; svg: string } | { ok: false; reason: string };

const SVG_MIME = "image/svg+xml";
const SVG_NS = "http://www.w3.org/2000/svg";

const RASTER_SUBTYPES = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

/** Attribute names (local, lowercased) carrying url() paint/server refs. */
const URL_ATTRIBUTES = [
  "fill",
  "stroke",
  "clip-path",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "marker",
];

const isSpace = (char: string): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r" ||
  char === "\f";

const isFragChar = (char: string): boolean =>
  (char >= "A" && char <= "Z") ||
  (char >= "a" && char <= "z") ||
  (char >= "0" && char <= "9") ||
  char === "-" ||
  char === "_" ||
  char === "." ||
  char === ":";

const lowerTag = (el: Element): string =>
  (el.localName ?? el.tagName ?? "").toLowerCase();

function parseSvgDocument(svg: string): Document | null {
  const document = new DOMParser().parseFromString(svg, SVG_MIME);
  if (document.getElementsByTagName("parsererror").length > 0) return null;
  const root = document.documentElement;
  if (!root || lowerTag(root) !== "svg") return null;
  return document;
}

function allElements(document: Document): Element[] {
  return Array.from(document.getElementsByTagName("*"));
}

function hrefValue(el: Element): string | null {
  for (const attr of Array.from(el.attributes)) {
    const local = (attr.localName ?? "").toLowerCase();
    if (local === "href" || local === "src") return attr.value;
  }
  return null;
}

function trimmedLower(value: string): string {
  return value.trim().toLowerCase();
}

function isExternalUrl(value: string): boolean {
  const text = trimmedLower(value);
  return (
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("//")
  );
}

function isRasterDataUri(value: string): boolean {
  const text = trimmedLower(value);
  const prefix = "data:image/";
  if (!text.startsWith(prefix)) return false;
  const rest = text.slice(prefix.length);
  let end = rest.length;
  const semi = rest.indexOf(";");
  const comma = rest.indexOf(",");
  if (semi >= 0 && semi < end) end = semi;
  if (comma >= 0 && comma < end) end = comma;
  const subtype = rest.slice(0, end);
  for (const known of RASTER_SUBTYPES) {
    if (subtype === known) return true;
  }
  return false;
}

/**
 * Fail-closed scan of one approved v3 asset string. Never throws: garbage
 * in -> unsupported out.
 */
export function scanApprovedAssetFlags(svg: string): LabExportAssetFlags {
  const flags: LabExportAssetFlags = {
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  };
  let document: Document | null = null;
  try {
    document = typeof svg === "string" ? parseSvgDocument(svg) : null;
  } catch {
    document = null;
  }
  if (!document) {
    flags.hasUnsupportedFeature = true;
    return flags;
  }
  // E3 preview parity (fail-closed): the preview renders v3 through
  // <image preserveAspectRatio="xMidYMid meet"> with no root transform.
  // getElementsByTagName("*") skips the root itself, so it is checked
  // directly here (and again in embedApprovedAsset for direct callers).
  if (
    hasNonDefaultRootPar(document.documentElement) ||
    document.documentElement.hasAttribute("transform")
  ) {
    flags.hasUnsupportedFeature = true;
  }
  for (const el of allElements(document)) {
    const tag = lowerTag(el);
    if (tag === "text" || tag === "tspan" || tag === "textpath") {
      flags.hasText = true;
    }
    if (el.hasAttribute("font-family")) {
      flags.hasText = true;
    }
    const styleAttr = el.getAttribute("style");
    if (
      styleAttr !== null &&
      styleAttr.toLowerCase().indexOf("font-family") >= 0
    ) {
      flags.hasText = true;
    }
    if (
      tag === "style" &&
      (el.textContent ?? "").toLowerCase().indexOf("font-family") >= 0
    ) {
      flags.hasText = true;
    }
    if (tag === "filter") {
      flags.hasUnsupportedFeature = true;
    } else if (tag.length > 2 && tag.startsWith("fe") && tag !== "feimage") {
      flags.hasUnsupportedFeature = true;
    }
    const href = hrefValue(el);
    if (href !== null) {
      const isImage = tag === "image" || tag === "feimage";
      if (isImage && (isRasterDataUri(href) || isExternalUrl(href))) {
        flags.hasRaster = true;
      } else if (!isImage && isExternalUrl(href)) {
        flags.hasUnsupportedFeature = true;
      }
    }
  }
  return flags;
}

/** E3 preview-parity helper: root preserveAspectRatio present but not
 * the preview default (absent or xMidYMid-meet, whitespace/case
 * tolerant). Anything else (none/slice/off-center) diverges from the
 * preview <image> and fails closed. */
function hasNonDefaultRootPar(root: Element): boolean {
  const raw = root.getAttribute("preserveAspectRatio");
  if (raw === null) return false;
  return (
    splitWhitespace(raw.trim()).join(" ").toLowerCase() !== "xmidymid meet"
  );
}

/** Collect `#fragment` targets of every url(#...) occurrence (DOM values). */
function collectUrlRefs(value: string, out: string[]): boolean {
  const lower = value.toLowerCase();
  let cursor = 0;
  while (cursor < value.length) {
    const at = lower.indexOf("url(", cursor);
    if (at < 0) return true;
    let index = at + 4;
    while (index < value.length && isSpace(value[index])) index += 1;
    const quote = value[index];
    const quoted = quote === '"' || quote === "'";
    if (quoted) index += 1;
    if (value[index] !== "#") return false;
    let end = index + 1;
    while (end < value.length && isFragChar(value[end])) end += 1;
    if (end === index + 1) return false;
    out.push(value.slice(index + 1, end));
    cursor = at + 4;
  }
  return true;
}

/** Rewrite url(#old) -> url(#new) for known olds (no regex on markup). */
function rewriteUrlValues(
  value: string,
  idMap: ReadonlyMap<string, string>,
): { text: string; ok: boolean } {
  const lower = value.toLowerCase();
  let cursor = 0;
  let out = "";
  while (cursor < value.length) {
    const at = lower.indexOf("url(", cursor);
    if (at < 0) {
      out += value.slice(cursor);
      return { text: out, ok: true };
    }
    let index = at + 4;
    while (index < value.length && isSpace(value[index])) index += 1;
    const quote = value[index];
    const quoted = quote === '"' || quote === "'";
    if (quoted) index += 1;
    if (value[index] !== "#") return { text: value, ok: false };
    let end = index + 1;
    while (end < value.length && isFragChar(value[end])) end += 1;
    const old = value.slice(index + 1, end);
    const renamed = idMap.get(old);
    if (renamed === undefined) return { text: value, ok: false };
    out += value.slice(cursor, index + 1) + renamed;
    cursor = end;
  }
  return { text: out, ok: true };
}

/** Rewrite `#old` id selectors inside ONE selector group (comma-safe). */
function rewriteSelectorGroup(
  group: string,
  idMap: ReadonlyMap<string, string>,
  classMap: ReadonlyMap<string, string>,
): string {
  let out = "";
  let cursor = 0;
  while (cursor < group.length) {
    const char = group[cursor];
    if (char !== "#" && char !== ".") {
      out += char;
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < group.length && isFragChar(group[end])) end += 1;
    const name = group.slice(cursor + 1, end);
    const renamed =
      char === "#" ? (idMap.get(name) ?? null) : (classMap.get(name) ?? null);
    if (renamed === null) {
      out += group.slice(cursor, end);
    } else {
      out += char + renamed;
    }
    cursor = end;
  }
  return out;
}

const isWhitespace = (char: string): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r" ||
  char === "\f";

/** Split on ASCII whitespace runs (no regex anywhere in this module). */
function splitWhitespace(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current !== "") tokens.push(current);
    current = "";
  };
  for (const char of value) {
    if (isWhitespace(char)) flush();
    else current += char;
  }
  flush();
  return tokens;
}

const failEmbed = (reason: string): ApprovedEmbedResult => ({
  ok: false,
  reason,
});

function roundExport(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  const snapped = rounded === 0 ? 0 : rounded;
  return String(snapped);
}

/**
 * Mirror of approvedDesign.sourceBox + APPROVED_ART_SIZE fit, computed from
 * the parsed root (width/height with CSS absolute units or percents over
 * the viewBox, else viewBox, else 1x1). Documented mirror: the same numbers
 * approvedDisplaySize(snapshot) yields for the stored width/height/viewBox.
 */
function rootSourceBox(root: Element): { width: number; height: number } {
  const viewBox = parseViewBoxAttr(root.getAttribute("viewBox"));
  const width = parseLengthAttr(root.getAttribute("width"), viewBox, "width");
  const height = parseLengthAttr(
    root.getAttribute("height"),
    viewBox,
    "height",
  );
  const w =
    (width ?? viewBox?.width ?? 0) > 0 ? (width ?? viewBox?.width ?? 0) : 0;
  const h =
    (height ?? viewBox?.height ?? 0) > 0 ? (height ?? viewBox?.height ?? 0) : 0;
  if (w > 0 && h > 0) return { width: w, height: h };
  return { width: 1, height: 1 };
}

function parseViewBoxAttr(
  raw: string | null,
): { x: number; y: number; width: number; height: number } | null {
  if (raw === null) return null;
  const tokens: string[] = [];
  let current = "";
  for (const char of raw) {
    if (char === "," || isSpace(char)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") tokens.push(current);
  if (tokens.length !== 4) return null;
  const numbers = tokens.map((token) => Number(token));
  if (!numbers.every((value) => Number.isFinite(value))) return null;
  const [x, y, width, height] = numbers;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

function unitFactor(unit: string): number | null {
  switch (unit) {
    case "":
    case "px":
      return 1;
    case "pt":
      return 96 / 72;
    case "pc":
      return 16;
    case "in":
      return 96;
    case "cm":
      return 96 / 2.54;
    case "mm":
      return 96 / 25.4;
    case "q":
      return 96 / 101.6;
    default:
      return null;
  }
}

function parseLengthAttr(
  raw: string | null,
  viewBox: { width: number; height: number } | null,
  dimension: "width" | "height",
): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  if (text.endsWith("%")) {
    if (!viewBox) return null;
    const percent = Number(text.slice(0, -1).trim());
    if (!Number.isFinite(percent)) return null;
    const value =
      ((dimension === "width" ? viewBox.width : viewBox.height) * percent) /
      100;
    return value > 0 ? value : null;
  }
  let split = 0;
  while (
    split < text.length &&
    ((text[split] >= "0" && text[split] <= "9") ||
      text[split] === "." ||
      text[split] === "+" ||
      text[split] === "-" ||
      text[split] === "e" ||
      text[split] === "E")
  ) {
    split += 1;
  }
  const factor = unitFactor(text.slice(split).trim().toLowerCase());
  if (factor === null) return null;
  const value = Number(text.slice(0, split)) * factor;
  if (!Number.isFinite(value) || !(value > 0)) return null;
  return value;
}

/**
 * Inline one approved v3 asset string for nesting under the pose wrapper.
 * Never throws for content reasons: every content problem is ok:false.
 */
export function embedApprovedAsset(
  svg: string,
  placedId: string,
): ApprovedEmbedResult {
  let document: Document | null = null;
  try {
    document = typeof svg === "string" ? parseSvgDocument(svg) : null;
  } catch {
    document = null;
  }
  if (!document || !document.documentElement) {
    return failEmbed(
      "Diseño aprobado no integrable: el SVG no pudo parsearse (bloqueo fail-closed).",
    );
  }
  const root = document.documentElement;
  const prefix = "lab-x-" + placedId + "-";

  // E3 preview parity (fail-closed, mirrors the scan): a surviving root
  // preserveAspectRatio/transform would diverge from the preview <image>.
  if (hasNonDefaultRootPar(root) || root.hasAttribute("transform")) {
    return failEmbed(
      "Diseño aprobado no integrable: preserveAspectRatio de raíz no estándar o transform en la raíz: " +
        "la vista previa usa xMidYMid meet sin transform y el inline debe coincidir (bloqueo fail-closed).",
    );
  }

  const idMap = new Map<string, string>();
  for (const el of allElements(document)) {
    const id = el.getAttribute("id");
    if (id !== null && !idMap.has(id)) idMap.set(id, prefix + id);
  }
  const classMap = new Map<string, string>();
  for (const el of allElements(document)) {
    const classes = el.getAttribute("class");
    if (classes === null) continue;
    for (const token of splitWhitespace(classes)) {
      if (!classMap.has(token)) {
        classMap.set(token, prefix + token);
      }
    }
  }

  // Rewrite pass: ids, classes, href/src, url() refs, style + <style>.
  for (const el of allElements(document)) {
    const id = el.getAttribute("id");
    if (id !== null) {
      const renamed = idMap.get(id);
      if (renamed === undefined) {
        return failEmbed(
          "Diseño aprobado no integrable: id interno inconsistente (bloqueo fail-closed).",
        );
      }
      el.setAttribute("id", renamed);
    }
    const classes = el.getAttribute("class");
    if (classes !== null) {
      const renamed = splitWhitespace(classes)
        .map((token) => classMap.get(token) ?? token)
        .join(" ");
      el.setAttribute("class", renamed);
    }
    for (const attr of Array.from(el.attributes)) {
      const local = (attr.localName ?? "").toLowerCase();
      const qualified = (attr.name ?? "").toLowerCase();
      if (local === "href" || local === "src") {
        const value = attr.value.trim();
        if (value === "") continue;
        if (value.startsWith("#")) {
          const renamed = idMap.get(value.slice(1));
          if (renamed === undefined) {
            return failEmbed(
              "Diseño aprobado no integrable: referencia «" +
                value +
                "» sin destino (referencia colgante; bloqueo fail-closed).",
            );
          }
          attr.value = "#" + renamed;
        } else {
          // data: payloads and external URLs never inline: the scan must
          // have blocked them first; a survivor still fails closed here.
          return failEmbed(
            "Diseño aprobado no integrable: href/src no local («" +
              value.slice(0, 48) +
              "»); solo referencias locales #fragmento (bloqueo fail-closed).",
          );
        }
        continue;
      }
      if (URL_ATTRIBUTES.indexOf(local) >= 0 || qualified === "style") {
        const rewritten = rewriteUrlValues(attr.value, idMap);
        if (!rewritten.ok) {
          return failEmbed(
            "Diseño aprobado no integrable: referencia url() no local o sin destino " +
              "en «" +
              qualified +
              "» (referencia colgante; bloqueo fail-closed).",
          );
        }
        attr.value = rewritten.text;
      }
    }
    if (lowerTag(el) === "style") {
      const rewritten = rewriteStyleElement(
        el.textContent ?? "",
        idMap,
        classMap,
      );
      if (!rewritten.ok) return failEmbed(rewritten.reason);
      el.textContent = rewritten.text;
    }
  }

  // Post-rewrite dangling cross-check: every url(#ref)/href="#ref" resolves.
  const defined = new Set<string>();
  for (const el of allElements(document)) {
    const id = el.getAttribute("id");
    if (id !== null) defined.add(id);
  }
  const refs: string[] = [];
  for (const el of allElements(document)) {
    for (const attr of Array.from(el.attributes)) {
      const local = (attr.localName ?? "").toLowerCase();
      const qualified = (attr.name ?? "").toLowerCase();
      if (local === "href" || local === "src") {
        const value = attr.value.trim();
        if (value.startsWith("#")) refs.push(value.slice(1));
      } else if (URL_ATTRIBUTES.indexOf(local) >= 0 || qualified === "style") {
        if (!collectUrlRefs(attr.value, refs)) {
          return failEmbed(
            "Diseño aprobado no integrable: url() no verificable tras la reescritura " +
              "(bloqueo fail-closed).",
          );
        }
      }
    }
    if (lowerTag(el) === "style") {
      if (!collectUrlRefs(el.textContent ?? "", refs)) {
        return failEmbed(
          "Diseño aprobado no integrable: url() no verificable en <style> " +
            "(bloqueo fail-closed).",
        );
      }
    }
  }
  for (const ref of refs) {
    if (!defined.has(ref)) {
      return failEmbed(
        "Diseño aprobado no integrable: referencia «#" +
          ref +
          "» sin destino tras la reescritura (referencia colgante; bloqueo fail-closed).",
      );
    }
  }

  // Centered fit-64 display box. Own viewBox kept verbatim when valid;
  // otherwise synthesized from the same rootSourceBox-derived fit
  // dimensions (E3: nested user space == fit box, never 300x225 source
  // units inside a 64x48 box).
  const box = rootSourceBox(root);
  const fit = APPROVED_ART_SIZE / Math.max(box.width, box.height);
  const displayWidth = box.width * fit;
  const displayHeight = box.height * fit;
  root.setAttribute("x", roundExport(-displayWidth / 2));
  root.setAttribute("y", roundExport(-displayHeight / 2));
  root.setAttribute("width", roundExport(displayWidth));
  root.setAttribute("height", roundExport(displayHeight));
  if (parseViewBoxAttr(root.getAttribute("viewBox")) === null) {
    root.setAttribute(
      "viewBox",
      "0 0 " + roundExport(displayWidth) + " " + roundExport(displayHeight),
    );
  }
  if (!root.hasAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);

  let serialized: string;
  try {
    serialized = new XMLSerializer().serializeToString(root);
  } catch {
    return failEmbed(
      "Diseño aprobado no integrable: no se pudo serializar el SVG (bloqueo fail-closed).",
    );
  }
  return { ok: true, svg: serialized };
}

/**
 * Rewrite one <style> element: bodies get url(#) rewrites, selector groups
 * get #id/.class rewrites. Any bare type-selector compound (a compound with
 * no `#`/` in it) fails closed: after inlining it would paint every
 * same-named element of the whole export file, which no prefixing can scope.
 */
function rewriteStyleElement(
  text: string,
  idMap: ReadonlyMap<string, string>,
  classMap: ReadonlyMap<string, string>,
): { ok: true; text: string } | { ok: false; reason: string } {
  const blockReason =
    "Diseño aprobado no integrable: <style> con selector de tipo desnudo " +
    "(p. ej. `rect{...}`), que pintaría todo el archivo tras el inline; " +
    "no admite namespacing seguro (bloqueo fail-closed).";
  let out = "";
  let rest = text;
  for (;;) {
    const open = rest.indexOf("{");
    if (open < 0) {
      if (rest.trim() !== "") {
        return {
          ok: false,
          reason:
            "Diseño aprobado no integrable: <style> con forma inesperada " +
            "(bloqueo fail-closed).",
        };
      }
      return { ok: true, text: out + rest };
    }
    const close = rest.indexOf("}", open + 1);
    if (close < 0) {
      return {
        ok: false,
        reason:
          "Diseño aprobado no integrable: <style> con forma inesperada " +
          "(bloqueo fail-closed).",
      };
    }
    const selector = rest.slice(0, open);
    const body = rest.slice(open + 1, close);
    for (const group of selector.split(",")) {
      const compounds = splitCompounds(group);
      if (compounds.length === 0) return { ok: false, reason: blockReason };
      for (const compound of compounds) {
        if (compound.indexOf("#") < 0 && compound.indexOf(".") < 0) {
          return { ok: false, reason: blockReason };
        }
      }
    }
    const rewrittenSelector = rewriteSelectorGroupFlat(
      selector,
      idMap,
      classMap,
    );
    const rewrittenBody = rewriteUrlValues(body, idMap);
    if (!rewrittenBody.ok) {
      return {
        ok: false,
        reason:
          "Diseño aprobado no integrable: referencia url() no local o sin destino " +
          "en <style> (referencia colgante; bloqueo fail-closed).",
      };
    }
    out += rewrittenSelector + "{" + rewrittenBody.text + "}";
    rest = rest.slice(close + 1);
  }
}

/** Split one selector group into compounds on whitespace/`>` (no regex). */
function splitCompounds(group: string): string[] {
  const compounds: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current !== "") compounds.push(current);
    current = "";
  };
  for (const char of group) {
    if (char === ">" || isSpace(char)) flush();
    else current += char;
  }
  flush();
  return compounds;
}

/** Rewrite every #id/.class token of a full selector list (no regex). */
function rewriteSelectorGroupFlat(
  selector: string,
  idMap: ReadonlyMap<string, string>,
  classMap: ReadonlyMap<string, string>,
): string {
  return selector
    .split(",")
    .map((group) => rewriteSelectorGroup(group, idMap, classMap))
    .join(",");
}
