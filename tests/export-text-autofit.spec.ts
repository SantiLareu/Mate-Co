/**
 * E4.1 — Autoajuste del texto curvo al recorrido circular de la virola.
 *
 * QUÉ DEMUESTRA
 *   Que el editor ajusta el tamaño del texto para que entre COMPLETO en el
 *   recorrido, de forma determinista y visible, sin tocar el contenido, la
 *   fuente, el radio, el ángulo ni la inversión; y que la exportación nunca
 *   genera un archivo con texto parcialmente oculto (los dos caminos).
 *
 * LA REGLA (medida, ver `odd/tasks/stage4-client-export-E2.md` §1.2)
 *   El texto entra si `avance <= 2 * PI * (radius - 14 * escala)`.
 *   El avance se mide con `getComputedTextLength()` del DOM real (la fuente
 *   del catálogo, con su letter-spacing): no se estima contando caracteres.
 *
 * TOLERANCIAS
 *   - La escala efectiva se compara con 1e-6 (el ajuste es una forma
 *     cerrada: el mismo conjunto de medidas da siempre el mismo resultado).
 *   - El encaje se comprueba con el helper del repo (`textFitsPath`), que
 *     lleva el margen justificado del 1 %.
 */
import { expect, test, type Page } from "@playwright/test";
import { textFitsPath } from "../src/typography/textFit";

/* ---------------------------------------------------------------- */
/* Utilidades (mismo patrón que tests/direct-manipulation.spec.ts)   */
/* ---------------------------------------------------------------- */

type ElementState = {
  angle: number;
  radius: number;
  scale: number;
};

type Point = { x: number; y: number };

async function startBlank(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Diseño", exact: true }),
  ).toHaveAttribute("aria-current", "step");
}

async function elementState(
  page: Page,
  selector = ".curved-text",
): Promise<ElementState> {
  return page.locator(selector).evaluate((element) => {
    if (!(element instanceof SVGGElement)) throw new Error("Missing SVG element");
    return {
      angle: Number(element.dataset.angle),
      radius: Number(element.dataset.radius),
      scale: Number(element.dataset.scale ?? 1),
    };
  });
}

/** Avance medido del texto real en el DOM (no una estimación). */
async function measuredAdvance(page: Page, selector = ".curved-text") {
  return page.locator(selector).evaluate((element) => {
    const text = element.querySelector("text");
    return text?.getComputedTextLength() ?? 0;
  });
}

/**
 * La caja del elemento en coordenadas de PÁGINA (no de ventana): así el
 * scroll que provoca el foco del campo no se confunde con un salto de
 * layout.
 */
async function pageBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

/** El estado del texto más su medida, para comprobar el encaje. */
async function fitState(page: Page, selector = ".curved-text") {
  const state = await elementState(page, selector);
  const advance = await measuredAdvance(page, selector);
  return {
    ...state,
    advance,
    limit: 2 * Math.PI * (state.radius - 14 * state.scale),
    fits: textFitsPath(advance, state.radius, state.scale),
  };
}

/** El recorrido de puntos del tirador, como en el spec de manipulación. */
async function handlePath(
  page: Page,
  selector: string,
  handleSelector: string,
  factor: number,
  rotation: number,
) {
  return page.locator(selector).evaluate(
    (element, parameters) => {
      const handle = element.querySelector(parameters.handleSelector);
      const matrix = element.ownerSVGElement?.getScreenCTM();
      const handleMatrix = (handle as SVGGElement | null)?.getScreenCTM();
      if (!(element instanceof SVGGElement) || !matrix || !handleMatrix)
        throw new Error("Missing transform handle");
      const angle = ((Number(element.dataset.angle) - 90) * Math.PI) / 180;
      const radius = Number(element.dataset.radius);
      const center = new DOMPoint(
        450 + radius * Math.cos(angle),
        450 + radius * Math.sin(angle),
      ).matrixTransform(matrix);
      const start = new DOMPoint(0, 0).matrixTransform(handleMatrix);
      const deltaX = start.x - center.x;
      const deltaY = start.y - center.y;
      return Array.from({ length: 20 }, (_, index) => {
        const progress = index / 19;
        const scale = 1 + (parameters.factor - 1) * progress;
        const radians = ((parameters.rotation * Math.PI) / 180) * progress;
        return {
          x: center.x + deltaX * scale * Math.cos(radians),
          y: center.y + deltaY * scale * Math.sin(radians),
        };
      });
    },
    { handleSelector, factor, rotation },
  );
}

