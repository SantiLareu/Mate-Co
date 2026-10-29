/**
 * E4.4 — Integración del exportador vectorial del cliente (PREDETERMINADO en
 * esta rama experimental).
 *
 * QUÉ DEMUESTRA
 *   Que el camino vectorial (`src/export/clientTextExportMode.ts`
 *   + `src/export/vectorProductionExport.ts`) es el PREDETERMINADO del cliente
 *   en esta rama experimental, y que el raster sigue intacto como REVERSIÓN
 *   EXPLÍCITA:
 *     - el modo predeterminado es el VECTORIAL (HarfBuzz), en cualquier
 *       compilación;
 *     - el raster se activa SÓLO de forma explícita: en desarrollo con el
 *       parámetro de URL `?textExport=raster`, y al compilar con
 *       `VITE_TEXT_EXPORT_MODE=raster`;
 *     - el exportador por defecto (`buildProductionSvg`) conserva el trazador
 *       raster como su PROPIO predeterminado interno: produce EXACTAMENTE los
 *       mismos bytes;
 *     - el camino vectorial exporta la misma ESTRUCTURA (grupo de grabado,
 *       referencias de la virola, líneas decorativas, knockout) pero con
 *       contornos en lugar de texto;
 *     - el pre-flight del camino vectorial falla de forma ACCIONABLE (código +
 *       mensaje en español) y NO genera ningún SVG (exportación atómica);
 *     - la composición del pre-flight se REUTILIZA (no se compone dos veces);
 *     - el SVG vectorial es determinista byte a byte;
 *     - la interfaz del cliente no gana ningún control nuevo.
 *
 * CÓMO LO COMPRUEBA
 *   Con el mismo arnés que el resto de pruebas de exportación: `page.goto("/")`
 *   y `page.evaluate` con `import("/src/...")`, es decir, el código REAL del
 *   producto ejecutándose en el navegador (no una reimplementación).
 *
 * NOTA SOBRE EL ROLLO (E4.4)
 *   El modo ya NO es un opt-in experimental: el vectorial es el predeterminado
 *   en TODOS los builds (el parámetro de URL `?textExport=…` sólo existe en
 *   desarrollo, `import.meta.env.DEV`, pero el PREDETERMINADO es vector en
 *   cualquier compilación). El raster es la reversión explícita: nunca un
 *   *fallback* automático. La reversión de producción es de COMPILACIÓN
 *   (`VITE_TEXT_EXPORT_MODE=raster`); la de desarrollo, el parámetro de URL.
 */
import { expect, test } from "@playwright/test";
import { TYPOGRAPHY_FONTS } from "../src/typography";
import type { TextElement } from "../src/components/CurvedText";
import type { ProductionDesignState } from "../src/export/productionSvg";

/* ------------------------------------------------------------------ */
/* Estado de diseño                                                   */
/* ------------------------------------------------------------------ */

/** Un texto del cliente (el contrato de `ProductionDesignState.texts`). */
const textElement = (overrides: Partial<TextElement> = {}): TextElement => ({
  id: "t1",
  text: "Mate&Co",
  fontFamily: "Poppins SemiBold",
  angle: 0,
  radius: 374,
  inverted: false,
  scale: 1,
  ...overrides,
});

/** Un diseño con un texto y líneas decorativas dobles. */
const designWith = (
  texts: TextElement[],
  circularLines: ProductionDesignState["circularLines"] = "double",
): ProductionDesignState => ({
  texts,
  icons: [],
  graphics: [],
  circularLines,
});

/* ------------------------------------------------------------------ */
/* Lectura de un SVG exportado                                         */
/* ------------------------------------------------------------------ */

type SvgFacts = {
  /** El grupo de grabado (`id="engraving-design"`) está presente. */
  engraving: boolean;
  /** Círculos de referencia de la virola (`id="virola-reference"`). */
  virolaCircles: number;
  /** Los grupos de texto: giro, traslación, escala y nº de paths. */
  textGroups: { rotate: string; translate: string; scale: string; paths: number }[];
  /** El grupo de líneas decorativas: arcos (paths) y círculos enteros. */
  lines: { paths: number; circles: number } | null;
  /** ¿Hay algún elemento `<text` (texto vivo) en el SVG? */
  hasTextTag: boolean;
  /** ¿Hay algún `textPath` en el SVG? */
  hasTextPath: boolean;
};

