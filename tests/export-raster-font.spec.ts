/**
 * E4.2 — El exportador raster usa la fuente real del catálogo.
 *
 * QUÉ DEMUESTRA
 *   1. Que el trazador raster traza **la misma tipografía que ve el
 *      cliente**: su SVG se carga como `<img>` y un SVG-as-imagen no puede
 *      pedir fuentes externas, así que la fuente va **embebida** como data
 *      URI. Antes de E4.2 el texto se dibujaba con la tipografía de reserva
 *      del sistema (medido: 15 580 px de tinta frente a los 32 867 px del
 *      navegador con la fuente real).
 *   2. Que una familia **fuera del catálogo** se rechaza con
 *      `FONT_NOT_IN_CATALOGUE` (nunca se sustituye).
 *   3. Que una fuente **no disponible** falla con `FONT_UNAVAILABLE`.
 *   4. Que la geometría y los grupos del SVG exportado se conservan.
 *
 * TOLERANCIAS
 *   - Píxeles sin pareja: 0 (el raster traza la misma letra ⇒ coincide).
 *   - Desviación media ≤ 0,1 u y máxima ≤ 1,5 u: es el error propio del
 *     rasterizado (umbral a 128 sobre la luminancia) y del trazado de
 *     contornos, no una diferencia de tipografía.
 */
import { expect, test, type Page } from "@playwright/test";
import { TYPOGRAPHY_FONTS } from "../src/typography";

const PX_PER_UNIT = 2;
const CANVAS_PX = 900 * PX_PER_UNIT;
const WINDOW_PX = 12;
const MEAN_TOLERANCE_UNITS = 0.1;
const MAX_TOLERANCE_UNITS = 1.5;

type Case = {
  label: string;
  family: string;
  inverted?: boolean;
  angle?: number;
};

const CASES: Case[] = [
  { label: "Poppins normal", family: "Poppins SemiBold" },
  { label: "Poppins invertido", family: "Poppins SemiBold", inverted: true },
  { label: "Poppins rotado 30°", family: "Poppins SemiBold", angle: 30 },
  { label: "Lato normal", family: "Lato SemiBold" },
  { label: "Lato invertido", family: "Lato SemiBold", inverted: true },
  { label: "Dancing Script", family: "Dancing Script" },
];

const TEXT = "¡Fiesta! Mate&Co";

