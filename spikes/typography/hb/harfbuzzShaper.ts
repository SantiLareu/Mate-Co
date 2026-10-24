/**
 * Stage 4 typography spike — HARFBUZZ SHAPER (isolated prototype).
 *
 * WHY THIS EXISTS: the spike's own engine (opentype.js + gposKerning.ts) does
 * not implement GSUB. Chromium DOES apply it, and in Lato that changes the
 * SHAPE of the text for 12 sequences (fi, ti, ff, tt, ...): the browser shows a
 * ligature the exporter never drew. HarfBuzz is the shaper Chromium itself
 * uses, so shaping with it removes that whole class of divergence.
 *
 * This module is the ONLY new dependency surface (harfbuzzjs, MIT). It is
 * deliberately small:
 *   - shapeText(): text -> clusters of glyphs (id, advance, outline commands)
 *   - the outline comes from the SAME font instance the shaper used
 *     (font.glyphToJson), so the glyph ids and the outlines can never disagree;
 *   - variable fonts: setVariations() makes HarfBuzz resolve the instance, so
 *     the outlines ARE the instanced ones (no build-time instancer needed).
 *
 * It does NOT touch the curved layout or the SVG serialisation: those live in
 * curvedTextOutlines.ts and are reused as-is.
 */
import type * as hbTypes from "harfbuzzjs";
import type { OutlineCommand } from "../curvedTextOutlines";

/**
 * The runtime module is loaded dynamically instead of imported statically, for
 * two MEASURED reasons:
 *  1. harfbuzzjs initialises its WASM with a TOP-LEVEL AWAIT; any bundler
 *     that pre-bundles it with a pre-es2022 target (Vite's default) fails
 *     with "Top-level await is not available in the configured target".
 *  2. a static bare import makes Vite's dependency SCANNER pick the package
 *     up anywhere in the project (it scans the *.html glob), which would break the
 *     PRODUCT's dev server. The specifier below is computed at runtime, so no
 *     bundler can see it.
 */
export type HarfBuzzModule = typeof hbTypes;

let module: HarfBuzzModule | null = null;

/** Base URL under which the harness serves the harfbuzzjs dist files. */
function harfBuzzBase(): string {
  const injected = (globalThis as { __HB_BASE__?: string }).__HB_BASE__;
  return injected ?? "/hb/harfbuzz";
}

/** Loads the WASM module (idempotent) and returns it. */
export async function loadHarfBuzz(): Promise<HarfBuzzModule> {
  if (module) return module;
  const base = harfBuzzBase();
  module = (await import(
    /* @vite-ignore */ `${base}/index.mjs`
  )) as HarfBuzzModule;
  return module;
}

export type ShapedGlyph = {
  /** Glyph id in the font. */
  gid: number;
  /** Advance of this glyph, in font units. */
  advanceUnits: number;
  /** Offsets of this glyph relative to the cluster origin, in font units. */
  xOffsetUnits: number;
  yOffsetUnits: number;
  /** Outline in font units (null for glyphs without contours, e.g. space). */
  commands: OutlineCommand[] | null;
};

export type ShapedCluster = {
  /** Index of the first source character of the cluster. */
  clusterKey: number;
  /** Source characters covered by the cluster (ligature clusters cover more). */
  text: string;
  /** Total advance of the cluster, in font units (kerning included). */
  advanceUnits: number;
  glyphs: ShapedGlyph[];
};

export type ShapedRun = {
  unitsPerEm: number;
  clusters: ShapedCluster[];
  /** Sum of the cluster advances (no letter-spacing), in font units. */
  totalAdvanceUnits: number;
};

export type ShapeOptions = {
  /** Unicode script tag (OpenType). Default "latn". */
  script?: string;
  /** BCP-47 language tag. Default "es". */
  language?: string;
  /** Variable-font axes, e.g. [{ tag: "wght", value: 700 }]. */
  variations?: { tag: string; value: number }[];
  /** Extra HarfBuzz features, e.g. [{ tag: "liga", value: 0 }] to disable. */
  features?: { tag: string; value: number; start?: number; end?: number }[];
  /**
   * Key under which the Face/Font are reused between calls. Without it every
   * call allocates a new Face+Font in the WASM heap: a 5625-pair sweep would
   * allocate 5625 of them (and the emscripten FinalizationRegistry frees them
   * at GC time, which surfaces as "memory access out of bounds").
   */
  cacheKey?: string;
};

export type ShapeErrorCode =
  | "FONT_INVALID"
  | "GLYPH_MISSING"
  | "TEXT_NOT_NFC"
  | "SHAPER_UNAVAILABLE";

export type ShapeResult =
  | { ok: true; run: ShapedRun }
  | { ok: false; code: ShapeErrorCode; reason: string };

/** HarfBuzz version actually running (recorded for reproducibility). */
export function shaperVersion(): string {
  return module ? module.versionString() : "(not loaded)";
}

