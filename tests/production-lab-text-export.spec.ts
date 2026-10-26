/**
 * Laboratorio físico — exportación experimental con TEXTO VECTORIAL (Etapa 4).
 *
 * Cubre el camino completo:
 *   vista previa (texto con la fuente real) -> motor HarfBuzz (contornos) ->
 *   serializador síncrono -> SVG físico con paths, sin <text> ni raster.
 *
 * Criterios: los del reporte de la Etapa 4 (longitud <= 1 %, posición
 * <= 0,2 mm, rotación <= 0,5°, desviación de tinta <= 0,2 mm). No se relajan.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LAB_URL = "/production-lab";
const PX_PER_MM = 24;

const FONT_IDS = [
  { id: "poppins", family: "Poppins SemiBold" },
  { id: "lato", family: "Lato SemiBold" },
  { id: "dancing-script", family: "Dancing Script" },
] as const;

type Scenario = {
  name: string;
  outer: number;
  inner: number;
  angle: number;
  radius: number;
  scale: number;
  inverted: boolean;
};

const SCENARIOS: Scenario[] = [
  { name: "85x50 normal", outer: 85, inner: 50, angle: 0, radius: 374, scale: 1, inverted: false },
  { name: "85x50 inverted", outer: 85, inner: 50, angle: 180, radius: 374, scale: 1, inverted: true },
  { name: "80x60 normal rotated 65", outer: 80, inner: 60, angle: 65, radius: 374, scale: 1.2, inverted: false },
  { name: "80x60 inverted rotated -150", outer: 80, inner: 60, angle: -150, radius: 340, scale: 1, inverted: true },
  { name: "75x65 normal rotated -35", outer: 75, inner: 65, angle: -35, radius: 357.5, scale: 1, inverted: false },
  { name: "75x65 inverted scale 1.5", outer: 75, inner: 65, angle: 200, radius: 345, scale: 1.5, inverted: true },
];

async function openLab(page: Page) {
  await page.goto(LAB_URL);
  await expect(page.getByTestId("lab-outer-input")).toBeVisible();
}

/** Descarga el SVG exportado por el laboratorio y devuelve su contenido. */
async function downloadLabSvg(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("lab-export-button").click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("la descarga no tiene ruta");
  return readFileSync(path, "utf8");
}

