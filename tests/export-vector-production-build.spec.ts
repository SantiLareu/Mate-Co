/**
 * E3.1 — El camino vectorial NO se puede activar en un build de PRODUCCIÓN.
 *
 * QUÉ DEMUESTRA
 *   Que la vía experimental `?textExport=vector` es **sólo de desarrollo**:
 *   en un build de producción (el que descarga el cliente) el parámetro NO
 *   activa el exportador vectorial, porque `import.meta.env.DEV` es `false`
 *   y Vite elimina esa rama al compilar.
 *
 * CÓMO LO COMPRUEBA (sobre el build real, no sobre un simulacro)
 *   1. Compila la aplicación con `vite build` en un directorio aparte.
 *   2. Sirve ese build con un servidor estático propio (con el fallback de
 *      la SPA).
 *   3. Abre la aplicación con `?textExport=vector` y hace el flujo real de
 *      exportación (añadir texto → confirmar → exportar).
 *   4. Comprueba dos señales independientes:
 *      a) el chunk del camino vectorial **no se pide nunca** (el módulo
 *         pesado no se descarga: el camino vectorial no llega a activarse);
 *      b) el SVG descargado es el del camino RASTER (su grupo de texto lleva
 *         `scale(0.33……)`, la firma del trazador de mapa de bits; el
 *         vectorial lleva `scale(1)`).
 *   5. Y como control, el mismo flujo contra el servidor de DESARROLLO: ahí
 *      el parámetro **sí** activa el camino vectorial (el chunk se pide y el
 *      SVG descargado es el vectorial).
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = resolve(HERE, "../test-results/export-vector-production-build");
const PORT = 4189;

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

function startServer(root: string): Promise<Server> {
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
  return new Promise((done) => server.listen(PORT, "127.0.0.1", () => done(server)));
}

/** Hace el flujo real de exportación y devuelve el SVG descargado. */
async function exportDesign(
  page: import("@playwright/test").Page,
  baseUrl: string,
): Promise<{ svg: string; requests: string[] }> {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(`${baseUrl}/?textExport=vector`);
  await page.locator(".add-text").click();
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator(".export-svg").click();
  const file = await download;
  const path = await file.path();
  return { svg: readFileSync(path, "utf8"), requests };
}

test("en un build de producción ?textExport=vector no activa el exportador vectorial", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // 1. Build real de PRODUCCIÓN, en su propio directorio.
  //    Ojo: hay que fijar el modo Y `NODE_ENV`. El proceso de pruebas corre
  //    con `NODE_ENV=development`, y Vite hereda esa variable: sin fijarla,
  //    `import.meta.env.DEV` queda en `true` y la rama de desarrollo SÍ
  //    llega al bundle (se comprobó). Un build de producción tiene que
  //    compilarse como tal.
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({
      configFile: resolve(REPO, "vite.config.ts"),
      root: REPO,
      mode: "production",
      logLevel: "warn",
      build: { outDir: OUT, emptyOutDir: true },
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
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

  const server = await startServer(OUT);
  try {
    const { svg, requests } = await exportDesign(page, `http://127.0.0.1:${PORT}`);

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

test("control: en desarrollo ?textExport=vector SÍ activa el exportador vectorial", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // El servidor de desarrollo (el `globalSetup` de Playwright) sí tiene
  // `import.meta.env.DEV === true`: ahí la vía experimental existe.
  const { svg, requests } = await exportDesign(page, "http://127.0.0.1:4175");

  const vectorChunk = requests.filter((url) => url.includes("vectorProductionExport"));
  expect(vectorChunk.length, "chunk del camino vectorial solicitado").toBeGreaterThan(0);
  // El SVG descargado es el VECTORIAL: el grupo del texto lleva `scale(1)`.
  expect(svg).toContain("translate(450 450) scale(1)");
  expect(svg).not.toContain("scale(0.33");
});