/** Outline of a glyph in font units, in the spike's command shape. */
function outlineOf(
  font: HarfBuzzModule["Font"],
  gid: number,
): OutlineCommand[] | null {
  const json = font.glyphToJson(gid);
  if (!json || json.length === 0) return null;
  const commands: OutlineCommand[] = [];
  for (const c of json) {
    const v = c.values;
    if (c.type === "M") commands.push({ type: "M", x: v[0], y: v[1] });
    else if (c.type === "L") commands.push({ type: "L", x: v[0], y: v[1] });
    else if (c.type === "Q")
      commands.push({ type: "Q", x1: v[0], y1: v[1], x: v[2], y: v[3] });
    else if (c.type === "C")
      commands.push({
        type: "C",
        x1: v[0],
        y1: v[1],
        x2: v[2],
        y2: v[3],
        x: v[4],
        y: v[5],
      });
    else commands.push({ type: "Z" });
  }
  return commands.length > 0 ? commands : null;
}

type PreparedFont = {
  /**
   * The Blob MUST stay reachable: harfbuzzjs registers it in a
   * FinalizationRegistry that calls hb_blob_destroy when it is collected, and
   * the Face points into that memory. Letting it go out of scope produces
   * "RuntimeError: memory access out of bounds" on the next shaping call.
   */
  blob: HarfBuzzModule["Blob"];
  face: HarfBuzzModule["Face"];
  font: HarfBuzzModule["Font"];
  unitsPerEm: number;
};

/** Face+Font per font file, reused across shaping calls. */
const fontCache = new Map<string, PreparedFont>();

async function getFont(
  cacheKey: string | undefined,
  fontBytes: ArrayBuffer,
): Promise<PreparedFont> {
  if (cacheKey) {
    const cached = fontCache.get(cacheKey);
    if (cached) return cached;
  }
  const hb = await loadHarfBuzz();
  const blob = new hb.Blob(fontBytes);
  const face = new hb.Face(blob, 0);
  const font = new hb.Font(face);
  const prepared = { blob, face, font, unitsPerEm: face.upem };
  if (cacheKey) fontCache.set(cacheKey, prepared);
  return prepared;
}

/**
 * Shapes a text with HarfBuzz.
 *
 * Never substitutes a missing glyph: if the font has no glyph for a
 * character, the run fails closed with GLYPH_MISSING.
 */
export async function shapeText(
  fontBytes: ArrayBuffer,
  text: string,
  options: ShapeOptions = {},
): Promise<ShapeResult> {
  if (text.normalize("NFC") !== text) {
    return {
      ok: false,
      code: "TEXT_NOT_NFC",
      reason:
        "El texto no está en forma NFC; no se normaliza en silencio (sin posicionamiento de marcas combinantes).",
    };
  }
  const hb = await loadHarfBuzz();
  let face: HarfBuzzModule["Face"];
  let font: HarfBuzzModule["Font"];
  try {
    const prepared = await getFont(options.cacheKey, fontBytes);
    face = prepared.face;
    font = prepared.font;
  } catch (error) {
    return {
      ok: false,
      code: "FONT_INVALID",
      reason: `La fuente no se pudo abrir: ${(error as Error).message}`,
    };
  }
  const unitsPerEm = face.upem;
  // Scale 1:1 in font units, so the outline commands come in font units and
  // the advances are the raw font advances (the mm conversion happens in the
  // curved layout, exactly like the opentype.js path).
  font.setScale(unitsPerEm, unitsPerEm);
  if (options.variations && options.variations.length > 0) {
    font.setVariations(
      options.variations.map((v) => new hb.Variation(v.tag, v.value)),
    );
  }

  // Fail closed on missing glyphs BEFORE shaping (nominalGlyph is undefined
  // when the font has no glyph for the codepoint).
  const missing = Array.from(text).filter(
    (c) => c !== " " && font.nominalGlyph(c.codePointAt(0)!) === undefined,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: "GLYPH_MISSING",
      reason: `La fuente no tiene glifo para: ${Array.from(new Set(missing)).join(" ")} (sin sustitución).`,
    };
  }

  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.setDirection(hb.Direction.LTR);
  buffer.setScript(options.script ?? "latn");
  buffer.setLanguage(options.language ?? "es");
  const features = options.features?.map(
    (f) => new hb.Feature(f.tag, f.value, f.start, f.end),
  );
  hb.shape(font, buffer, features);

  const shaped = buffer.getGlyphInfosAndPositions();
  const clusters: ShapedCluster[] = [];
  let totalAdvanceUnits = 0;
  for (const g of shaped) {
    const clusterKey = g.cluster ?? 0;
    let cluster = clusters[clusters.length - 1];
    if (!cluster || cluster.clusterKey !== clusterKey) {
      cluster = { clusterKey, text: "", advanceUnits: 0, glyphs: [] };
      clusters.push(cluster);
    }
    const advance = g.xAdvance ?? 0;
    cluster.glyphs.push({
      gid: g.codepoint,
      advanceUnits: advance,
      xOffsetUnits: g.xOffset ?? 0,
      yOffsetUnits: g.yOffset ?? 0,
      commands: outlineOf(font, g.codepoint),
    });
    cluster.advanceUnits += advance;
    totalAdvanceUnits += advance;
  }
  // Cluster text: the source characters from this cluster to the next one.
  clusters.forEach((cluster, i) => {
    const next = clusters[i + 1]?.clusterKey ?? text.length;
    cluster.text = text.slice(cluster.clusterKey, next);
  });

  return {
    ok: true,
    run: { unitsPerEm, clusters, totalAdvanceUnits },
  };
}
