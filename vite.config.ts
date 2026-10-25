import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HB_DIST = resolve(HERE, "node_modules/harfbuzzjs/dist");
/** Ficheros del paquete que el navegador necesita en tiempo de ejecución. */
const HB_FILES = ["index.mjs", "harfbuzz.js", "harfbuzz.wasm"];
const PUBLIC_BASE = "/assets/harfbuzz";

/**
 * Sirve el WASM de HarfBuzz fuera del bundle inicial.
 *
 * Por qué hace falta:
 *   1. el paquete resuelve su .wasm con `new URL("harfbuzz.wasm", import.meta.url)`
 *      → el wasm tiene que estar SIEMPRE junto al glue;
 *   2. su entrypoint inicializa el módulo con un TOP-LEVEL AWAIT → el
 *      empaquetador no lo puede incorporate en un chunk con el target normal;
 *   3. el motor lo importa dinámicamente con un especificador calculado en
 *      tiempo de ejecución → ni el bundle inicial ni el escáner de dependencias
 *      lo ven (si lo vieran, el optimizador de Vite lo reconstruiría con el
 *      target por defecto y el build fallaría).
 *
 * En desarrollo el plugin sirve los ficheros tal cual (middleware); en build
 * los emite como assets con nombre estable, de modo que la URL es la misma en
 * ambos casos.
 */
function harfBuzzAssets(): Plugin {
  let isBuild = false;
  return {
    name: "harfbuzz-assets",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(`${PUBLIC_BASE}/`)) return next();
        const name = url.slice(PUBLIC_BASE.length + 1);
        if (!/^[\w.-]+$/.test(name)) return next();
        const file = resolve(HB_DIST, name);
        if (!file.startsWith(HB_DIST) || !existsSync(file)) return next();
        res.setHeader(
          "Content-Type",
          name.endsWith(".wasm")
            ? "application/wasm"
            : "text/javascript",
        );
        res.end(readFileSync(file));
      });
    },
    buildStart() {
      // En desarrollo los ficheros los sirve el middleware de arriba; emitFile
      // sólo tiene sentido en el build.
      if (!isBuild) return;
      for (const name of HB_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `assets/harfbuzz/${name}`,
          source: readFileSync(resolve(HB_DIST, name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [harfBuzzAssets()],
  optimizeDeps: {
    // El paquete nunca debe pre-empaquetarse: su glue resuelve el wasm
    // junto a sí mismo y usa top-level await.
    exclude: ["harfbuzzjs"],
  },
});
