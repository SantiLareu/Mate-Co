/**
 * E4.4 — El exportador VECTORIAL es el PREDETERMINADO en un build real de
 * PRODUCCIÓN; el raster es la REVERSIÓN EXPLÍCITA.
 *
 * QUÉ DEMUESTRA
 *   1. En un build de producción (el que descarga el cliente), sin ninguna
 *      variable de entorno y sin parámetro de URL, el SVG descargado es el
 *      VECTORIAL (los contornos de HarfBuzz) y el chunk del camino vectorial
 *      **sí** se descarga.
 *   2. La REVERSIÓN EXPLÍCITA: una compilación **aislada** con
 *      `VITE_TEXT_EXPORT_MODE=raster` (otro `outDir`, dentro de
 *      `test-results/`, que git ignora) descarga el SVG **raster** y **no**
 *      pide el chunk del camino vectorial. El proyecto no se toca: sólo se
 *      escribe en `test-results/`.
 *   3. En DESARROLLO el parámetro de URL sigue mandando sobre el
 *      predeterminado: `?textExport=raster` fuerza el camino raster y
 *      `?textExport=vector` el vectorial.
 *
 * CÓMO LO COMPRUEBA (sobre el build real, no sobre un simulacro)
 *   1. Compila la aplicación con `vite build` en un directorio aparte.
 *   2. Sirve ese build con un servidor estático propio (con el fallback de
 *      la SPA).
 *   3. Hace el flujo real de exportación (añadir texto → confirmar →
 *      exportar) y captura la descarga.
 *   4. Comprueba dos señales independientes:
 *      a) el chunk del camino vectorial (URL con "vectorProductionExport")
 *         pedido o no;
 *      b) la firma del SVG descargado: `translate(450 450) scale(1)` es la
 *         del camino VECTORIAL y `scale(0.33……)` la del RASTER (el trazador
 *         de mapa de bits).
 *
 * NOTA SOBRE LA REVERSIÓN
 *   `import.meta.env.VITE_TEXT_EXPORT_MODE` lo sustituye Vite **al compilar**:
 *   por eso la reversión se prueba con una SEGUNDA compilación, con la
 *   variable fijada antes de `build()` y restaurada después (el mismo patrón
 *   que el `NODE_ENV` de producción).
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { build } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = resolve(HERE, "../test-results/export-vector-production-build");
/** La compilación AISLADA de la reversión: otro `outDir`, nunca el del proyecto. */
const OUT_ROLLBACK = resolve(HERE, "../test-results/export-vector-production-build-rollback");
const PORT = 4189;
const PORT_ROLLBACK = 4190;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function startServer(root: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    let file = join(root, url);
    // Fallback de la SPA: cualquier ruta desconocida sirve el index.
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, "index.html");
    }
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

/**
 * Compila la aplicación en modo PRODUCCIÓN.
 *
 * Ojo: hay que fijar el modo Y `NODE_ENV`. El proceso de pruebas corre con
 * `NODE_ENV=development`, y Vite hereda esa variable: sin fijarla,
 * `import.meta.env.DEV` queda en `true` y la rama de desarrollo SÍ llega
 * al bundle (se comprobó). Un build de producción tiene que compilarse como
 * tal.
 *
 * `textExportMode` fija la REVERSIÓN EXPLÍCITA al compilar
 * (`VITE_TEXT_EXPORT_MODE`): Vite sustituye `import.meta.env.VITE_TEXT_EXPORT_MODE`
 * en tiempo de compilación, así que es aquí donde se decide el camino.
 * La variable se restaura al terminar (igual que `NODE_ENV`).
 */
