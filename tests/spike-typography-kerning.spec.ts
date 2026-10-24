/**
 * Stage 4 typography spike — REAL KERNING (Lato SemiBold 2.015).
 * ISOLATED from the product: imports only the spike modules and, read-only,
 * the lab's frame math (strategy B numbers come from the lab's own functions).
 *
 * The browser (Chromium/HarfBuzz) is the independent reference. Nothing here
 * is tuned to pass: tolerances are the ones fixed in the Stage 4 report
 * (length <= 1 %, per-glyph position <= 0.2 mm, rotation <= 0.5 deg, visual
 * divergence <= 0.2 mm) and every measured value is written to
 * test-results/spike-typography/ for review.
 *
 * TWO MEASUREMENT FIXES (2026-10-24), both verified against Chromium:
 *
 * 1) The browser reference is framed in DEVICE PIXELS (1 mm = 24 px). Framed
 *    in millimetre user units, Chromium lays the text out at a ~1.3 px em and
 *    grid-fits the glyphs there before magnifying them with the CTM: the
 *    reference then reached only IoU 0.77 against the outline (0.92 with the
 *    device-pixel framing) and a total-length error up to 9x larger. The
 *    reference now describes the same text at the size it is compared at.
 *
 * 2) The visual criterion is a PHYSICAL ink-to-ink deviation (mm), not a
 *    relative ink-AREA ratio. The area ratio compared a hinted glyph raster
 *    (Chromium text) with an unhinted vector raster (the outline): at a 32 px
 *    em the two differ by up to 5 % of area for the SAME outlines (measured
 *    per glyph: 'H' 0.00 %, 'O' 5.3 %, 'T' 39 % at 16 px), so a 2 % area
 *    threshold could not be met even by a perfect outline. The deviation
 *    metric measures geometry: it is 0.00-0.04 mm for correct outlines and
 *    0.09-0.94 mm when the real kerning is dropped (sensitivity control).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import {
  buildSpikeSvg,
  layoutCurvedText,
  loadFontChecked,
  loadFontFromBuffer,
  type CurvedTextLayout,
  type CurvedTextRequest,
  type FontHandle,
} from "../spikes/typography/curvedTextOutlines";
import { createPhysicalFrame, resolveText } from "../src/production-lab/geometry";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FONT_DIR = resolve(HERE, "../spikes/typography/fonts/lato");
const FONT_FILE = resolve(FONT_DIR, "Lato-SemiBold.ttf");
const FONT_URL = "/spikes/typography/fonts/lato/Lato-SemiBold.ttf";
const FAMILY = "SpikeLato";
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

const ALL_ES =
  "áéíóúüñÁÉÍÓÚÜÑ¿¡&.,-:;!?()0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Kerning-heavy Spanish phrase: To, Té, Vi, Ya, Ta, AV, VA, AT, TA, ¿T ... */
const KERN_TEXT = "¿Té o Vino? ¡Ya, Tía Ana! AVATAR";
/** Characters whose pairwise kerning is checked against the browser. */
const PAIR_CHARS = Array.from("AVTYWLPFKRÁÑÓÚEaeoáéóuvywr.,¿¡-");

const gi = (c: string) => handle.font.charToGlyphIndex(c);
const kernOf = (pair: string) => handle.kern(gi(pair[0]), gi(pair[1]));

type Scenario = {
  outer: number;
  inner: number;
  angle: number;
  radius: number;
  scale: number;
  inverted: boolean;
};

function makeRequest(s: Scenario, text = KERN_TEXT) {
  const frameResult = createPhysicalFrame(s.outer, s.inner, "band-thickness");
  if (!frameResult.ok) throw new Error("frame");
  const frame = frameResult.frame;
  const placed = resolveText(
    {
      id: "t",
      text,
      fontFamily: "Lato",
      angle: s.angle,
      radius: s.radius,
      inverted: s.inverted,
      scale: s.scale,
    },
    frame,
  );
  if (placed.baselineRadiusMm === null) throw new Error("baseline");
  const request: CurvedTextRequest = {
    text,
    fontSizeMm: placed.fontSizeMm,
    letterSpacingMm: placed.letterSpacingMm,
    baselineRadiusMm: placed.baselineRadiusMm,
    angleDegrees: s.angle,
    inverted: s.inverted,
    invertedDyMm: placed.invertedDyMm ?? 0,
  };
  return { frame, request };
}

