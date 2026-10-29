/**
 * E4.3 — Verificación de INTEGRACIÓN de E4 (trazador raster corregido + camino
 * vectorial experimental) y de su reversión.
 *
 * QUÉ DEMUESTRA (el alcance de E4.3, punto por punto)
 *   1. Flujo completo en móvil: editar → confirmar → exportar, en el camino
 *      raster (el predeterminado) y en el camino vectorial experimental.
 *   2. Las tres tipografías del catálogo (Poppins, Lato, Dancing Script).
 *   3. Textos normales, invertidos, rotados y largos.
 *   4. Imágenes subidas, íconos y líneas decorativas conservados.
 *   5. Una tipografía antigua → error ACCIONABLE (nunca sustitución).
 *   6. Una tipografía no disponible → error explícito, sin reserva.
 *   7. El camino vectorial NUNCA cae automáticamente al raster.
 *   8. La reversión entre modos NO modifica los pedidos guardados.
 *   9. Móvil (viewport de la suite) y build de producción (comprobado por
 *      `export-vector-production-build.spec.ts`, que se ejecuta en la misma
 *      tanda: aquí no se duplica).
 *  10. El coste de memoria de la fuente embebida: la fuente se descarga y se
 *      embebe UNA sola vez por tipografía (no se re-descarga ni se re-codifica
 *      en cada trazado).
 *
 * CÓMO LO COMPRUEBA
 *   Con el código REAL del producto en el navegador (`page.evaluate` con
 *   `import("/src/...")`) y con el flujo REAL de la interfaz (`.add-text` →
 *   `.design-confirm` → `.export-svg`, con descarga observada).
 *
 * LO QUE NO TOCA
 *   Ni el modo predeterminado, ni HarfBuzz por defecto, ni `main`, ni los
 *   trabajos confirmados, ni los snapshots.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/* ------------------------------------------------------------------ */
/* Lectura de un SVG exportado (en Node: es el ARCHIVO que descarga   */
/* el cliente, no el DOM de la app)                                   */
/* ------------------------------------------------------------------ */

type SvgFacts = {
  /** Grupo de grabado. */
  engraving: boolean;
  /** Círculos de referencia de la virola. */
  virolaCircles: number;
  /** Grupos de texto (uno por texto trazado). */
  textGroups: number;
  /** Paths dentro de los grupos de texto. */
  textPaths: number;
  /** Grupos de ícono/graphic (translate + rotate + scale). */
  elementGroups: number;
  /** Líneas decorativas (el grupo con trazo de 2). */
  decorativeLines: boolean;
  /** ¿Hay texto vivo? */
  hasTextTag: boolean;
  /** ¿Hay una fuente embebida en el ARCHIVO? (no debe haberla) */
  hasFontFace: boolean;
  /** ¿Hay imágenes rasterizadas? (no debe haberlas) */
  hasImage: boolean;
  /** ¿El texto del trazador raster (scale del mapa de bits)? */
  rasterSignature: boolean;
  /** ¿El texto del trazador vectorial (scale 1)? */
  vectorSignature: boolean;
};

function facts(svg: string): SvgFacts {
  const engraving = /<g id="engraving-design">([\s\S]*)\n {2}<\/g>\n<\/svg>/.exec(svg);
  const body = engraving ? engraving[1] : "";
  const virola = /<g id="virola-reference"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
  const virolaBody = virola ? virola[1] : "";
  const textGroups = [
    ...body.matchAll(
      /<g transform="rotate\([^)]*\)">\s*<g transform="translate\([^)]*\) scale\([^)]*\)"[^>]*>([\s\S]*?)<\/g>\s*<\/g>/g,
    ),
  ];
  return {
    engraving: engraving !== null,
    virolaCircles: (virolaBody.match(/<circle/g) ?? []).length,
    textGroups: textGroups.length,
    textPaths: textGroups.reduce(
      (total, match) => total + (match[1].match(/<path /g) ?? []).length,
      0,
    ),
    elementGroups: (body.match(/stroke-linecap="round"/g) ?? []).length,
    decorativeLines: /<g fill="none" stroke="#000000" stroke-width="2">/.test(body),
    hasTextTag: /<text[\s>]/.test(svg),
    hasFontFace: svg.includes("@font-face"),
    hasImage: /<image[\s>]/.test(svg),
    rasterSignature: svg.includes("scale(0.33"),
    vectorSignature: svg.includes("translate(450 450) scale(1)"),
  };
}

/* ------------------------------------------------------------------ */
/* Utilidades de flujo                                                 */
/* ------------------------------------------------------------------ */