/**
 * Lee la ESTRUCTURA de un SVG de producción ya generado.
 *
 * Se parsea el XML que devuelve el exportador (no el DOM de la app): lo que
 * se comprueba es el ARCHIVO que descarga el cliente.
 */
function parseSvgFacts(svg: string): SvgFacts {
  // El grupo de grabado va del `<g id="engraving-design">` hasta el cierre
  // final del SVG (el ancla del final evita cortar en un `</g>` anidado).
  const engraving = /<g id="engraving-design">([\s\S]*)\n {2}<\/g>\n<\/svg>/.exec(svg);
  const body = engraving ? engraving[1] : "";
  const virola = /<g id="virola-reference"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
  const virolaBody = virola ? virola[1] : "";
  const textGroups = [
    ...body.matchAll(
      /<g transform="rotate\(([^)]*)\)">\s*<g transform="translate\(([^)]*)\) scale\(([^)]*)\)"[^>]*>([\s\S]*?)<\/g>\s*<\/g>/g,
    ),
  ].map((match) => ({
    rotate: match[1],
    translate: match[2],
    scale: match[3],
    paths: (match[4].match(/<path /g) ?? []).length,
  }));
  const lines = /<g fill="none" stroke="#000000" stroke-width="2">([\s\S]*?)<\/g>/.exec(body);
  const linesBody = lines ? lines[1] : "";
  return {
    engraving: engraving !== null,
    virolaCircles: (virolaBody.match(/<circle/g) ?? []).length,
    textGroups,
    lines: lines
      ? {
          paths: (linesBody.match(/<path/g) ?? []).length,
          circles: (linesBody.match(/<circle/g) ?? []).length,
        }
      : null,
    hasTextTag: /<text[\s>]/.test(svg),
    hasTextPath: svg.includes("textPath"),
  };
}

/* ------------------------------------------------------------------ */
/* 1 — El modo predeterminado es el vectorial (raster = reversión)     */
/* ------------------------------------------------------------------ */

