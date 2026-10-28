/**
 * E3.0 — Política de errores: ningún texto se omite en silencio.
 *
 * QUÉ DEMUESTRA
 *   1. El trazador raster devuelve `null` SÓLO cuando no hay nada que
 *      dibujar (texto vacío o sólo espacios). Cualquier otro fallo lanza un
 *      error con código: antes, un `null` por fallo hacía que el exportador
 *      (`productionSvg.ts:142`, `if (!trace) continue;`) **omitiera el texto
 *      del SVG del cliente sin avisar**.
 *   2. Un trazador que lanza impide que se genere el SVG: la exportación es
 *      atómica (no hay archivo incompleto).
 *   3. El adaptador valida el catálogo: una familia desconocida falla con
 *      `FONT_NOT_IN_CATALOGUE` en lugar de sustituirse por una del sistema.
 *   4. La normalización NFC ocurre SÓLO en la entrada y el fallo sigue
 *      siendo explícito cuando el texto no se puede componer.
 */
import { expect, test } from "@playwright/test";

const CATALOGUE_FAMILY = "Poppins SemiBold";

/** Textos con contenido: ninguno puede devolver `null`. */
const TEXTS_WITH_CONTENT = [
  "¡Fiesta! Mate&Co",
  "Mate&Co ".repeat(15).trim(),
  "a\u0301",
  "\u200B",
  "á é í ó ú ñ ¿ ¡",
];

