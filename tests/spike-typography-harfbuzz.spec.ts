/**
 * Stage 4 typography spike — HARFBUZZ PARITY (isolated).
 *
 * ISOLATED from the product: it starts its OWN Vite server (the isolated
 * harness in spikes/typography/hb-harness) and never touches the product's
 * configuration, editor, admin, snapshots or exporters.
 *
 * WHAT IS PROVEN HERE:
 *  1. the WASM shaper loads in dev (and in build, see the build test);
 *  2. with HarfBuzz, Lato's 12 GSUB ligature sequences (fi, ti, ff, tt, ...)
 *     reproduce the BROWSER's advances exactly (the divergence measured
 *     without shaping was up to 3.7 % of the em);
 *  3. the whole 5625-pair sweep matches Chromium within the browser's own
 *     layout quantisation (1/64 px);
 *  4. Dancing Script's contextual substitution ("or") and its variable weight
 *     axis (wght 400/600/700) reproduce the browser;
 *  5. the curved SVG (85/50, 80/60, 75/65; normal, inverted, rotated) stays
 *     inside the tolerances already fixed by the Stage 4 report;
 *  6. the output is deterministic and Spanish characters are covered;
 *  7. unsupported input still fails closed (no silent substitution).
 *
 * The thresholds are NOT relaxed: they are the ones already in force in
 * tests/spike-typography*.spec.ts (length <= 1 %, position <= 0.2 mm,
 * rotation <= 0.5 deg, visual deviation <= 0.2 mm) plus the browser's own
 * 1/64 px layout quantisation for advances.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { createPhysicalFrame, resolveText } from "../src/production-lab/geometry";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const HARNESS_CONFIG = resolve(HERE, "../spikes/typography/hb-harness/vite.config.ts");
const HARNESS_URL = "http://127.0.0.1:4180/spikes/typography/hb-harness/index.html";
const FONT_LATO = "/spikes/typography/fonts/lato/Lato-SemiBold.ttf";
const FONT_POPPINS = "/spikes/typography/fonts/poppins/Poppins-SemiBold.ttf";
const FONT_DANCING = "/spikes/typography/fonts/dancingscript/DancingScript[wght].ttf";
/** The browser lays text out with 1/64 px granularity (LayoutUnit). */
const LAYOUT_QUANTUM_PX = 1 / 64;
const FONT_SIZE_PX = 100;

let server: ViteDevServer;

test.beforeAll(async () => {
  server = await createServer({
    configFile: HARNESS_CONFIG,
    server: { port: 4180, strictPort: true, host: "127.0.0.1" },
  });
  await server.listen();
});

test.afterAll(async () => {
  await server?.close();
});

async function openHarness(page: Page, fonts: string[], weight = "600") {
  // Instrumentation: surface the browser's console errors and uncaught
  // exceptions in the test output (they are NOT swallowed by any assertion).
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      console.log(`[browser:${m.type()}] ${m.text().slice(0, 400)}`);
    }
  });
  page.on("pageerror", (e) =>
    console.log(
      `[browser:pageerror] ${e.name}: ${e.message.slice(0, 200)} | stack: ${(e.stack ?? "").slice(0, 500)}`,
    ),
  );
  page.on("requestfailed", (r) =>
    console.log(`[browser:requestfailed] ${r.url()} ${r.failure()?.errorText}`),
  );
  await page.goto(HARNESS_URL);
  await page.evaluate(async ({ fontUrls, weight }) => {
    for (const url of fontUrls) {
      // The weight descriptor matters for VARIABLE fonts: with a single value
      // the browser pins the face to that instance, so a reference rendered at
      // 600 could not be compared with an engine run at 400 or 700.
      const face = new FontFace("SpikeRef", `url(${url})`, { weight });
      await face.load();
      document.fonts.add(face);
    }
    await document.fonts.ready;
  }, { fontUrls: fonts, weight });
  await page.waitForFunction(() => Boolean((window as unknown as { hb?: unknown }).hb));
}

