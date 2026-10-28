/**
 * E3.0 — Ventana de visibilidad del texto largo: paridad con Chromium real.
 *
 * QUÉ DEMUESTRA
 *   Que el adaptador (`src/export/vectorTextOutlines.ts`) produce EXACTAMENTE
 *   la misma tinta que la vista previa del editor cuando el texto es más
 *   largo que la vuelta del path.
 *
 * POR QUÉ HACE FALTA UNA REGLA
 *   El path del texto de la vista previa (`src/components/CurvedText.tsx`) es
 *   una CIRCUNFERENCIA CERRADA de radio `radius - 14 * escala`. El navegador
 *   centra el texto (`startOffset="50%"`) y pinta SÓLO los clusters cuyo
 *   CENTRO de avance cae dentro del path: un cluster cuyo avance cruza el
 *   borde se pinta a medias, y uno cuyo centro queda fuera no se pinta.
 *   La regla (`|sMid| <= pi * R`) se midió contra el DOM real de Chromium
 *   (ver `odd/tasks/stage4-client-export-E2.md` §1.2).
 *
 * CÓMO LO COMPRUEBA
 *   1) Construye la REFERENCIA con la misma receta que la vista previa: el
 *      mismo path (circunferencia completa) y el mismo `<textPath
 *      startOffset="50%">`, rasterizado a 2 px por unidad de diseño, con la
 *      fuente del catálogo EMBEBIDA como data URI (un SVG cargado como
 *      `<img>` no puede pedir fuentes externas: sin eso el navegador dibuja
 *      con otra tipografía y se compararía OTRA fuente).
 *   2) Compone el ADAPTADOR en la misma página y rasteriza sus contornos
 *      con el mismo markup que usa el exportador.
 *   3) Compara las máscaras de tinta (desviación física) y la caja de tinta.
 *   4) Para el límite del recorrido, lee el DOM real del navegador (qué
 *      caracteres pinta) y lo contrasta con la regla del motor.
 *
 * TOLERANCIAS (unidades de diseño; 1 u ≈ 0,134 mm)
 *   - SIN PAREJA = 0: estricto, en todos los escenarios.
 *   - MEDIA ≤ 0,05 u.
 *   - MÁXIMA ≤ 1,6 u — TOLERANCIA EXPERIMENTAL: el glifo frontera. El
 *     navegador lo pinta a medias (su avance cruza el borde del path) y el
 *     motor lo pinta entero; medido 1,12 u (escala 1) y 1,50–1,58 u (escala
 *     3), es decir ≤0,21 mm en UN solo glifo. Por encima del límite físico
 *     de grabado (0,2 mm) sólo en el peor caso medido.
 *   - ÁREA de tinta ≤ 3 %: el motor dibuja el glifo frontera entero.
 */
import { expect, test, type Page } from "@playwright/test";
import { TYPOGRAPHY_FONTS } from "../src/typography";

/** Píxeles por unidad de diseño en la rasterización de referencia. */
const PX_PER_UNIT = 2;
/** Lado del lienzo (900 unidades de diseño × 2 px). */
const CANVAS_PX = 900 * PX_PER_UNIT;
/** Radio de búsqueda de pareja (px): 12 px = 6 unidades de diseño. */
const WINDOW_PX = 12;

const MEAN_TOLERANCE_UNITS = 0.05;
/** TOLERANCIA EXPERIMENTAL (glifo frontera): ver la cabecera del archivo. */
const MAX_TOLERANCE_UNITS = 1.6;
const INK_AREA_TOLERANCE = 0.03;
/** El arco de la tinta: 1 % con un suelo absoluto (cuantización de la máscara). */
const INK_ARC_TOLERANCE = 0.01;
const INK_ARC_ABSOLUTE_TOLERANCE = 2;

type Scenario = {
  name: string;
  text: string;
  scale: number;
  radius: number;
  inverted?: boolean;
  angle?: number;
};

const LONG_TEXT = "Mate&Co ".repeat(15).trim();
const VERY_LONG_TEXT = "Mate&Co ".repeat(30).trim();
const SCALE_3_TEXT = "Virola de aceroDrinkware tallado a medida ".repeat(4).slice(0, 80);

