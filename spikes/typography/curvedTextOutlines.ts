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
import * as opentypeNamespace from "opentype.js";
import type { Font, Glyph } from "opentype.js";

type OpentypeApi = { parse: (buffer: ArrayBuffer) => Font };

/**
 * Vite's dependency pre-bundle exposes opentype.js with DIFFERENT interop
 * shapes depending on the bundle format it picks:
 *   - CJS-shaped bundle: only `default` (the whole module.exports);
 *   - ESM-shaped bundle: the named exports (parse, load, Font, ...) and NO
 *     `default`.
 * A default import therefore fails in the second case ("does not provide an
 * export named 'default'"), and a namespace import fails in the first one
 * ("opentype.parse is not a function"). Both shapes are in play in this repo
 * (the product server and the isolated HarfBuzz harness), so the core picks
 * whichever actually provides `parse`.
 */
const opentype: OpentypeApi =
  (opentypeNamespace as unknown as { default?: OpentypeApi }).default ??
  (opentypeNamespace as unknown as OpentypeApi);
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

  const items: CurveItem[] = glyphs.map((_, i) => ({
    advanceMm: advances[i],
    kernBeforeMm: kerns[i],
  }));
  const curve = layoutCurveItems(items, req);
  const out: LaidOutGlyph[] = curve.placements.map((placement, i) => ({
    char: chars[i],
    glyphIndex: glyphs[i].index,
    advanceMm: advances[i],
    kernMm: kerns[i],
    sMidMm: placement.sMidMm,
    mid: placement.mid,
    origin: placement.origin,
    rotationDegrees: placement.rotationDegrees,
  }));

  return {
    ok: true,
    glyphs: out,
    totalAdvanceMm: curve.totalAdvanceMm,
    spanDegrees: curve.spanDegrees,
  };
}

/**
 * One item of the run to lay out on the arc. `kernBeforeMm` is the kerning
 * applied BEFORE the item (0 when the shaper already folded the kerning into
 * the advance, as HarfBuzz does).
 */
export type CurveItem = {
  advanceMm: number;
  kernBeforeMm: number;
};

export type CurvePlacement = {
  /** Arc coordinate of the advance midpoint, from the text centre (mm). */
  sMidMm: number;
  /** Advance midpoint on the baseline circle, mm, centre (0,0). */
  mid: { x: number; y: number };
  /** Rotation of the item x axis, degrees (clockwise, y down). */
  rotationDegrees: number;
  /** Origin (pen position on the baseline, pre-dy), mm. */
  origin: { x: number; y: number };
};

/**
 * THE CURVED LAYOUT: places a run of items on the baseline circle.
 *
 * Extracted from layoutCurvedText so that the very same arithmetic serves
 * both outline sources (opentype.js characters and HarfBuzz shaped clusters):
 * the advance midpoint sits on the circle, the item is rotated to the tangent
 * there, and the letter-spacing is added after every item.
 */
export function baselinePoint(
  sMm: number,
  req: CurvedTextRequest,
): { x: number; y: number } {
  const dir = req.inverted ? -1 : 1;
  const t = toRad(req.angleDegrees) + (dir * sMm) / req.baselineRadiusMm;
  return {
    x: req.baselineRadiusMm * Math.sin(t),
    y: -req.baselineRadiusMm * Math.cos(t),
  };
}