test.describe("política de errores del trazado de texto", () => {
  test("el trazador raster nunca devuelve null para un texto con contenido", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    const results = await page.evaluate(async (texts) => {
      const raster = await import("/src/export/textOutlines.ts");
      const out: { text: string; kind: string; message?: string }[] = [];
      for (const text of texts) {
        try {
          const trace = await raster.traceTextElement({
            text,
            fontFamily: "Poppins SemiBold",
            scale: 1,
            radius: 374,
            inverted: false,
          });
          out.push({ text, kind: trace === null ? "null" : "trazo" });
        } catch (error) {
          out.push({ text, kind: "error", message: String((error as Error).message) });
        }
      }
      // Y los casos legítimamente vacíos.
      for (const text of ["", "   ", "\n\t "]) {
        const trace = await raster.traceTextElement({
          text,
          fontFamily: "Poppins SemiBold",
          scale: 1,
          radius: 374,
          inverted: false,
        });
        out.push({ text, kind: trace === null ? "null" : "trazo" });
      }
      return out;
    }, TEXTS_WITH_CONTENT);

    for (const result of results) {
      const empty = result.text.trim().length === 0;
      if (empty) {
        // Sin contenido dibujable legítimo: `null` (nada que trazar).
        expect(result.kind, `"${result.text}"`).toBe("null");
      } else {
        // Con contenido: un trazo o un error explícito. NUNCA `null`.
        expect(result.kind, `"${result.text}"`).not.toBe("null");
        if (result.kind === "error") {
          expect(result.message ?? "", `"${result.text}"`).toMatch(
            /^[A-Z_]+:/,
          );
        }
      }
    }
  });

  test("sin omisión silenciosa: un fallo impide el SVG", async ({ page }) => {
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
        icons: [],
        graphics: [],
        circularLines: "none" as const,
      };
      // Un trazador que falla: la exportación debe RECHAZAR (y no existir SVG).
      let failed = false;
      let message = "";
      try {
        await buildProductionSvg(state, async () => {
          throw new Error("GLYPH_MISSING: glifo de prueba ausente.");
        });
      } catch (error) {
        failed = true;
        message = String((error as Error).message);
      }
      // Con un trazador sano, el SVG existe y lleva el texto.
      const healthy = await buildProductionSvg(state, async () => ({
        paths: [{ d: "M0 0H5V5H0Z" }],
        cropX: 100,
        cropY: 100,
        pixelScale: 3,
        inkBox: { x: 110, y: 110, width: 20, height: 10 },
        arcLength: 40,
      }));
      return {
        failed,
        message,
        healthyHasText: healthy.includes("M0 0H5V5H0Z"),
        healthyHasGlyph: healthy.includes("<text"),
      };
    });
    expect(result.failed, "un trazador que lanza impide el SVG").toBe(true);
    expect(result.message).toContain("GLYPH_MISSING");
    expect(result.healthyHasText).toBe(true);
    expect(result.healthyHasGlyph, "el SVG exportado no lleva <text>").toBe(false);
  });

  test("el catálogo se valida: una familia desconocida no se sustituye", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      try {
        const trace = await adapter.vectorTextTrace({
          text: "Mate&Co",
          fontFamily: "Georgia",
          scale: 1,
          radius: 374,
          inverted: false,
        });
        return { failed: false, paths: trace ? trace.paths.length : 0 };
      } catch (error) {
        return { failed: true, message: String((error as Error).message) };
      }
    });
    expect(result.failed, "una familia fuera del catálogo falla").toBe(true);
    expect(result.message).toContain("FONT_NOT_IN_CATALOGUE");
    // Sin sustitución: no se devuelve ninguna geometría trazada.
    expect(result.paths ?? 0).toBe(0);
  });

  test("NFC: la entrada se normaliza y el fallo sigue siendo explícito", async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      const request = {
        fontFamily: "Poppins SemiBold",
        scale: 1,
        radius: 374,
        inverted: false,
      };
      // Descompuesta y precompuesta: el resultado es IDÉNTICO porque la
      // entrada se normaliza (y el navegador pinta ambas igual: medido 0 u).
      const decomposed = await adapter.vectorTextTrace({
        ...request,
        text: "a\u0301",
      });
      const precomposed = await adapter.vectorTextTrace({
        ...request,
        text: "á",
      });
      let missing: string | null = null;
      try {
        await adapter.vectorTextTrace({ ...request, text: "☃" });
      } catch (error) {
        missing = String((error as Error).message);
      }
      return {
        decomposed: JSON.stringify(decomposed),
        precomposed: JSON.stringify(precomposed),
        missing,
      };
    });
    expect(result.decomposed).toBe(result.precomposed);
    expect(result.decomposed).not.toContain("null");
    // Un glifo ausente sigue siendo un error explícito (no una sustitución).
    expect(result.missing).toContain("GLYPH_MISSING");
  });

  test("los errores llevan un código accionable", async ({ page }) => {
    await page.goto("/");
    // Nota: el adaptador tiene además una guarda `INVALID_RADIUS`, pero es
    // defensiva e inalcanzable: `clampTextRadius` recorta el radio a
    // [305, 410] y `clampTextScale` a [0,3, 3], así que el radio base
    // (`radio - 14 * escala`) siempre es positivo.
    const messages = await page.evaluate(async () => {
      const adapter = await import("/src/export/vectorTextOutlines.ts");
      const base = {
        text: "Mate&Co",
        fontFamily: "Poppins SemiBold",
        scale: 1,
        radius: 374,
        inverted: false,
      };
      const collect = async (request: Parameters<typeof adapter.vectorTextTrace>[0]) => {
        try {
          await adapter.vectorTextTrace(request);
          return null;
        } catch (error) {
          return String((error as Error).message);
        }
      };
      return {
        notInCatalogue: await collect({ ...base, fontFamily: "Georgia" }),
        missingGlyph: await collect({ ...base, text: "☃" }),
      };
    });
    expect(messages.notInCatalogue).toContain("FONT_NOT_IN_CATALOGUE");
    expect(messages.missingGlyph).toContain("GLYPH_MISSING");
    // El mensaje es legible para el cliente (español, con el código primero).
    for (const message of Object.values(messages)) {
      expect(message ?? "").toMatch(/^[A-Z_]+: .+/);
    }
  });
});
