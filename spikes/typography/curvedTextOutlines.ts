/**
 * Typography spike (Stage 4): curved text -> real glyph outlines as SVG paths
 * in millimetres. ISOLATED: not imported by the customizer, admin, snapshots
 * or the productive exporter. Pure and DOM-free (font bytes are supplied by
 * the caller). No rasterization, no <text>, no font substitution.
 *
 * Geometry mirrors the editor's CurvedText (and the lab's PhysicalComposition)
 * <textPath> model so editor / lab / SVG can be compared glyph by glyph:
 *  - angle 0 = TOP, clockwise, y down, centre (0,0) in mm.
 *  - text centred on the arc (text-anchor middle, startOffset 50%): the arc
 *    coordinate s is measured from the text centre.
 *  - each glyph is a rigid body whose advance MIDPOINT sits on the baseline
 *    circle (browser textPath semantics), rotated to the tangent there.
 *  - normal text: clockwise progression, glyph tops point outwards.
 *    inverted: counter-clockwise progression, glyph tops point inwards, and a
 *    local dy (outwards) is applied exactly like the editor's dy.
 *  - letter-spacing is added after every glyph (trailing one included in the
 *    anchoring length, as the browser does).
 */
import opentype, { type Font, type Glyph } from "opentype.js";
import { readGposKerning, type KerningSource } from "./gposKerning";

export type FontHandle = {
  font: Font;
  unitsPerEm: number;
  /** Provenance echoed into the SVG so the file names its font. */
  postScriptName: string;
  version: string;
  /** Pair kerning in font units (GPOS reader, never opentype.js's). */
  kern: (leftGlyph: number, rightGlyph: number) => number;
  kerningSource: KerningSource;
};

export type FontLoadResult =
  | { ok: true; handle: FontHandle }
  | { ok: false; code: "KERNING_UNSUPPORTED"; reason: string };

/** Fails closed when the font's kerning cannot be reproduced faithfully. */
export function loadFontChecked(buffer: ArrayBuffer): FontLoadResult {
  const kerning = readGposKerning(buffer);
  if (!kerning.ok) return kerning;
  const font = opentype.parse(buffer);
  // opentype.js 2.x groups name records by platform ("windows", "macintosh"…).
  type NameTable = Record<string, Record<string, Record<string, string>>>;
  const names = font.names as unknown as NameTable;
  const pick = (key: string): string => {
    for (const platform of ["windows", "macintosh", "unicode"]) {
      const entry = names[platform]?.[key];
      if (entry) return entry.en ?? Object.values(entry)[0] ?? "";
    }
    return "";
  };
  return {
    ok: true,
    handle: {
      font,
      unitsPerEm: font.unitsPerEm,
      postScriptName: pick("postScriptName"),
      version: pick("version"),
      kern: kerning.kern,
      kerningSource: kerning.source,
    },
  };
}

export function loadFontFromBuffer(buffer: ArrayBuffer): FontHandle {
  const result = loadFontChecked(buffer);
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
  return result.handle;
}

export type CurvedTextRequest = {
  text: string;
  fontSizeMm: number;
  letterSpacingMm: number;
  /** Baseline circle radius (PlacedText.baselineRadiusMm). */
  baselineRadiusMm: number;
  /** Element angle: 0 = top, clockwise degrees. */
  angleDegrees: number;
  inverted: boolean;
  /** PlacedText.invertedDyMm (outward shift of the glyph baseline), or 0. */
  invertedDyMm: number;
};

export type LaidOutGlyph = {
  char: string;
  glyphIndex: number;
  /** Own advance, mm (no kerning, no letter-spacing). */
  advanceMm: number;
  /** Kerning applied BEFORE this glyph (mm, usually <= 0). */
  kernMm: number;
  /** Arc coordinate of the glyph advance midpoint, from the text centre (mm). */
  sMidMm: number;
  /** Advance midpoint on the baseline circle, mm, centre (0,0). */
  mid: { x: number; y: number };
  /** Glyph origin (pen position on the baseline, pre-dy), mm. */
  origin: { x: number; y: number };
  /** Rotation of the glyph x axis, degrees (clockwise, y down). */
  rotationDegrees: number;
};

