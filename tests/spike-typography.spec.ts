/**
 * Stage 4 typography spike: tests. ISOLATED from the product: imports only
 * the spike module and (read-only) the lab's frame math, so strategy B
 * numbers come from the same functions the lab/exporter use.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  buildSpikeSvg,
  glyphPathData,
  layoutCurvedText,
  loadFontFromBuffer,
  type CurvedTextRequest,
  type FontHandle,
} from "../spikes/typography/curvedTextOutlines";
import { createPhysicalFrame, resolveText } from "../src/production-lab/geometry";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FONT_DIR = resolve(HERE, "../spikes/typography/fonts/poppins");
const FONT_FILE = resolve(FONT_DIR, "Poppins-SemiBold.ttf");
const FONT_URL = "/spikes/typography/fonts/poppins/Poppins-SemiBold.ttf";
// Pinned provenance: google/fonts ofl/poppins @ 7dc16b7 (Poppins 4.004);
// SHA-256 is asserted in the provenance test below.
const OUT_DIR = resolve(HERE, "../test-results/spike-typography");
/** Device pixels per millimetre used by every raster comparison here. */
const PX_PER_MM = 24;
/**
 * Search window (device px) for the nearest-ink distance: 16 px = 0.67 mm at
 * 24 px/mm. Anything farther than that is reported as "beyond" (a real
 * geometric error, not rasteriser noise).
 */
const DEV_WINDOW_PX = 16;

const bytes = readFileSync(FONT_FILE);
const arrayBuffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;
const handle: FontHandle = loadFontFromBuffer(arrayBuffer);

const SIZES = [
  { outer: 85, inner: 50 },
  { outer: 80, inner: 60 },
  { outer: 75, inner: 65 },
] as const;

const SPANISH = "Mate&Co · Edición física";
const ALL_ES = "áéíóúüñÁÉÍÓÚÜÑ¿¡&.,-:;!?()0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Scenario = {
  outer: number;
  inner: number;
  text: string;
  angle: number;
  radius: number;
  scale: number;
  inverted: boolean;
};

function makeRequest(s: Scenario) {
  const frameResult = createPhysicalFrame(s.outer, s.inner, "band-thickness");
  if (!frameResult.ok) throw new Error("frame");
  const frame = frameResult.frame;
  const placed = resolveText(
    {
      id: "t",
      text: s.text,
      fontFamily: "Poppins",
      angle: s.angle,
      radius: s.radius,
      inverted: s.inverted,
      scale: s.scale,
    },
    frame,
  );
  if (placed.baselineRadiusMm === null) throw new Error("baseline");
  const request: CurvedTextRequest = {
    text: s.text,
    fontSizeMm: placed.fontSizeMm,
    letterSpacingMm: placed.letterSpacingMm,
    baselineRadiusMm: placed.baselineRadiusMm,
    angleDegrees: s.angle,
    inverted: s.inverted,
    invertedDyMm: placed.invertedDyMm ?? 0,
  };
  return { frame, placed, request };
}

const base = (o: Partial<Scenario> = {}): Scenario => ({
  outer: 85,
  inner: 50,
  text: SPANISH,
  angle: 0,
  radius: 374,
  scale: 1,
  inverted: false,
  ...o,
});