test.describe("laboratorio: exportación con texto vectorial", () => {
  test("el export con texto se habilita y el SVG lleva contornos, sin <text> ni raster", async ({
    page,
  }) => {
    await openLab(page);
    await page.getByTestId("lab-outer-input").fill("85");
    await page.getByTestId("lab-inner-input").fill("50");
    await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
    // Los contornos se calculan de forma asíncrona: el botón se habilita
    // cuando están listos.
    await expect(page.getByTestId("lab-export-button")).toBeEnabled({
      timeout: 20000,
    });
    const svg = await downloadLabSvg(page);

    // Sin texto editable, sin raster, sin fuentes ni referencias externas.
    expect(svg).not.toMatch(/<text\b/i);
    expect(svg).not.toMatch(/<image\b/i);
    expect(svg).not.toMatch(/data:/i);
    expect(svg).not.toMatch(/font-family/i);
    expect(svg).not.toMatch(/<foreignObject\b/i);
    // Referencias externas (la declaración xmlns NO lo es).
    expect(svg).not.toMatch(/href="https?:/i);
    expect(svg).not.toMatch(/src="https?:/i);
    expect(svg).not.toMatch(/url\(https?:/i);
    expect(svg).not.toMatch(/@import/i);
    // Los aros de referencia van en su propio grupo, separados del grabado.
    expect(svg).toContain('id="lab-ring-reference"');
    expect(svg).toContain('id="lab-engraving"');
    const ringAt = svg.indexOf('id="lab-ring-reference"');
    const engravingAt = svg.indexOf('id="lab-engraving"');
    expect(ringAt).toBeGreaterThan(-1);
    expect(engravingAt).toBeGreaterThan(ringAt);
    // El texto entra como paths con su id de origen.
    expect(svg).toMatch(/data-text-id="lab-text-top"/);
    expect(svg).toMatch(/data-text-id="lab-text-bottom"/);
    // El SVG es un archivo vectorial en milímetros.
    expect(svg).toMatch(/width="85mm" height="85mm"/);
  });

  test("determinismo: dos exportaciones del mismo diseño dan bytes idénticos", async ({
    page,
  }) => {
    await openLab(page);
    await page.getByTestId("lab-outer-input").fill("85");
    await page.getByTestId("lab-inner-input").fill("50");
    await expect(page.getByTestId("lab-export-button")).toBeEnabled({
      timeout: 20000,
    });
    const first = await downloadLabSvg(page);
    const second = await downloadLabSvg(page);
    expect(second).toBe(first);
  });

  test("fidelidad: los contornos exportados coinciden con la vista previa del navegador", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openLab(page);
    await page.getByTestId("lab-outer-input").fill("85");
    await page.getByTestId("lab-inner-input").fill("50");
    await expect(page.getByTestId("lab-export-button")).toBeEnabled({
      timeout: 20000,
    });
    const svg = await downloadLabSvg(page);

    // Medidas reales de la vista previa (data-*) y paths del texto exportado.
    const preview = await page.evaluate(() => {
      const group = document.querySelector('[data-testid="lab-physical-text-lab-text-top"]');
      if (!group) return null;
      const text = group.querySelector("text");
      return {
        fontFamily: text?.getAttribute("font-family") ?? null,
        fontSize: Number(text?.getAttribute("font-size")),
        letterSpacing: Number(text?.getAttribute("letter-spacing")),
        baselineRadius: Number(group.getAttribute("data-baseline-r")),
        text: text?.textContent ?? null,
      };
    });
    expect(preview).not.toBeNull();
    expect(preview!.fontFamily).toBe("Poppins SemiBold");

    // El texto exportado, en el mismo espacio (mm, origen en el centro).
    const exported = await page.evaluate((svgText) => {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const groups = [...doc.querySelectorAll('[data-text-id="lab-text-top"]')];
      return groups.map((g) => ({
        transform: g.getAttribute("transform"),
        paths: [...g.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? ""),
      }));
    }, svg);
    expect(exported.length).toBe(1);
    expect(exported[0].paths.length).toBeGreaterThan(0);

    // Comparación de tinta: la referencia es el texto del navegador con las
    // MISMAS medidas del laboratorio; el exportado se recorta a la misma área.
    const deviation = await page.evaluate(
      async ({ svgText, text, fontFamily, fontSize, letterSpacing, baselineRadius }) => {
        const ns = "http://www.w3.org/2000/svg";
        const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
        const group = doc.querySelector('[data-text-id="lab-text-top"]');
        const root = doc.documentElement;
        const size = Number(root.getAttribute("width").replace("mm", ""));
        const half = size / 2;
        const k = 24;
        const px = Math.round(size * k);

        // Referencia: el texto del navegador, en el mismo sistema de la
        // vista previa (arco de radio = baseline) y con el MISMO peso.
        const fontUrl = "/typography/poppins/Poppins-SemiBold.ttf?v1";
        const bytes = await (await fetch(fontUrl)).arrayBuffer();
        let binary = "";
        const view = new Uint8Array(bytes);
        for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
        const b64 = btoa(binary);
        const r = baselineRadius * k;
        const refSvg =
          `<svg xmlns="${ns}" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
          `<style>@font-face{font-family:"RefFont";font-weight:600;src:url(data:font/ttf;base64,${b64}) format("truetype")}</style>` +
          `<defs><path id="arc" d="M0 ${r} A${r} ${r} 0 0 1 0 ${-r} A${r} ${r} 0 0 1 0 ${r}"/></defs>` +
          `<g transform="translate(${half * k} ${half * k})">` +
          `<text font-family="RefFont" font-size="${fontSize * k}" font-weight="600" letter-spacing="${letterSpacing * k}" text-anchor="middle" fill="#000">` +
          `<textPath href="#arc" startOffset="50%">${text.replace(/&/g, "&amp;")}</textPath></text></g></svg>`;

        // Exportado: el MISMO grupo del SVG exportado (con su transform en mm),
        // escalado al lienzo en píxeles.
        const outSvg =
          `<svg xmlns="${ns}" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
          `<g transform="scale(${k})">` +
          `<g ${group.getAttribute("transform") ? `transform="${group.getAttribute("transform")}"` : ""} fill="#000" fill-rule="nonzero">` +
          [...group.querySelectorAll("path")].map((p) => `<path d="${p.getAttribute("d")}"/>`).join("") +
          `</g></g></svg>`;

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
        const b = await draw(outSvg, false);
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
        const dev = (from: Uint8Array, to: Uint8Array) => {
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
        const d1 = dev(maskA, maskB);
        const d2 = dev(maskB, maskA);
        return {
          inkA,
          inkB,
          meanMm: Math.max(d1.meanMm, d2.meanMm),
          maxMm: Math.max(d1.maxMm, d2.maxMm),
          beyond: d1.beyond + d2.beyond,
        };
      },
      {
        svgText: svg,
        text: preview!.text ?? "",
        fontFamily: preview!.fontFamily,
        fontSize: preview!.fontSize,
        letterSpacing: preview!.letterSpacing,
        baselineRadius: preview!.baselineRadius,
      },
    );

    expect(deviation.inkA).toBeGreaterThan(200);
    expect(deviation.inkB).toBeGreaterThan(200);
    expect(
      deviation.maxMm,
      `desviación máxima ${String(deviation.maxMm)} mm (media ${String(deviation.meanMm)} mm)`,
    ).toBeLessThanOrEqual(0.2);
    expect(deviation.meanMm).toBeLessThanOrEqual(0.05);
    expect(deviation.beyond).toBe(0);
  });

  test("variantes: tres fuentes x tres virolas x normal/invertido/rotado, exportadas y fieles al navegador", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await openLab(page);
    const results = await page.evaluate(
      async ({ scenarios, fontIds }) => {
        const geometry = await import("/src/production-lab/geometry.ts");
        const outlines = await import("/src/production-lab/typographyOutlines.ts");
        const exporter = await import("/src/production-lab/exportSvg.ts");
        const ns = "http://www.w3.org/2000/svg";
        const k = 24;
        const out: {
          name: string;
          font: string;
          ok: boolean;
          reason?: string;
          maxMm?: number;
          meanMm?: number;
          hasText?: boolean;
          pathCount?: number;
        }[] = [];

        for (const font of fontIds) {
          for (const sc of scenarios) {
            const frameResult = geometry.createPhysicalFrame(
              sc.outer,
              sc.inner,
              "band-thickness",
            );
            if (!frameResult.ok) throw new Error("frame");
            const frame = frameResult.frame;
            const source = {
              id: "t1",
              text: "¡Fiesta! Tía Ñandú",
              fontFamily: font.family,
              angle: sc.angle,
              radius: sc.radius,
              inverted: sc.inverted,
              scale: sc.scale,
            };
            // Fase 1: las medidas (no dependen de la medición).
            const measuresOnly = geometry.buildPhysicalReport({
              outerDiameter: sc.outer,
              innerDiameter: sc.inner,
              strategy: "band-thickness",
              texts: [{ element: source }],
              icons: [],
              approved: [],
              circularLines: [],
            });
            if (!measuresOnly.ok) throw new Error("report(measures)");
            // Fase 2: los contornos con esas medidas.
            const prepared = await outlines.prepareLabTextOutlines(
              measuresOnly.report,
              [source],
            );
            if (!prepared.ok) {
              out.push({ name: sc.name, font: font.family, ok: false, reason: prepared.reason });
              continue;
            }
            // Fase 3: el span lo da el propio motor (mismo avance que los
            // contornos), para que la banda y el texto coincidan.
            const reportResult = geometry.buildPhysicalReport({
              outerDiameter: sc.outer,
              innerDiameter: sc.inner,
              strategy: "band-thickness",
              texts: [
                {
                  element: source,
                  measurement: {
                    lengthMm: prepared.outlines["t1"].advanceMm,
                    provenance: "engine-harfbuzz",
                  },
                },
              ],
              icons: [],
              approved: [],
              circularLines: [],
            });
            if (!reportResult.ok) throw new Error("report");
            const built = exporter.buildLabPhysicalSvg({
              report: reportResult.report,
              iconPaths: {},
              textOutlines: prepared.outlines,
            });
            if (!built.ok) {
              out.push({ name: sc.name, font: font.family, ok: false, reason: built.reason });
              continue;
            }
            const svgText = built.svg;

            // Fidelidad: el texto del navegador con las MISMAS medidas.
            const placed = reportResult.report.texts[0];
            const fontUrl = font.url;
            const bytes = await (await fetch(fontUrl)).arrayBuffer();
            let binary = "";
            const view = new Uint8Array(bytes);
            for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
            const b64 = btoa(binary);
            const size = Number(
              svgText.match(/width="([\d.]+)mm"/)![1],
            );
            const half = size / 2;
            const px = Math.round(size * k);
            const r = placed.baselineRadiusMm! * k;
            const sweep = placed.sweep === 0 ? 0 : 1;
            const refSvg =
              `<svg xmlns="${ns}" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
              `<style>@font-face{font-family:"RefFont";font-weight:600;src:url(data:font/ttf;base64,${b64}) format("truetype")}</style>` +
              `<defs><path id="arc" d="M0 ${r} A${r} ${r} 0 0 ${sweep} 0 ${-r} A${r} ${r} 0 0 ${sweep} 0 ${r}"/></defs>` +
              `<g transform="translate(${half * k} ${half * k}) rotate(${placed.angle})">` +
              `<text font-family="RefFont" font-size="${placed.fontSizeMm * k}" font-weight="600" letter-spacing="${placed.letterSpacingMm * k}" text-anchor="middle"${placed.invertedDyMm !== null ? ` dy="${placed.invertedDyMm * k}"` : ""} fill="#000">` +
              `<textPath href="#arc" startOffset="50%">${source.text.replace(/&/g, "&amp;")}</textPath></text></g></svg>`;

            const exportedDoc = new DOMParser().parseFromString(svgText, "image/svg+xml");
            const exportedGroup = exportedDoc.querySelector('[data-text-id="t1"]');
            const outSvg =
              `<svg xmlns="${ns}" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">` +
              `<g transform="scale(${k})">` +
              `<g ${exportedGroup?.getAttribute("transform") ? `transform="${exportedGroup.getAttribute("transform")}"` : ""} fill="#000" fill-rule="nonzero">` +
              [...(exportedGroup?.querySelectorAll("path") ?? [])].map((p) => `<path d="${p.getAttribute("d")}"/>`).join("") +
              `</g></g></svg>`;

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
            const b = await draw(outSvg, false);
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
            const dev = (from: Uint8Array, to: Uint8Array) => {
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
            const d1 = dev(maskA, maskB);
            const d2 = dev(maskB, maskA);
            out.push({
              name: sc.name,
              font: font.family,
              ok: true,
              maxMm: Math.max(d1.maxMm, d2.maxMm),
              meanMm: Math.max(d1.meanMm, d2.meanMm),
              hasText: /<text\b/i.test(svgText),
              pathCount: (svgText.match(/<path\b/g) ?? []).length,
            });
          }
        }
        return out;
      },
      {
        scenarios: SCENARIOS,
        fontIds: FONT_IDS.map((f) => ({
          id: f.id,
          family: f.family,
          url:
            f.id === "poppins"
              ? "/typography/poppins/Poppins-SemiBold.ttf?v1"
              : f.id === "lato"
                ? "/typography/lato/Lato-SemiBold.ttf?v1"
                : "/typography/dancingscript/DancingScript-wght.ttf?v1",
        })),
      },
    );

    expect(results.length).toBe(SCENARIOS.length * FONT_IDS.length);
    for (const r of results) {
      expect(r.ok, `${r.name} ${r.font}: ${r.reason ?? ""}`).toBe(true);
      expect(r.hasText, `${r.name} ${r.font} contiene <text>`).toBe(false);
      expect(r.pathCount ?? 0, `${r.name} ${r.font} sin paths`).toBeGreaterThan(0);
      expect(
        r.maxMm ?? 99,
        `${r.name} ${r.font} desviación máxima ${String(r.maxMm)} mm`,
      ).toBeLessThanOrEqual(0.2);
      expect(
        r.meanMm ?? 99,
        `${r.name} ${r.font} desviación media ${String(r.meanMm)} mm`,
      ).toBeLessThanOrEqual(0.05);
    }
  });

  test("genera ejemplos de SVG exportados (85/50, 80/60, 75/65)", async ({ page }) => {
    const dir = resolve(HERE, "../test-results/lab-text-export");
    mkdirSync(dir, { recursive: true });
    const index: string[] = [];
    for (const [outer, inner] of [
      [85, 50],
      [80, 60],
      [75, 65],
    ] as const) {
      await openLab(page);
      await page.getByTestId("lab-outer-input").fill(String(outer));
      await page.getByTestId("lab-inner-input").fill(String(inner));
      await expect(page.getByTestId("lab-export-button")).toBeEnabled({
        timeout: 20000,
      });
      const svg = await downloadLabSvg(page);
      const name = `lab-fisico-${outer}x${inner}-band-thickness.svg`;
      writeFileSync(resolve(dir, name), svg);
      index.push(
        `${name} ${String(svg.length)}B sha256=${createHash("sha256").update(svg).digest("hex").slice(0, 16)}`,
      );
      // El archivo exportado es vectorial puro.
      expect(svg).not.toMatch(/<text\b/i);
      expect(svg).toContain('id="lab-engraving"');
    }
    writeFileSync(resolve(dir, "index.txt"), index.join("\n") + "\n");
    console.log(`[ejemplos] ${index.join(" | ")}`);
    expect(index.length).toBe(3);
  });

  test("fallo explícito: texto no reproducible bloquea la exportación", async ({
    page,
  }) => {
    await openLab(page);
    await page.goto(LAB_URL);
    const result = await page.evaluate(async () => {
      const geometry = await import("/src/production-lab/geometry.ts");
      const outlines = await import("/src/production-lab/typographyOutlines.ts");
      const exporter = await import("/src/production-lab/exportSvg.ts");
      const frameResult = geometry.createPhysicalFrame(85, 50, "band-thickness");
      if (!frameResult.ok) throw new Error("frame");
      const source = {
        id: "t1",
        text: "☃",
        fontFamily: "Poppins SemiBold",
        angle: 0,
        radius: 374,
        inverted: false,
        scale: 1,
      };
      const reportResult = geometry.buildPhysicalReport({
        outerDiameter: 85,
        innerDiameter: 50,
        strategy: "band-thickness",
        texts: [{ element: source }],
        icons: [],
        approved: [],
        circularLines: [],
      });
      if (!reportResult.ok) throw new Error("report");
      const prepared = await outlines.prepareLabTextOutlines(
        reportResult.report,
        [source],
      );
      // Y con contornos ausentes, el serializador bloquea.
      const built = exporter.buildLabPhysicalSvg({
        report: reportResult.report,
        iconPaths: {},
      });
      return {
        preparedOk: prepared.ok,
        preparedReason: prepared.ok ? null : prepared.reason,
        builtOk: built.ok,
        builtCode: built.ok ? null : built.code,
      };
    });
    expect(result.preparedOk).toBe(false);
    expect(result.preparedReason).toContain("glifo");
    expect(result.builtOk).toBe(false);
    expect(result.builtCode).toBe("FONT_OUTLINES_UNAVAILABLE");
  });
});
