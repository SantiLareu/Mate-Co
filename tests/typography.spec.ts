/**
 * Motor tipográfico vectorial (src/typography) — regresión y compatibilidad.
 *
 * Estas pruebas ejercitan el motor DEL PRODUCTO contra el navegador, con la
 * misma metodología que el spike validado (Etapa 4):
 *   - la referencia del navegador se encuadra en píxeles de dispositivo, para
 *     que Chromium componga y rasterice el texto al tamaño en el que se
 *     compara, y la fuente va EMBEBIDA en el propio SVG (un SVG rasterizado
 *     como imagen no hereda las @font-face de la página);
 *   - la geometría se compara en milímetros y el renderizado con una
 *     desviación física tinta-tinta.
 *
 * Umbrales (los mismos del reporte de la Etapa 4, sin relajar):
 *   avance <= 1 %, posición <= 0,2 mm, rotación <= 0,5°, desviación <= 0,2 mm,
 *   y el avance contra el navegador dentro de la cuantización del propio
 *   navegador (1/64 px).
 */
import { expect, test, type Page } from "@playwright/test";
import { createPhysicalFrame, resolveText } from "../src/production-lab/geometry";

const PX_PER_MM = 24;
const LAYOUT_QUANTUM_PX = 1 / 64;
const CURVE_TEXT = "¡Fiesta! Tía Ñandú — AVATAR";
const GSUB_PAIRS = ["ff", "fi", "fj", "fk", "fb", "fh", "ft", "tf", "ti", "tt", "fí"];

const SCENARIOS = [
  { name: "85x50 normal", outer: 85, inner: 50, angle: 0, radius: 374, scale: 1, inverted: false },
  { name: "85x50 inverted", outer: 85, inner: 50, angle: 180, radius: 374, scale: 1, inverted: true },
  { name: "80x60 normal rotated 65", outer: 80, inner: 60, angle: 65, radius: 374, scale: 1.2, inverted: false },
  { name: "80x60 inverted rotated -150", outer: 80, inner: 60, angle: -150, radius: 340, scale: 1, inverted: true },
  { name: "75x65 normal rotated -35", outer: 75, inner: 65, angle: -35, radius: 357.5, scale: 1, inverted: false },
  { name: "75x65 inverted scale 1.5", outer: 75, inner: 65, angle: 200, radius: 345, scale: 1.5, inverted: true },
];

const FONTS = [
  { id: "poppins", label: "Poppins SemiBold", weight: 600, variable: false },
  { id: "lato", label: "Lato SemiBold", weight: 600, variable: false },
  { id: "dancing-script", label: "Dancing Script", weight: 600, variable: true },
] as const;

/** Carga el motor del producto en la página (el servidor de dev lo sirve). */
async function loadEngine(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const engine = await import("/src/typography/index.ts");
    (window as unknown as { engine: typeof engine }).engine = engine;
  });
}

