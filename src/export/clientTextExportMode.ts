/**
 * Modo del trazador de texto del cliente — **E4.4**.
 *
 * QUÉ ES
 *   Un interruptor mínimo, sin dependencias pesadas, que decide con qué
 *   trazador se genera el SVG que descarga el cliente:
 *     - `vector` (el motor de HarfBuzz): **el predeterminado desde E4.4**
 *       en la rama experimental;
 *     - `raster` (VTracer sobre el texto del navegador): **reversión
 *       explícita**, nunca un *fallback* automático.
 *
 * POR QUÉ EL VECTORIAL ES EL PREDETERMINADO
 *   El camino vectorial compone el texto con los contornos reales de la
 *   fuente del catálogo (E0–E4.2): el archivo exportado lleva la geometría
 *   exacta de las letras, sin rasterizar ni trazar. Es lo que se graba.
 *
 * REVERSIÓN EXPLÍCITA (NUNCA AUTOMÁTICA)
 *   El raster se activa de dos formas, ambas **explícitas**:
 *     1. al COMPILAR con `VITE_TEXT_EXPORT_MODE=raster`: la reversión que
 *        se usa en producción (una decisión de quien compila);
 *     2. en DESARROLLO, con el parámetro de URL `?textExport=raster`.
 *   Si el camino vectorial falla, la exportación **falla**: nunca cae al
 *   raster en silencio (VTracer es reversión, no reserva).
 *
 * POR QUÉ ESTÁ EN SU PROPIO MÓDULO
 *   Para que el camino vectorial se cargue **bajo demanda** (import
 *   dinámico): el motor de HarfBuzz y el adaptador vectorial no deben entrar
 *   en el bundle inicial que descarga el cliente.
 */

/**
 * El modo del trazador de texto del cliente.
 *
 * - `vector`: el motor de HarfBuzz (predeterminado de la rama experimental).
 * - `raster`: el camino de siempre (VTracer), sólo por reversión explícita.
 */
export type ClientTextExportMode = "raster" | "vector";

/**
 * El predeterminado desde E4.4: el cliente descarga el SVG **vectorial**.
 *
 * E4.3 lo dejó en `raster`; el cambio se hace sólo en esta rama
 * experimental y se puede revertir explícitamente (ver arriba).
 */
export const DEFAULT_CLIENT_TEXT_EXPORT_MODE: ClientTextExportMode = "vector";

/**
 * El valor de compilación (`VITE_TEXT_EXPORT_MODE`), si lo hay.
 *
 * `import.meta.env` sólo existe cuando el código lo sirve Vite. Este módulo
 * también se importa desde Node (las pruebas lo cargan a través de
 * `ConfirmPanel`), donde `import.meta.env` es `undefined`: la lectura tiene
 * que ser segura o la importación revienta.
 */
function buildOverride(): ClientTextExportMode | null {
  try {
    const value = import.meta.env.VITE_TEXT_EXPORT_MODE;
    return value === "raster" || value === "vector" ? value : null;
  } catch {
    // Fuera de Vite (Node): no hay override de compilación.
    return null;
  }
}

/**
 * Modo fijado **al compilar** (`VITE_TEXT_EXPORT_MODE=raster|vector`).
 *
 * Es la reversión explícita: quien compila decide. `null` = sin override,
 * o sea, manda `DEFAULT_CLIENT_TEXT_EXPORT_MODE`.
 */
export const CLIENT_TEXT_EXPORT_MODE_OVERRIDE: ClientTextExportMode | null =
  buildOverride();

/**
 * Resuelve el modo del trazador de texto.
 *
 * Nunca falla y nunca cambia el predeterminado por accidente:
 *   1. el override de compilación manda (reversión explícita);
 *   2. en desarrollo, el parámetro de URL `?textExport=raster|vector`;
 *   3. si nada de eso, el predeterminado (vectorial).
 */
export function resolveClientTextExportMode(): ClientTextExportMode {
  if (CLIENT_TEXT_EXPORT_MODE_OVERRIDE) return CLIENT_TEXT_EXPORT_MODE_OVERRIDE;
  // La rama de desarrollo se ELIMINA del bundle de producción: Vite sustituye
  // `import.meta.env.DEV` por `false` y el optimizador se lleva el bloque
  // entero (el cliente final no recibe ningún parámetro técnico).
  //
  // OJO: la lectura tiene que ser literal y en línea (no dentro de una
  // función auxiliar) para que esa eliminación siga ocurriendo.
  try {
    if (import.meta.env.DEV && typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get(
        "textExport",
      );
      if (requested === "raster" || requested === "vector") return requested;
    }
  } catch {
    // Fuera de Vite (Node): no hay modo de desarrollo.
  }
  return DEFAULT_CLIENT_TEXT_EXPORT_MODE;
}