/** Same request laid out with kerning switched OFF (sensitivity control). */
function noKernHandle(): FontHandle {
  return { ...handle, kern: () => 0 };
}

const scenarios: { name: string; s: Scenario }[] = [
  { name: "85x50 normal top", s: { outer: 85, inner: 50, angle: 0, radius: 374, scale: 1, inverted: false } },
  { name: "85x50 inverted bottom", s: { outer: 85, inner: 50, angle: 180, radius: 330, scale: 1, inverted: true } },
  { name: "80x60 normal rotated 65", s: { outer: 80, inner: 60, angle: 65, radius: 374, scale: 1.2, inverted: false } },
  { name: "80x60 inverted rotated -150", s: { outer: 80, inner: 60, angle: -150, radius: 340, scale: 1, inverted: true } },
  { name: "75x65 normal rotated -35", s: { outer: 75, inner: 65, angle: -35, radius: 357.5, scale: 1, inverted: false } },
  { name: "75x65 inverted scale 1.5", s: { outer: 75, inner: 65, angle: 200, radius: 345, scale: 1.5, inverted: true } },
];

const slug = (name: string) => name.replace(/[^a-z0-9]+/gi, "_");

function writeOut(name: string, content: string) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, name), content);
}

// ---------------------------------------------------------------------------
// Provenance, coverage, kerning existence
// ---------------------------------------------------------------------------

test.describe("lato: provenance, coverage and kerning data", () => {
  test("font file matches the pinned official hash, name, version and OFL (RFN 'Lato')", () => {
    const sha = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    expect(sha).toBe("71B8B7DECBE75A881ED267BE539D402BD1E9420B799658AADA4E0D1BD5AF803C");
    expect(handle.postScriptName).toBe("Lato-SemiBold");
    expect(handle.version).toContain("Version 2.015");
    expect(handle.unitsPerEm).toBe(2000);
    const ofl = readFileSync(resolve(FONT_DIR, "OFL.txt"), "utf8");
    expect(ofl).toContain("SIL Open Font License, Version 1.1");
    // Lato DOES declare a Reserved Font Name: modified/subset copies must be renamed.
    expect(ofl.split("\n")[0]).toContain('Reserved Font Name "Lato"');
  });

  test("covers Spanish characters with real outlines (100%)", () => {
    const missing = Array.from(ALL_ES).filter((c) => gi(c) === 0);
    expect(missing).toEqual([]);
    for (const c of Array.from(ALL_ES)) {
      expect(handle.font.glyphs.get(gi(c)).path.commands.length, c).toBeGreaterThan(0);
    }
  });

  test("kerning exists in GPOS (Extension lookups) and opentype.js alone silently drops it", () => {
    expect(handle.kerningSource).toEqual({
      kind: "gpos",
      script: "latn",
      langSys: "dflt",
      lookups: [0],
    });
    // Regression pins read from the font file (independently checked against
    // the browser in the pair test below).
    const pins: Record<string, number> = {
      AV: -112, VA: -112, AT: -141, To: -242, Te: -242, Ta: -224, Yá: -224,
      LT: -183, "P.": -194, "F,": -174, "¿T": -168, Áv: -82, Ña: -28, Wa: -118,
    };
    for (const [pair, value] of Object.entries(pins)) expect(kernOf(pair), pair).toBe(value);
    // DOCUMENTED DIVERGENCE: opentype.js 2.0.0 cannot read GPOS lookup type 9
    // and returns 0 for every one of those pairs, with no error.
    const lookups = (handle.font.tables as unknown as {
      gpos: { lookups: { lookupType: number; subtables: { error?: string }[] }[] };
    }).gpos.lookups;
    expect(lookups[0].lookupType).toBe(9);
    expect(lookups[0].subtables[0].error).toBe("GPOS Lookup 9 not supported");
    for (const pair of Object.keys(pins)) {
      expect(handle.font.getKerningValue(gi(pair[0]), gi(pair[1])), pair).toBe(0);
    }
    const nonZero = PAIR_CHARS.flatMap((a) => PAIR_CHARS.map((b) => a + b)).filter(
      (p) => kernOf(p) !== 0,
    );
    expect(nonZero.length).toBeGreaterThan(300);
  });

  test("unsupported kerning fails closed (KERNING_UNSUPPORTED), never zero", () => {
    // Patch a COPY: turn the first Extension subtable's wrapped type 2 into 3.
    const copy = arrayBuffer.slice(0);
    const v = new DataView(copy);
    let gpos = -1;
    for (let i = 0; i < v.getUint16(4); i += 1) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(...[0, 1, 2, 3].map((k) => v.getUint8(rec + k)));
      if (tag === "GPOS") gpos = v.getUint32(rec + 8);
    }
    expect(gpos).toBeGreaterThan(0);
    const lookupList = gpos + v.getUint16(gpos + 8);
    const lookup0 = lookupList + v.getUint16(lookupList + 2);
    expect(v.getUint16(lookup0)).toBe(9);
    const ext0 = lookup0 + v.getUint16(lookup0 + 6);
    expect(v.getUint16(ext0 + 2)).toBe(2);
    v.setUint16(ext0 + 2, 3);
    const result = loadFontChecked(copy);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KERNING_UNSUPPORTED");
      expect(result.reason).toContain("tipo 3");
    }
  });
});