export function layoutCurveItems(
  items: CurveItem[],
  req: CurvedTextRequest,
): {
  placements: CurvePlacement[];
  totalAdvanceMm: number;
  spanDegrees: number;
} {
  const dir = req.inverted ? -1 : 1;
  let total = 0;
  for (const item of items) {
    total += item.kernBeforeMm + item.advanceMm + req.letterSpacingMm;
  }
  const placements: CurvePlacement[] = [];
  let pen = -total / 2; // arc coordinate of the next glyph origin
  for (const item of items) {
    pen += item.kernBeforeMm;
    const sMid = pen + item.advanceMm / 2;
    const theta = toRad(req.angleDegrees) + (dir * sMid) / req.baselineRadiusMm;
    // The origin is reported along the item's own (rotated) x axis, so it is
    // comparable with the browser's per-character start position.
    const rotation = (theta * 180) / Math.PI + (req.inverted ? 180 : 0);
    const mid = baselinePoint(sMid, req);
    const r = toRad(rotation);
    placements.push({
      sMidMm: sMid,
      mid,
      rotationDegrees: rotation,
      origin: {
        x: mid.x - (item.advanceMm / 2) * Math.cos(r),
        y: mid.y - (item.advanceMm / 2) * Math.sin(r),
      },
    });
    pen += item.advanceMm + req.letterSpacingMm;
  }
  return {
    placements,
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
/**
 * Outline commands in FONT UNITS (the same shape opentype.js exposes and the
 * same shape HarfBuzz's draw functions emit).
 */
export type OutlineCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

/**
 * Rigid transform of an outline (font units) to absolute millimetres.
 *
 * Extracted from glyphPathData so that ANY outline source (opentype.js or
 * HarfBuzz) goes through the exact same arithmetic and the exact same
 * serialisation: scale, flip, dy, rotation, translation. Curves stay curves
 * (Q/C are never flattened) and coordinates are rounded to 3 decimals (1 um).
 */
export function outlineToPathData(
  commands: readonly OutlineCommand[],
  placement: {
    /** Advance of the glyph/cluster, mm (the outline is centred on it). */
    advanceMm: number;
    /** Midpoint of the advance on the baseline circle, mm. */
    mid: { x: number; y: number };
    /** Rotation of the glyph x axis, degrees (clockwise, y down). */
    rotationDegrees: number;
  },
  scale: number,
  dyMm: number,
): string {
  const rot = toRad(placement.rotationDegrees);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const map = (x: number, y: number): string => {
    // glyph-local mm: x along the advance centred on its midpoint, y down.
    const lx = x * scale - placement.advanceMm / 2;
    const ly = -y * scale + dyMm;
    const px = placement.mid.x + lx * cos - ly * sin;
    const py = placement.mid.y + lx * sin + ly * cos;
    return `${mm(px)} ${mm(py)}`;
  };
  const parts: string[] = [];
  for (const c of commands) {
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

export function glyphPathData(
  handle: FontHandle,
  glyph: LaidOutGlyph,
  req: CurvedTextRequest,
): string {
  const g: Glyph = handle.font.glyphs.get(glyph.glyphIndex);
  return outlineToPathData(
    g.path.commands as unknown as readonly OutlineCommand[],
    {
      advanceMm: glyph.advanceMm,
      mid: glyph.mid,
      rotationDegrees: glyph.rotationDegrees,
    },
    req.fontSizeMm / handle.unitsPerEm,
    req.inverted ? req.invertedDyMm : 0,
  );
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

export type SpikeSvgParts = SpikeSvgInput & {
  /** Layout to serialise (already computed by the caller). */
  layout: CurvedTextLayout;
  /** Name recorded in data-font (provenance of the outlines). */
  fontName: string;
  /** Outline of one laid-out glyph, in absolute millimetres. */
  pathFor: (glyph: LaidOutGlyph) => string;
};

/**
 * THE SERIALISATION: absolute millimetre paths, one per glyph, no <text>, no
 * raster, no external references.
 *
 * Extracted from buildSpikeSvg so that every outline source (opentype.js or
 * HarfBuzz) produces byte-identical SVG structure.
 */
export function serializeSpikeSvg(parts: SpikeSvgParts): SpikeSvgResult {
  const { layout } = parts;
  const half = parts.outerDiameterMm / 2;
  const side = parts.outerDiameterMm;
  const paths = layout.glyphs
    .map((glyph, index) => {
      const d = parts.pathFor(glyph);
      // Spaces have no contours: emit nothing (no empty path).
      return d === ""
        ? ""
        : `<path id="spike-glyph-${index}" data-char="${escapeAttr(glyph.char)}" d="${d}"/>`;
    })
    .filter((p) => p !== "")
    .join("");
  const rings =
    parts.rings === false
      ? ""
      : `<g id="spike-ring-reference" fill="none" stroke="#0000FF" stroke-width="0.15">` +
        `<circle cx="0" cy="0" r="${mm(parts.outerDiameterMm / 2)}"/>` +
        `<circle cx="0" cy="0" r="${mm(parts.innerDiameterMm / 2)}"/></g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(side)}mm" height="${mm(side)}mm" ` +
    `viewBox="${mm(-half)} ${mm(-half)} ${mm(side)} ${mm(side)}" ` +
    `data-spike="stage4-typography" data-strategy="${parts.strategy}" ` +
    `data-size-factor="${String(parts.sizeFactor)}" data-font="${escapeAttr(parts.fontName)}" ` +
    `data-font-size-mm="${String(parts.request.fontSizeMm)}" ` +
    `data-baseline-radius-mm="${String(parts.request.baselineRadiusMm)}">` +
    rings +
    `<g id="spike-text-outlines" fill="#000" fill-rule="nonzero">${paths}</g></svg>`;
  return { ok: true, svg, layout };
}

export function buildSpikeSvg(
  handle: FontHandle,
  input: SpikeSvgInput,
): SpikeSvgResult {
  const layout = layoutCurvedText(handle, input.request);
  if (!layout.ok) return layout;
  return serializeSpikeSvg({
    ...input,
    layout,
    fontName: handle.postScriptName,
    pathFor: (glyph) => glyphPathData(handle, glyph, input.request),
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