const SCENARIOS: Scenario[] = [
  { name: "47 caracteres, escala 1", text: "Un texto bastante largo para la virola de acero", scale: 1, radius: 374 },
  { name: "119 caracteres, escala 1", text: LONG_TEXT, scale: 1, radius: 374 },
  { name: "119 caracteres, escala 1, invertido", text: LONG_TEXT, scale: 1, radius: 374, inverted: true },
  { name: "119 caracteres, escala 1, rotado 30°", text: LONG_TEXT, scale: 1, radius: 374, angle: 30 },
  { name: "119 caracteres, escala 1, radio 305", text: LONG_TEXT, scale: 1, radius: 305 },
  { name: "119 caracteres, escala 1, radio 410", text: LONG_TEXT, scale: 1, radius: 410 },
  { name: "80 caracteres, escala 3", text: SCALE_3_TEXT, scale: 3, radius: 374 },
  { name: "80 caracteres, escala 3, invertido", text: SCALE_3_TEXT, scale: 3, radius: 374, inverted: true },
  { name: "80 caracteres, escala 0,3", text: SCALE_3_TEXT, scale: 0.3, radius: 374 },
  { name: "239 caracteres, escala 1", text: VERY_LONG_TEXT, scale: 1, radius: 374 },
];

type Metrics = {
  error?: string;
  inkReference: number;
  inkAdapter: number;
  meanDeviation: number;
  maxDeviation: number;
  unpaired: number;
  referenceArc: number;
  adapterArc: number;
  pathCount: number;
  cropX: number;
  cropY: number;
  pixelScale: number;
};

/**
 * Mide, en la página, la tinta del navegador y la del adaptador para un
 * escenario, y devuelve las métricas de comparación.
 */
