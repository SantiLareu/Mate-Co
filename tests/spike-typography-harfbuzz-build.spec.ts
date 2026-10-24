/**
 * Stage 4 typography spike — the ISOLATED HARNESS BUILD.
 *
 * Proves that the HarfBuzz WASM can be shipped by a Vite build and loaded by
 * the browser: the emscripten glue resolves its .wasm relative to its own
 * module URL, and the published entrypoint initialises the module with a
 * top-level await, so the build needs an explicit target and an explicit
 * asset. The measurement (sizes and timings) is written to
 * test-results/spike-typography/hb-build.txt for review.
 */
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CONFIG = resolve(HERE, "../spikes/typography/hb-harness/vite.config.ts");
const DIST = resolve(HERE, "../spikes/typography/hb-harness/dist-hb");
const REPO = resolve(HERE, "..");
const OUT = resolve(HERE, "../test-results/spike-typography");
const PORT = 4187;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
};

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    let file = join(DIST, url);
    if (!existsSync(file)) file = join(REPO, url);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(PORT, "127.0.0.1", () => done(server)));
}

test("the built harness loads HarfBuzz and its WASM", async ({ page }) => {
  await build({ configFile: CONFIG, logLevel: "warn" });
  const server = await startServer();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/spikes/typography/hb-harness/index.html`);
  await page.waitForFunction(() => Boolean((window as unknown as { hb?: unknown }).hb), null, {
    timeout: 30000,
  });
  const readyMs = Date.now() - t0;
  const info = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        hb: {
          version: string;
          loadMs: number;
          build: (
            u: string,
            r: unknown,
            o: unknown,
          ) => Promise<{ ok: boolean; svg?: string }>;
        };
      }
    ).hb;
    const request = {
      text: "¡Fiesta! Tía Ñandú — AVATAR",
      fontSizeMm: 4.6756,
      letterSpacingMm: 0.2672,
      baselineRadiusMm: 34.084,
      angleDegrees: 0,
      inverted: false,
      invertedDyMm: 0,
      outerDiameterMm: 85,
      innerDiameterMm: 50,
      sizeFactor: 1,
    };
    const timings: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 5; i += 1) {
      const t = performance.now();
      const r = await api.build(
        "/spikes/typography/fonts/lato/Lato-SemiBold.ttf",
        request,
        {},
      );
      timings.push(performance.now() - t);
      bytes = (r.svg ?? "").length;
    }
    return { version: api.version, loadMs: api.loadMs, timings, bytes };
  });
  server.close();

  const report = [
    `build: version=${info.version} loadMs=${info.loadMs.toFixed(1)} pageReadyMs=${readyMs}`,
    `build: shaping+layout ms=[${info.timings.map((t) => t.toFixed(1)).join(", ")}] svgBytes=${info.bytes}`,
    `build: errores de consola/pagina = ${errors.length}`,
    ...errors.map((e) =>  `   ${e}`),
  ].join("\n");
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "hb-build.txt"), report + "\n");
  console.log(report);

  expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(info.bytes).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
  expect(info.loadMs).toBeLessThan(2000);
});