// ---------------------------------------------------------------------------
// Browser references
// ---------------------------------------------------------------------------

async function loadFace(page: Page) {
  await page.goto("/spikes/typography/harness.html");
  await page.evaluate(
    async ({ url, family }) => {
      const face = new FontFace(family, `url(${url})`, { weight: "600" });
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
    },
    { url: FONT_URL, family: FAMILY },
  );
}

test("pairwise kerning: browser advance deltas == advance + kern (+ spacing), straight text", async ({ page }) => {
  await loadFace(page);
  const pairs = PAIR_CHARS.flatMap((a) => PAIR_CHARS.map((b) => a + b));
  const upm = handle.unitsPerEm;
  const spacing = 100; // non-zero like the editor (keeps optional ligatures off)
  const measured = await page.evaluate(
    ({ pairs, upm, spacing, family }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 10000 4000");
      svg.setAttribute("width", "1000");
      svg.setAttribute("height", "400");
      document.body.appendChild(svg);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("font-family", family);
      text.setAttribute("font-weight", "600");
      text.setAttribute("font-size", String(upm)); // 1 user unit = 1 font unit
      text.setAttribute("letter-spacing", String(spacing));
      text.setAttribute("x", "100");
      text.setAttribute("y", "3000");
      svg.appendChild(text);
      const out: number[] = [];
      for (const pair of pairs) {
        text.textContent = pair;
        out.push(text.getStartPositionOfChar(1).x - text.getStartPositionOfChar(0).x);
      }
      svg.remove();
      return out;
    },
    { pairs, upm, spacing, family: FAMILY },
  );
  const lines: string[] = [];
  let maxErr = 0;
  let kernedPairs = 0;
  let maxKernAbs = 0;
  let worstNoKern = 0;
  pairs.forEach((pair, i) => {
    const adv = handle.font.glyphs.get(gi(pair[0])).advanceWidth ?? 0;
    const kern = kernOf(pair);
    const expected = adv + kern + spacing;
    const err = Math.abs(measured[i] - expected);
    const errNoKern = Math.abs(measured[i] - (adv + spacing));
    if (kern !== 0) {
      kernedPairs += 1;
      maxKernAbs = Math.max(maxKernAbs, Math.abs(kern));
      worstNoKern = Math.max(worstNoKern, errNoKern);
    }
    maxErr = Math.max(maxErr, err);
    if (err > 0.5 || kern !== 0)
      lines.push(`${pair} browser=${measured[i].toFixed(3)} spike=${expected} kern=${kern} err=${err.toFixed(3)}`);
  });
  lines.unshift(
    `pairs=${pairs.length} kerned=${kernedPairs} maxErr(font units)=${maxErr.toFixed(4)} maxErrIfKernIgnored=${worstNoKern.toFixed(1)} maxKern=${maxKernAbs}`,
  );
  writeOut("lato-pairs-browser.txt", lines.join("\n") + "\n");
  expect(kernedPairs).toBeGreaterThan(300);
  // <= 1 font unit = 0.05 % em: float noise only; kerning is up to 244 units.
  expect(maxErr, lines[0]).toBeLessThanOrEqual(1);
  // Sensitivity: ignoring kerning would be off by the largest kern value.
  expect(worstNoKern).toBeGreaterThanOrEqual(maxKernAbs - 1);
});

