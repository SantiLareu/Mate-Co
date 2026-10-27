/**
 * E1 — Paridad del adaptador vectorial del cliente (E0) con la vista previa
 * REAL del cliente.
 *
 * QUÉ DEMUESTRA
 *   Que el adaptador (`src/export/vectorTextOutlines.ts`), que compone el
 *   texto con el motor de HarfBuzz, produce la MISMA tinta que la vista
 *   previa del editor (`src/components/CurvedText.tsx`), que es la que el
 *   cliente ve: mismas medidas, misma fuente, mismo peso, mismo arco y
 *   mismo `dy`.
 *
 * CÓMO LO COMPRUEBA
 *   1) Abre la app, entra en "Diseño", añade un texto y LEE del DOM real del
 *      editor el `<text>` (font-family, font-size, letter-spacing, dy,
 *      text-anchor), su `<textPath href>` y el `d` del `<path id="curve-…">`
 *      que usa la vista previa, además de `data-angle` / `data-radius` /
 *      `data-scale` del grupo.
 *   2) Con esos valores REALES arma la REFERENCIA: un SVG con ese mismo
 *      path y ese mismo `<textPath startOffset="50%">` (la misma receta que
 *      usa la vista previa), rasterizado a 2 px por unidad de diseño. La
 *      fuente del catálogo va embebida (data URI) porque un SVG cargado como
 *      imagen no puede pedir recursos externos: sin eso el navegador
 *      dibujaría con la tipografía por defecto y se compararía OTRA fuente
 *      (la sustitución silenciosa que la Etapa 4 prohíbe).
 *   3) Compone el ADAPTADOR en la misma página y rasteriza sus contornos
 *      con el mismo markup que usa el exportador (`rotate` +
 *      `translate(cropX cropY) scale(1/pixelScale)`).
 *   4) Compara las máscaras de tinta (desviación física, como en
 *      `tests/production-lab-typography-parity.spec.ts`): media, máxima y
 *      píxeles sin pareja. Compara también la caja de tinta y el avance.
 *
 * TOLERANCIAS (unidades de diseño; la vista previa del cliente no tiene mm)
 *   1 unidad de diseño ≈ 0,134 mm en la virola 85/50 estrategia B (radio
 *   útil de texto 374 u ≈ 50 mm), así que 0,2 mm ≈ 1,5 unidades.
 *   - MEDIA ≤ 0,3 u (≈0,04 mm): el desvío sistemático entre motor y
 *     navegador NO es una traslación del texto (el texto queda centrado en
 *     el mismo punto), sino el redondeo del punto de anclaje de cada glifo
 *     (el motor rota el glifo en el centro de su avance; el navegador lo
 *     rota en su origen) y el ajuste de rejilla del rasterizador. Con un
 *     tamaño de fuente de 35 u, ese error es del orden de 0,1 u.
 *   - MÁXIMA ≤ 1,5 u (≈0,2 mm): el mismo criterio que la paridad del
 *     laboratorio (0,2 mm máximos y 0,05 mm de media) traducido a unidades
 *     de diseño.
 */
import { expect, test, type Page } from "@playwright/test";
import { TYPOGRAPHY_FONTS } from "../src/typography";
import { catalogueFontForFamily } from "../src/typography/catalogue";

/** Píxeles por unidad de diseño en la rasterización de referencia. */
const PX_PER_UNIT = 2;
/** Lado del lienzo (900 unidades de diseño × 2 px). */
const CANVAS_PX = 900 * PX_PER_UNIT;
/** Radio de búsqueda de pareja (px): 12 px = 6 unidades de diseño. */
const WINDOW_PX = 12;

const MEAN_TOLERANCE_UNITS = 0.3;
const MAX_TOLERANCE_UNITS = 1.5;
const INKBOX_TOLERANCE_UNITS = 2;
/** La tinta de la referencia y la del adaptador deben ser la misma (mismo % de área). */
const INK_AREA_TOLERANCE = 0.1;
/** El avance del motor y el del navegador deben coincidir (mismo %). */
const ADVANCE_TOLERANCE = 0.01;

type PreviewFacts = {
  pathD: string;
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  dy: number;
  textAnchor: string;
  startOffset: string;
  content: string;
  /** Avance que el navegador mide en la propia vista previa. */
  length: number;
  angle: number;
  radius: number;
  scale: number;
};

type Metrics = {
  error?: string;
  empty?: boolean;
  inkReference: number;
  inkAdapter: number;
  meanDeviation: number;
  maxDeviation: number;
  unpaired: number;
  referenceBox: { x: number; y: number; width: number; height: number } | null;
  adapterBox: { x: number; y: number; width: number; height: number } | null;
  arcLength: number;
  pathCount: number;
  cropX: number;
  cropY: number;
  pixelScale: number;
};