/** Avance del navegador para una lista de textos, en px (font-size 100). */
async function browserAdvances(page: Page, texts: string[]): Promise<number[]> {
  return page.evaluate(
    ({ texts, size }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      document.body.appendChild(svg);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("font-family", "TypographyRef");
      text.setAttribute("font-weight", "600");
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
    { texts, size: 100 },
  );
}

/** Registra la fuente del producto como @font-face en la página. */
async function registerFace(page: Page, fontId: string, weight = "600") {
  await page.evaluate(
    async ({ fontId, weight }) => {
      const engine = (
        window as unknown as {
          engine: { TYPOGRAPHY_FONTS: Record<string, { url: string }> };
        }
      ).engine;
      const font = engine.TYPOGRAPHY_FONTS[fontId];
      const face = new FontFace("TypographyRef", `url(${font.url})`, { weight });
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
    },
    { fontId, weight },
  );
}

test.describe("motor tipográfico (src/typography)", () => {
  test("carga el WASM de HarfBuzz de forma diferida y reporta su versión", async ({
    page,
  }) => {
    await loadEngine(page);
    const info = await page.evaluate(async () => {
      const engine = (
        window as unknown as {
          engine: {
            warmUpTypography: () => Promise<void>;
            renderCurvedText: (spec: unknown) => Promise<{ ok: boolean }>;
          };
        }
      ).engine;
      const t0 = performance.now();
      await engine.warmUpTypography();
      const warmUpMs = performance.now() - t0;
      const result = await engine.renderCurvedText({
        text: "AVATAR",
        fontId: "poppins",
        fontSizeMm: 4.6756,
        letterSpacingMm: 0.2672,
        baselineRadiusMm: 34.084,
        angleDegrees: 0,
        inverted: false,
        invertedDyMm: 0,
      });
      return { warmUpMs, ok: result.ok };
    });
    expect(info.ok).toBe(true);
    expect(info.warmUpMs).toBeLessThan(5000);
  });

  test("reproduce el avance del navegador en los 11 pares GSUB de Lato", async ({
    page,
  }) => {
    await loadEngine(page);
    await registerFace(page, "lato");
    const browser = await browserAdvances(page, GSUB_PAIRS);
    const shaped = await page.evaluate(
      async ({ pairs }) => {
        const engine = (
          window as unknown as {
            engine: {
              renderCurvedText: (
                spec: unknown,
              ) => Promise<{ ok: boolean; totalAdvanceMm?: number }>;
            };
          }
        ).engine;
        const out: number[] = [];
        const fontSizeMm = 4.6756;
        for (const pair of pairs) {
          const r = await engine.renderCurvedText({
            text: pair,
            fontId: "lato",
            fontSizeMm,
            letterSpacingMm: 0,
            baselineRadiusMm: 34.084,
            angleDegrees: 0,
            inverted: false,
            invertedDyMm: 0,
          });
          // el motor devuelve mm; el navegador mide a font-size 100 px
          out.push(r.ok ? ((r.totalAdvanceMm ?? 0) / fontSizeMm) * 100 : -1);
        }
        return out;
      },
      { pairs: GSUB_PAIRS },
    );
    for (let i = 0; i < GSUB_PAIRS.length; i += 1) {
      expect(shaped[i], GSUB_PAIRS[i]).toBeGreaterThan(0);
      expect(
        Math.abs(browser[i] - shaped[i]),
        `${GSUB_PAIRS[i]} navegador=${browser[i]} motor=${shaped[i]}`,
      ).toBeLessThanOrEqual(LAYOUT_QUANTUM_PX);
    }
  });

  test("texto curvo idéntico al navegador: medidas, posiciones y contornos", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadEngine(page);
    for (const font of FONTS) {
      await registerFace(page, font.id, String(font.weight));
      for (const sc of SCENARIOS) {
        const frameResult = createPhysicalFrame(sc.outer, sc.inner, "band-thickness");
        if (!frameResult.ok) throw new Error("frame");
        const frame = frameResult.frame;
        const placed = resolveText(
          {
            id: "t",
            text: CURVE_TEXT,
            fontFamily: "Lato",
            angle: sc.angle,
            radius: sc.radius,
            inverted: sc.inverted,
            scale: sc.scale,
          },
          frame,
        );
        if (placed.baselineRadiusMm === null) throw new Error("baseline");
        const request = {
          text: CURVE_TEXT,
          fontSizeMm: placed.fontSizeMm,
          letterSpacingMm: placed.letterSpacingMm,
          baselineRadiusMm: placed.baselineRadiusMm,
          angleDegrees: sc.angle,
          inverted: sc.inverted,
          invertedDyMm: placed.invertedDyMm ?? 0,
          outerDiameterMm: sc.outer,
        };

        const result = await page.evaluate(
          async ({ fontId, weight, request, scenario, text, pxPerMm }) => {
            const ns = "http://www.w3.org/2000/svg";
            const engine = (
              window as unknown as {
                engine: {
                  TYPOGRAPHY_FONTS: Record<string, { url: string }>;
                  renderCurvedText: (
                    spec: unknown,
                  ) => Promise<{
                    ok: boolean;
                    code?: string;
                    reason?: string;
                    totalAdvanceMm?: number;
                    glyphs?: { char: string; d: string }[];
                  }>;
                };
              }
            ).engine;

            // 1) el motor: contornos en mm
            const built = await engine.renderCurvedText({
              ...request,
              fontId,
              weight,
            });
            if (!built.ok) {
              return { error: `${built.code}: ${built.reason}` };
            }
            const k = pxPerMm;
            const px = Math.round(scenario.outerDiameterMm * k);
            const half = (scenario.outerDiameterMm / 2) * k;
            const paths = built.glyphs!.map((g) => g.d).filter((d) => d !== "");
            const outlineSvg =
              `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${scenario.outerDiameterMm * k} ${scenario.outerDiameterMm * k}">` +
              `<g transform="scale(${k})" fill="#000" fill-rule="nonzero">` +
              paths.map((d) => `<path d="${d}"/>`).join("") +
              `</g></svg>`;

            // 2) la referencia del navegador, con la fuente EMBEBIDA
            const fontUrl = engine.TYPOGRAPHY_FONTS[fontId].url;
            const bytes = await (await fetch(fontUrl)).arrayBuffer();
            let binary = "";
            const view = new Uint8Array(bytes);
            for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
            const fontB64 = btoa(binary);
            const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
            const r = request.baselineRadiusMm * k;
            const sweep = request.inverted ? 0 : 1;
            const refSvg =
              `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${scenario.outerDiameterMm * k} ${scenario.outerDiameterMm * k}">` +
              `<style>@font-face{font-family:"TypographyRef";font-weight:600;src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
              `<defs><path id="c" d="M0 ${r} A${r} ${r} 0 0 ${sweep} 0 ${-r} A${r} ${r} 0 0 ${sweep} 0 ${r}"/></defs>` +
              `<g transform="rotate(${request.angleDegrees})"><text font-family="TypographyRef" font-size="${request.fontSizeMm * k}" font-weight="600" letter-spacing="${request.letterSpacingMm * k}" text-anchor="middle"${request.inverted ? ` dy="${request.invertedDyMm * k}"` : ""} fill="#000">` +
              `<textPath href="#c" startOffset="50%">${escaped}</textPath></text></g></svg>`;

            // 3) el navegador: longitud del texto
            const dom = document.createElementNS(ns, "svg");
            document.body.appendChild(dom);
            const t = document.createElementNS(ns, "text");
            t.setAttribute("font-family", "TypographyRef");
            t.setAttribute("font-size", String(request.fontSizeMm * k));
            t.setAttribute("font-weight", "600");
            t.setAttribute("letter-spacing", String(request.letterSpacingMm * k));
            t.setAttribute("text-anchor", "middle");
            if (request.inverted) t.setAttribute("dy", String(request.invertedDyMm * k));
            const tp = document.createElementNS(ns, "textPath");
            tp.setAttribute("href", "#c");
            tp.setAttribute("startOffset", "50%");
            tp.textContent = text;
            t.appendChild(tp);
            const defs = document.createElementNS(ns, "defs");
            const curve = document.createElementNS(ns, "path");
            curve.setAttribute("id", "c");
            curve.setAttribute(
              "d",
              `M0 ${r} A${r} ${r} 0 0 ${sweep} 0 ${-r} A${r} ${r} 0 0 ${sweep} 0 ${r}`,
            );
            defs.appendChild(curve);
            dom.appendChild(defs);
            dom.appendChild(t);
            const browserLengthMm = t.getComputedTextLength() / k;
            dom.remove();

            // 4) desviación física tinta-tinta
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
              devMeanMm: Math.max(dev.meanMm, devBack.meanMm),
              devMaxMm: Math.max(dev.maxMm, devBack.maxMm),
              devBeyond: dev.beyond + devBack.beyond,
              inkA,
              inkB,
            };
          },
          {
            fontId: font.id,
            weight: font.weight,
            request,
            scenario: {
              outerDiameterMm: sc.outer,
              innerDiameterMm: sc.inner,
            },
            text: CURVE_TEXT,
            pxPerMm: PX_PER_MM,
          },
        );

        expect((result as { error?: string }).error, `${sc.name} ${font.label}`).toBeUndefined();
        const r = result as {
          browserLengthMm: number;
          spikeLengthMm: number;
          devMeanMm: number;
          devMaxMm: number;
          devBeyond: number;
          inkA: number;
          inkB: number;
        };
        const lengthDiff = Math.abs(r.browserLengthMm - r.spikeLengthMm) / r.browserLengthMm;
        expect(lengthDiff, `${sc.name} ${font.label} longitud`).toBeLessThanOrEqual(0.01);
        expect(r.devMaxMm, `${sc.name} ${font.label} desviación`).toBeLessThanOrEqual(0.2);
        expect(r.devMeanMm, `${sc.name} ${font.label} desviación media`).toBeLessThanOrEqual(0.05);
        expect(r.devBeyond, `${sc.name} ${font.label} píxeles sin pareja`).toBe(0);
        expect(r.inkA, `${sc.name} ${font.label} referencia`).toBeGreaterThan(500);
        expect(r.inkB, `${sc.name} ${font.label} contorno`).toBeGreaterThan(500);
      }
    }
  });

  test("fallo explícito: glifo ausente y texto no NFC", async ({ page }) => {
    await loadEngine(page);
    const result = await page.evaluate(async () => {
      const engine = (
        window as unknown as {
          engine: {
            renderCurvedText: (
              spec: unknown,
            ) => Promise<{ ok: boolean; code?: string }>;
          };
        }
      ).engine;
      const base = {
        fontId: "poppins",
        fontSizeMm: 4.6756,
        letterSpacingMm: 0.2672,
        baselineRadiusMm: 34.084,
        angleDegrees: 0,
        inverted: false,
        invertedDyMm: 0,
      };
      const missing = await engine.renderCurvedText({ ...base, text: "☃" });
      const notNfc = await engine.renderCurvedText({ ...base, text: "a\u0301" });
      return {
        missing: { ok: missing.ok, code: missing.code },
        notNfc: { ok: notNfc.ok, code: notNfc.code },
      };
    });
    expect(result.missing.ok).toBe(false);
    expect(result.missing.code).toBe("GLYPH_MISSING");
    expect(result.notNfc.ok).toBe(false);
    expect(result.notNfc.code).toBe("TEXT_NOT_NFC");
  });

  test("determinismo: la misma entrada produce los mismos contornos", async ({
    page,
  }) => {
    await loadEngine(page);
    const builds = await page.evaluate(async () => {
      const engine = (
        window as unknown as {
          engine: {
            renderCurvedText: (
              spec: unknown,
            ) => Promise<{ ok: boolean; glyphs?: { d: string }[] }>;
          };
        }
      ).engine;
      const spec = {
        text: "fi ti AVATAR",
        fontId: "lato",
        fontSizeMm: 4.6756,
        letterSpacingMm: 0.2672,
        baselineRadiusMm: 34.084,
        angleDegrees: 0,
        inverted: false,
        invertedDyMm: 0,
      };
      const a = await engine.renderCurvedText(spec);
      const b = await engine.renderCurvedText(spec);
      const c = await engine.renderCurvedText(spec);
      return [
        a.glyphs?.map((g) => g.d).join("|"),
        b.glyphs?.map((g) => g.d).join("|"),
        c.glyphs?.map((g) => g.d).join("|"),
      ];
    });
    expect(builds[0]).toBeTruthy();
    expect(builds[1]).toBe(builds[0]);
    expect(builds[2]).toBe(builds[0]);
  });
});