type BrowserGlyph = { x: number; y: number; rotation: number };

/**
 * Browser reference, framed in DEVICE PIXELS.
 *
 * The reference viewBox is expressed in pixels (1 mm = PX_PER_MM px) so that
 * Chromium lays the text out at the size at which it is compared. Framed in
 * millimetre user units the browser lays the text out at a ~1.3 px em (the
 * 75x65 scenario) and grid-fits the glyphs there before magnifying them with
 * the CTM: measured against the outline that reference reached only
 * IoU 0.77 (instead of 0.92) and a total-length error up to 9x larger.
 * Positions and lengths come back in millimetres.
 */
async function measureCurved(page: Page, request: CurvedTextRequest, half: number) {
  const r = request.baselineRadiusMm;
  const sweep = request.inverted ? 0 : 1;
  const k = PX_PER_MM;
  return page.evaluate(
    ({ request, half, r, sweep, family, k }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", String(half * 2 * k));
      svg.setAttribute("height", String(half * 2 * k));
      svg.setAttribute("viewBox", `${-half * k} ${-half * k} ${half * 2 * k} ${half * 2 * k}`);
      document.body.appendChild(svg);
      const g = document.createElementNS(ns, "g");
      g.setAttribute("transform", `rotate(${request.angleDegrees})`);
      const defs = document.createElementNS(ns, "defs");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("id", "spike-curve");
      path.setAttribute("d", `M0 ${r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${-r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${r * k}`);
      defs.appendChild(path);
      g.appendChild(defs);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("font-family", family);
      text.setAttribute("font-size", String(request.fontSizeMm * k));
      text.setAttribute("font-weight", "600");
      text.setAttribute("letter-spacing", String(request.letterSpacingMm * k));
      text.setAttribute("text-anchor", "middle");
      if (request.inverted) text.setAttribute("dy", String(request.invertedDyMm * k));
      const tp = document.createElementNS(ns, "textPath");
      tp.setAttribute("href", "#spike-curve");
      tp.setAttribute("startOffset", "50%");
      tp.textContent = request.text;
      text.appendChild(tp);
      g.appendChild(text);
      svg.appendChild(g);
      const ref = document.createElementNS(ns, "g");
      svg.appendChild(ref);
      const ctm = text.getCTM();
      const refCtm = ref.getCTM();
      const rel = ctm && refCtm ? refCtm.inverse().multiply(ctm) : null;
      const glyphs: { x: number; y: number; rotation: number }[] = [];
      for (let i = 0; i < text.getNumberOfChars(); i += 1) {
        const p = text.getStartPositionOfChar(i);
        const q = rel ? p.matrixTransform(rel) : p;
        glyphs.push({
          x: q.x / k,
          y: q.y / k,
          rotation: text.getRotationOfChar(i) + request.angleDegrees,
        });
      }
      const out = { length: text.getComputedTextLength() / k, glyphs };
      svg.remove();
      return out;
    },
    { request, half, r, sweep, family: FAMILY, k },
  );
}

function compare(layout: CurvedTextLayout, request: CurvedTextRequest, glyphs: BrowserGlyph[]) {
  let maxPos = 0;
  let maxRot = 0;
  const rows: string[] = [];
  layout.glyphs.forEach((g, i) => {
    const b = glyphs[i];
    const rad = (g.rotationDegrees * Math.PI) / 180;
    const dy = request.inverted ? request.invertedDyMm : 0;
    const ex = g.origin.x - dy * Math.sin(rad);
    const ey = g.origin.y + dy * Math.cos(rad);
    const dPos = Math.hypot(b.x - ex, b.y - ey);
    const dRot = Math.abs(((b.rotation - g.rotationDegrees + 540) % 360) - 180);
    maxPos = Math.max(maxPos, dPos);
    maxRot = Math.max(maxRot, dRot);
    rows.push(`${i} '${g.char}' kern=${g.kernMm.toFixed(4)}mm dPos=${dPos.toFixed(4)}mm dRot=${dRot.toFixed(3)}deg`);
  });
  return { maxPos, maxRot, rows };
}