function pathNumbers(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Outline height of 'H' in font units, read from the real glyph (all straight segments). */
function hHeightUnits(): number {
  const glyph = handle.font.glyphs.get(handle.font.charToGlyphIndex("H"));
  const ys: number[] = [];
  for (const c of glyph.path.commands) if (c.type !== "Z") ys.push(c.y);
  return Math.max(...ys) - Math.min(...ys);
}

test.describe("spike: provenance and coverage", () => {
  test("font file matches the pinned official hash and name", () => {
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(sha.toUpperCase()).toBe(
      "D3BF1BDAF0550E83DA9AC0B1D1D9FE6DB086835A83AA28578E609A394B9A0286",
    );
    expect(handle.postScriptName).toBe("Poppins-SemiBold");
    expect(handle.unitsPerEm).toBe(1000);
    const ofl = readFileSync(resolve(FONT_DIR, "OFL.txt"), "utf8");
    expect(ofl).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(ofl).toContain("Copyright 2020 The Poppins Project Authors");
    // No Reserved Font Name is declared in the copyright line.
    expect(ofl.split("\n")[0]).not.toContain("Reserved Font Name");
  });

  test("covers Spanish characters with real outlines (100%)", () => {
    const missing: string[] = [];
    for (const ch of Array.from(ALL_ES)) {
      const index = handle.font.charToGlyphIndex(ch);
      if (index === 0) {
        missing.push(ch);
        continue;
      }
      expect(
        handle.font.glyphs.get(index).path.commands.length,
        `outline for ${ch}`,
      ).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
    expect(handle.font.charToGlyphIndex("·")).not.toBe(0);
    expect(handle.font.charToGlyphIndex(" ")).not.toBe(0);
  });

  test("missing glyph and non-NFC fail closed (no substitution)", () => {
    const { request } = makeRequest(base());
    const missing = layoutCurvedText(handle, { ...request, text: "Mate日本" });
    expect(missing.ok).toBe(false);
    if (!missing.ok && missing.code === "GLYPH_MISSING") {
      expect(missing.chars).toEqual(["日", "本"]);
    } else throw new Error("expected GLYPH_MISSING");
    const decomposed = layoutCurvedText(handle, {
      ...request,
      text: "Nin\u0303o",
    });
    expect(decomposed.ok).toBe(false);
    if (!decomposed.ok) expect(decomposed.code).toBe("TEXT_NOT_NFC");
    const bad = layoutCurvedText(handle, { ...request, baselineRadiusMm: 0 });
    expect(bad.ok).toBe(false);
  });
});

test.describe("spike: physical SVG (strategy B)", () => {
  for (const size of SIZES) {
    test(`mm dimensions, rings, scale and baseline for ${size.outer}/${size.inner}`, () => {
      const { frame, placed, request } = makeRequest(
        base({ outer: size.outer, inner: size.inner }),
      );
      const result = buildSpikeSvg(handle, {
        outerDiameterMm: size.outer,
        innerDiameterMm: size.inner,
        strategy: "band-thickness",
        sizeFactor: frame.sizeFactor,
        request,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const svg = result.svg;
      // Strategy B: size factor = (Ro - Ri) / 131, font = 35 * factor.
      const ro = size.outer / 2;
      const ri = size.inner / 2;
      expect(frame.sizeFactor).toBeCloseTo((ro - ri) / 131, 12);
      expect(placed.fontSizeMm).toBeCloseTo(35 * ((ro - ri) / 131), 9);
      expect(placed.baselineRadiusMm).toBeCloseTo(
        placed.anchorRadiusMm - 14 * frame.sizeFactor,
        9,
      );
      // Explicit mm root; viewBox in mm user units centred on (0,0).
      expect(svg).toContain(`width="${size.outer}mm" height="${size.outer}mm"`);
      expect(svg).toContain(
        `viewBox="${-size.outer / 2} ${-size.outer / 2} ${size.outer} ${size.outer}"`,
      );
      // Diameter = 2R (radius attributes are exactly R).
      expect(svg).toContain(`<circle cx="0" cy="0" r="${ro}"/>`);
      expect(svg).toContain(`<circle cx="0" cy="0" r="${ri}"/>`);
      expect(svg).toContain(`data-strategy="band-thickness"`);
      // Ring reference group is separate from the engraving group.
      expect(svg.indexOf('id="spike-ring-reference"')).toBeLessThan(
        svg.indexOf('id="spike-text-outlines"'),
      );
      // Glyph midpoints sit on the baseline circle (exact radius).
      for (const g of result.layout.glyphs) {
        expect(Math.hypot(g.mid.x, g.mid.y)).toBeCloseTo(
          request.baselineRadiusMm,
          9,
        );
      }
      // Outline radii stay inside [baseline - descender, baseline + ascender].
      const k = request.fontSizeMm / handle.unitsPerEm;
      const group = svg.split('id="spike-text-outlines"')[1];
      const nums = pathNumbers(
        Array.from(group.matchAll(/ d="([^"]+)"/g))
          .map((m) => m[1])
          .join(" "),
      );
      let rMin = Infinity;
      let rMax = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const r = Math.hypot(nums[i], nums[i + 1]);
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
      }
      expect(rMax).toBeLessThanOrEqual(
        request.baselineRadiusMm + 1.1 * handle.font.ascender * k + 0.01,
      );
      expect(rMin).toBeGreaterThanOrEqual(
        request.baselineRadiusMm + handle.font.descender * k * 1.2 - 0.01,
      );
    });
  }

  test("glyph size is physical: 'H' outline height = font-unit height * mm/em (<= 0.01 mm)", () => {
    // letterSpacing 0 isolates the glyph: with spacing, the trailing space
    // legitimately shifts a single centred glyph off the exact top.
    const request: CurvedTextRequest = {
      ...makeRequest(base({ text: "H" })).request,
      letterSpacingMm: 0,
    };
    const layout = layoutCurvedText(handle, request);
    if (!layout.ok) throw new Error("layout");
    const ys = pathNumbers(glyphPathData(handle, layout.glyphs[0], request)).filter(
      (_, i) => i % 2 === 1,
    );
    // Single centred glyph at angle 0: rotation 0, so the bbox height is the
    // outline height up to the 1 µm rounding.
    expect(layout.glyphs[0].rotationDegrees).toBeCloseTo(0, 9);
    const height = Math.max(...ys) - Math.min(...ys);
    const expected = (hHeightUnits() * request.fontSizeMm) / handle.unitsPerEm;
    expect(Math.abs(height - expected)).toBeLessThan(0.01);
    // The outline height agrees with the font's declared cap height to ~0.5%.
    const cap = handle.font.tables.os2?.sCapHeight ?? 0;
    expect(Math.abs(hHeightUnits() - cap) / cap).toBeLessThan(0.01);
    // Baseline at radius r: glyph bottom at y = -r (top of the ring), outward = -y.
    expect(Math.abs(Math.max(...ys) + request.baselineRadiusMm)).toBeLessThan(0.01);
  });

  test("transforms: angle rotates rigidly; inverted flips and applies dy", () => {
    const a = makeRequest(base({ angle: 0 }));
    const b = makeRequest(base({ angle: 90 }));
    const la = layoutCurvedText(handle, a.request);
    const lb = layoutCurvedText(handle, b.request);
    if (!la.ok || !lb.ok) throw new Error("layout");
    la.glyphs.forEach((g, i) => {
      // +90 deg clockwise (y down): (x, y) -> (-y, x)
      expect(lb.glyphs[i].mid.x).toBeCloseTo(-g.mid.y, 9);
      expect(lb.glyphs[i].mid.y).toBeCloseTo(g.mid.x, 9);
      expect(lb.glyphs[i].rotationDegrees).toBeCloseTo(g.rotationDegrees + 90, 9);
    });
    // Inverted single 'H' at the top: rotated 180, tops point to the centre,
    // baseline pushed OUTWARD by dy exactly.
    const inv = makeRequest(base({ text: "H", inverted: true }));
    inv.request.letterSpacingMm = 0;
    expect(inv.request.invertedDyMm).toBeGreaterThan(0);
    const li = layoutCurvedText(handle, inv.request);
    if (!li.ok) throw new Error("layout");
    expect(li.glyphs[0].rotationDegrees).toBeCloseTo(180, 9);
    const ys = pathNumbers(glyphPathData(handle, li.glyphs[0], inv.request)).filter(
      (_, i) => i % 2 === 1,
    );
    const r = inv.request.baselineRadiusMm;
    const dy = inv.request.invertedDyMm;
    expect(Math.abs(Math.min(...ys) + (r + dy))).toBeLessThan(0.01);
    const cap = (hHeightUnits() * inv.request.fontSizeMm) / handle.unitsPerEm;
    expect(Math.abs(Math.max(...ys) - (-(r + dy) + cap))).toBeLessThan(0.01);
    // Reading direction reverses: first glyph is on the RIGHT when inverted.
    const normal = layoutCurvedText(handle, makeRequest(base({ text: "AB" })).request);
    const reversed = layoutCurvedText(handle, makeRequest(base({ text: "AB", inverted: true })).request);
    if (!normal.ok || !reversed.ok) throw new Error("layout");
    expect(normal.glyphs[0].mid.x).toBeLessThan(normal.glyphs[1].mid.x);
    expect(reversed.glyphs[0].mid.x).toBeGreaterThan(reversed.glyphs[1].mid.x);
  });

  test("kerning: this Poppins build declares no 'kern' feature; spike applies none (browser agrees, see compare tests)", () => {
    // Finding of the spike: the official google/fonts Poppins 4.004 GPOS only
    // carries abvm/blwm mark features (no 'kern' GPOS feature, no legacy
    // 'kern' table). Hence kerning is 0 here and the browser length matches.
    // The kerning code path itself is NOT exercised by a real kerned font in
    // this spike (open risk for Lato/Merriweather/...).
    const tables = handle.font.tables as unknown as {
      kern?: unknown;
      gpos?: { features: { tag: string }[] };
    };
    expect(tables.kern).toBeUndefined();
    expect((tables.gpos?.features ?? []).some((f) => f.tag === "kern")).toBe(false);
    // The spike's own GPOS reader agrees: no 'kern' feature for latn/DFLT.
    expect(handle.kerningSource.kind).toBe("none");
    const { request } = makeRequest(base({ text: "AVATAR To" }));
    const layout = layoutCurvedText(handle, request);
    if (!layout.ok) throw new Error("layout");
    expect(layout.glyphs.every((g) => g.kernMm === 0)).toBe(true);
  });

  test("no raster, no <text>, no fonts, no external refs", () => {
    const { frame, request } = makeRequest(base());
    const result = buildSpikeSvg(handle, {
      outerDiameterMm: 85,
      innerDiameterMm: 50,
      strategy: "band-thickness",
      sizeFactor: frame.sizeFactor,
      request,
    });
    if (!result.ok) throw new Error("svg");
    expect(result.svg).not.toMatch(
      /<text|<tspan|<image|data:|href=|url\(|font-family|<style|<filter|<foreignObject|<script/i,
    );
    // One path per non-space character; spaces emit no contour.
    const nonSpace = Array.from(SPANISH).filter((c) => c !== " ").length;
    expect((result.svg.match(/<path /g) ?? []).length).toBe(nonSpace);
    // Curves stay curves (quadratic TrueType outlines), no polyline flattening.
    expect(result.svg).toMatch(/Q/);
  });

  test("determinism: identical bytes across repeated builds, all sizes", () => {
    const hashes: string[] = [];
    mkdirSync(OUT_DIR, { recursive: true });
    for (const size of SIZES) {
      const outputs = [0, 1, 2].map(() => {
        const { frame, request } = makeRequest(
          base({ outer: size.outer, inner: size.inner }),
        );
        const r = buildSpikeSvg(handle, {
          outerDiameterMm: size.outer,
          innerDiameterMm: size.inner,
          strategy: "band-thickness",
          sizeFactor: frame.sizeFactor,
          request,
        });
        if (!r.ok) throw new Error("svg");
        return r.svg;
      });
      expect(outputs[1]).toBe(outputs[0]);
      expect(outputs[2]).toBe(outputs[0]);
      // A second FontHandle parsed from the same bytes yields the same bytes.
      const again = loadFontFromBuffer(arrayBuffer);
      const { frame, request } = makeRequest(
        base({ outer: size.outer, inner: size.inner }),
      );
      const r2 = buildSpikeSvg(again, {
        outerDiameterMm: size.outer,
        innerDiameterMm: size.inner,
        strategy: "band-thickness",
        sizeFactor: frame.sizeFactor,
        request,
      });
      if (!r2.ok) throw new Error("svg");
      expect(r2.svg).toBe(outputs[0]);
      hashes.push(
        `${size.outer}/${size.inner} ${createHash("sha256").update(outputs[0]).digest("hex")}`,
      );
      writeFileSync(
        resolve(OUT_DIR, `spike-poppins-semibold-${size.outer}x${size.inner}-B.svg`),
        outputs[0],
      );
    }
    writeFileSync(resolve(OUT_DIR, "hashes.txt"), hashes.join("\n") + "\n");
  });
});

// ---------------------------------------------------------------------------
// Editor/lab <textPath> (browser) vs spike outlines. The browser rendering is
// only the REFERENCE under test; nothing here ships.
// ---------------------------------------------------------------------------

type BrowserGlyph = { x: number; y: number; rotation: number };

const scenarios: { name: string; s: Scenario }[] = [
  { name: "normal 85/50", s: base() },
  { name: "normal 75/65 rotated 40", s: base({ outer: 75, inner: 65, angle: 40 }) },
  { name: "inverted 80/60 scale 1.5", s: base({ outer: 80, inner: 60, inverted: true, scale: 1.5, radius: 330 }) },
  // Kerning-heavy pairs plus the full Spanish alphabet extras.
  { name: "kerning pairs 85/50", s: base({ text: "AVATAR To Ty LT ¡Señor Ñandú! ¿Qué?" }) },
];

for (const sc of scenarios) {
  test(`browser <textPath> vs outlines: ${sc.name}`, async ({ page }) => {
    // Blank isolated harness (not the app): no app reloads, no app code.
    await page.goto("/spikes/typography/harness.html");
    const { request } = makeRequest(sc.s);
    const layout = layoutCurvedText(handle, request);
    if (!layout.ok) throw new Error("layout");
    const half = sc.s.outer / 2;
    const r = request.baselineRadiusMm;
    const sweep = sc.s.inverted ? 0 : 1;

    const measured = await page.evaluate(
      async ({ fontUrl, request, half, r, sweep, k }) => {
        const face = new FontFace("SpikePoppins", `url(${fontUrl})`, { weight: "600" });
        await face.load();
        document.fonts.add(face);
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("width", String(half * 2 * k));
        svg.setAttribute("height", String(half * 2 * k));
        svg.setAttribute("viewBox", `${-half * k} ${-half * k} ${half * 2 * k} ${half * 2 * k}`);
        svg.style.position = "fixed";
        svg.style.left = "0";
        svg.style.top = "0";
        document.body.appendChild(svg);
        const g = document.createElementNS(ns, "g");
        g.setAttribute("transform", `rotate(${request.angleDegrees})`);
        const path = document.createElementNS(ns, "path");
        path.setAttribute("id", "spike-curve");
        path.setAttribute(
          "d",
          `M0 ${r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${-r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${r * k}`,
        );
        const defs = document.createElementNS(ns, "defs");
        defs.appendChild(path);
        g.appendChild(defs);
        const text = document.createElementNS(ns, "text");
        text.setAttribute("font-family", "SpikePoppins");
        text.setAttribute("font-size", String(request.fontSizeMm * k));
        text.setAttribute("font-weight", "600");
        text.setAttribute("letter-spacing", String(request.letterSpacingMm * k));
        text.setAttribute("text-anchor", "middle");
        if (request.inverted) text.setAttribute("dy", String(request.invertedDyMm * k));
        const textPath = document.createElementNS(ns, "textPath");
        textPath.setAttribute("href", "#spike-curve");
        textPath.setAttribute("startOffset", "50%");
        textPath.textContent = request.text;
        text.appendChild(textPath);
        g.appendChild(text);
        svg.appendChild(g);
        // Reference group without rotation: gives the viewBox-only mapping, so
        // the rotated group's positions come back in mm (root user units).
        const ref = document.createElementNS(ns, "g");
        svg.appendChild(ref);
        await document.fonts.ready;
        const ctm = text.getCTM();
        const refCtm = ref.getCTM();
        const rel = ctm && refCtm ? refCtm.inverse().multiply(ctm) : null;
        const glyphs: { x: number; y: number; rotation: number }[] = [];
        const n = text.getNumberOfChars();
        for (let i = 0; i < n; i += 1) {
          const p = text.getStartPositionOfChar(i);
          const q = rel ? p.matrixTransform(rel) : p;
          glyphs.push({
            x: q.x / k,
            y: q.y / k,
            rotation: text.getRotationOfChar(i) + request.angleDegrees,
          });
        }
        const out = {
          length: text.getComputedTextLength() / k,
          n,
          glyphs,
          loaded: document.fonts.check("600 20px SpikePoppins"),
        };
        svg.remove();
        return out;
      },
      { fontUrl: FONT_URL, request, half, r, sweep, k: PX_PER_MM },
    );

    expect(measured.loaded).toBe(true);
    const chars = Array.from(request.text);
    expect(measured.n).toBe(chars.length);

    // Criterion 6: advance length within 1 % of the browser's.
    const lengthDiff = Math.abs(measured.length - layout.totalAdvanceMm) / measured.length;
    // Criterion 7 (finer): per-glyph position / rotation vs browser.
    const report: string[] = [`length browser=${measured.length} spike=${layout.totalAdvanceMm} diff=${(lengthDiff * 100).toFixed(4)}%`];
    let maxPos = 0;
    let maxRot = 0;
    layout.glyphs.forEach((g, i) => {
      const b = measured.glyphs[i];
      // The browser's start position INCLUDES the editor's dy (glyph-local
      // outward shift); the spike's `origin` is the pre-dy pen position.
      const rad = (g.rotationDegrees * Math.PI) / 180;
      const dy = request.inverted ? request.invertedDyMm : 0;
      const ex = g.origin.x - dy * Math.sin(rad);
      const ey = g.origin.y + dy * Math.cos(rad);
      const dPos = Math.hypot(b.x - ex, b.y - ey);
      const dRot = Math.abs(((b.rotation - g.rotationDegrees + 540) % 360) - 180);
      maxPos = Math.max(maxPos, dPos);
      maxRot = Math.max(maxRot, dRot);
      report.push(`${i} '${g.char}' dPos=${dPos.toFixed(4)}mm dRot=${dRot.toFixed(3)}deg`);
    });
    report.push(`MAX dPos=${maxPos.toFixed(4)}mm dRot=${maxRot.toFixed(3)}deg`);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUT_DIR, `browser-compare-${sc.name.replace(/[^a-z0-9]+/gi, "_")}.txt`),
      report.join("\n") + "\n",
    );
    expect(lengthDiff, report[0]).toBeLessThanOrEqual(0.01);
    expect(maxPos, "per-glyph origin distance (mm)").toBeLessThanOrEqual(0.2);
    expect(maxRot, "per-glyph rotation (deg)").toBeLessThanOrEqual(0.5);
  });
}

/**
 * Re-frame an outline SVG (paths in millimetres) into device pixels so that it
 * is rasterised at the same scale as the reference text: the viewBox becomes
 * pixels and the path group is scaled by `k`.
 */
function outlineSvgInPixels(svg: string, k: number): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/);
  if (!viewBox) throw new Error("outline svg without viewBox");
  const [minX, minY, w, h] = viewBox[1].split(/\s+/).map(Number);
  const n = (v: number) => Number(v.toFixed(6));
  return svg
    .replace(/width="[^"]+"/, `width="${n(w * k)}"`)
    .replace(/height="[^"]+"/, `height="${n(h * k)}"`)
    .replace(/viewBox="[^"]+"/, `viewBox="${n(minX * k)} ${n(minY * k)} ${n(w * k)} ${n(h * k)}"`)
    .replace(`<g id="spike-text-outlines"`, `<g transform="scale(${k})" id="spike-text-outlines"`);
}