export type LayoutError =
  | { ok: false; code: "GLYPH_MISSING"; chars: string[]; reason: string }
  | { ok: false; code: "TEXT_NOT_NFC"; reason: string }
  | { ok: false; code: "INVALID_INPUT"; reason: string };

export type CurvedTextLayout = {
  ok: true;
  glyphs: LaidOutGlyph[];
  /** Σ(advance + kern + letterSpacing): the length the arc is centred on. */
  totalAdvanceMm: number;
  /** Total angular extent of the advance run, degrees. */
  spanDegrees: number;
};

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function layoutCurvedText(
  handle: FontHandle,
  req: CurvedTextRequest,
): CurvedTextLayout | LayoutError {
  if (
    !finite(req.fontSizeMm) ||
    req.fontSizeMm <= 0 ||
    !finite(req.letterSpacingMm) ||
    !finite(req.baselineRadiusMm) ||
    req.baselineRadiusMm <= 0 ||
    !finite(req.angleDegrees) ||
    !finite(req.invertedDyMm)
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "Medidas de texto no finitas o radio base no positivo.",
    };
  }
  // Never rewrite the user's text silently: decomposed sequences would need
  // mark positioning that this spike does not implement.
  if (req.text.normalize("NFC") !== req.text) {
    return {
      ok: false,
      code: "TEXT_NOT_NFC",
      reason:
        "El texto no está en forma NFC; no se normaliza en silencio (sin posicionamiento de marcas combinantes).",
    };
  }
  const chars = Array.from(req.text);
  const missing = chars.filter((c) => handle.font.charToGlyphIndex(c) === 0);
  if (missing.length > 0) {
    return {
      ok: false,
      code: "GLYPH_MISSING",
      chars: Array.from(new Set(missing)),
      reason: `La fuente no tiene glifo para: ${Array.from(new Set(missing)).join(" ")} (sin sustitución).`,
    };
  }

  const k = req.fontSizeMm / handle.unitsPerEm;
  const glyphs = chars.map((c) =>
    handle.font.glyphs.get(handle.font.charToGlyphIndex(c)),
  );
  const advances = glyphs.map((g) => (g.advanceWidth ?? 0) * k);
  const kerns = glyphs.map((g, i) =>
    i === 0 ? 0 : handle.kern(glyphs[i - 1].index, g.index) * k,
  );

  let total = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    total += kerns[i] + advances[i] + req.letterSpacingMm;
  }

  const dir = req.inverted ? -1 : 1;
  const out: LaidOutGlyph[] = [];
  let pen = -total / 2; // arc coordinate of the next glyph origin
  for (let i = 0; i < glyphs.length; i += 1) {
    pen += kerns[i];
    const sMid = pen + advances[i] / 2;
    const theta = toRad(req.angleDegrees) + (dir * sMid) / req.baselineRadiusMm;
    const point = (s: number) => {
      const t = toRad(req.angleDegrees) + (dir * s) / req.baselineRadiusMm;
      return {
        x: req.baselineRadiusMm * Math.sin(t),
        y: -req.baselineRadiusMm * Math.cos(t),
      };
    };
    // The origin is reported along the glyph's own (rotated) x axis, so it is
    // comparable with the browser's per-character start position.
    const rotation = (theta * 180) / Math.PI + (req.inverted ? 180 : 0);
    const mid = point(sMid);
    const r = toRad(rotation);
    out.push({
      char: chars[i],
      glyphIndex: glyphs[i].index,
      advanceMm: advances[i],
      kernMm: kerns[i],
      sMidMm: sMid,
      mid,
      origin: {
        x: mid.x - (advances[i] / 2) * Math.cos(r),
        y: mid.y - (advances[i] / 2) * Math.sin(r),
      },
      rotationDegrees: rotation,
    });
    pen += advances[i] + req.letterSpacingMm;
  }

  return {
    ok: true,
    glyphs: out,
    totalAdvanceMm: total,
    spanDegrees: (total / req.baselineRadiusMm) * (180 / Math.PI),
  };
}