/** Advance of a text in the browser, at FONT_SIZE_PX. */
async function browserAdvances(
  page: Page,
  texts: string[],
  weight = "600",
): Promise<number[]> {
  return page.evaluate(
    ({ texts, size, weight }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      document.body.appendChild(svg);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("font-family", "SpikeRef");
      text.setAttribute("font-weight", weight);
      text.setAttribute("font-size", String(size));
      svg.appendChild(text);
      const out: number[] = [];
      for (const t of texts) {
        text.textContent = t;
        out.push(text.getComputedTextLength());
      }
      svg.remove();
      return out;
    },
    { texts, size: FONT_SIZE_PX, weight },
  );
}

/** Advance (px) of each text, shaped by HarfBuzz in the harness page. */
async function harfBuzzAdvances(
  page: Page,
  fontUrl: string,
  texts: string[],
  options: { variations?: { tag: string; value: number }[] } = {},
): Promise<{ ok: boolean; advancePx: number; code?: string }[]> {
  return page.evaluate(
    async ({ fontUrl, texts, options }) => {
      const api = (window as unknown as {
        hb: {
          shapeAdvances: (
            url: string,
            t: string[],
            o: { variations?: { tag: string; value: number }[] },
          ) => Promise<{ ok: boolean; advanceUnits: number; code?: string }[]>;
        };
      }).hb;
      const raw = await api.shapeAdvances(fontUrl, texts, options);
      return raw.map((r) => ({
        ok: r.ok,
        advancePx: r.advanceUnits,
        code: r.code,
      }));
    },
    { fontUrl, texts, options },
  ) as Promise<{ ok: boolean; advancePx: number; code?: string }[]>;
}

