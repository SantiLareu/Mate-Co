/**
 * Laboratorio físico — paridad entre la vista previa y los contornos
 * vectoriales (Etapa 4, fase 2).
 *
 * QUÉ DEMUESTRA
 *   Que, con la MISMA fuente, la MISMA configuración tipográfica y la MISMA
 *   geometría, el motor vectorial produce el mismo texto que la vista previa
 *   del laboratorio: mismas medidas, mismas posiciones y contornos que
 *   coinciden con el render del navegador.
 *
 * QUÉ NO HACE (y por qué)
 *   NO habilita la exportación con texto: el gate FONT_OUTLINES_UNAVAILABLE
 *   sigue vigente. La paridad para los trabajos REALES exige que la vista
 *   previa use una fuente empaquetada, y hoy la vista previa usa las fuentes
 *   propietarias del editor (Georgia, Arial, ...): eso es una decisión de
 *   producto (la lista de tipografías visibles) que sigue pendiente de
 *   autorización. Aquí se demuestra el MECANISMO con una fuente del catálogo.
 */
import { expect, test, type Page } from "@playwright/test";
import { catalogueFontForFamily } from "../src/production-lab/typographyOutlines";
import {
  createPhysicalFrame,
  resolveText,
  textArcPathMm,
} from "../src/production-lab/geometry";
import { TYPOGRAPHY_FONTS } from "../src/typography";

const PX_PER_MM = 24;

test.describe("laboratorio: paridad vista previa / contornos vectoriales", () => {
  test("el mapeo de familia es explícito: sin sustitución silenciosa", () => {
    expect(catalogueFontForFamily("Georgia")).toBeNull();
    expect(catalogueFontForFamily("Arial")).toBeNull();
    expect(catalogueFontForFamily("Poppins SemiBold")).toBe("poppins");
    expect(catalogueFontForFamily("Lato SemiBold")).toBe("lato");
    expect(catalogueFontForFamily("Dancing Script")).toBe("dancing-script");
  });

  for (const fontId of ["poppins", "lato", "dancing-script"] as const) {
    test(`paridad de geometría y contornos: ${TYPOGRAPHY_FONTS[fontId].family}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("/");

      // 1) medidas del laboratorio (estrategia B), como en la vista previa
      const frameResult = createPhysicalFrame(85, 50, "band-thickness");
      if (!frameResult.ok) throw new Error("frame");
      const frame = frameResult.frame;
      const placed = resolveText(
        {
          id: "lab-parity",
          text: "¡Fiesta! Mate&Co",
          fontFamily: TYPOGRAPHY_FONTS[fontId].family,
          angle: 0,
          radius: 374,
          inverted: false,
          scale: 1,
        },
        frame,
      );
      if (placed.baselineRadiusMm === null) throw new Error("baseline");

      // 2) la geometría que el laboratorio ya calculó
      const geometry = {
        fontSizeMm: placed.fontSizeMm,
        letterSpacingMm: placed.letterSpacingMm,
        baselineRadiusMm: placed.baselineRadiusMm,
        angle: 0,
        inverted: false,
        invertedDyMm: placed.invertedDyMm ?? 0,
      };

      // 3) la vista previa y los contornos del motor, ambos en la página
      //    (el motor es browser-only: WASM + fetch de la fuente)
      const result = await page.evaluate(
        async ({ fontId, geometry, fontUrl, text, pxPerMm }) => {
          const lab = await import("/src/production-lab/typographyOutlines.ts");
          const outlines = await lab.labTextOutlines(text, fontId, geometry);
          if (!outlines.ok) {
            return { error: `${outlines.code}: ${outlines.reason}` };
          }
          const ns = "http://www.w3.org/2000/svg";
          const bytes = await (await fetch(fontUrl)).arrayBuffer();
          let binary = "";
          const view = new Uint8Array(bytes);
          for (let i = 0; i < view.length; i += 1) {
            binary += String.fromCharCode(view[i]);
          }
          const fontB64 = btoa(binary);
          const k = pxPerMm;
          const outer = 85;
          const px = Math.round(outer * k);
          const half = (outer / 2) * k;
          const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
          const r = geometry.baselineRadiusMm * k;
          // El arco del laboratorio (textArcPathMm) y el texto centrado.
          const arc = `M0 ${r} A${r} ${r} 0 0 1 0 ${-r} A${r} ${r} 0 0 1 0 ${r}`;
          const previewSvg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${outer * k} ${outer * k}">` +
            `<style>@font-face{font-family:"CatalogueRef";font-weight:600;src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
            `<defs><path id="lab-arc" d="${arc}"/></defs>` +
            `<g transform="rotate(${geometry.angle})">` +
            `<text font-family="CatalogueRef" font-size="${geometry.fontSizeMm * k}" font-weight="600" letter-spacing="${geometry.letterSpacingMm * k}" text-anchor="middle" fill="#000">` +
            `<textPath href="#lab-arc" startOffset="50%">${escaped}</textPath></text></g></svg>`;

          // Los contornos del motor (mm) al mismo espacio de píxeles.
          const outlineSvg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${outer * k} ${outer * k}">` +
            `<g transform="scale(${k})" fill="#000" fill-rule="nonzero">` +
            outlines.paths.map((p) => `<path d="${p.d}"/>`).join("") +
            `</g></svg>`;

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
          const a = await draw(previewSvg, true);
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
            inkA,
            inkB,
            devMeanMm: Math.max(dev.meanMm, devBack.meanMm),
            devMaxMm: Math.max(dev.maxMm, devBack.maxMm),
            devBeyond: dev.beyond + devBack.beyond,
          };
        },
        {
          fontId,
          geometry,
          fontUrl: TYPOGRAPHY_FONTS[fontId].url,
          text: "¡Fiesta! Mate&Co",
          pxPerMm: PX_PER_MM,
        },
      );

      expect((result as { error?: string }).error).toBeUndefined();
      expect(result.inkA).toBeGreaterThan(500);
      expect(result.inkB).toBeGreaterThan(500);
      expect(result.devMaxMm, "desviación máxima").toBeLessThanOrEqual(0.2);
      expect(result.devMeanMm, "desviación media").toBeLessThanOrEqual(0.05);
      expect(result.devBeyond, "píxeles sin pareja").toBe(0);
    });
  }
});