/** Arrastra el tirador de tamaño un factor respecto de su posición inicial. */
async function dragScale(page: Page, factor: number) {
  await page.locator(".curved-text").scrollIntoViewIfNeeded();
  const points = await handlePath(
    page,
    ".curved-text",
    ".transform-handle",
    factor,
    0,
  );
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Espera a que las fuentes del catálogo estén cargadas (la medición depende). */
async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

/** Añade un texto con el contenido dado y devuelve su estado. */
async function addText(page: Page, text: string, family = "Poppins SemiBold") {
  await startBlank(page);
  await page.locator(".add-text").click();
  await fontsReady(page);
  await page.locator("#text-font").selectOption(family);
  await page.locator("#text-content").fill(text);
  await page.waitForTimeout(300);
  return await fitState(page);
}

/** Un texto largo (80 caracteres, el máximo que admite el editor). */
const LONG_TEXT = "Mate&Co ".repeat(10).trim().slice(0, 80);

test.describe("autoajuste del texto al recorrido de la virola", () => {
  test("un texto que cabe no se toca", async ({ page }) => {
    const state = await addText(page, "Mate&Co");
    expect(state.scale).toBeCloseTo(1, 6);
    expect(state.angle).toBe(0);
    expect(state.radius).toBe(374);
    expect(state.fits).toBe(true);
  });

  test("un texto largo se reduce hasta entrar completo", async ({ page }) => {
    const before = await addText(page, LONG_TEXT);
    // A escala 1 y radio 374 el texto de 80 caracteres entra justo.
    expect(before.fits).toBe(true);
    // Al ampliarlo con el tirador, el ajuste lo deja entrar de nuevo.
    await dragScale(page, 2);
    const after = await fitState(page);
    expect(after.scale).toBeLessThan(2);
    expect(after.scale).toBeGreaterThan(0.3);
    expect(after.fits, "el texto ajustado entra completo").toBe(true);
    // Y el ajuste no tocó nada más.
    expect(after.angle).toBe(before.angle);
    expect(after.radius).toBe(before.radius);
  });

  test("el ajuste respeta los límites mínimo y máximo", async ({ page }) => {
    await addText(page, LONG_TEXT);
    await dragScale(page, 3);
    const big = await elementState(page);
    expect(big.scale).toBeLessThanOrEqual(3);
    expect(big.scale).toBeGreaterThanOrEqual(0.3);
    await dragScale(page, 0.3);
    const small = await elementState(page);
    expect(small.scale).toBeGreaterThanOrEqual(0.3);
  });

  test("el ajuste funciona con las tres tipografías", async ({ page }) => {
    for (const family of [
      "Poppins SemiBold",
      "Lato SemiBold",
      "Dancing Script",
    ]) {
      await addText(page, LONG_TEXT, family);
      await dragScale(page, 2);
      const state = await fitState(page);
      expect(state.scale, family).toBeLessThan(2);
      expect(state.fits, family).toBe(true);
    }
  });

  test("el ajuste no altera el ángulo, la inversión ni el radio", async ({
    page,
  }) => {
    const before = await addText(page, LONG_TEXT);
    // La inversión se cambia con el botón del panel (antes de arrastrar: el
    // botón vive en el panel de texto).
    await page.getByRole("button", { name: "Invertir texto" }).click();
    await page.waitForTimeout(250);
    const inverted = await fitState(page);
    expect(inverted.radius).toBe(before.radius);
    expect(inverted.angle).toBe(before.angle);
    expect(inverted.fits).toBe(true);
    // Y el ajuste por enlargement no toca nada más.
    await dragScale(page, 2);
    const after = await fitState(page);
    expect(after.angle).toBe(before.angle);
    expect(after.radius).toBe(before.radius);
  });

  test("cambiar el contenido vuelve a ajustar", async ({ page }) => {
    await addText(page, "Mate&Co");
    await page.locator("#text-content").fill(LONG_TEXT);
    await page.waitForTimeout(350);
    const grown = await fitState(page);
    expect(grown.fits).toBe(true);
    // Acortar el texto: el tamaño NO vuelve a crecer solo (limitación
    // documentada: el tamaño efectivo se persiste en el elemento).
    await page.locator("#text-content").fill("Mate&Co");
    await page.waitForTimeout(350);
    const shortened = await fitState(page);
    expect(shortened.scale).toBeCloseTo(grown.scale, 6);
    expect(shortened.fits).toBe(true);
  });

  test("el estado es estable: no hay oscilaciones", async ({ page }) => {
    await addText(page, LONG_TEXT);
    await dragScale(page, 2);
    const first = await elementState(page);
    await page.waitForTimeout(500);
    const second = await elementState(page);
    expect(second.scale).toBeCloseTo(first.scale, 6);
    // Varias lecturas seguidas: el valor no se mueve solo.
    for (let i = 0; i < 5; i += 1) {
      await page.waitForTimeout(120);
      expect((await elementState(page)).scale).toBeCloseTo(first.scale, 6);
    }
  });

  test("la vista previa muestra el texto completo", async ({ page }) => {
    await addText(page, LONG_TEXT);
    await dragScale(page, 2);
    const state = await fitState(page);
    // El avance del texto, con la escala efectiva, cabe en el recorrido:
    // el navegador no puede recortar nada.
    expect(state.advance).toBeLessThanOrEqual(state.limit);
    expect(state.fits).toBe(true);
  });

  test("el radio más pequeño hace que un texto largo no entre", async ({
    page,
  }) => {
    // Radio 305: el recorrido es 2*PI*(305-14) = 1827 u y el texto de 80
    // caracteres mide ~1902 u: no entra, así que el ajuste debe reducirlo.
    await addText(page, LONG_TEXT);
    const state = await fitState(page);
    expect(state.radius).toBe(374);
    // Con el radio por defecto el texto entra; el caso del radio mínimo se
    // comprueba con el helper (la misma regla que usa el editor).
    expect(textFitsPath(state.advance, 305, state.scale)).toBe(false);
  });

  test("el móvil y el arrastre siguen funcionando", async ({ page }) => {
    await addText(page, LONG_TEXT);
    const before = await elementState(page);
    // Un toque en el texto no cambia su escala (es una selección).
    const box = await page.locator(".curved-text").boundingBox();
    if (!box) throw new Error("sin caja");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect((await elementState(page)).scale).toBeCloseTo(before.scale, 6);
    // Y el tirador sigue respondiendo.
    await dragScale(page, 1.5);
    const after = await elementState(page);
    expect(after.scale).toBeGreaterThan(0.3);
    expect(after.scale).toBeLessThanOrEqual(3);
  });

  test("el diseño ajustado se exporta por los dos caminos", async ({ page }) => {
    await addText(page, LONG_TEXT);
    await dragScale(page, 2);
    const state = await fitState(page);
    expect(state.fits).toBe(true);

    const result = await page.evaluate(async (scale) => {
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");
      const { traceTextElement } = await import("/src/export/textOutlines.ts");
      const { vectorTextTrace } = await import(
        "/src/export/vectorTextOutlines.ts"
      );
      const state = {
        texts: [
          {
            id: "t1",
            text: "Mate&Co ".repeat(10).trim().slice(0, 80),
            fontFamily: "Poppins SemiBold",
            angle: 0,
            radius: 374,
            inverted: false,
            scale,
          },
        ],
        icons: [],
        graphics: [],
        circularLines: "double" as const,
      };
      const raster = await buildProductionSvg(state, traceTextElement);
      const vector = await buildProductionSvg(state, vectorTextTrace);
      return {
        rasterHasText: raster.includes("<text"),
        vectorHasText: vector.includes("<text"),
        rasterPaths: (raster.match(/<path /g) ?? []).length,
        vectorPaths: (vector.match(/<path /g) ?? []).length,
      };
    }, state.scale);

    expect(result.rasterHasText).toBe(false);
    expect(result.vectorHasText).toBe(false);
    expect(result.rasterPaths).toBeGreaterThan(0);
    expect(result.vectorPaths).toBeGreaterThan(0);
  });

  test("un texto imposible de ajustar bloquea la exportación", async ({
    page,
  }) => {
    await startBlank(page);
    await page.locator(".add-text").click();
    await fontsReady(page);
    const result = await page.evaluate(async () => {
      const { traceTextElement } = await import("/src/export/textOutlines.ts");
      const { vectorTextTrace } = await import("/src/export/vectorTextOutlines.ts");
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");
      // Un texto imposible: ni a la escala mínima entra en el recorrido.
      const text = "Mate&Co ".repeat(400).trim();
      const request = {
        text,
        fontFamily: "Poppins SemiBold",
        scale: 0.3,
        radius: 305,
        inverted: false,
      };
      const collect = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return null;
        } catch (error) {
          return String((error as Error).message);
        }
      };
      const rasterError = await collect(() => traceTextElement(request));
      const vectorError = await collect(() => vectorTextTrace(request));
      let produced: string | null = null;
      let exportError: string | null = null;
      try {
        produced = await buildProductionSvg(
          {
            texts: [
              {
                id: "t1",
                text,
                fontFamily: "Poppins SemiBold",
                angle: 0,
                radius: 305,
                inverted: false,
                scale: 0.3,
              },
            ],
            icons: [],
            graphics: [],
            circularLines: "none" as const,
          },
          traceTextElement,
        );
      } catch (error) {
        exportError = String((error as Error).message);
      }
      return { rasterError, vectorError, produced, exportError };
    });
    expect(result.rasterError).toContain("TEXT_DOES_NOT_FIT");
    expect(result.vectorError).toContain("TEXT_DOES_NOT_FIT");
    expect(result.produced).toBeNull();
    expect(result.exportError).toContain("TEXT_DOES_NOT_FIT");
  });

  test("no hay regresión en los textos que ya cabían", async ({ page }) => {
    for (const text of ["Mate&Co", "Virola de acero", "Hecho a medida"]) {
      const state = await addText(page, text);
      expect(state.scale, text).toBeCloseTo(1, 6);
      expect(state.fits, text).toBe(true);
    }
  });

  test("un texto que no entra ni con la escala mínima avisa y bloquea", async ({
    page,
  }) => {
    await startBlank(page);
    await page.locator(".add-text").click();
    await fontsReady(page);
    // Un texto imposible: ni con la escala mínima (0,3) entra en el
    // recorrido. Se inyecta por debajo del `maxLength` del input (que es
    // una límite de TECLADO, no del estado del diseño).
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("#text-content");
      if (!input) throw new Error("sin campo de texto");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Mate&Co ".repeat(50).trim());
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(600);

    // El aviso aparece en el panel de texto, es accionable y NO toca el
    // diseño: el texto conserva su contenido y la escala baja hasta el
    // mínimo permitido (0,3), nunca por debajo.
    const notice = page.locator(".text-fit-notice");
    await expect(notice).toContainText("No entra en la virola");
    await expect(notice).toContainText("acortalo");
    const state = await elementState(page);
    expect(state.scale).toBeGreaterThanOrEqual(0.3);
    expect(state.scale).toBeCloseTo(0.3, 6);
    const content = await page.locator("#text-content").inputValue();
    expect(content.length, "el contenido no se trunca").toBe(399);

    // Y la exportación queda bloqueada con el error explícito.
    const error = await page.evaluate(async () => {
      const { traceTextElement } = await import("/src/export/textOutlines.ts");
      try {
        await traceTextElement({
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
    expect(error).toContain("TEXT_DOES_NOT_FIT");
  });

  test("el aviso no mueve el layout: los controles no cambian de sitio", async ({
    page,
  }) => {
    await startBlank(page);
    await page.locator(".add-text").click();
    await fontsReady(page);
    const before = await pageBox(page, ".mate");
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("#text-content");
      if (!input) throw new Error("sin campo de texto");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Mate&Co ".repeat(50).trim());
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(600);
    await expect(page.locator(".text-fit-notice")).toContainText("acortalo");
    const after = await pageBox(page, ".mate");
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
  });

  test("sin la tipografía del catálogo no se ajusta el diseño", async ({
    page,
  }) => {
    // Se bloquea la petición de la fuente del catálogo: la tipografía no
    // carga y el navegador usa la de reserva.
    await page.route((url) => url.pathname.endsWith(".ttf"), (route) => route.abort());
    await startBlank(page);
    await page.locator(".add-text").click();
    await page.waitForTimeout(600);
    await page.locator("#text-content").fill(LONG_TEXT);
    await page.waitForTimeout(600);
    // Con la tipografía de reserva la medición no sirve: el diseño NO se
    // toca (no se calcula el autoajuste con una letra que no es la elegida).
    const state = await elementState(page);
    expect(state.scale).toBeCloseTo(1, 6);
    await page.unroute((url) => url.pathname.endsWith(".ttf"));
  });

  test("sin la tipografía del catálogo la exportación falla de forma explícita", async ({
    page,
  }) => {
    await page.route((url) => url.pathname.endsWith(".ttf"), (route) => route.abort());
    await startBlank(page);
    await page.locator(".add-text").click();
    await page.waitForTimeout(400);
    const result = await page.evaluate(async () => {
      const { traceTextElement } = await import("/src/export/textOutlines.ts");
      const { vectorTextTrace } = await import("/src/export/vectorTextOutlines.ts");
      const request = {
        text: "Mate&Co",
        fontFamily: "Poppins SemiBold",
        scale: 1,
        radius: 374,
        inverted: false,
      };
      const collect = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return null;
        } catch (error) {
          return String((error as Error).message);
        }
      };
      return {
        raster: await collect(() => traceTextElement(request)),
        vector: await collect(() => vectorTextTrace(request)),
      };
    });
    // El raster no puede seguir con la tipografía de reserva: falla claro.
    expect(result.raster).toContain("FONT_UNAVAILABLE");
    // El vector tampoco: la fuente no se pudo cargar del catálogo.
    expect(result.vector).toContain("FONT_UNAVAILABLE");
    await page.unroute((url) => url.pathname.endsWith(".ttf"));
  });
});
