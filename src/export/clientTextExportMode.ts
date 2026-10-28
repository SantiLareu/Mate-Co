/**
 * Modo del trazador de texto del cliente — **interno y experimental** (E3.1).
 *
 * QUÉ ES
 *   Un interruptor mínimo, sin dependencias pesadas, que decide con qué
 *   trazador se genera el SVG que descarga el cliente:
 *     - `raster` (VTracer sobre el texto del navegador): **el predeterminado
 *       y el comportamiento de siempre**;
 *     - `vector` (el motor de HarfBuzz): experimental, sin validar todavía
 *       con el grabador real (E5).
 *
 * POR QUÉ ES INTERNO
 *   El cliente final no debe ver opciones técnicas. La vía `vector` existe
 *   como constante interna y, **sólo en desarrollo**, como parámetro de URL
 *   (`?textExport=vector`). En el build de producción no existe ninguna vía
 *   para activarlo.
 *
 * POR QUÉ ESTÁ EN SU PROPIO MÓDULO
 *   Para que el camino experimental se cargue **bajo demanda** (import
 *   dinámico): el motor de HarfBuzz y el adaptador vectorial no deben entrar
 *   en el bundle inicial que descarga el cliente.
 */

/**
 * El modo del trazador de texto del cliente.
 *
 * - `raster`: el comportamiento de siempre (VTracer).
 * - `vector`: el motor de HarfBuzz (experimental).
 */
export type ClientTextExportMode = "raster" | "vector";

/** El predeterminado NO cambia: el cliente descarga el SVG raster. */
export const DEFAULT_CLIENT_TEXT_EXPORT_MODE: ClientTextExportMode = "raster";

/**
 * Modo interno para forzar el camino vectorial en una compilación concreta.
 *
 * Está en `false` a propósito: activarlo es una decisión consciente
 * (E3.1/E5), no un efecto secundario.
 */
export const VECTOR_EXPORT_EXPERIMENTAL_ENABLED = false;

/**
 * Resuelve el modo del trazador de texto.
 *
 * Nunca falla y nunca cambia el predeterminado por accidente: sólo una
 * petición explícita (constante interna o, en desarrollo, el parámetro de
 * URL) activa el camino vectorial.
 */
export function resolveClientTextExportMode(): ClientTextExportMode {
  if (VECTOR_EXPORT_EXPERIMENTAL_ENABLED) return "vector";
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const requested = new URLSearchParams(window.location.search).get(
      "textExport",
    );
    if (requested === "vector") return "vector";
  }
  return DEFAULT_CLIENT_TEXT_EXPORT_MODE;
}