test.describe("harfbuzz spike", () => {
  test("the WASM shaper loads in the isolated dev harness and reports its version", async ({
    page,
  }) => {
    await openHarness(page, [FONT_LATO]);
    const version = await page.evaluate(
      () => (window as unknown as { hb: { version: string } }).hb.version,
    );
    expect(typeof version).toBe("string");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("lato: the 12 GSUB sequences that diverged now match the browser", async ({
    page,
  }) => {
    await openHarness(page, [FONT_LATO]);
    const pairs = ["ff", "fi", "fj", "fk", "fb", "fh", "ft", "tf", "ti", "tt", "fí"];
    const browser = await browserAdvances(page, pairs);
    const shaped = await harfBuzzAdvances(page, FONT_LATO, pairs);
    const upm = 2000;
    const rows = pairs.map((pair, i) => {
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      return `${pair}: browser=${browser[i].toFixed(4)} harfbuzz=${expected.toFixed(4)} delta=${(browser[i] - expected).toFixed(4)}`;
    });
    for (let i = 0; i < pairs.length; i += 1) {
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      expect(
        Math.abs(browser[i] - expected),
        `${pairs[i]} browser=${browser[i]} harfbuzz=${expected}`,
      ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
    }
    expect(rows.length).toBe(pairs.length);
  });

  test("lato: the whole 5625-pair sweep matches the browser within 1/64 px", async ({
    page,
  }) => {
    await openHarness(page, [FONT_LATO]);
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789áéíóúüñ¿¡&.,-";
    const pairs: string[] = [];
    for (const a of chars) for (const b of chars) pairs.push(a + b);
    const browser = await browserAdvances(page, pairs);
    const shaped = await harfBuzzAdvances(page, FONT_LATO, pairs);
    const upm = 2000;
    let worst = 0;
    let worstPair = "";
    for (let i = 0; i < pairs.length; i += 1) {
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      const delta = Math.abs(browser[i] - expected);
      if (delta > worst) {
        worst = delta;
        worstPair = pairs[i];
      }
    }
    expect(
      worst,
      `peor par '${worstPair}' (browser vs HarfBuzz)`,
    ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
  });

  test("poppins: parity is preserved (the engine that had 0 divergences)", async ({
    page,
  }) => {
    await openHarness(page, [FONT_POPPINS]);
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const pairs: string[] = [];
    for (const a of chars) for (const b of chars) pairs.push(a + b);
    const browser = await browserAdvances(page, pairs);
    const shaped = await harfBuzzAdvances(page, FONT_POPPINS, pairs);
    const upm = 1000;
    let worst = 0;
    for (let i = 0; i < pairs.length; i += 1) {
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      worst = Math.max(worst, Math.abs(browser[i] - expected));
    }
    expect(worst).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
  });

  test("dancing script: the contextual 'or' substitution and the wght axis match the browser", async ({
    page,
  }) => {
    // The reference must render the SAME instance the engine shapes: the
    // variable font is declared with its full weight range and every case
    // sets the text's weight explicitly.
    await openHarness(page, [FONT_DANCING], "400 700");
    const upm = 1000;
    // (a) the contextual substitution: 'or' was +4.013 px (4 % of em) apart.
    const pairs = ["or", "no", "ro", "on"];
    const browser = await browserAdvances(page, pairs, "400");
    const shaped = await harfBuzzAdvances(page, FONT_DANCING, pairs);
    for (let i = 0; i < pairs.length; i += 1) {
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      expect(
        Math.abs(browser[i] - expected),
        `${pairs[i]} browser=${browser[i]} harfbuzz=${expected}`,
      ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
    }
    // (b) the variable axis: the browser renders wght 400/600/700.
    const phrase = "¿Mate&Co! Edición física";
    for (const weight of [400, 600, 700]) {
      const browserOne = await browserAdvances(page, [phrase], String(weight));
      const hbOne = await harfBuzzAdvances(
        page,
        FONT_DANCING,
        [phrase],
        { variations: [{ tag: "wght", value: weight }] },
      );
      const expected = (hbOne[0].advancePx / upm) * FONT_SIZE_PX;
      expect(
        Math.abs(browserOne[0] - expected),
        `wght ${weight}: browser=${browserOne[0]} harfbuzz=${expected}`,
      ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
    }
  });

  test("dancing script: kerning with lookupFlag 8 + GDEF is applied, not refused", async ({
    page,
  }) => {
    await openHarness(page, [FONT_DANCING], "400 700");
    const pairs = ["AV", "To", "Ta", "Ya", "P."];
    const browser = await browserAdvances(page, pairs, "400");
    const shaped = await harfBuzzAdvances(page, FONT_DANCING, pairs);
    const upm = 1000;
    for (let i = 0; i < pairs.length; i += 1) {
      expect(shaped[i].ok, pairs[i]).toBe(true);
      const expected = (shaped[i].advancePx / upm) * FONT_SIZE_PX;
      expect(
        Math.abs(browser[i] - expected),
        `${pairs[i]} browser=${browser[i]} harfbuzz=${expected}`,
      ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
    }
  });

  test("dancing script: the outlines are the INSTANCED ones (wght 700 != wght 400)", async ({
    page,
  }) => {
    await openHarness(page, [FONT_DANCING]);
    const build = async (weight: number) =>
      page.evaluate(
        async ({ fontUrl, weight }) => {
          const api = (
            window as unknown as {
              hb: {
                build: (
                  url: string,
                  request: unknown,
                  options: unknown,
                ) => Promise<{ ok: boolean; svg?: string; code?: string }>;
              };
            }
          ).hb;
          const result = await api.build(
            fontUrl,
            {
              text: "Mate",
              fontSizeMm: 4.6756,
              letterSpacingMm: 0.2672,
              baselineRadiusMm: 34.084,
              angleDegrees: 0,
              inverted: false,
              invertedDyMm: 0,
              outerDiameterMm: 85,
              innerDiameterMm: 50,
              sizeFactor: 1,
            },
            { variations: [{ tag: "wght", value: weight }] },
          );
          return result;
        },
        { fontUrl: FONT_DANCING, weight },
      );
    const regular = await build(400);
    const bold = await build(700);
    expect(regular.ok).toBe(true);
    expect(bold.ok).toBe(true);
    // Different instances must produce different geometry.
    expect(bold.svg).not.toBe(regular.svg);
    // The bold instance is wider (bigger advance per glyph).
    const width = (svg: string) =>
      Math.max(
        ...[...svg.matchAll(/ d="([^"]+)"/g)].map((m) =>
          Math.max(...[...m[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((n) => Math.abs(Number(n[0])))),
        ),
      );
    expect(width(bold.svg!)).toBeGreaterThan(width(regular.svg!));
  });

  test("explicit failures: missing glyph and non-NFC text fail closed", async ({
    page,
  }) => {
    await openHarness(page, [FONT_LATO]);
    const result = await page.evaluate(
      async ({ fontUrl }) => {
        const api = (
          window as unknown as {
            hb: {
              build: (
                url: string,
                request: unknown,
                options: unknown,
              ) => Promise<{ ok: boolean; code?: string; reason?: string }>;
            };
          }
        ).hb;
        const base = {
          fontSizeMm: 4.6756,
          letterSpacingMm: 0.2672,
          baselineRadiusMm: 34.084,
          angleDegrees: 0,
          inverted: false,
          invertedDyMm: 0,
          outerDiameterMm: 85,
          innerDiameterMm: 50,
          sizeFactor: 1,
        };
        const missing = await api.build(fontUrl, { ...base, text: "☃" }, {});
        // "a" + U+0301 (decomposed): the precomposed "á" would be NFC and the
        // check would never trigger. Written explicitly so the intent is visible.
        const notNfc = await api.build(fontUrl, { ...base, text: "a\u0301" }, {});
        return { missing, notNfc };
      },
      { fontUrl: FONT_LATO },
    );
    expect(result.missing.ok).toBe(false);
    expect(result.missing.code).toBe("GLYPH_MISSING");
    expect(result.notNfc.ok).toBe(false);
    expect(result.notNfc.code).toBe("TEXT_NOT_NFC");
  });

  test("determinism: the same shaped input yields byte-identical SVG", async ({
    page,
  }) => {
    await openHarness(page, [FONT_LATO]);
    const builds = await page.evaluate(
      async ({ fontUrl }) => {
        const api = (
          window as unknown as {
            hb: {
              build: (
                url: string,
                request: unknown,
                options: unknown,
              ) => Promise<{ ok: boolean; svg?: string }>;
            };
          }
        ).hb;
        const request = {
          text: "fi ti AVATAR",
          fontSizeMm: 4.6756,
          letterSpacingMm: 0.2672,
          baselineRadiusMm: 34.084,
          angleDegrees: 0,
          inverted: false,
          invertedDyMm: 0,
          outerDiameterMm: 85,
          innerDiameterMm: 50,
          sizeFactor: 1,
        };
        const a = await api.build(fontUrl, request, {});
        const b = await api.build(fontUrl, request, {});
        const c = await api.build(fontUrl, request, {});
        return [a.svg, b.svg, c.svg];
      },
      { fontUrl: FONT_LATO },
    );
    expect(builds[0]).toBeTruthy();
    expect(builds[1]).toBe(builds[0]);
    expect(builds[2]).toBe(builds[0]);
  });

  test("Spanish characters are covered by the shaped run", async ({ page }) => {
    await openHarness(page, [FONT_LATO]);
    const all = "áéíóúüñÁÉÍÓÚÜÑ¿¡&.,-:;!?()0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const result = await page.evaluate(
      async ({ fontUrl, text }) => {
        const api = (
          window as unknown as {
            hb: {
              shapeAdvances: (
                url: string,
                t: string[],
                o: unknown,
              ) => Promise<{ ok: boolean; advanceUnits: number; code?: string }[]>;
            };
          }
        ).hb;
        const [r] = await api.shapeAdvances(fontUrl, [text], {});
        return r;
      },
      { fontUrl: FONT_LATO, text: all },
    );
    expect(result.ok).toBe(true);
    expect(result.advanceUnits).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// FASE 1 — Curved text: HarfBuzz outlines vs the browser's own <textPath>.
//
// Same methodology as the existing spike (tests/spike-typography*.spec.ts):
//   - the browser reference is framed in DEVICE PIXELS (1 mm = 24 px), so
//     Chromium lays the text out and rasterises it at the size it is compared
//     at;
//   - the geometry is compared in millimetres (position, rotation) and the
//     rendering is compared with a PHYSICAL ink-to-ink deviation in mm.
//
// The thresholds are the ones already in force (length <= 1 %, position
// <= 0.2 mm, rotation <= 0.5 deg, visual deviation <= 0.2 mm). They are NOT
// relaxed here.
// ---------------------------------------------------------------------------

const CURVE_TEXT = "¡Fiesta! Tía Ñandú — AVATAR";
const PX_PER_MM = 24;

const CURVE_SCENARIOS = [
  { name: "85x50 normal", outer: 85, inner: 50, angle: 0, radius: 374, scale: 1, inverted: false },
  { name: "85x50 inverted", outer: 85, inner: 50, angle: 180, radius: 374, scale: 1, inverted: true },
  { name: "80x60 normal rotated 65", outer: 80, inner: 60, angle: 65, radius: 374, scale: 1.2, inverted: false },
  { name: "80x60 inverted rotated -150", outer: 80, inner: 60, angle: -150, radius: 340, scale: 1, inverted: true },
  { name: "75x65 normal rotated -35", outer: 75, inner: 65, angle: -35, radius: 357.5, scale: 1, inverted: false },
  { name: "75x65 inverted scale 1.5", outer: 75, inner: 65, angle: 200, radius: 345, scale: 1.5, inverted: true },
];

type CurveFont = {
  label: string;
  url: string;
  /** Weight the browser must render (and the engine must shape). */
  weight: string;
  /** Variable axes for the engine, when the font is variable. */
  variations?: { tag: string; value: number }[];
};

/** Lab geometry (strategy B) — the same numbers the spike uses. */
function labRequest(sc: (typeof CURVE_SCENARIOS)[number], text: string) {
  const frameResult = createPhysicalFrame(sc.outer, sc.inner, "band-thickness");
  if (!frameResult.ok) throw new Error("frame");
  const frame = frameResult.frame;
  const placed = resolveText(
    {
      id: "t",
      text,
      fontFamily: "Lato",
      angle: sc.angle,
      radius: sc.radius,
      inverted: sc.inverted,
      scale: sc.scale,
    },
    frame,
  );
  if (placed.baselineRadiusMm === null) throw new Error("baseline");
  return {
    text,
    fontSizeMm: placed.fontSizeMm,
    letterSpacingMm: placed.letterSpacingMm,
    baselineRadiusMm: placed.baselineRadiusMm,
    angleDegrees: sc.angle,
    inverted: sc.inverted,
    invertedDyMm: placed.invertedDyMm ?? 0,
    outerDiameterMm: sc.outer,
    innerDiameterMm: sc.inner,
    sizeFactor: frame.sizeFactor,
  };
}

for (const font of [
  { label: "Poppins", url: FONT_POPPINS, weight: "600" },
  { label: "Lato", url: FONT_LATO, weight: "600" },
  {
    label: "Dancing Script",
    url: FONT_DANCING,
    weight: "600",
    variations: [{ tag: "wght", value: 600 }],
  },
] satisfies CurveFont[]) {
  test(`curved text vs Chromium: ${font.label}`, async ({ page }) => {
    test.setTimeout(180_000);
    await openHarness(page, [font.url], font.url === FONT_DANCING ? "400 700" : "600");

    for (const sc of CURVE_SCENARIOS) {
      const request = labRequest(sc, CURVE_TEXT);
      const result = await page.evaluate(
        async ({ fontUrl, weight, request, scenario, variations, text, pxPerMm }) => {
          const ns = "http://www.w3.org/2000/svg";
          const api = (
            window as unknown as {
              hb: {
                build: (
                  url: string,
                  request: unknown,
                  options: unknown,
                ) => Promise<{
                  ok: boolean;
                  svg?: string;
                  code?: string;
                  reason?: string;
                  totalAdvanceMm?: number;
                  clusters?: { text: string; advanceUnits: number }[];
                  glyphs?: {
                    char: string;
                    origin: { x: number; y: number };
                    rotationDegrees: number;
                  }[];
                }>;
              };
            }
          ).hb;

          // 1) the HarfBuzz outline, re-framed in device pixels
          const built = await api.build(
            fontUrl,
            request,
            variations ? { variations } : {},
          );
          if (!built.ok) {
            return { error: `${built.code}: ${built.reason}` };
          }
          const k = pxPerMm;
          const px = Math.round(scenario.outer * k);
          const half = (scenario.outer / 2) * k;
          const outlineSvg = built.svg!
            .replace(/width="[^"]+"/, `width="${px}"`)
            .replace(/height="[^"]+"/, `height="${px}"`)
            .replace(
              /viewBox="[^"]+"/,
              `viewBox="${-half} ${-half} ${scenario.outer * k} ${scenario.outer * k}"`,
            )
            .replace(
              `<g id="spike-text-outlines"`,
              `<g transform="scale(${k})" id="spike-text-outlines"`,
            );

          // 2) the browser reference, in device pixels
          const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          // The reference is rasterised as an SVG DOCUMENT (an image), and an
          // SVG image does NOT inherit the page's @font-face: the text would
          // fall back to a system font (43 % less ink) and the comparison
          // would be meaningless. The font is embedded in the SVG itself,
          // exactly like the existing spike specs do.
          const fontBytes = await (await fetch(fontUrl)).arrayBuffer();
          let binary = "";
          const bytesView = new Uint8Array(fontBytes);
          for (let i = 0; i < bytesView.length; i += 1) {
            binary += String.fromCharCode(bytesView[i]);
          }
          const fontB64 = btoa(binary);
          const r = request.baselineRadiusMm * k;
          const sweep = request.inverted ? 0 : 1;
          const refSvg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${scenario.outer * k} ${scenario.outer * k}">` +
            `<style>@font-face{font-family:"SpikeRef";font-weight:600;src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
            `<defs><path id="c" d="M0 ${r} A${r} ${r} 0 0 ${sweep} 0 ${-r} A${r} ${r} 0 0 ${sweep} 0 ${r}"/></defs>` +
            `<g transform="rotate(${request.angleDegrees})"><text font-family="SpikeRef" font-size="${request.fontSizeMm * k}" font-weight="${weight}" letter-spacing="${request.letterSpacingMm * k}" text-anchor="middle"${request.inverted ? ` dy="${request.invertedDyMm * k}"` : ""} fill="#000">` +
            `<textPath href="#c" startOffset="50%">${escaped}</textPath></text></g></svg>`;

          // 3) the browser's own geometry (per character)
          const dom = document.createElementNS(ns, "svg");
          dom.setAttribute("width", String(px));
          dom.setAttribute("height", String(px));
          dom.setAttribute("viewBox", `${-half} ${-half} ${scenario.outer * k} ${scenario.outer * k}`);
          document.body.appendChild(dom);
          const g = document.createElementNS(ns, "g");
          g.setAttribute("transform", `rotate(${request.angleDegrees})`);
          const defs = document.createElementNS(ns, "defs");
          const curve = document.createElementNS(ns, "path");
          curve.setAttribute("id", "ref-curve");
          curve.setAttribute(
            "d",
            `M0 ${r} A${r} ${r} 0 0 ${sweep} 0 ${-r} A${r} ${r} 0 0 ${sweep} 0 ${r}`,
          );
          defs.appendChild(curve);
          g.appendChild(defs);
          const t = document.createElementNS(ns, "text");
          t.setAttribute("font-family", "SpikeRef");
          t.setAttribute("font-size", String(request.fontSizeMm * k));
          t.setAttribute("font-weight", weight);
          t.setAttribute("letter-spacing", String(request.letterSpacingMm * k));
          t.setAttribute("text-anchor", "middle");
          if (request.inverted) t.setAttribute("dy", String(request.invertedDyMm * k));
          const tp = document.createElementNS(ns, "textPath");
          tp.setAttribute("href", "#ref-curve");
          tp.setAttribute("startOffset", "50%");
          tp.textContent = text;
          t.appendChild(tp);
          g.appendChild(t);
          dom.appendChild(g);
          const ref = document.createElementNS(ns, "g");
          dom.appendChild(ref);
          const ctm = t.getCTM();
          const refCtm = ref.getCTM();
          const rel = ctm && refCtm ? refCtm.inverse().multiply(ctm) : null;
          const chars: { x: number; y: number; rotation: number }[] = [];
          for (let i = 0; i < t.getNumberOfChars(); i += 1) {
            const p = t.getStartPositionOfChar(i);
            const q = rel ? p.matrixTransform(rel) : p;
            chars.push({
              x: q.x / k,
              y: q.y / k,
              rotation: t.getRotationOfChar(i) + request.angleDegrees,
            });
          }
          const browserLengthMm = t.getComputedTextLength() / k;
          dom.remove();

          // 4) rasterise both and measure the physical ink-to-ink deviation
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
          const a = await draw(refSvg, true);
          const b = await draw(outlineSvg, false);
          const maskA = new Uint8Array(px * px);
          const maskB = new Uint8Array(px * px);
          let inkA = 0;
          let inkB = 0;
          for (let i = 0; i < a.length; i += 4) {
            maskA[i / 4] = a[i] < 128 ? 1 : 0;
            maskB[i / 4] = b[i] < 128 ? 1 : 0;
            if (maskA[i / 4]) inkA += 1;
            if (maskB[i / 4]) inkB += 1;
          }
          const win = 16;
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
              meanMm: count ? sum / count / k : 0,
              maxMm: max / k,
              beyond,
            };
          };
          const dev = deviation(maskA, maskB);
          const devBack = deviation(maskB, maskA);
          return {
            browserLengthMm,
            spikeLengthMm: built.totalAdvanceMm,
            chars,
            glyphs: built.glyphs,
            clusters: built.clusters,
            devMeanMm: Math.max(dev.meanMm, devBack.meanMm),
            devMaxMm: Math.max(dev.maxMm, devBack.maxMm),
            devBeyond: dev.beyond + devBack.beyond,
            inkA,
            inkB,
          };
        },
        {
          fontUrl: font.url,
          weight: font.weight,
          request,
          scenario: sc,
          variations: font.variations,
          text: CURVE_TEXT,
          pxPerMm: PX_PER_MM,
        },
      );

      expect((result as { error?: string }).error, sc.name).toBeUndefined();
      const r = result as {
        browserLengthMm: number;
        spikeLengthMm: number;
        chars: { x: number; y: number; rotation: number }[];
        glyphs: {
          char: string;
          origin: { x: number; y: number };
          rotationDegrees: number;
        }[];
        clusters: { text: string }[];
        devMeanMm: number;
        devMaxMm: number;
        devBeyond: number;
        inkA: number;
        inkB: number;
      };

      // advance: <= 1 %
      const lengthDiff = Math.abs(r.browserLengthMm - r.spikeLengthMm) / r.browserLengthMm;
      expect(lengthDiff, `${sc.name} ${font.label} longitud`).toBeLessThanOrEqual(0.01);

      // position / rotation per character (a ligature cluster maps several
      // characters onto one glyph: the glyph carries the cluster's text).
      let maxPos = 0;
      let maxRot = 0;
      let cursor = 0;
      r.glyphs.forEach((glyph) => {
        const clusterLen = Math.max(1, glyph.char.length);
        for (let c = cursor; c < cursor + clusterLen; c += 1) {
          const b = r.chars[c];
          if (!b) continue;
          const rad = (glyph.rotationDegrees * Math.PI) / 180;
          const dy = request.inverted ? request.invertedDyMm : 0;
          const ex = glyph.origin.x - dy * Math.sin(rad);
          const ey = glyph.origin.y + dy * Math.cos(rad);
          maxPos = Math.max(maxPos, Math.hypot(b.x - ex, b.y - ey));
          maxRot = Math.max(maxRot, Math.abs(((b.rotation - glyph.rotationDegrees + 540) % 360) - 180));
        }
        cursor += clusterLen;
      });
      expect(maxPos, `${sc.name} ${font.label} posicion`).toBeLessThanOrEqual(0.2);
      expect(maxRot, `${sc.name} ${font.label} rotacion`).toBeLessThanOrEqual(0.5);

      // physical ink-to-ink deviation
      expect(r.devMaxMm, `${sc.name} ${font.label} desviacion`).toBeLessThanOrEqual(0.2);
      expect(r.devMeanMm, `${sc.name} ${font.label} desviacion media`).toBeLessThanOrEqual(0.05);
      expect(r.devBeyond, `${sc.name} ${font.label} pixeles sin pareja`).toBe(0);
      expect(r.inkA, `${sc.name} ${font.label} referencia`).toBeGreaterThan(500);
      expect(r.inkB, `${sc.name} ${font.label} contorno`).toBeGreaterThan(500);
    }
  });
}