/** Compara la tinta del raster con la del navegador usando la MISMA fuente. */
async function compareWithBrowser(page: Page, testCase: Case) {
  return await page.evaluate(
    async ({ testCase, text, pxPerUnit, canvasPx, windowPx }) => {
      const raster = await import("/src/export/textOutlines.ts");
      const fonts = await import("/src/typography/fonts.ts");

      const base64 = async (url: string) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const view = new Uint8Array(bytes);
        let binary = "";
        for (let i = 0; i < view.length; i += 1) {
          binary += String.fromCharCode(view[i]);
        }
        return btoa(binary);
      };
      const draw = async (svg: string, settle: boolean) => {
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvasPx;
        canvas.height = canvasPx;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        const paint = () => {
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvasPx, canvasPx);
          context.drawImage(image, 0, 0, canvasPx, canvasPx);
        };
        paint();
        if (settle) {
          await new Promise((done) => setTimeout(done, 400));
          paint();
        }
        URL.revokeObjectURL(url);
        return context.getImageData(0, 0, canvasPx, canvasPx).data;
      };
      const maskOf = (pixels: Uint8ClampedArray) => {
        const mask = new Uint8Array(canvasPx * canvasPx);
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const luminance =
            0.2126 * pixels[i] +
            0.7152 * pixels[i + 1] +
            0.0722 * pixels[i + 2];
          if (luminance < 128) {
            mask[i / 4] = 1;
            ink += 1;
          }
        }
        return { mask, ink };
      };
      const deviation = (from: Uint8Array, to: Uint8Array) => {
        let sum = 0;
        let count = 0;
        let beyond = 0;
        let max = 0;
        for (let y = 0; y < canvasPx; y += 1) {
          for (let x = 0; x < canvasPx; x += 1) {
            if (!from[y * canvasPx + x]) continue;
            count += 1;
            let best = -1;
            for (let dy = -windowPx; dy <= windowPx; dy += 1) {
              const yy = y + dy;
              if (yy < 0 || yy >= canvasPx) continue;
              for (let dx = -windowPx; dx <= windowPx; dx += 1) {
                const xx = x + dx;
                if (xx < 0 || xx >= canvasPx) continue;
                if (to[yy * canvasPx + xx]) {
                  const distance = Math.sqrt(dx * dx + dy * dy);
                  if (best < 0 || distance < best) best = distance;
                  if (best === 0) break;
                }
              }
              if (best === 0) break;
            }
            if (best < 0) {
              beyond += 1;
              sum += windowPx;
              if (windowPx > max) max = windowPx;
              continue;
            }
            sum += best;
            if (best > max) max = best;
          }
        }
        return { mean: count ? sum / count : 0, beyond, max };
      };

      const scale = 1;
      const radius = 374;
      const pathRadius = radius - 14 * scale;
      const inverted = !!testCase.inverted;
      const angle = testCase.angle ?? 0;
      const sweep = inverted ? 0 : 1;
      const pathD =
        `M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 - pathRadius} ` +
        `A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 + pathRadius}`;

      const font = Object.values(fonts.TYPOGRAPHY_FONTS).find(
        (candidate) => candidate.family === testCase.family,
      );
      if (!font) return { error: `familia desconocida en el catálogo: ${testCase.family}` };
      const dataUri = `data:font/ttf;base64,${await base64(font.url)}`;
      const referenceSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<style>@font-face{font-family:"${testCase.family}";font-weight:600;src:url(${dataUri}) format("truetype")}</style>` +
        `<g transform="rotate(${angle} 450 450)">` +
        `<defs><path id="pc" d="${pathD}"/></defs>` +
        `<text font-family="${testCase.family}" font-size="35" font-weight="600" letter-spacing="2" text-anchor="middle" dy="${inverted ? 26 : 0}" fill="#000000">` +
        `<textPath href="#pc" startOffset="50%">${text.replace(/&/g, "&amp;")}</textPath></text></g></svg>`;

      const trace = await raster.traceTextElement({
        text,
        fontFamily: testCase.family,
        scale,
        radius,
        inverted,
      });
      const rasterSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<g transform="rotate(${angle} 450 450)">` +
        `<g transform="translate(${trace.cropX} ${trace.cropY}) scale(${1 / trace.pixelScale})" fill="#000000" fill-rule="evenodd">` +
        trace.paths
          .map((path) => `<path d="${path.d}"${path.transform ? ` transform="${path.transform}"` : ""}/>`)
          .join("") +
        `</g></g></svg>`;

      const reference = maskOf(await draw(referenceSvg, true));
      const traced = maskOf(await draw(rasterSvg, false));
      const forward = deviation(reference.mask, traced.mask);
      const backward = deviation(traced.mask, reference.mask);
      return {
        inkReference: reference.ink,
        inkTraced: traced.ink,
        mean: Math.max(forward.mean, backward.mean) / pxPerUnit,
        max: Math.max(forward.max, backward.max) / pxPerUnit,
        unpaired: forward.beyond + backward.beyond,
        paths: trace.paths.length,
        arcLength: Math.round(trace.arcLength),
      };
    },
    {
      testCase,
      text: TEXT,
      pxPerUnit: PX_PER_UNIT,
      canvasPx: CANVAS_PX,
      windowPx: WINDOW_PX,
    },
  );
}