async function buildProduction(outDir: string, textExportMode?: "raster" | "vector") {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTextExportMode = process.env.VITE_TEXT_EXPORT_MODE;
  process.env.NODE_ENV = "production";
  if (textExportMode === undefined) delete process.env.VITE_TEXT_EXPORT_MODE;
  else process.env.VITE_TEXT_EXPORT_MODE = textExportMode;
  try {
    await build({
      configFile: resolve(REPO, "vite.config.ts"),
      root: REPO,
      mode: "production",
      logLevel: "warn",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTextExportMode === undefined) delete process.env.VITE_TEXT_EXPORT_MODE;
    else process.env.VITE_TEXT_EXPORT_MODE = previousTextExportMode;
  }
}

/**
 * Hace el flujo real de exportación y devuelve el SVG descargado.
 *
 * `query` es el parámetro de URL del modo (sólo tiene efecto en desarrollo:
 * en un build de producción `import.meta.env.DEV` es `false`).
 */
async function exportDesign(
  page: Page,
  baseUrl: string,
  query = "",
): Promise<{ svg: string; requests: string[] }> {
  const requests: string[] = [];
  const onRequest = (request: Request) => requests.push(request.url());
  page.on("request", onRequest);
  try {
    await page.goto(`${baseUrl}/${query}`);
    await page.locator(".add-text").click();
    await page.locator(".design-confirm").click();
    await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.locator(".export-svg").click();
    const file = await download;
    const path = await file.path();
    return { svg: readFileSync(path, "utf8"), requests };
  } finally {
    page.off("request", onRequest);
  }
}

test("en un build de producción el exportador VECTORIAL es el predeterminado", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // 1. Build real de PRODUCCIÓN, en su propio directorio, SIN override: el
  //    predeterminado de la rama experimental es el camino vectorial.
  await buildProduction(OUT);
  expect(existsSync(join(OUT, "index.html")), "index.html del build").toBe(true);

  // La rama de desarrollo no puede llegar al bundle de producción: el
  // parámetro `textExport` sólo existe dentro de ella.
  const assets = readdirSync(join(OUT, "assets"));
  const mainBundle = assets.filter((file) => /^index-.*\.js$/.test(file));
  expect(mainBundle.length, "bundle principal del build").toBeGreaterThan(0);
  for (const file of mainBundle) {
    const content = readFileSync(join(OUT, "assets", file), "utf8");
    expect(
      content.includes("textExport"),
      `la rama de desarrollo llegó al bundle ${file}`,
    ).toBe(false);
  }

  const server = await startServer(OUT, PORT);
  try {
    const { svg, requests } = await exportDesign(page, `http://127.0.0.1:${PORT}`);

    // a) El chunk del camino vectorial SÍ se descarga: el predeterminado del
    //    cliente es el camino vectorial.
    const vectorChunk = requests.filter((url) => url.includes("vectorProductionExport"));
    expect(vectorChunk.length, "chunk del camino vectorial solicitado").toBeGreaterThan(0);

    // b) El archivo descargado es el VECTORIAL: el grupo del texto lleva
    //    `scale(1)`, no la escala del mapa de bits.
    expect(svg).toContain("translate(450 450) scale(1)");
    expect(svg).not.toContain("scale(0.33");
    // Y el SVG es un archivo de producción válido, con el grupo de grabado.
    expect(svg).toContain('id="engraving-design"');
  } finally {
    server.close();
  }
});

test("reversión explícita: un build compilado con VITE_TEXT_EXPORT_MODE=raster descarga el SVG raster", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // 2. Reversión EXPLÍCITA: una compilación AISLADA (otro `outDir`, dentro de
  //    `test-results/`, que git ignora) con `VITE_TEXT_EXPORT_MODE=raster`.
  //    El proyecto NO se toca: el estado final del repositorio no cambia.
  expect(
    OUT_ROLLBACK.startsWith(resolve(REPO, "test-results")),
    "la reversión se compila dentro de test-results/",
  ).toBe(true);
  await buildProduction(OUT_ROLLBACK, "raster");
  expect(existsSync(join(OUT_ROLLBACK, "index.html")), "index.html del build de reversión").toBe(
    true,
  );

  const server = await startServer(OUT_ROLLBACK, PORT_ROLLBACK);
  try {
    const { svg, requests } = await exportDesign(
      page,
      `http://127.0.0.1:${PORT_ROLLBACK}`,
    );

    // a) El chunk del camino vectorial NO se descarga: el módulo pesado no
    //    llega a cargarse ⇒ el camino vectorial no se activa.
    const vectorChunk = requests.filter((url) => url.includes("vectorProductionExport"));
    expect(vectorChunk, "chunk del camino vectorial solicitado").toEqual([]);

    // b) El archivo descargado es el del camino RASTER: el grupo del texto
    //    lleva la escala del trazador de mapa de bits (pixelScale 3), no la
    //    del vectorial (scale(1)).
    expect(svg).toContain("scale(0.33");
    expect(svg).not.toContain("translate(450 450) scale(1)");
    // Y el SVG es un archivo de producción válido, con el grupo de grabado.
    expect(svg).toContain('id="engraving-design"');
  } finally {
    server.close();
  }
});

test("control: en desarrollo ?textExport=raster fuerza el raster y ?textExport=vector fuerza el vectorial", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // El servidor de desarrollo (el `globalSetup` de Playwright) sí tiene
  // `import.meta.env.DEV === true`: ahí el parámetro de URL manda sobre el
  // predeterminado.
  const raster = await exportDesign(
    page,
    "http://127.0.0.1:4175",
    "?textExport=raster",
  );
  expect(
    raster.requests.filter((url) => url.includes("vectorProductionExport")),
    "chunk del camino vectorial solicitado",
  ).toEqual([]);
  expect(raster.svg, "el SVG descargado es el raster").toContain("scale(0.33");
  expect(raster.svg, "el SVG descargado no es el vectorial").not.toContain(
    "translate(450 450) scale(1)",
  );

  const vector = await exportDesign(
    page,
    "http://127.0.0.1:4175",
    "?textExport=vector",
  );
  expect(
    vector.requests.filter((url) => url.includes("vectorProductionExport")).length,
    "chunk del camino vectorial solicitado",
  ).toBeGreaterThan(0);
  expect(vector.svg, "el SVG descargado es el vectorial").toContain(
    "translate(450 450) scale(1)",
  );
  expect(vector.svg, "el SVG descargado no es el raster").not.toContain("scale(0.33");
});