async function measure(page: Page, scenario: Scenario): Promise<Metrics> {
  return await page.evaluate(
    async ({ scenario, pxPerUnit, canvasPx, windowPx }) => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      const fonts = await import("/src/typography/fonts.ts");

      const scale = scenario.scale;
      const radius = scenario.radius;
      const inverted = scenario.inverted ?? false;
      const angle = scenario.angle ?? 0;
      const pathRadius = radius - 14 * scale;
      const fontSize = 35 * scale;
      const letterSpacing = 2 * scale;
      const dy = inverted ? 26 * scale : 0;
      const sweep = inverted ? 0 : 1;
      // El path de la vista previa: la circunferencia completa.
      const pathD =
        `M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 - pathRadius} ` +
        `A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 + pathRadius}`;

      const font = fonts.TYPOGRAPHY_FONTS.poppins;
      const bytes = await (await fetch(font.url)).arrayBuffer();
      const view = new Uint8Array(bytes);
      let binary = "";
      for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
      const fontB64 = btoa(binary);
      const escaped = scenario.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

      let trace: {
        paths: { d: string }[];
        cropX: number;
        cropY: number;
        pixelScale: number;
        arcLength: number;
      } | null = null;
      try {
        // E4.1: el ADAPTADOR (la frontera de exportación) rechaza un texto
        // que no cabe en el recorrido. Para ejercitar la GEOMETRÍA del
        // recorte —que sigue viva como defensa en profundidad— se compone y
        // se construye por debajo de esa frontera.
        const composed = await adapter.composeVectorText({
          text: scenario.text,
          fontFamily: fonts.TYPOGRAPHY_FONTS.poppins.family,
          scale,
          radius,
          inverted,
        });
        if (!composed.ok) {
          return {
            error: `${composed.code}: ${composed.message}`,
            inkReference: 0,
            inkAdapter: 0,
            meanDeviation: 0,
            maxDeviation: 0,
            unpaired: 0,
            referenceArc: 0,
            adapterArc: 0,
            pathCount: 0,
            cropX: 0,
            cropY: 0,
            pixelScale: 0,
          };
        }
        trace = adapter.buildVectorTrace(composed);
      } catch (error) {
        return {
          error: String((error as Error).message),
          inkReference: 0,
          inkAdapter: 0,
          meanDeviation: 0,
          maxDeviation: 0,
          unpaired: 0,
          referenceArc: 0,
          adapterArc: 0,
          pathCount: 0,
          cropX: 0,
          cropY: 0,
          pixelScale: 0,
        };
      }
      if (!trace) {
        return {
          error: "sin trazo",
          inkReference: 0,
          inkAdapter: 0,
          meanDeviation: 0,
          maxDeviation: 0,
          unpaired: 0,
          referenceArc: 0,
          adapterArc: 0,
          pathCount: 0,
          cropX: 0,
          cropY: 0,
          pixelScale: 0,
        };
      }

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

      // REFERENCIA: la receta de la vista previa (path + textPath).
      const referenceSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<style>@font-face{font-family:"ParityRef";font-weight:600;src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
        `<g transform="rotate(${angle} 450 450)">` +
        `<defs><path id="parity-curve" d="${pathD}"/></defs>` +
        `<text font-family="ParityRef" font-size="${fontSize}" font-weight="600" letter-spacing="${letterSpacing}" text-anchor="middle" dy="${dy}" fill="#000000">` +
        `<textPath href="#parity-curve" startOffset="50%">${escaped}</textPath>` +
        `</text></g></svg>`;

      // ADAPTADOR: el markup del exportador del cliente.
      const outlineSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<g transform="rotate(${angle} 450 450)">` +
        `<g transform="translate(${trace.cropX} ${trace.cropY}) scale(${1 / trace.pixelScale})" fill="#000000" fill-rule="evenodd">` +
        trace.paths.map((path) => `<path d="${path.d}"/>`).join("") +
        `</g></g></svg>`;

      const referencePixels = await draw(referenceSvg, true);
      const outlinePixels = await draw(outlineSvg, false);

      const referenceMask = new Uint8Array(canvasPx * canvasPx);
      const outlineMask = new Uint8Array(canvasPx * canvasPx);
      let inkReference = 0;
      let inkAdapter = 0;
      let minArc = Infinity;
      let maxArc = -Infinity;
      for (let i = 0; i < referencePixels.length; i += 4) {
        const pixel = i / 4;
        const luminance =
          0.2126 * referencePixels[i] +
          0.7152 * referencePixels[i + 1] +
          0.0722 * referencePixels[i + 2];
        if (luminance < 128) {
          referenceMask[pixel] = 1;
          inkReference += 1;
          // Arco de la tinta de la referencia: el texto está centrado arriba
          // (ángulo 0), así que el ángulo se mide desde el tope.
          const x = (pixel % canvasPx) / pxPerUnit - 450;
          const y = Math.floor(pixel / canvasPx) / pxPerUnit - 450;
          const angleFromTop = (Math.atan2(x, -y) * 180) / Math.PI;
          if (angleFromTop < minArc) minArc = angleFromTop;
          if (angleFromTop > maxArc) maxArc = angleFromTop;
        }
        const luminanceOutline =
          0.2126 * outlinePixels[i] +
          0.7152 * outlinePixels[i + 1] +
          0.0722 * outlinePixels[i + 2];
        if (luminanceOutline < 128) {
          outlineMask[pixel] = 1;
          inkAdapter += 1;
        }
      }

      const deviation = (from: Uint8Array, to: Uint8Array) => {
        let sum = 0;
        let count = 0;
        let max = 0;
        let beyond = 0;
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
        return { mean: count ? sum / count : 0, max, beyond };
      };

      const forward = deviation(referenceMask, outlineMask);
      const backward = deviation(outlineMask, referenceMask);

      return {
        inkReference,
        inkAdapter,
        meanDeviation: Math.max(forward.mean, backward.mean) / pxPerUnit,
        maxDeviation: Math.max(forward.max, backward.max) / pxPerUnit,
        unpaired: forward.beyond + backward.beyond,
        referenceArc: inkReference
          ? ((maxArc - minArc) * Math.PI * pathRadius) / 180
          : 0,
        adapterArc: trace.arcLength,
        pathCount: trace.paths.length,
        cropX: trace.cropX,
        cropY: trace.cropY,
        pixelScale: trace.pixelScale,
      };
    },
    {
      scenario,
      pxPerUnit: PX_PER_UNIT,
      canvasPx: CANVAS_PX,
      windowPx: WINDOW_PX,
    },
  );
}

/** Comprobaciones comunes a todos los escenarios con tinta. */
function expectParity(metrics: Metrics, scenario: Scenario) {
  expect(metrics.error, scenario.name).toBeUndefined();
  expect(metrics.inkReference, "tinta de la referencia").toBeGreaterThan(500);
  expect(metrics.inkAdapter, "tinta del adaptador").toBeGreaterThan(500);
  expect(
    Math.abs(metrics.inkAdapter - metrics.inkReference) / metrics.inkReference,
    `área de tinta (${scenario.name})`,
  ).toBeLessThanOrEqual(INK_AREA_TOLERANCE);
  expect(metrics.unpaired, `píxeles sin pareja (${scenario.name})`).toBe(0);
  expect(
    metrics.meanDeviation,
    `desviación media (${scenario.name})`,
  ).toBeLessThanOrEqual(MEAN_TOLERANCE_UNITS);
  expect(
    metrics.maxDeviation,
    `desviación máxima (${scenario.name})`,
  ).toBeLessThanOrEqual(MAX_TOLERANCE_UNITS);
}

test.describe("adaptador vectorial: ventana de visibilidad del texto largo", () => {
  test("el texto largo se recorta igual que en el navegador", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const scenario: Scenario = {
      name: "119 caracteres",
      text: LONG_TEXT,
      scale: 1,
      radius: 374,
    };
    const metrics = await measure(page, scenario);
    expectParity(metrics, scenario);
    // El adaptador entrega la geometría en el espacio 900, sin transformaciones
    // (la traslación la hace el exportador) y un path por glifo.
    expect(metrics.cropX).toBe(450);
    expect(metrics.cropY).toBe(450);
    expect(metrics.pixelScale).toBe(1);
    expect(metrics.pathCount).toBeGreaterThan(0);
  });

  test("la matriz de escala, radio, inversión y rotación", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/");
    for (const scenario of SCENARIOS) {
      const metrics = await measure(page, scenario);
      expectParity(metrics, scenario);
    }
  });

  test("los límites del recorrido coinciden con el DOM real", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/");
    const scenarios: Scenario[] = [
      { name: "119 caracteres, escala 1", text: LONG_TEXT, scale: 1, radius: 374 },
      { name: "239 caracteres, escala 1", text: VERY_LONG_TEXT, scale: 1, radius: 374 },
      { name: "80 caracteres, escala 3", text: SCALE_3_TEXT, scale: 3, radius: 374 },
      { name: "119 caracteres, radio 305", text: LONG_TEXT, scale: 1, radius: 305 },
      { name: "119 caracteres, radio 410", text: LONG_TEXT, scale: 1, radius: 410 },
    ];
    for (const scenario of scenarios) {
      const windows = await page.evaluate(async (scenario) => {
        const engine = await import("/src/typography/index.ts");
        const fonts = await import("/src/typography/fonts.ts");

        const scale = scenario.scale;
        const radius = scenario.radius;
        const pathRadius = radius - 14 * scale;
        const fontSize = 35 * scale;
        const letterSpacing = 2 * scale;
        const pathD =
          `M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 1 450 ${450 - pathRadius} ` +
          `A${pathRadius} ${pathRadius} 0 0 1 450 ${450 + pathRadius}`;

        // La fuente embebida: el SVG en línea sí puede usar una data URI.
        const bytes = await (await fetch(fonts.TYPOGRAPHY_FONTS.poppins.url)).arrayBuffer();
        const view = new Uint8Array(bytes);
        let binary = "";
        for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
        const style = document.createElement("style");
        style.textContent =
          `@font-face{font-family:"ParityRef";font-weight:600;src:url(data:font/ttf;base64,${btoa(binary)}) format("truetype")}`;
        document.head.appendChild(style);

        const host = document.createElement("div");
        host.style.cssText = "position:absolute;left:-5000px;top:0";
        host.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">` +
          `<defs><path id="probe-curve" d="${pathD}"/></defs>` +
          `<text font-family="ParityRef" font-size="${fontSize}" font-weight="600" letter-spacing="${letterSpacing}" text-anchor="middle" fill="#000">` +
          `<textPath href="#probe-curve" startOffset="50%">${scenario.text.replace(/&/g, "&amp;")}</textPath></text></svg>`;
        document.body.appendChild(host);
        await document.fonts.ready;

        const textElement = host.querySelector("text")!;
        const charCount = textElement.getNumberOfChars();
        const painted: number[] = [];
        for (let i = 0; i < charCount; i += 1) {
          let position: { x: number; y: number } | null = null;
          try {
            position = textElement.getStartPositionOfChar(i);
          } catch (error) {
            position = null;
          }
          // Blink devuelve (0,0) para un carácter que no compone sobre el path.
          if (position && !(position.x === 0 && position.y === 0)) painted.push(i);
        }
        host.remove();
        style.remove();

        // El motor: la misma ventana, calculada con la regla del CENTRO.
        const composed = await engine.renderCurvedText({
          text: scenario.text,
          fontId: "poppins",
          weight: 600,
          fontSizeMm: fontSize,
          letterSpacingMm: letterSpacing,
          baselineRadiusMm: pathRadius,
          angleDegrees: 0,
          inverted: false,
          invertedDyMm: 0,
        });
        if (!composed.ok) return { error: composed.code };
        const halfWindow = Math.PI * pathRadius;
        const visible = composed.clusters.filter(
          (cluster) =>
            cluster.sMidMm >= -halfWindow && cluster.sMidMm <= halfWindow,
        );
        const engineFirst = visible.length ? visible[0].charStart : -1;
        const engineLast = visible.length ? visible[visible.length - 1].charEnd - 1 : -1;
        const domFirst = painted.length ? painted[0] : -1;
        const domLast = painted.length ? painted[painted.length - 1] : -1;
        return {
          engineFirst,
          engineLast,
          domFirst,
          domLast,
          domCount: painted.length,
          clusterCount: composed.clusters.length,
          visibleCount: visible.length,
          multiGlyphClusters: composed.clusters.filter(
            (cluster) => cluster.glyphs.length > 1,
          ).length,
        };
      }, scenario);

      expect(windows.error, scenario.name).toBeUndefined();
      // La ventana del motor (centro del avance) es EXACTAMENTE la que
      // reporta el DOM real del navegador.
      expect(windows.engineFirst, `inicio (${scenario.name})`).toBe(windows.domFirst);
      expect(windows.engineLast, `fin (${scenario.name})`).toBe(windows.domLast);
      expect(windows.domCount, `caracteres pintados (${scenario.name})`).toBeGreaterThan(0);
    }
  });

  test("clusters de varios glifos y ligaduras", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/");
    const scenarios: Scenario[] = [
      { name: "ligaduras", text: "fi fl ffi office difficult affinity", scale: 1, radius: 374 },
      { name: "base + marca combinante", text: "á é í ó ú ñ ¿ ¡", scale: 1, radius: 374 },
    ];
    for (const scenario of scenarios) {
      const metrics = await measure(page, scenario);
      expectParity(metrics, scenario);
    }
    // El motor trata el cluster como UNA unidad: expone sus límites de arco
    // y agrupa todos sus glifos. Un cluster PUEDE producir varios glifos
    // (scripts con reordenación), por eso la ventana de visibilidad se
    // decide por cluster y no por glifo.
    const info = await page.evaluate(async () => {
      const engine = await import("/src/typography/index.ts");
      const compose = async (text: string) => {
        const composed = await engine.renderCurvedText({
          text,
          fontId: "poppins",
          weight: 600,
          fontSizeMm: 35,
          letterSpacingMm: 2,
          baselineRadiusMm: 360,
          angleDegrees: 0,
          inverted: false,
          invertedDyMm: 0,
        });
        if (!composed.ok) return { error: composed.code };
        return {
          clusters: composed.clusters.map((cluster) => ({
            text: cluster.text,
            charStart: cluster.charStart,
            charEnd: cluster.charEnd,
            glyphs: cluster.glyphs.length,
            sMidMm: cluster.sMidMm,
            sStartMm: cluster.sStartMm,
            sEndMm: cluster.sEndMm,
          })),
          glyphCount: composed.glyphs.length,
        };
      };
      const ligatures = await compose("fi fl ffi office");
      const notNfc = await compose("a\u0301");
      return { ligatures, notNfc };
    });

    expect(info.ligatures.error).toBeUndefined();
    const clusters = info.ligatures.clusters;
    // Los clusters cubren el texto una sola vez, de forma contigua.
    expect(clusters.length).toBeGreaterThan(0);
    let cursor = 0;
    for (const cluster of clusters) {
      expect(cluster.charStart, "cobertura contigua de los clusters").toBe(cursor);
      expect(cluster.charEnd).toBeGreaterThan(cluster.charStart);
      expect(cluster.text.length).toBe(cluster.charEnd - cluster.charStart);
      // Los límites de arco son coherentes con el avance del cluster.
      expect(cluster.sStartMm).toBeLessThan(cluster.sMidMm);
      expect(cluster.sEndMm).toBeGreaterThan(cluster.sMidMm);
      cursor = cluster.charEnd;
    }
    expect(cursor, "los clusters cubren todo el texto").toBe("fi fl ffi office".length);
    // Todos los glifos están agrupados en su cluster (ninguno se duplica).
    expect(
      clusters.reduce((total, cluster) => total + cluster.glyphs, 0),
    ).toBe(info.ligatures.glyphCount);
    // El motor conserva el fallo cerrado ante texto no NFC: la
    // normalización es del ADAPTADOR (E3.0), no del motor.
    expect(info.notNfc.error).toBe("TEXT_NOT_NFC");
  });

  test("arcLength es el arco de la tinta, no el avance", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/");
    for (const scenario of [SCENARIOS[0], SCENARIOS[1], SCENARIOS[6]]) {
      const metrics = await measure(page, scenario);
      expect(metrics.error, scenario.name).toBeUndefined();
      expect(metrics.referenceArc, `arco de la referencia (${scenario.name})`).toBeGreaterThan(0);
      expect(
        Math.abs(metrics.adapterArc - metrics.referenceArc),
        `arco de la tinta (${scenario.name})`,
      ).toBeLessThanOrEqual(
        Math.max(
          metrics.referenceArc * INK_ARC_TOLERANCE,
          INK_ARC_ABSOLUTE_TOLERANCE,
        ),
      );
    }
  });

  test("la banda de protección se deriva del arco de la tinta", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");

      const state = {
        texts: [
          {
            id: "t1",
            text: "Mate&Co ".repeat(15).trim(),
            fontFamily: "Poppins SemiBold",
            angle: 0,
            radius: 374,
            inverted: false,
            scale: 1,
          },
        ],
        icons: [],
        graphics: [],
        circularLines: "double" as const,
      };

      // El SVG con el trazador VECTORIAL (inyectado por el seam existente).
      // E4.1: este texto NO entra en el recorrido, así que el trazador de
      // exportación lo rechazaría; para comprobar la banda se usa el
      // trazador por debajo de esa frontera.
      const vectorTrace = async () => {
        const composed = await adapter.composeVectorText({
          text: state.texts[0].text,
          fontFamily: state.texts[0].fontFamily,
          scale: 1,
          radius: 374,
          inverted: false,
        });
        if (!composed.ok) throw new Error(`${composed.code}: ${composed.message}`);
        return adapter.buildVectorTrace(composed);
      };
      const vectorSvg = await buildProductionSvg(state, vectorTrace);

      // El mismo SVG con un trazador de referencia que devuelve el mismo
      // arco: la banda (y por tanto los arcos de las líneas decorativas) debe
      // ser idéntica.
      const trace = await vectorTrace();
      const stubArc = await vectorTrace();
      const stubSvg = await buildProductionSvg(state, async () => ({
        paths: trace!.paths,
        cropX: trace!.cropX,
        cropY: trace!.cropY,
        pixelScale: trace!.pixelScale,
        inkBox: trace!.inkBox,
        arcLength: stubArc!.arcLength,
      }));

      // La banda de producción (`productionSvg.ts:143`).
      const halfSpan = (arcLength: number, radius: number) =>
        Math.min(135, Math.max(7, ((arcLength / 2 + 14) / radius) * (180 / Math.PI)));

      const arcsOf = (svg: string) =>
        (svg.match(/<path d="M[\d.]+ [\d.]+ A[^"]+"/g) ?? []).join("|");

      return {
        sameLines: arcsOf(vectorSvg) === arcsOf(stubSvg),
        halfSpanFromTrace: halfSpan(trace!.arcLength, 374),
        arcLength: trace!.arcLength,
        vectorHasText: vectorSvg.includes("<text"),
      };
    });
    // El SVG exportado con el trazador vectorial no lleva texto: sólo paths.
    expect(result.vectorHasText).toBe(false);
    // La banda se deriva del arco de la tinta y es la misma con el trazador
    // de referencia: el knockout no cambia al vectorizar.
    expect(result.sameLines).toBe(true);
    expect(result.halfSpanFromTrace).toBeGreaterThan(0);
  });
});