test.describe("exportador raster: la fuente real del catálogo", () => {
  test("el raster traza la misma letra que ve el cliente", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    for (const testCase of CASES) {
      const metrics = await compareWithBrowser(page, testCase);
      expect(metrics.error, testCase.label).toBeUndefined();
      expect(metrics.inkReference!, `${testCase.label} (navegador)`).toBeGreaterThan(1000);
      expect(metrics.inkTraced!, `${testCase.label} (raster)`).toBeGreaterThan(1000);
      // Misma letra ⇒ el área de tinta es la misma (el trazado de contornos
      // engorda un poco el borde: ±15 %).
      const ratio = metrics.inkTraced! / metrics.inkReference!;
      expect(ratio, `${testCase.label} (área de tinta)`).toBeGreaterThan(0.85);
      expect(ratio, `${testCase.label} (área de tinta)`).toBeLessThan(1.15);
      // Y la forma coincide: sin píxeles sin pareja y con una desviación que
      // es sólo el error del rasterizado y del trazado.
      expect(metrics.unpaired, `${testCase.label} (sin pareja)`).toBe(0);
      expect(metrics.mean!, `${testCase.label} (desviación media)`).toBeLessThanOrEqual(
        MEAN_TOLERANCE_UNITS,
      );
      expect(metrics.max!, `${testCase.label} (desviación máxima)`).toBeLessThanOrEqual(
        MAX_TOLERANCE_UNITS,
      );
    }
  });

  test("una familia fuera del catálogo se rechaza sin sustituir", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      const collect = async (fontFamily: string) => {
        try {
          const trace = await raster.traceTextElement({
            text: "Mate&Co",
            fontFamily,
            scale: 1,
            radius: 374,
            inverted: false,
          });
          return { ok: true, paths: trace?.paths.length ?? 0 };
        } catch (error) {
          return { ok: false, message: String((error as Error).message) };
        }
      };
      return {
        georgia: await collect("Georgia"),
        arial: await collect("Arial"),
        unknown: await collect("Fuente Inventada"),
      };
    });
    for (const [name, outcome] of Object.entries(result)) {
      expect(outcome.ok, `${name}: no debe exportar`).toBe(false);
      expect(outcome.message, `${name}: código`).toContain("FONT_NOT_IN_CATALOGUE");
      // El mensaje dice qué elegir.
      expect(outcome.message, `${name}: mensaje accionable`).toContain(
        "Poppins SemiBold",
      );
    }
  });

  test("una fuente no disponible falla de forma explícita", async ({ page }) => {
    // Se bloquea la petición del binario: la fuente del catálogo no carga.
    await page.route((url) => url.pathname.endsWith(".ttf"), (route) => route.abort());
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      try {
        await raster.traceTextElement({
          text: "Mate&Co",
          fontFamily: "Poppins SemiBold",
          scale: 1,
          radius: 374,
          inverted: false,
        });
        return null;
      } catch (error) {
        return String((error as Error).message);
      }
    });
    expect(result).toContain("FONT_UNAVAILABLE");
    await page.unroute((url) => url.pathname.endsWith(".ttf"));
  });

  test("la geometría y los grupos del SVG exportado se conservan", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");
      const state = {
        texts: [
          {
            id: "t1",
            text: "Mate&Co",
            fontFamily: "Poppins SemiBold",
            angle: 0,
            radius: 374,
            inverted: false,
            scale: 1,
          },
        ],
        icons: [
          {
            id: "i1",
            iconId: "guitarra",
            angle: 40,
            radius: 340,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        graphics: [],
        circularLines: "double" as const,
      };
      const svg = await buildProductionSvg(state);
      return {
        svg,
        hasText: svg.includes("<text"),
        hasFontFace: svg.includes("@font-face"),
        hasImage: svg.includes("<image"),
        hasEngraving: svg.includes('id="engraving-design"'),
        hasVirola: svg.includes('id="virola-reference"'),
        hasTransform: svg.includes("transform="),
        pathCount: (svg.match(/<path /g) ?? []).length,
      };
    });
    // El archivo exportado no lleva texto, ni fuentes embebidas, ni imágenes:
    // sólo geometría (el @font-face vive en el SVG temporal del trazador).
    expect(result.hasText).toBe(false);
    expect(result.hasFontFace).toBe(false);
    expect(result.hasImage).toBe(false);
    // Los grupos y las transformaciones siguen ahí.
    expect(result.hasEngraving).toBe(true);
    expect(result.hasVirola).toBe(true);
    expect(result.hasTransform).toBe(true);
    expect(result.pathCount).toBeGreaterThan(0);
  });

  test("el autoajuste de E4.1 sigue vigente con el raster corregido", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      // Un texto que no entra en el recorrido: el raster lo bloquea igual que
      // antes (E4.1) y con el mismo código.
      try {
        await raster.traceTextElement({
          text: "Mate&Co ".repeat(50).trim(),
          fontFamily: "Poppins SemiBold",
          scale: 0.3,
          radius: 374,
          inverted: false,
        });
        return null;
      } catch (error) {
        return String((error as Error).message);
      }
    });
    expect(result).toContain("TEXT_DOES_NOT_FIT");
  });
});
