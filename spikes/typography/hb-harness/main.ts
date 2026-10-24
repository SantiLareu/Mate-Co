/**
 * HarfBuzz harness page (isolated).
 *
 * Loads the WASM shaper and exposes a tiny API for the spike test:
 *   hb.version                      -> HarfBuzz version running
 *   hb.shapeAdvances(url, texts[])  -> advance of each text, shaped
 *   hb.build(url, request)          -> the spike's SVG (mm) built from a
 *                                      HarfBuzz-shaped run
 * Nothing here is product code: it lives inside the spike.
 */
import { loadHarfBuzz, shapeText, shaperVersion } from "../hb/harfbuzzShaper";
import { buildShapedSvg } from "../hb/curvedHarfBuzz";

type BuildRequest = {
  text: string;
  fontSizeMm: number;
  letterSpacingMm: number;
  baselineRadiusMm: number;
  angleDegrees: number;
  inverted: boolean;
  invertedDyMm: number;
  outerDiameterMm: number;
  innerDiameterMm: number;
  sizeFactor: number;
};

const fonts = new Map<string, ArrayBuffer>();

async function loadFont(url: string): Promise<ArrayBuffer> {
  const cached = fonts.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  fonts.set(url, bytes);
  return bytes;
}

// Load the WASM module before exposing the API: the page is only ready when
// the shaper can actually shape. The load time is measured (WASM download +
// instantiation) because it is part of the cost of the feature.
const loadStart = performance.now();
await loadHarfBuzz();
const loadMs = performance.now() - loadStart;

const api = {
  version: shaperVersion(),
  loadMs,
  async shapeAdvances(
    url: string,
    texts: string[],
    options: { variations?: { tag: string; value: number }[] } = {},
  ) {
    const bytes = await loadFont(url);
    const out: { ok: boolean; advanceUnits: number; code?: string; reason?: string }[] = [];
    for (const text of texts) {
      const result = await shapeText(bytes, text, { ...options, cacheKey: url });
      out.push(
        result.ok
          ? { ok: true, advanceUnits: result.run.totalAdvanceUnits }
          : { ok: false, advanceUnits: 0, code: result.code, reason: result.reason },
      );
    }
    return out;
  },
  async build(
    url: string,
    request: BuildRequest,
    options: { variations?: { tag: string; value: number }[] } = {},
  ) {
    const bytes = await loadFont(url);
    const t0 = performance.now();
    const shaped = await shapeText(bytes, request.text, { ...options, cacheKey: url });
    if (!shaped.ok) {
      return { ok: false, code: shaped.code, reason: shaped.reason };
    }
    const built = buildShapedSvg(shaped.run, {
      outerDiameterMm: request.outerDiameterMm,
      innerDiameterMm: request.innerDiameterMm,
      strategy: "band-thickness",
      sizeFactor: request.sizeFactor,
      request: {
        text: request.text,
        fontSizeMm: request.fontSizeMm,
        letterSpacingMm: request.letterSpacingMm,
        baselineRadiusMm: request.baselineRadiusMm,
        angleDegrees: request.angleDegrees,
        inverted: request.inverted,
        invertedDyMm: request.invertedDyMm,
      },
      fontName: "HarfBuzz",
      // No reference rings: the visual comparison rasterises only the text.
      rings: false,
    });
    const ms = performance.now() - t0;
    if (!built.ok) return { ok: false, code: built.code, reason: built.reason };
    return {
      ok: true,
      svg: built.svg,
      ms,
      unitsPerEm: shaped.run.unitsPerEm,
      totalAdvanceUnits: shaped.run.totalAdvanceUnits,
      totalAdvanceMm: built.layout.totalAdvanceMm,
      clusters: shaped.run.clusters.map((c) => ({
        text: c.text,
        advanceUnits: c.advanceUnits,
        gids: c.glyphs.map((g) => g.gid),
      })),
      glyphs: built.layout.glyphs.map((g) => ({
        char: g.char,
        origin: g.origin,
        rotationDegrees: g.rotationDegrees,
        sMidMm: g.sMidMm,
      })),
    };
  },
};

(window as unknown as { hb: typeof api }).hb = api;