// Visual comparison (criterion 7). Both documents are rasterised ONLY inside
// the test page to compare pixels; the product artefact stays vector.
//
// The reference is framed in DEVICE PIXELS (1 mm = 24 px) so that Chromium
// lays the text out at the size at which it is rasterised: framed in
// millimetre user units the browser lays the text out at a ~1.3 px em and
// grid-fits the glyphs there before magnifying them with the CTM (measured:
// IoU 0.77 against the outline instead of 0.92).
//
// The fidelity criterion is a PHYSICAL ink-to-ink deviation (mm), not a
// relative ink-AREA ratio: the area ratio compares a hinted glyph raster with
// an unhinted vector raster, and at a 32 px em the two differ by up to 5 % of
// area for the SAME outlines (measured per glyph). The deviation measures
// geometry: 0.00-0.04 mm for correct outlines.
for (const sc of scenarios) {
  test(`visual overlay editor-style text vs outline SVG: ${sc.name}`, async ({ page }) => {
    await page.goto("/spikes/typography/harness.html");
    const { request, frame } = makeRequest(sc.s);
    const built = buildSpikeSvg(handle, {
      outerDiameterMm: sc.s.outer,
      innerDiameterMm: sc.s.inner,
      strategy: "band-thickness",
      sizeFactor: frame.sizeFactor,
      request,
      rings: false,
    });
    if (!built.ok) throw new Error("svg");
    const half = sc.s.outer / 2;
    const r = request.baselineRadiusMm;
    const sweep = request.inverted ? 0 : 1;
    const fontB64 = bytes.toString("base64");
    const k = PX_PER_MM;
    const px = Math.round(sc.s.outer * k);
    // Sensitivity control: the same outline displaced by 0.5 mm — 2.5x the
    // documented 0.2 mm tolerance — is a real geometric error and must be
    // visible to the criterion below. The shift is applied INSIDE the pixel
    // scaling, so 0.5 mm = 12 device px.
    const shiftedSvg = outlineSvgInPixels(built.svg, k).replace(
      `<g transform="scale(${k})" id="spike-text-outlines"`,
      `<g transform="scale(${k}) translate(0.5 0)" id="spike-text-outlines"`,
    );
    const textSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half * k} ${-half * k} ${sc.s.outer * k} ${sc.s.outer * k}">` +
      `<style>@font-face{font-family:SpikePoppins;font-weight:600;src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
      `<defs><path id="c" d="M0 ${r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${-r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${r * k}"/></defs>` +
      `<g transform="rotate(${request.angleDegrees})"><text font-family="SpikePoppins" font-size="${request.fontSizeMm * k}" font-weight="600" letter-spacing="${request.letterSpacingMm * k}" text-anchor="middle"${request.inverted ? ` dy="${request.invertedDyMm * k}"` : ""} fill="#000">` +
      `<textPath href="#c" startOffset="50%">${request.text.replace(/&/g, "&amp;")}</textPath></text></g></svg>`;

    const result = await page.evaluate(
      async ({ textSvg, outlineSvg, shiftedSvg, px, sideMm, tolMm, win }) => {
        const draw = async (svg: string, settle: boolean) => {
          const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          const img = new Image();
          img.src = url;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = px;
          canvas.height = px;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          const paint = () => {
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, px, px);
            ctx.drawImage(img, 0, 0, px, px);
          };
          paint();
          // Data-URI fonts inside SVG images may resolve a frame late.
          if (settle) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            paint();
          }
          URL.revokeObjectURL(url);
          return ctx.getImageData(0, 0, px, px).data;
        };
        const maskOf = (data: Uint8ClampedArray) => {
          const mask = new Uint8Array(px * px);
          for (let i = 0; i < data.length; i += 4) mask[i / 4] = data[i] < 128 ? 1 : 0;
          return mask;
        };
        const maskA = maskOf(await draw(textSvg, true));
        const maskB = maskOf(await draw(outlineSvg, false));
        const maskShifted = maskOf(await draw(shiftedSvg, false));
        const pxPerMm = px / sideMm;
        const reach = Math.ceil(tolMm * pxPerMm);
        // Divergence in mm: share of ink pixels with NO ink of the other
        // rendering within `reach` px (= tolerance mm * px/mm), both ways.
        const far = (from: Uint8Array, to: Uint8Array) => {
          let bad = 0;
          let total = 0;
          for (let y = 0; y < px; y += 1) {
            for (let x = 0; x < px; x += 1) {
              if (!from[y * px + x]) continue;
              total += 1;
              let found = false;
              for (let dy = -reach; dy <= reach && !found; dy += 1) {
                const yy = y + dy;
                if (yy < 0 || yy >= px) continue;
                for (let dx = -reach; dx <= reach; dx += 1) {
                  const xx = x + dx;
                  if (xx < 0 || xx >= px) continue;
                  if (dx * dx + dy * dy <= reach * reach && to[yy * px + xx]) {
                    found = true;
                    break;
                  }
                }
              }
              if (!found) bad += 1;
            }
          }
          return total ? bad / total : 0;
        };
        // Physical ink-to-ink deviation (mm): for every ink pixel, the
        // distance to the nearest ink pixel of the other rendering.
        const deviation = (from: Uint8Array, to: Uint8Array) => {
          let sum = 0;
          let count = 0;
          let max = 0;
          let beyond = 0;
          for (let y = 0; y < px; y += 1) {
            for (let x = 0; x < px; x += 1) {
              if (!from[y * px + x]) continue;
              count += 1;
              let best = -1;
              for (let dy = -win; dy <= win; dy += 1) {
                const yy = y + dy;
                if (yy < 0 || yy >= px) continue;
                for (let dx = -win; dx <= win; dx += 1) {
                  const xx = x + dx;
                  if (xx < 0 || xx >= px) continue;
                  if (to[yy * px + xx]) {
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (best < 0 || d < best) best = d;
                    if (best === 0) break;
                  }
                }
                if (best === 0) break;
              }
              if (best < 0) {
                beyond += 1;
                sum += win;
                if (win > max) max = win;
                continue;
              }
              sum += best;
              if (best > max) max = best;
            }
          }
          return {
            meanMm: count ? sum / count / pxPerMm : 0,
            maxMm: max / pxPerMm,
            beyond,
          };
        };
        const pair = (maskOther: Uint8Array) => {
          let inkA = 0;
          let inkB = 0;
          let inter = 0;
          let union = 0;
          for (let i = 0; i < maskA.length; i += 1) {
            if (maskA[i]) inkA += 1;
            if (maskOther[i]) inkB += 1;
            if (maskA[i] && maskOther[i]) inter += 1;
            if (maskA[i] || maskOther[i]) union += 1;
          }
          const ab = deviation(maskA, maskOther);
          const ba = deviation(maskOther, maskA);
          return {
            inkA,
            inkB,
            inkAreaDiffPct: (Math.abs(inkA - inkB) / inkA) * 100,
            iou: union ? inter / union : 1,
            farTextFromOutline: far(maskA, maskOther),
            farOutlineFromText: far(maskOther, maskA),
            devMeanMm: Math.max(ab.meanMm, ba.meanMm),
            devMaxMm: Math.max(ab.maxMm, ba.maxMm),
            devBeyond: ab.beyond + ba.beyond,
          };
        };
        return { aligned: pair(maskB), displaced: pair(maskShifted), reach };
      },
      {
        textSvg,
        outlineSvg: outlineSvgInPixels(built.svg, k),
        shiftedSvg,
        px,
        sideMm: sc.s.outer,
        tolMm: 0.2,
        win: DEV_WINDOW_PX,
      },
    );

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      resolve(OUT_DIR, `visual-${sc.name.replace(/[^a-z0-9]+/gi, "_")}.txt`),
      JSON.stringify(result) + "\n",
    );
    const { aligned, displaced } = result;
    expect(aligned.inkA, "text reference rendered with the embedded font").toBeGreaterThan(500);
    expect(aligned.inkB).toBeGreaterThan(500);
    // Geometric fidelity, in millimetres (the reported tolerance): every ink
    // pixel of one rendering is within 0.2 mm of an ink pixel of the other,
    // and the mean deviation stays below 0.05 mm.
    expect(aligned.devMaxMm, JSON.stringify(result)).toBeLessThanOrEqual(0.2);
    expect(aligned.devMeanMm, JSON.stringify(result)).toBeLessThanOrEqual(0.05);
    expect(aligned.devBeyond, JSON.stringify(result)).toBe(0);
    // Criterion 7: max divergence <= 0.2 mm (<= 0.5 % antialias outliers).
    expect(aligned.farTextFromOutline, JSON.stringify(result)).toBeLessThanOrEqual(0.005);
    expect(aligned.farOutlineFromText, JSON.stringify(result)).toBeLessThanOrEqual(0.005);
    // Sensitivity control: a 0.5 mm displacement of the outline (2.5x the
    // documented tolerance) is a real geometric error and this criterion
    // must see it clearly.
    expect(displaced.devMeanMm, JSON.stringify(result)).toBeGreaterThan(
      aligned.devMeanMm * 5,
    );
    expect(displaced.devMeanMm, JSON.stringify(result)).toBeGreaterThan(0.05);
  });
}