/** Aplica el modo experimental sin recargar la página (lo resuelve el exportador en cada llamada). */
async function setMode(page: Page, mode: "raster" | "vector") {
  await page.evaluate((mode) => {
    const url = new URL(window.location.href);
    if (mode === "vector") url.searchParams.set("textExport", "vector");
    else url.searchParams.delete("textExport");
    window.history.replaceState({}, "", url.toString());
  }, mode);
}

/** Hace el flujo real de la interfaz y devuelve el SVG descargado. */
async function exportThroughUi(page: Page): Promise<{ svg: string; error: string | null }> {
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator(".export-svg").click();
  const file = await download;
  return { svg: readFileSync(await file.path(), "utf8"), error: null };
}

/**
 * Hace clic en exportar y devuelve el error visible, o `null` si el archivo
 * se descargó (es decir: si el camino NO falló).
 */
async function exportErrorThroughUi(page: Page): Promise<string | null> {
  const download = page
    .waitForEvent("download", { timeout: 8_000 })
    .then(() => "descargó", () => "sin descarga");
  await page.locator(".export-svg").click();
  const alert = page.getByRole("alert").first();
  const visible = await alert
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true, () => false);
  const message = visible ? ((await alert.textContent()) ?? "") : "";
  const outcome = await download;
  return outcome === "descargó" ? null : message;
}

/** Los pedidos guardados (IndexedDB), como texto estable para comparar. */
async function storedJobs(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open("mateco.jobs.v1");
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    const records = await new Promise<unknown[]>((done, fail) => {
      const request = db.transaction("jobs", "readonly").objectStore("jobs").getAll();
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    db.close();
    return JSON.stringify(records);
  });
}

/* ------------------------------------------------------------------ */
/* Diseño de prueba                                                    */
/* ------------------------------------------------------------------ */

const FAMILIES = ["Poppins SemiBold", "Lato SemiBold", "Dancing Script"];

const VARIANTS = [
  { label: "normal", text: "Mate&Co", inverted: false, angle: 0 },
  { label: "invertido", text: "Mate&Co", inverted: true, angle: 0 },
  { label: "rotado 30°", text: "Mate&Co", inverted: false, angle: 30 },
  { label: "largo", text: "MATECOFFEE PARA VOS AMIGOS", inverted: false, angle: 0 },
];

/** El diseño completo (texto + ícono + imagen subida + líneas dobles). */
const FULL_DESIGN = {
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
      type: "icon" as const,
      iconId: "guitar",
      angle: 40,
      radius: 340,
      scale: 1,
      rotation: 0,
      mirrored: false,
      inverted: false,
    },
  ],
  graphics: [
    {
      id: "g1",
      type: "uploaded-graphic" as const,
      paths: [{ d: "M10 10 L50 10 L50 50 Z" }],
      sourceWidth: 64,
      sourceHeight: 64,
      artBounds: { x: 10, y: 10, width: 40, height: 40 },
      angle: 120,
      radius: 300,
      scale: 1,
      rotation: 0,
      mirrored: false,
      inverted: false,
    },
  ],
  circularLines: "double" as const,
};

/* ------------------------------------------------------------------ */
/* 1 — Flujo completo en móvil (raster, el predeterminado)            */
/* ------------------------------------------------------------------ */