/** Canonical mm serialisation: 3 decimals (1 µm), no "-0", no exponent. */
export function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Absolute path data (mm) of one laid-out glyph: font-unit outline mapped by
 * a rigid transform (scale, flip, dy, rotation, translation). Every command
 * point is transformed individually, so curves stay exact quadratics/cubics
 * (rigid transforms preserve Bézier form). No flattening, no raster.
 */
export function glyphPathData(
  handle: FontHandle,
  glyph: LaidOutGlyph,
  req: CurvedTextRequest,
): string {
  const g: Glyph = handle.font.glyphs.get(glyph.glyphIndex);
  const k = req.fontSizeMm / handle.unitsPerEm;
  const rot = toRad(glyph.rotationDegrees);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dy = req.inverted ? req.invertedDyMm : 0;
  const map = (x: number, y: number): string => {
    // glyph-local mm: x along the advance centred on its midpoint, y down.
    const lx = x * k - glyph.advanceMm / 2;
    const ly = -y * k + dy;
    const px = glyph.mid.x + lx * cos - ly * sin;
    const py = glyph.mid.y + lx * sin + ly * cos;
    return `${mm(px)} ${mm(py)}`;
  };
  const parts: string[] = [];
  for (const c of g.path.commands) {
    if (c.type === "M") parts.push(`M${map(c.x, c.y)}`);
    else if (c.type === "L") parts.push(`L${map(c.x, c.y)}`);
    else if (c.type === "Q")
      parts.push(`Q${map(c.x1, c.y1)} ${map(c.x, c.y)}`);
    else if (c.type === "C")
      parts.push(`C${map(c.x1, c.y1)} ${map(c.x2, c.y2)} ${map(c.x, c.y)}`);
    else parts.push("Z");
  }
  return parts.join("");
}

export type SpikeSvgInput = {
  outerDiameterMm: number;
  innerDiameterMm: number;
  strategy: "band-thickness" | "outer-diameter";
  sizeFactor: number;
  request: CurvedTextRequest;
  /** Reference rings (measurement references, separate group). Default true. */
  rings?: boolean;
};

export type SpikeSvgResult =
  | { ok: true; svg: string; layout: CurvedTextLayout }
  | LayoutError;

export function buildSpikeSvg(
  handle: FontHandle,
  input: SpikeSvgInput,
): SpikeSvgResult {
  const layout = layoutCurvedText(handle, input.request);
  if (!layout.ok) return layout;
  const half = input.outerDiameterMm / 2;
  const side = input.outerDiameterMm;
  const paths = layout.glyphs
    .map((glyph, index) => {
      const d = glyphPathData(handle, glyph, input.request);
      // Spaces have no contours: emit nothing (no empty path).
      return d === ""
        ? ""
        : `<path id="spike-glyph-${index}" data-char="${escapeAttr(glyph.char)}" d="${d}"/>`;
    })
    .filter((p) => p !== "")
    .join("");
  const rings =
    input.rings === false
      ? ""
      : `<g id="spike-ring-reference" fill="none" stroke="#0000FF" stroke-width="0.15">` +
        `<circle cx="0" cy="0" r="${mm(input.outerDiameterMm / 2)}"/>` +
        `<circle cx="0" cy="0" r="${mm(input.innerDiameterMm / 2)}"/></g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(side)}mm" height="${mm(side)}mm" ` +
    `viewBox="${mm(-half)} ${mm(-half)} ${mm(side)} ${mm(side)}" ` +
    `data-spike="stage4-typography" data-strategy="${input.strategy}" ` +
    `data-size-factor="${String(input.sizeFactor)}" data-font="${escapeAttr(handle.postScriptName)}" ` +
    `data-font-size-mm="${String(input.request.fontSizeMm)}" ` +
    `data-baseline-radius-mm="${String(input.request.baselineRadiusMm)}">` +
    rings +
    `<g id="spike-text-outlines" fill="#000" fill-rule="nonzero">${paths}</g></svg>`;
  return { ok: true, svg, layout };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