/** Abre el editor en el paso "Diseño" y añade un texto. */
async function openEditor(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Diseño", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  await page.locator(".add-text").click();
}

/** Escribe el contenido del texto seleccionado. */
async function setText(page: Page, text: string) {
  await page.locator("#text-content").fill(text);
}

/** Elige una tipografía del catálogo. */
async function setFont(page: Page, family: string) {
  await page.locator("#text-font").selectOption(family);
}

/** Deja el texto invertido (o no) con el botón real del panel. */
async function setInverted(page: Page, inverted: boolean) {
  const button = page.getByRole("button", { name: "Invertir texto" });
  const pressed = (await button.getAttribute("aria-pressed")) === "true";
  if (pressed !== inverted) await button.click();
}

/** Lee del DOM real de la vista previa los datos del texto. */
async function readPreview(page: Page): Promise<PreviewFacts> {
  return await page.evaluate(() => {
    const group = document.querySelector("g.curved-text");
    if (!group) throw new Error("La vista previa no tiene ningún texto.");
    const text = group.querySelector("text");
    const textPath = group.querySelector("textPath");
    if (!text || !textPath) throw new Error("La vista previa no tiene texto curvado.");
    const href = textPath.getAttribute("href") ?? textPath.getAttribute("xlink:href") ?? "";
    const path = document.getElementById(href.replace(/^#/, ""));
    if (!path) throw new Error(`No se encuentra el path del arco (${href}).`);
    return {
      pathD: path.getAttribute("d") ?? "",
      fontFamily: text.getAttribute("font-family") ?? "",
      fontSize: Number(text.getAttribute("font-size")),
      letterSpacing: Number(text.getAttribute("letter-spacing") ?? 0),
      dy: Number(text.getAttribute("dy") ?? 0),
      textAnchor: text.getAttribute("text-anchor") ?? "",
      startOffset: textPath.getAttribute("startOffset") ?? "",
      content: textPath.textContent ?? "",
      length: text.getComputedTextLength(),
      angle: Number(group.getAttribute("data-angle")),
      radius: Number(group.getAttribute("data-radius")),
      scale: Number(group.getAttribute("data-scale")),
    };
  });
}

/**
 * La fuente del catálogo que usa la vista previa, según su `font-family`.
 *
 * Se deriva del DOM (no de una constante del test): si el editor cambiara de
 * tipografía, la referencia se construiría con la fuente equivocada y la
 * comparación medwould medir otra fuente —el fallo exacto que este test
 * tiene que cazar.
 */
function fontOf(dom: PreviewFacts) {
  const fontId = catalogueFontForFamily(dom.fontFamily);
  if (!fontId) {
    throw new Error(`La familia «${dom.fontFamily}» no está en el catálogo.`);
  }
  const font = TYPOGRAPHY_FONTS[fontId];
  return {
    fontId,
    url: font.url,
    // Rango de peso con el que se declara la @font-face: las fuentes
    // variables lo declaran como rango (el navegador interpola el eje).
    weightRange: font.variable ? "400 700" : "600",
  };
}

/**
 * Compara, dentro de la página, la referencia (navegador) con el adaptador.
 *
 * La referencia se arma con la MISMA receta que la vista previa: el mismo
 * path, el mismo `<textPath startOffset="50%">` y los mismos atributos del
 * `<text>` leídos del DOM.
 */
async function compareInPage(
  page: Page,
  dom: PreviewFacts,
  font: { url: string; weightRange: string },
): Promise<Metrics> {
  return await page.evaluate(
    async ({ dom, fontUrl, fontWeightRange, pxPerUnit, canvasPx, windowPx }) => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      // El sentido del arco (sweep) está en el `d` del path de la vista
      // previa: 0 = invertido.
      const sweep =
        (dom.pathD.match(/A\s*[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+([01])/) ?? [])[1] ?? "1";
      const inverted = sweep === "0";

      let trace: {
        paths: { d: string }[];
        cropX: number;
        cropY: number;
        pixelScale: number;
        inkBox: { x: number; y: number; width: number; height: number };
        arcLength: number;
      } | null = null;
      try {
        trace = await adapter.vectorTextTrace({
          text: dom.content,
          fontFamily: dom.fontFamily,
          scale: dom.scale,
          radius: dom.radius,
          inverted,
        });
      } catch (error) {
        return {
          error: String((error as Error).message),
          inkReference: 0,
          inkAdapter: 0,
          meanDeviation: 0,
          maxDeviation: 0,
          unpaired: 0,
          referenceBox: null,
          adapterBox: null,
          arcLength: 0,
          pathCount: 0,
          cropX: 0,
          cropY: 0,
          pixelScale: 0,
        };
      }
      if (!trace) {
        return {
          empty: true,
          inkReference: 0,
          inkAdapter: 0,
          meanDeviation: 0,
          maxDeviation: 0,
          unpaired: 0,
          referenceBox: null,
          adapterBox: null,
          arcLength: 0,
          pathCount: 0,
          cropX: 0,
          cropY: 0,
          pixelScale: 0,
        };
      }

      // La fuente del catálogo, embebida para el SVG de referencia.
      const bytes = await (await fetch(fontUrl)).arrayBuffer();
      const view = new Uint8Array(bytes);
      let binary = "";
      for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
      const fontB64 = btoa(binary);
      const escaped = dom.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // REFERENCIA: la misma receta que la vista previa del cliente.
      const referenceSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<style>@font-face{font-family:"ParityRef";font-weight:${fontWeightRange};src:url(data:font/ttf;base64,${fontB64}) format("truetype")}</style>` +
        `<g transform="rotate(${dom.angle} 450 450)">` +
        `<defs><path id="parity-curve" d="${dom.pathD}"/></defs>` +
        `<text font-family="ParityRef" font-size="${dom.fontSize}" font-weight="600" letter-spacing="${dom.letterSpacing}" text-anchor="${dom.textAnchor}" dy="${dom.dy}" fill="#000000">` +
        `<textPath href="#parity-curve" startOffset="${dom.startOffset}">${escaped}</textPath>` +
        `</text></g></svg>`;

      // ADAPTADOR: exactamente el markup del exportador del cliente.
      const outlineSvg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 900 900">` +
        `<g transform="rotate(${dom.angle} 450 450)">` +
        `<g transform="translate(${trace.cropX} ${trace.cropY}) scale(${1 / trace.pixelScale})" fill="#000000" fill-rule="evenodd">` +
        trace.paths.map((path) => `<path d="${path.d}"/>`).join("") +
        `</g></g></svg>`;

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
          // La @font-face embebida se carga de forma asíncrona dentro de la
          // imagen SVG: se repinta tras un turno para que el texto esté.
          await new Promise((done) => setTimeout(done, 400));
          paint();
        }
        URL.revokeObjectURL(url);
        return context.getImageData(0, 0, canvasPx, canvasPx).data;
      };

      const referencePixels = await draw(referenceSvg, true);
      const outlinePixels = await draw(outlineSvg, false);

      const referenceMask = new Uint8Array(canvasPx * canvasPx);
      const outlineMask = new Uint8Array(canvasPx * canvasPx);
      let inkReference = 0;
      let inkAdapter = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      // La caja de la referencia se mide en el MISMO marco que la del
      // adaptador: sin rotar. El adaptador entrega el `inkBox` del texto SIN
      // rotar (lo gira después el exportador, `rotateBox(inkBox, angle)`),
      // así que la referencia se deshace el giro del grupo antes de medir.
      const radians = (dom.angle * Math.PI) / 180;
      const cos = Math.cos(-radians);
      const sin = Math.sin(-radians);
      for (let i = 0; i < referencePixels.length; i += 4) {
        const pixel = i / 4;
        const luminance =
          0.2126 * referencePixels[i] +
          0.7152 * referencePixels[i + 1] +
          0.0722 * referencePixels[i + 2];
        if (luminance < 128) {
          referenceMask[pixel] = 1;
          inkReference += 1;
          const x = pixel % canvasPx;
          const y = Math.floor(pixel / canvasPx);
          const dx = x / pxPerUnit - 450;
          const dy = y / pxPerUnit - 450;
          const ux = 450 + dx * cos - dy * sin;
          const uy = 450 + dx * sin + dy * cos;
          if (ux < minX) minX = ux;
          if (ux > maxX) maxX = ux;
          if (uy < minY) minY = uy;
          if (uy > maxY) maxY = uy;
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
        referenceBox:
          inkReference === 0
            ? null
            : {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
              },
        adapterBox: trace.inkBox,
        arcLength: trace.arcLength,
        pathCount: trace.paths.length,
        cropX: trace.cropX,
        cropY: trace.cropY,
        pixelScale: trace.pixelScale,
      };
    },
    {
      dom,
      fontUrl: font.url,
      fontWeightRange: font.weightRange,
      pxPerUnit: PX_PER_UNIT,
      canvasPx: CANVAS_PX,
      windowPx: WINDOW_PX,
    },
  );
}

/** Comprobaciones comunes a todos los casos con tinta. */
function expectParity(metrics: Metrics, dom: PreviewFacts) {
  expect(metrics.error).toBeUndefined();
  expect(metrics.empty).toBeFalsy();
  expect(metrics.inkReference, "tinta de la referencia").toBeGreaterThan(500);
  expect(metrics.inkAdapter, "tinta del adaptador").toBeGreaterThan(500);
  // La misma tinta: si la referencia usara otra fuente, el área sería
  // distinta (es lo que pasa con una fuente de otro peso o de otra familia).
  expect(
    Math.abs(metrics.inkAdapter - metrics.inkReference) / metrics.inkReference,
    "área de tinta (referencia vs adaptador)",
  ).toBeLessThanOrEqual(INK_AREA_TOLERANCE);
  expect(metrics.unpaired, "píxeles sin pareja").toBe(0);
  expect(
    metrics.meanDeviation,
    "desviación media (unidades de diseño)",
  ).toBeLessThanOrEqual(MEAN_TOLERANCE_UNITS);
  expect(
    metrics.maxDeviation,
    "desviación máxima (unidades de diseño)",
  ).toBeLessThanOrEqual(MAX_TOLERANCE_UNITS);
  // El avance: el motor compone el texto como el navegador (mismo HarfBuzz).
  expect(
    Math.abs(metrics.arcLength - dom.length) / dom.length,
    "avance (motor vs navegador)",
  ).toBeLessThanOrEqual(ADVANCE_TOLERANCE);
  // La caja de tinta del adaptador es la de la referencia (la que el
  // navegador pintó), dentro de la tolerancia. Se comparan en el marco SIN
  // rotar: el `inkBox` del adaptador es el del texto sin rotar (el
  // exportador lo gira después con `rotateBox`).
  expect(metrics.referenceBox).not.toBeNull();
  const box = metrics.adapterBox!;
  expect(Math.abs(box.x - metrics.referenceBox!.x), "inkBox.x").toBeLessThanOrEqual(
    INKBOX_TOLERANCE_UNITS,
  );
  expect(Math.abs(box.y - metrics.referenceBox!.y), "inkBox.y").toBeLessThanOrEqual(
    INKBOX_TOLERANCE_UNITS,
  );
  expect(
    Math.abs(box.width - metrics.referenceBox!.width),
    "inkBox.width",
  ).toBeLessThanOrEqual(INKBOX_TOLERANCE_UNITS);
  expect(
    Math.abs(box.height - metrics.referenceBox!.height),
    "inkBox.height",
  ).toBeLessThanOrEqual(INKBOX_TOLERANCE_UNITS);
}

test.describe("adaptador vectorial del cliente: paridad con la vista previa", () => {
  test("la referencia se construye con los valores REALES del editor", async ({
    page,
  }) => {
    await openEditor(page);
    await setText(page, "Mate&Co");
    const dom = await readPreview(page);
    // El editor pinta con la fuente del catálogo, la misma geometría que
    // documenta CurvedText.tsx.
    expect(dom.fontFamily).toBe(TYPOGRAPHY_FONTS.poppins.family);
    expect(dom.fontSize).toBe(35);
    expect(dom.letterSpacing).toBe(2);
    expect(dom.textAnchor).toBe("middle");
    expect(dom.startOffset).toBe("50%");
    expect(dom.dy).toBe(0);
    expect(dom.angle).toBe(0);
    expect(dom.scale).toBe(1);
    expect(dom.radius).toBe(374);
    // El arco de la vista previa: dos medias circunferencias de radio
    // (radio − 14 × escala) centradas en (450,450).
    expect(dom.pathD).toContain("M450 810");
    expect(dom.pathD).toContain("A360 360 0 0 1 450 90");
  });

  for (const fontId of ["poppins", "lato", "dancing-script"] as const) {
    test(`paridad de tinta: ${TYPOGRAPHY_FONTS[fontId].family}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openEditor(page);
      await setFont(page, TYPOGRAPHY_FONTS[fontId].family);
      await setText(page, "¡Fiesta! Mate&Co");
      const dom = await readPreview(page);
      expect(dom.fontFamily).toBe(TYPOGRAPHY_FONTS[fontId].family);

      const metrics = await compareInPage(page, dom, fontOf(dom));
      expectParity(metrics, dom);
      // El adaptador entrega un path por glifo, en el espacio 900 y sin
      // transformaciones (la traslación la hace el exportador).
      expect(metrics.cropX).toBe(450);
      expect(metrics.cropY).toBe(450);
      expect(metrics.pixelScale).toBe(1);
      expect(metrics.pathCount).toBeGreaterThan(0);
    });
  }

  test("paridad de tinta: texto invertido", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await setText(page, "Texto invertido");
    await setInverted(page, true);
    const dom = await readPreview(page);
    // El `dy` del invertido sale del propio DOM.
    expect(dom.dy).toBe(26);
    expect(dom.pathD).toContain("A360 360 0 0 0 450 90");

    const metrics = await compareInPage(page, dom, fontOf(dom));
    expectParity(metrics, dom);
  });

  test("paridad de tinta: texto rotado", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await setText(page, "Texto rotado");
    // El editor rota el texto con el teclado (el mismo gesto del usuario).
    const group = page.locator("g.curved-text");
    await group.click();
    for (let i = 0; i < 6; i += 1) await group.press("ArrowRight");
    const dom = await readPreview(page);
    expect(dom.angle).toBe(30);

    const metrics = await compareInPage(page, dom, fontOf(dom));
    expectParity(metrics, dom);
  });

  test("paridad de tinta: texto largo (>= 40 caracteres)", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    await setText(page, "Un texto bastante largo para la virola de acero");
    const dom = await readPreview(page);
    expect(dom.content.length).toBeGreaterThanOrEqual(40);

    const metrics = await compareInPage(page, dom, fontOf(dom));
    expectParity(metrics, dom);
  });

  test("texto vacío y texto con sólo espacios: sin trazo (null)", async ({
    page,
  }) => {
    await openEditor(page);
    await setText(page, "");
    const empty = await readPreview(page);
    const emptyMetrics = await compareInPage(page, empty, fontOf(empty));
    expect(emptyMetrics.error).toBeUndefined();
    expect(emptyMetrics.empty, "texto vacío → sin trazo").toBe(true);

    await setText(page, "   ");
    const spaces = await readPreview(page);
    expect(spaces.content).toBe("   ");
    const spaceMetrics = await compareInPage(page, spaces, fontOf(spaces));
    expect(spaceMetrics.error).toBeUndefined();
    expect(
      spaceMetrics.empty,
      "texto con sólo espacios → sin trazo (sin banda fantasma)",
    ).toBe(true);
  });

  test("familia fuera del catálogo: error explícito (sin sustitución)", async ({
    page,
  }) => {
    await openEditor(page);
    // La vista previa sólo ofrece tipografías del catálogo, así que este caso
    // no se puede provocar desde el editor: se llama al adaptador con una
    // familia de sistema (el editor la usaba antes de la Etapa 4).
    const result = await page.evaluate(async () => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      try {
        await adapter.vectorTextTrace({
          text: "Mate&Co",
          fontFamily: "Georgia",
          scale: 1,
          radius: 374,
          inverted: false,
        });
        return { error: undefined };
      } catch (error) {
        return { error: String((error as Error).message) };
      }
    });
    expect(result.error, "familia fuera del catálogo").toContain(
      "FONT_NOT_IN_CATALOGUE",
    );
  });

  test("glifo no soportado: error explícito (sin sustitución)", async ({
    page,
  }) => {
    await openEditor(page);
    await setText(page, "☃");
    const dom = await readPreview(page);
    expect(dom.content).toBe("☃");
    const metrics = await compareInPage(page, dom, fontOf(dom));
    expect(metrics.error).toContain("GLYPH_MISSING");
  });

  test("texto no NFC: error explícito (sin normalizar en silencio)", async ({
    page,
  }) => {
    await openEditor(page);
    await setText(page, "a\u0301");
    const dom = await readPreview(page);
    const metrics = await compareInPage(page, dom, fontOf(dom));
    expect(metrics.error).toContain("TEXT_NOT_NFC");
  });

  test("determinismo: dos llamadas dan el mismo resultado byte a byte", async ({
    page,
  }) => {
    await openEditor(page);
    await setText(page, "Determinista");
    const dom = await readPreview(page);
    const result = await page.evaluate(async (dom) => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      const request = {
        text: dom.content,
        fontFamily: dom.fontFamily,
        scale: dom.scale,
        radius: dom.radius,
        inverted: false,
      };
      const first = await adapter.vectorTextTrace(request);
      const second = await adapter.vectorTextTrace(request);
      return {
        first: JSON.stringify(first),
        second: JSON.stringify(second),
      };
    }, dom);
    expect(result.first).toBe(result.second);
    expect(result.first).toContain('"pixelScale":1');
  });
});