for (const sc of scenarios) {
  test(`curved kerned text vs browser positions: ${sc.name}`, async ({ page }) => {
    await loadFace(page);
    const { request } = makeRequest(sc.s);
    const layout = layoutCurvedText(handle, request);
    const plain = layoutCurvedText(noKernHandle(), request);
    if (!layout.ok || !plain.ok) throw new Error("layout");
    expect(layout.glyphs.filter((g) => g.kernMm !== 0).length).toBeGreaterThanOrEqual(8);
    const measured = await measureCurved(page, request, sc.s.outer / 2);
    expect(measured.glyphs.length).toBe(Array.from(request.text).length);
    const withKern = compare(layout, request, measured.glyphs);
    const withoutKern = compare(plain, request, measured.glyphs);
    const lengthDiff = Math.abs(measured.length - layout.totalAdvanceMm) / measured.length;
    const lengthDiffNoKern = Math.abs(measured.length - plain.totalAdvanceMm) / measured.length;
    const header =
      `${sc.name}: fontSize=${request.fontSizeMm.toFixed(4)}mm baselineR=${request.baselineRadiusMm.toFixed(4)}mm\n` +
      `length browser=${measured.length.toFixed(4)} spike=${layout.totalAdvanceMm.toFixed(4)} diff=${(lengthDiff * 100).toFixed(4)}% | ignoring kern diff=${(lengthDiffNoKern * 100).toFixed(3)}%\n` +
      `MAX with kerning dPos=${withKern.maxPos.toFixed(4)}mm dRot=${withKern.maxRot.toFixed(3)}deg | ignoring kerning dPos=${withoutKern.maxPos.toFixed(4)}mm`;
    writeOut(`lato-curved-${slug(sc.name)}.txt`, header + "\n" + withKern.rows.join("\n") + "\n");
    expect(lengthDiff, header).toBeLessThanOrEqual(0.01);
    expect(withKern.maxPos, header).toBeLessThanOrEqual(0.2);
    expect(withKern.maxRot, header).toBeLessThanOrEqual(0.5);
    // Sensitivity (not a pass condition on the engine): the browser really
    // kerns, so dropping kerning must be measurably worse.
    expect(withoutKern.maxPos, header).toBeGreaterThan(withKern.maxPos * 2);
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

// Outline comparison: both documents rasterised ONLY inside the test page.
for (const sc of scenarios) {
  test(`curved kerned outlines vs browser text (visual): ${sc.name}`, async ({ page }) => {
    await page.goto("/spikes/typography/harness.html");
    const { request, frame } = makeRequest(sc.s);
    const build = (font: FontHandle) => {
      const r = buildSpikeSvg(font, {
        outerDiameterMm: sc.s.outer,
        innerDiameterMm: sc.s.inner,
        strategy: "band-thickness",
        sizeFactor: frame.sizeFactor,
        request,
        rings: false,
      });
      if (!r.ok) throw new Error("svg");
      return r.svg;
    };
    const outlineSvg = build(handle);
    // Sensitivity control: the same outline without real kerning is a genuine
    // geometric error and must be visible to the criterion below.
    const plainSvg = build(noKernHandle());
    const half = sc.s.outer / 2;
    const r = request.baselineRadiusMm;
    const sweep = request.inverted ? 0 : 1;
    const escaped = request.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const k = PX_PER_MM;
    const px = Math.round(sc.s.outer * k);
    // Reference in device pixels: Chromium lays the text out at the size at
    // which it is rasterised (see measureCurved).
    const textSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half * k} ${-half * k} ${sc.s.outer * k} ${sc.s.outer * k}">` +
      `<style>@font-face{font-family:${FAMILY};font-weight:600;src:url(data:font/ttf;base64,${bytes.toString("base64")}) format("truetype")}</style>` +
      `<defs><path id="c" d="M0 ${r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${-r * k} A${r * k} ${r * k} 0 0 ${sweep} 0 ${r * k}"/></defs>` +
      `<g transform="rotate(${request.angleDegrees})"><text font-family="${FAMILY}" font-size="${request.fontSizeMm * k}" font-weight="600" letter-spacing="${request.letterSpacingMm * k}" text-anchor="middle"${request.inverted ? ` dy="${request.invertedDyMm * k}"` : ""} fill="#000">` +
      `<textPath href="#c" startOffset="50%">${escaped}</textPath></text></g></svg>`;
    const result = await page.evaluate(
      async ({ textSvg, outlineSvg, plainSvg, px, sideMm, tolMm, win }) => {
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
          if (settle) {
            await new Promise((done) => setTimeout(done, 400));
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
        const maskPlain = maskOf(await draw(plainSvg, false));
        const pxPerMm = px / sideMm;
        const reach = Math.ceil(tolMm * pxPerMm);
        // Share of ink pixels with NO ink of the other rendering within
        // `reach` px (= tolerance mm * px/mm), both ways.
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
        // distance to the nearest ink pixel of the other rendering. This is
        // the geometric criterion; the relative ink-AREA ratio is NOT usable
        // (see the file header).
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
        return { withKerning: pair(maskB), withoutKerning: pair(maskPlain), reach };
      },
      {
        textSvg,
        outlineSvg: outlineSvgInPixels(outlineSvg, k),
        plainSvg: outlineSvgInPixels(plainSvg, k),
        px,
        sideMm: sc.s.outer,
        tolMm: 0.2,
        win: DEV_WINDOW_PX,
      },
    );
    writeOut(`lato-visual-${slug(sc.name)}.txt`, JSON.stringify(result) + "\n");
    const { withKerning, withoutKerning } = result;
    expect(withKerning.inkA, "reference text rendered with the embedded font").toBeGreaterThan(500);
    expect(withKerning.inkB).toBeGreaterThan(500);
    // Geometric fidelity, in millimetres (the reported tolerance): every ink
    // pixel of one rendering is within 0.2 mm of an ink pixel of the other,
    // and the mean deviation stays below 0.05 mm.
    expect(withKerning.devMaxMm, JSON.stringify(result)).toBeLessThanOrEqual(0.2);
    expect(withKerning.devMeanMm, JSON.stringify(result)).toBeLessThanOrEqual(0.05);
    expect(withKerning.devBeyond, JSON.stringify(result)).toBe(0);
    // Criterion 7: max divergence <= 0.2 mm (<= 0.5 % antialias outliers).
    expect(withKerning.farTextFromOutline, JSON.stringify(result)).toBeLessThanOrEqual(0.005);
    expect(withKerning.farOutlineFromText, JSON.stringify(result)).toBeLessThanOrEqual(0.005);
    // Sensitivity control: dropping real kerning is a real geometric error
    // and this criterion must see it clearly.
    expect(withoutKerning.devMaxMm, JSON.stringify(result)).toBeGreaterThan(
      withKerning.devMaxMm,
    );
    expect(withoutKerning.devMeanMm, JSON.stringify(result)).toBeGreaterThan(
      withKerning.devMeanMm * 5,
    );
  });
}

test("lato: determinism and example SVGs for the three ferrule sizes (strategy B)", () => {
  const sizes = [
    { outer: 85, inner: 50 },
    { outer: 80, inner: 60 },
    { outer: 75, inner: 65 },
  ];
  const hashes: string[] = [];
  for (const size of sizes) {
    const s: Scenario = { ...size, angle: 0, radius: 374, scale: 1, inverted: false };
    const build = (h: FontHandle) => {
      const { frame, request } = makeRequest(s);
      const r = buildSpikeSvg(h, {
        outerDiameterMm: size.outer,
        innerDiameterMm: size.inner,
        strategy: "band-thickness",
        sizeFactor: frame.sizeFactor,
        request,
      });
      if (!r.ok) throw new Error("svg");
      return r.svg;
    };
    const first = build(handle);
    expect(build(handle)).toBe(first);
    expect(build(loadFontFromBuffer(arrayBuffer))).toBe(first);
    expect(first).toContain(`width="${size.outer}mm" height="${size.outer}mm"`);
    expect(first).toContain(`data-font="Lato-SemiBold"`);
    expect(first).not.toMatch(/<text|<image|data:|href=|url\(|font-family|<style/i);
    // Kerning changes geometry: the SVG differs from a kerning-free build.
    expect(build(noKernHandle())).not.toBe(first);
    hashes.push(`${size.outer}/${size.inner} ${createHash("sha256").update(first).digest("hex")}`);
    writeOut(`spike-lato-semibold-${size.outer}x${size.inner}-B.svg`, first);
  }
  writeOut("hashes-lato.txt", hashes.join("\n") + "\n");
});
