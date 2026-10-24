/**
 * Isolated Vite harness for the HarfBuzz spike.
 *
 * It does NOT touch the product configuration: the product has no
 * vite.config.ts and this file is only used by the spike's own test, which
 * starts its OWN Vite server with this config (port 4180).
 *
 * THE PROBLEM IT SOLVES (both measured):
 *  1. harfbuzzjs ships an emscripten module that resolves its .wasm with
 *     `new URL("harfbuzz.wasm", import.meta.url)`, and the published
 *     entrypoint calls `createHarfBuzz()` with no arguments, so `locateFile`
 *     cannot be injected through the public API. In a bundler that URL points
 *     at the chunk, where the wasm is not.
 *  2. harfbuzzjs initialises the WASM with a TOP-LEVEL AWAIT, so Vite's
 *     dependency pre-bundle (default target es2020) refuses to build it, and
 *     its bare import is picked up by Vite's dependency SCANNER anywhere in
 *     the project (it scans the *.html glob) — which would break the PRODUCT's dev
 *     server as soon as the spike lives in the repo.
 *
 * THE SOLUTION:
 *  - the shaper loads the package with a RUNTIME-computed dynamic import, so
 *    no bundler or scanner can see it;
 *  - this plugin serves the package's dist files under a stable path in dev
 *    (dev middleware) and emits them as assets in build, always keeping the
 *    .wasm NEXT TO the glue so the default URL resolution works untouched.
 */
import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const HB_DIST = resolve(REPO_ROOT, "node_modules/harfbuzzjs/dist");
/** Files the browser needs: the wrapper, the emscripten glue and the wasm. */
const HB_FILES = ["index.mjs", "harfbuzz.js", "harfbuzz.wasm"];
const DEV_BASE = "/hb/harfbuzz";
const BUILD_BASE = "assets/hb/harfbuzz";

function harfbuzzAssetsPlugin(): Plugin {
  let base = DEV_BASE;
  return {
    name: "harfbuzz-assets",
    configResolved(config) {
      if (config.command !== "build") {
        base = DEV_BASE;
        return;
      }
      // In the build the harness page lives under the repo root
      // (spikes/typography/hb-harness/index.html) while the assets are emitted
      // at <outDir>/assets: the base must be relative to the PAGE, otherwise
      // the dynamic import resolves to a path that does not exist.
      const depth = relative(config.root, HERE).split(sep).filter(Boolean).length;
      base = `${"../".repeat(depth)}${BUILD_BASE}`;
    },
    configureServer(server) {
      // dev: serve the package files untouched, so the emscripten glue keeps
      // resolving its wasm with `new URL("harfbuzz.wasm", import.meta.url)`.
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith(`${DEV_BASE}/`)) return next();
        const name = url.slice(DEV_BASE.length + 1);
        if (!/^[\w.-]+$/.test(name)) return next();
        const file = resolve(HB_DIST, name);
        if (!file.startsWith(HB_DIST)) return next();
        try {
          const body = readFileSync(file);
          res.setHeader(
            "Content-Type",
            name.endsWith(".wasm")
              ? "application/wasm"
              : name.endsWith(".mjs")
                ? "text/javascript"
                : "text/javascript",
          );
          res.end(body);
        } catch {
          next();
        }
      });
    },
    buildStart() {
      for (const name of HB_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `${BUILD_BASE}/${name}`,
          source: readFileSync(resolve(HB_DIST, name)),
        });
      }
    },
    transformIndexHtml() {
      return [
        {
          tag: "script",
          injectTo: "head",
          children: `window.__HB_BASE__=${JSON.stringify(base)};`,
        },
      ];
    },
  };
}

export default defineConfig({
  // The repo root, so the harness page can load the spike modules and the
  // font files with ordinary URLs.
  root: REPO_ROOT,
  base: "./",
  // The harness gets its OWN dependency-optimizer cache: two Vite servers
  // with the same root otherwise fight over the same pre-bundled files (the
  // ?v= hash depends on the config). Precaution, not the cause of the
  // interop failure below.
  cacheDir: resolve(REPO_ROOT, "node_modules/.vite-hb"),
  optimizeDeps: {
    // harfbuzzjs must never be pre-bundled: its top-level await needs an
    // esnext target and its glue resolves the wasm next to itself.
    //
    // The optimiser's esbuild target stays at Vite's default: raising it to
    // esnext was measured NOT to be the cause of the interop failure below.
    exclude: ["harfbuzzjs"],
  },
  plugins: [harfbuzzAssetsPlugin()],
  build: {
    outDir: resolve(HERE, "dist-hb"),
    emptyOutDir: true,
    // The harfbuzz entrypoint uses a top-level await.
    target: "esnext",
    rollupOptions: {
      // Only the harness page is an entry: the product app is not part of the
      // spike build (its chunks would pollute the size measurement).
      input: { harness: resolve(HERE, "index.html") },
    },
  },
});