test.describe("exportador vectorial del cliente: modo predeterminado y reversión", () => {
  test("el modo predeterminado es el vectorial y el raster es la reversión explícita", async ({
    page,
  }) => {
    await page.goto("/");
    const normal = await page.evaluate(async () => {
      const mode = await import("/src/export/clientTextExportMode.ts");
      return {
        resolved: mode.resolveClientTextExportMode(),
        defaultMode: mode.DEFAULT_CLIENT_TEXT_EXPORT_MODE,
        override: mode.CLIENT_TEXT_EXPORT_MODE_OVERRIDE,
      };
    });
    // El predeterminado es el VECTORIAL: el cliente descarga el SVG con los
    // contornos reales de la fuente.
    expect(normal.resolved).toBe("vector");
    expect(normal.defaultMode).toBe("vector");
    // Sin override de compilación: el servidor de desarrollo no fija
    // `VITE_TEXT_EXPORT_MODE`.
    expect(normal.override).toBeNull();

    // El raster se activa SÓLO de forma explícita (en desarrollo, por
    // parámetro de URL): es la reversión, nunca un *fallback* automático.
    await page.goto("/?textExport=raster");
    const rollback = await page.evaluate(async () => {
      const mode = await import("/src/export/clientTextExportMode.ts");
      return mode.resolveClientTextExportMode();
    });
    expect(rollback).toBe("raster");

    // Y el vectorial también se puede pedir explícitamente.
    await page.goto("/?textExport=vector");
    const dev = await page.evaluate(async () => {
      const mode = await import("/src/export/clientTextExportMode.ts");
      return mode.resolveClientTextExportMode();
    });
    expect(dev).toBe("vector");
  });

  /* ---------------------------------------------------------------- */
  /* 2 — El camino raster sigue siendo el predeterminado interno      */
  /* ---------------------------------------------------------------- */

  test("el camino raster sigue siendo el predeterminado de buildProductionSvg (reversión)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");
      const { traceTextElement } = await import("/src/export/textOutlines.ts");
      // El predeterminado (sin segundo argumento) tiene que ser el MISMO
      // trazador raster de siempre: mismos bytes, no "parecidos".
      const implicit = await buildProductionSvg(state);
      const explicit = await buildProductionSvg(state, traceTextElement);
      return { implicit, explicit };
    }, designWith([textElement()]));

    expect(result.implicit.length).toBeGreaterThan(0);
    expect(result.explicit).toBe(result.implicit);
    // Y el SVG del predeterminado es el de siempre: texto como contornos.
    const facts = parseSvgFacts(result.implicit);
    expect(facts.engraving).toBe(true);
    expect(facts.virolaCircles).toBe(2);
    expect(facts.hasTextTag).toBe(false);
    expect(facts.hasTextPath).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* 3 — El camino vectorial exporta sin texto y con la misma estructura */
  /* ---------------------------------------------------------------- */

  test("el camino vectorial exporta sin texto y con la misma estructura", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { buildProductionSvg } = await import("/src/export/productionSvg.ts");
      const { buildVectorProductionSvg } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const rasterSvg = await buildProductionSvg(state);
      const vectorSvg = await buildVectorProductionSvg(state);
      return { rasterSvg, vectorSvg };
    }, designWith([textElement()]));

    const raster = parseSvgFacts(result.rasterSvg);
    const vector = parseSvgFacts(result.vectorSvg);

    // La ESTRUCTURA es la misma en los dos caminos.
    expect(raster.engraving, "grupo de grabado (raster)").toBe(true);
    expect(vector.engraving, "grupo de grabado (vector)").toBe(true);
    expect(raster.virolaCircles, "referencias de la virola (raster)").toBe(2);
    expect(vector.virolaCircles, "referencias de la virola (vector)").toBe(2);
    expect(raster.textGroups.length, "grupos de texto (raster)").toBe(1);
    expect(vector.textGroups.length, "grupos de texto (vector)").toBe(1);

    // El SVG VECTORIAL no lleva texto vivo: sólo contornos.
    expect(vector.hasTextTag, "<text> en el SVG vectorial").toBe(false);
    expect(vector.hasTextPath, "textPath en el SVG vectorial").toBe(false);
    // El RASTER tampoco: su texto ya son paths.
    expect(raster.hasTextTag, "<text> en el SVG raster").toBe(false);
    expect(raster.hasTextPath, "textPath en el SVG raster").toBe(false);

    // El grupo de texto del vectorial tiene al menos un path de contorno.
    expect(vector.textGroups[0].paths, "paths del texto vectorial").toBeGreaterThanOrEqual(1);
    // Y el raster también traza el texto como paths.
    expect(raster.textGroups[0].paths, "paths del texto raster").toBeGreaterThanOrEqual(1);
  });

  /* ---------------------------------------------------------------- */
  /* 4 — Determinismo del SVG vectorial                               */
  /* ---------------------------------------------------------------- */

  test("el SVG vectorial es determinista", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { buildVectorProductionSvg } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const first = await buildVectorProductionSvg(state);
      const second = await buildVectorProductionSvg(state);
      return { first, second };
    }, designWith([textElement()]));

    expect(result.first.length).toBeGreaterThan(0);
    // Byte a byte: el mismo texto produce EXACTAMENTE el mismo archivo.
    expect(result.second).toBe(result.first);
  });

  /* ---------------------------------------------------------------- */
  /* 5 — El pre-flight falla de forma accionable y no genera SVG      */
  /* ---------------------------------------------------------------- */

  test("el pre-flight falla de forma accionable y no genera SVG", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { planVectorExport, buildVectorProductionSvg } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const plan = await planVectorExport(state.texts);
      let rejection: string | null = null;
      let produced: string | null = null;
      try {
        produced = await buildVectorProductionSvg(state);
      } catch (error) {
        rejection = (error as Error).message;
      }
      return {
        plan: plan.ok
          ? { ok: true }
          : { ok: false, code: plan.code, message: plan.message },
        rejection,
        produced,
      };
    }, designWith([textElement({ text: "☃" })], "none"));

    // El pre-flight falla CERRADO, con un código explícito.
    expect(result.plan.ok).toBe(false);
    if (result.plan.ok) throw new Error("El pre-flight no debería haber sido correcto.");
    expect(result.plan.code).toBe("GLYPH_MISSING");
    // El mensaje es accionable y está en español.
    expect(result.plan.message.length).toBeGreaterThan(0);
    expect(result.plan.message).toContain("No se puede exportar el texto");
    expect(result.plan.message).toContain("☃");

    // Y NO se genera ningún SVG: la exportación es atómica.
    expect(result.produced).toBeNull();
    expect(result.rejection).not.toBeNull();
    expect(result.rejection).toContain("GLYPH_MISSING");
  });

  /* ---------------------------------------------------------------- */
  /* 6 — El pre-flight valida el catálogo                              */
  /* ---------------------------------------------------------------- */

  test("el pre-flight valida el catálogo", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { planVectorExport, buildVectorProductionSvg } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const plan = await planVectorExport(state.texts);
      let rejection: string | null = null;
      let produced: string | null = null;
      try {
        produced = await buildVectorProductionSvg(state);
      } catch (error) {
        rejection = (error as Error).message;
      }
      return {
        plan: plan.ok
          ? { ok: true }
          : { ok: false, code: plan.code, message: plan.message },
        rejection,
        produced,
      };
    }, designWith([textElement({ fontFamily: "Georgia" })], "none"));

    // Una tipografía fuera del catálogo NO se sustituye: falla el pre-flight.
    expect(result.plan.ok).toBe(false);
    if (result.plan.ok) throw new Error("El pre-flight no debería haber sido correcto.");
    expect(result.plan.code).toBe("FONT_NOT_IN_CATALOGUE");
    expect(result.plan.message.length).toBeGreaterThan(0);
    expect(result.plan.message).toContain("Georgia");

    expect(result.produced).toBeNull();
    expect(result.rejection).not.toBeNull();
    expect(result.rejection).toContain("FONT_NOT_IN_CATALOGUE");
  });

  /* ---------------------------------------------------------------- */
  /* 7 — El pre-flight acepta el texto normalizable                   */
  /* ---------------------------------------------------------------- */

  test("el pre-flight acepta el texto normalizable", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (texts) => {
      const { planVectorExport } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const plan = await planVectorExport(texts);
      return plan.ok
        ? { ok: true, checked: plan.checked }
        : { ok: false, code: plan.code, message: plan.message };
    }, [textElement({ text: "a\u0301" })]);

    // "a" + U+0301 se normaliza a NFC: el pre-flight lo ACEPTA.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("El pre-flight falló: " + result.message);
    expect(result.checked).toBeGreaterThanOrEqual(1);
  });

  /* ---------------------------------------------------------------- */
  /* 8 — El pre-flight reutiliza la composición                        */
  /* ---------------------------------------------------------------- */

  test("el pre-flight reutiliza la composición (no convierte dos veces)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { planVectorExport } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const adapter = await import("/src/export/vectorTextOutlines.ts");

      const request = {
        text: "Mate&Co",
        fontFamily: "Poppins SemiBold",
        scale: 1,
        radius: 374,
        inverted: false,
      };
      const element = (id: string) => ({
        id,
        text: request.text,
        fontFamily: request.fontFamily,
        angle: 0,
        radius: request.radius,
        inverted: request.inverted,
        scale: request.scale,
      });

      const plan = await planVectorExport([element("t1")]);
      if (!plan.ok) return { error: plan.code, message: plan.message };

      // El trazador del plan y el trazador suelto deben producir EXACTAMENTE
      // la misma traza: la composición del pre-flight es la que se usa.
      const fromPlan = await plan.traceText(request);
      const direct = await adapter.vectorTextTrace(request);

      // Dos textos idénticos: la clave de composición no los distingue.
      const duplicated = await planVectorExport([element("t1"), element("t2")]);

      return {
        fromPlan: JSON.stringify(fromPlan),
        direct: JSON.stringify(direct),
        checked: plan.checked,
        checkedDuplicated: duplicated.ok ? duplicated.checked : -1,
      };
    });

    expect(result.error).toBeUndefined();
    expect(result.fromPlan).not.toBeNull();
    // Mismos paths, mismo inkBox, mismo arcLength.
    expect(result.fromPlan).toBe(result.direct);
    expect(result.checked).toBe(1);
    expect(result.checkedDuplicated).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /* 9 — Texto invertido, rotado y las tres tipografías                */
  /* ---------------------------------------------------------------- */

  test("el camino vectorial respeta el texto invertido, rotado y las tres tipografías", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    const cases = [
      { label: "normal", angle: 0, inverted: false },
      { label: "invertido", angle: 0, inverted: true },
      { label: "rotado", angle: 30, inverted: false },
    ];
    const families = [
      TYPOGRAPHY_FONTS.poppins.family,
      TYPOGRAPHY_FONTS.lato.family,
      TYPOGRAPHY_FONTS["dancing-script"].family,
    ];

    for (const family of families) {
      for (const scenario of cases) {
        const svg = await page.evaluate(
          async (state) => {
            const { buildVectorProductionSvg } = await import(
              "/src/export/vectorProductionExport.ts"
            );
            return await buildVectorProductionSvg(state);
          },
          designWith([
            textElement({
              fontFamily: family,
              angle: scenario.angle,
              inverted: scenario.inverted,
            }),
          ]),
        );
        const facts = parseSvgFacts(svg);
        const label = `${family} (${scenario.label})`;
        expect(facts.engraving, label).toBe(true);
        expect(facts.textGroups.length, label).toBe(1);
        const group = facts.textGroups[0];
        // El giro del elemento se aplica en el espacio del cliente.
        expect(group.rotate, `giro (${label})`).toBe(`${scenario.angle} 450 450`);
        // Los contornos viven en el centro del espacio de diseño.
        expect(group.translate, `traslación (${label})`).toBe("450 450");
        expect(group.paths, `paths del texto (${label})`).toBeGreaterThan(0);
        expect(facts.hasTextTag, `<text> (${label})`).toBe(false);
        expect(facts.hasTextPath, `textPath (${label})`).toBe(false);
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /* 10 — El knockout y las líneas decorativas se conservan            */
  /* ---------------------------------------------------------------- */

  test("el knockout y las líneas decorativas se conservan", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const result = await page.evaluate(async (state) => {
      const { buildVectorProductionSvg } = await import(
        "/src/export/vectorProductionExport.ts"
      );
      const withText = await buildVectorProductionSvg(state);
      const withoutText = await buildVectorProductionSvg({
        texts: [],
        icons: [],
        graphics: [],
        circularLines: state.circularLines,
      });
      return { withText, withoutText };
    }, designWith([textElement()], "double"));

    const withText = parseSvgFacts(result.withText);
    const withoutText = parseSvgFacts(result.withoutText);

    // Las líneas decorativas siguen ahí en los dos casos.
    expect(withText.lines, "grupo de líneas con texto").not.toBeNull();
    expect(withoutText.lines, "grupo de líneas sin texto").not.toBeNull();
    expect(withoutText.lines!.circles, "círculos enteros sin texto").toBe(2);
    expect(withoutText.lines!.paths, "arcos sin texto").toBe(0);

    // El KNOCKOUT del texto interrumpe la línea que CRUZA la banda de
    // protección. El modo "double" dibuja dos radios (347 y 367) y la banda
    // del texto está en el radio 374 con medio-ancho 23,5 u: la línea de 367
    // cae DENTRO de la banda (|367-374| = 7 ≤ 23,5) y la de 347 queda
    // fuera (|347-374| = 27 > 23,5). Con texto, la de 367 pasa a ser arcos
    // abiertos; la de 347 sigue siendo el círculo entero de siempre.
    expect(withText.lines!.circles, "línea de 347 sin knockout").toBe(1);
    expect(withText.lines!.paths, "arcos de la línea de 367").toBeGreaterThanOrEqual(2);
    expect(result.withText, "arco interrumpido de la línea de 367").toContain(
      "A367 367",
    );
    expect(result.withText, "círculo entero de la línea de 347").toContain(
      '<circle cx="450" cy="450" r="347"',
    );
  });

  /* ---------------------------------------------------------------- */
  /* 11 — Sin regresión: la confirmación sigue funcionando             */
  /* ---------------------------------------------------------------- */

  test("sin regresión: la confirmación sigue funcionando", async ({ page }) => {
    await page.goto("/");
    await page.locator(".add-text").click();
    await expect(page.locator("[data-text-id]")).toBeVisible();

    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
    await expect(page.locator(".confirm-summary")).toContainText("Textos: 1");

    // El botón de exportar sigue siendo el de siempre y sigue habilitado.
    const exportButton = page.locator(".export-svg");
    await expect(exportButton).toBeVisible();
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toHaveText("Exportar SVG de producción");

    // El panel NO gana ningún control técnico nuevo (E3.1 / S9): el panel
    // de confirmación no tiene selects, radios ni checkboxes.
    const controls = await page.locator(".confirm-panel").evaluate((panel) => ({
      selects: panel.querySelectorAll("select").length,
      radios: panel.querySelectorAll('input[type="radio"]').length,
      checkboxes: panel.querySelectorAll('input[type="checkbox"]').length,
    }));
    expect(controls.selects, "select en el panel de confirmación").toBe(0);
    expect(controls.radios, "radio en el panel de confirmación").toBe(0);
    expect(controls.checkboxes, "checkbox en el panel de confirmación").toBe(0);
  });
});