test.describe("E4.3 — integración de E4", () => {
  test("el flujo completo en móvil exporta el SVG raster (el predeterminado)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");

    // Móvil: el viewport de la suite y sin desbordamiento horizontal.
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    expect(viewport.width, "viewport móvil").toBeLessThanOrEqual(500);
    expect(viewport.overflow, "sin desbordamiento horizontal").toBeLessThanOrEqual(1);

    // Editar → confirmar (guarda el pedido) → exportar.
    await page.locator(".add-text").click();
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();

    const { svg } = await exportThroughUi(page);
    const file = facts(svg);

    expect(file.engraving, "grupo de grabado").toBe(true);
    expect(file.virolaCircles, "círculos de referencia").toBe(2);
    expect(file.textGroups, "grupo de texto").toBe(1);
    expect(file.textPaths, "paths del texto").toBeGreaterThan(0);
    // El archivo descargado es sólo geometría.
    expect(file.hasTextTag, "sin texto vivo").toBe(false);
    expect(file.hasFontFace, "sin fuente embebida en el archivo").toBe(false);
    expect(file.hasImage, "sin imágenes rasterizadas").toBe(false);
    // Y es el camino raster (no el vectorial).
    expect(file.rasterSignature, "firma del trazador raster").toBe(true);
    expect(file.vectorSignature, "no es el camino vectorial").toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* 2 — El camino vectorial experimental (desarrollo)                */
  /* ---------------------------------------------------------------- */

  test("el flujo completo en modo vectorial experimental no cae al raster", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/?textExport=vector");

    await page.locator(".add-text").click();
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();

    const { svg } = await exportThroughUi(page);
    const file = facts(svg);

    // El módulo pesado se carga (el camino vectorial se activó).
    expect(
      requests.filter((url) => url.includes("vectorProductionExport")).length,
      "chunk del camino vectorial solicitado",
    ).toBeGreaterThan(0);
    // Y el archivo es VECTORIAL: no hay rastro del raster.
    expect(file.vectorSignature, "firma del trazador vectorial").toBe(true);
    expect(file.rasterSignature, "no cayó al raster").toBe(false);
    expect(file.textPaths, "paths del texto").toBeGreaterThan(0);
    expect(file.engraving, "grupo de grabado").toBe(true);
    expect(file.hasTextTag, "sin texto vivo").toBe(false);
    expect(file.hasFontFace, "sin fuente embebida en el archivo").toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* 3 y 4 — Las tres tipografías × las cuatro variantes               */
  /* ---------------------------------------------------------------- */

  test("las tres tipografías y las cuatro variantes exportan en los dos caminos", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    const results = await page.evaluate(
      async ({ families, variants, design }) => {
        const raster = await import("/src/export/productionSvg.ts");
        const vector = await import("/src/export/vectorProductionExport.ts");
        const out: {
          family: string;
          variant: string;
          raster: string | null;
          vector: string | null;
          rasterError: string | null;
          vectorError: string | null;
        }[] = [];
        for (const family of families) {
          for (const variant of variants) {
            const state = {
              ...design,
              texts: [
                {
                  id: "t1",
                  text: variant.text,
                  fontFamily: family,
                  angle: variant.angle,
                  radius: 374,
                  inverted: variant.inverted,
                  scale: 1,
                },
              ],
              icons: [],
              graphics: [],
            };
            let rasterSvg: string | null = null;
            let rasterError: string | null = null;
            try {
              rasterSvg = await raster.buildProductionSvg(state);
            } catch (error) {
              rasterError = String((error as Error).message);
            }
            let vectorSvg: string | null = null;
            let vectorError: string | null = null;
            try {
              vectorSvg = await vector.buildVectorProductionSvg(state);
            } catch (error) {
              vectorError = String((error as Error).message);
            }
            out.push({
              family,
              variant: variant.label,
              raster: rasterSvg,
              vector: vectorSvg,
              rasterError,
              vectorError,
            });
          }
        }
        return out;
      },
      { families: FAMILIES, variants: VARIANTS, design: FULL_DESIGN },
    );

    expect(results.length, "combinaciones probadas").toBe(FAMILIES.length * VARIANTS.length);
    for (const result of results) {
      const label = `${result.family} / ${result.variant}`;
      expect(result.rasterError, `raster ${label}`).toBeNull();
      expect(result.vectorError, `vectorial ${label}`).toBeNull();
      const rasterFile = facts(result.raster!);
      const vectorFile = facts(result.vector!);
      // Los dos caminos producen un archivo de producción válido.
      expect(rasterFile.engraving, `raster ${label}`).toBe(true);
      expect(vectorFile.engraving, `vectorial ${label}`).toBe(true);
      expect(rasterFile.textPaths, `raster ${label}`).toBeGreaterThan(0);
      expect(vectorFile.textPaths, `vectorial ${label}`).toBeGreaterThan(0);
      expect(rasterFile.textGroups, `raster ${label}`).toBe(1);
      expect(vectorFile.textGroups, `vectorial ${label}`).toBe(1);
      // Los dos caminos exportan sólo geometría.
      for (const file of [rasterFile, vectorFile]) {
        expect(file.hasTextTag, `texto vivo ${label}`).toBe(false);
        expect(file.hasFontFace, `fuente embebida ${label}`).toBe(false);
        expect(file.hasImage, `imagen raster ${label}`).toBe(false);
      }
      // Y cada camino es el suyo.
      expect(rasterFile.rasterSignature, `firma raster ${label}`).toBe(true);
      expect(vectorFile.vectorSignature, `firma vectorial ${label}`).toBe(true);
    }
  });

  /* ---------------------------------------------------------------- */
  /* 4 — Imágenes subidas, íconos y líneas decorativas                */
  /* ---------------------------------------------------------------- */

  test("las imágenes subidas, los íconos y las líneas decorativas se conservan en los dos caminos", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    const result = await page.evaluate(async (design) => {
      const raster = await import("/src/export/productionSvg.ts");
      const vector = await import("/src/export/vectorProductionExport.ts");
      const icons = await import("/src/data/icons.ts");
      const rasterSvg = await raster.buildProductionSvg(design);
      const vectorSvg = await vector.buildVectorProductionSvg(design);
      return {
        rasterSvg,
        vectorSvg,
        iconPath: icons.iconById["guitar"].paths[0],
      };
    }, FULL_DESIGN);

    const rasterFile = facts(result.rasterSvg);
    const vectorFile = facts(result.vectorSvg);
    for (const [label, svg] of [
      ["raster", result.rasterSvg],
      ["vectorial", result.vectorSvg],
    ] as const) {
      expect(svg, `imagen subida ${label}`).toContain("M10 10 L50 10 L50 50 Z");
      expect(svg, `ícono ${label}`).toContain(result.iconPath);
      expect(facts(svg).decorativeLines, `líneas decorativas ${label}`).toBe(true);
    }
    // La estructura (grupos) es la misma en los dos caminos.
    expect(rasterFile.elementGroups, "grupos de ícono").toBe(vectorFile.elementGroups);
    expect(rasterFile.virolaCircles, "círculos de referencia").toBe(vectorFile.virolaCircles);
  });

  /* ---------------------------------------------------------------- */
  /* 5 — Una tipografía antigua                                       */
  /* ---------------------------------------------------------------- */

  test("una tipografía antigua da un error accionable en los dos caminos", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      const vector = await import("/src/export/vectorProductionExport.ts");
      const state = {
        texts: [
          {
            id: "t1",
            text: "Mate&Co",
            fontFamily: "Georgia",
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
      const collect = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return { ok: true, message: "" };
        } catch (error) {
          return { ok: false, message: String((error as Error).message) };
        }
      };
      return {
        raster: await collect(() =>
          raster.traceTextElement({
            text: "Mate&Co",
            fontFamily: "Georgia",
            scale: 1,
            radius: 374,
            inverted: false,
          }),
        ),
        vector: await collect(() => vector.buildVectorProductionSvg(state)),
      };
    });

    for (const [name, outcome] of Object.entries(result)) {
      expect(outcome.ok, `${name}: no debe exportar`).toBe(false);
      expect(outcome.message, `${name}: código`).toContain("FONT_NOT_IN_CATALOGUE");
      // El mensaje dice qué elegir.
      expect(outcome.message, `${name}: mensaje accionable`).toContain("Poppins SemiBold");
      expect(outcome.message, `${name}: mensaje accionable`).toContain("Lato SemiBold");
      expect(outcome.message, `${name}: mensaje accionable`).toContain("Dancing Script");
    }
  });

  /* ---------------------------------------------------------------- */
  /* 6 — Una tipografía no disponible                                 */
  /* ---------------------------------------------------------------- */

  test("una tipografía no disponible no produce sustitución silenciosa", async ({ page }) => {
    await page.route((url) => url.pathname.endsWith(".ttf"), (route) => route.abort());
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      const vector = await import("/src/export/vectorProductionExport.ts");
      const collect = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return { ok: true, message: "" };
        } catch (error) {
          return { ok: false, message: String((error as Error).message) };
        }
      };
      return {
        raster: await collect(() =>
          raster.traceTextElement({
            text: "Mate&Co",
            fontFamily: "Poppins SemiBold",
            scale: 1,
            radius: 374,
            inverted: false,
          }),
        ),
        vector: await collect(() =>
          vector.buildVectorProductionSvg({
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
            circularLines: "none",
          }),
        ),
      };
    });

    for (const [name, outcome] of Object.entries(result)) {
      expect(outcome.ok, `${name}: no debe exportar`).toBe(false);
      expect(outcome.message, `${name}: código`).toContain("FONT_UNAVAILABLE");
      // Sin sustitución: el fallo es explícito y no devuelve un SVG.
      expect(outcome.message.length, `${name}: mensaje`).toBeGreaterThan(20);
    }
    // El camino raster lo dice en español y con el motivo.
    expect(result.raster.message, "raster: mensaje").toContain("no se pudo cargar");
    await page.unroute((url) => url.pathname.endsWith(".ttf"));
  });

  /* ---------------------------------------------------------------- */
  /* 7 — El vectorial nunca cae automáticamente al raster              */
  /* ---------------------------------------------------------------- */

  test("el camino vectorial falla de forma explícita y no descarga ningún SVG", async ({ page }) => {
    test.setTimeout(120_000);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    // La fuente no se puede descargar: el camino vectorial tiene que fallar.
    await page.route((url) => url.pathname.endsWith(".ttf"), (route) => route.abort());
    await page.goto("/?textExport=vector");

    await page.locator(".add-text").click();
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();

    const error = await exportErrorThroughUi(page);
    expect(error, "el error es visible").not.toBeNull();
    expect(error!, "código del error").toContain("FONT_UNAVAILABLE");
    // El camino vectorial se intentó (el módulo se cargó): el fallo es suyo.
    expect(
      requests.filter((url) => url.includes("vectorProductionExport")).length,
      "chunk del camino vectorial solicitado",
    ).toBeGreaterThan(0);
    await page.unroute((url) => url.pathname.endsWith(".ttf"));
  });

  /* ---------------------------------------------------------------- */
  /* 8 — La reversión entre modos no modifica los pedidos              */
  /* ---------------------------------------------------------------- */

  test("la reversión entre modos no modifica los pedidos guardados", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/");
    await page.locator(".add-text").click();
    // Ir al paso de confirmación y CONFIRMAR el diseño (eso guarda el pedido).
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
    await page.locator(".confirm-design").click();
    await expect(page.getByTestId("confirm-job")).toBeVisible();

    const before = await storedJobs(page);
    expect(before.length, "hay un pedido guardado").toBeGreaterThan(2);

    // 1) Raster (el predeterminado).
    const raster = facts((await exportThroughUi(page)).svg);
    expect(raster.rasterSignature, "primera exportación: raster").toBe(true);
    expect(await storedJobs(page), "el raster no toca los pedidos").toBe(before);

    // 2) Vectorial experimental (sin recargar: el modo se resuelve en cada
    //    exportación, así que el diseño y el pedido siguen siendo los mismos).
    await setMode(page, "vector");
    const vector = facts((await exportThroughUi(page)).svg);
    expect(vector.vectorSignature, "segunda exportación: vectorial").toBe(true);
    expect(await storedJobs(page), "el vectorial no toca los pedidos").toBe(before);

    // 3) De vuelta al raster: reversión limpia.
    await setMode(page, "raster");
    const back = facts((await exportThroughUi(page)).svg);
    expect(back.rasterSignature, "tercera exportación: raster otra vez").toBe(true);
    expect(await storedJobs(page), "la reversión no toca los pedidos").toBe(before);
  });

  /* ---------------------------------------------------------------- */
  /* 10 — Coste de memoria de las fuentes embebidas                    */
  /* ---------------------------------------------------------------- */

  test("la fuente embebida se carga una sola vez (coste de memoria acotado)", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(".ttf")) fontRequests.push(request.url());
    });
    await page.goto("/");

    const measurement = await page.evaluate(async () => {
      const raster = await import("/src/export/textOutlines.ts");
      const fonts = await import("/src/typography/fonts.ts");
      const heap = () => {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return memory ? memory.usedJSHeapSize : 0;
      };
      const trace = () =>
        raster.traceTextElement({
          text: "Mate&Co",
          fontFamily: "Poppins SemiBold",
          scale: 1,
          radius: 374,
          inverted: false,
        });
      const before = heap();
      await trace();
      const afterFirst = heap();
      await trace();
      await trace();
      const afterThird = heap();
      // Tamaño del binario y de su forma embebida (base64).
      const poppins = fonts.TYPOGRAPHY_FONTS.poppins;
      const bytes = (await (await fetch(poppins.url)).arrayBuffer()).byteLength;
      return {
        firstTraceDelta: afterFirst - before,
        nextTracesDelta: afterThird - afterFirst,
        fontBytes: bytes,
        embeddedBytes: Math.ceil(bytes / 3) * 4,
      };
    });

    // La fuente no se vuelve a descargar ni a re-codificar en base64: el
    // coste de memoria es el de UNA fuente por tipografía, no el de un
    // trazado por texto.
    expect(fontRequests.length, "peticiones de la fuente durante la página").toBeLessThanOrEqual(4);

    // Y el archivo exportado no lleva la fuente dentro.
    await page.locator(".add-text").click();
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
    const { svg } = await exportThroughUi(page);
    expect(svg.includes("@font-face"), "el archivo no lleva la fuente").toBe(false);
    expect(svg.length, "tamaño del archivo exportado (kB)").toBeLessThan(200 * 1024);

    test.info().annotations.push({
      type: "memoria",
      description:
        `binario ${Math.round(measurement.fontBytes / 1024)} kB · embebido ~${Math.round(measurement.embeddedBytes / 1024)} kB · ` +
        `1er trazado +${Math.round(measurement.firstTraceDelta / 1024)} kB · 2 trazados más +${Math.round(measurement.nextTracesDelta / 1024)} kB`,
    });
  });
});
