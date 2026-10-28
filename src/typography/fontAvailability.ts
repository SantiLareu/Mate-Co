/**
 * Disponibilidad de una tipografía en el navegador (E4.1).
 *
 * POR QUÉ EXISTE
 *   Una tipografía que no se ha cargado se sustituye **en silencio** por la
 *   de reserva del navegador. Con eso, dos medidas dejan de ser comparables:
 *   el avance del texto medido en el DOM y el del motor. Medido: con la
 *   tipografía de reserva, un texto de 80 caracteres mide 1 901,9 u en vez de
 *   2 856,8 u.
 *
 *   Aquí se pregunta al navegador si la familia pedida está **realmente
 *   disponible** (`document.fonts.check`), que es la misma comprobación que
 *   usa `tests/typography-catalogue.spec.ts` ⇒ los tres sitios (editor,
 *   panel y exportador) hablan el mismo idioma.
 *
 * NOTA
 *   `document.fonts.check` sólo devuelve `true` para una tipografía del
 *   catálogo cuando el navegador la ha **pedido** (es decir, cuando algo la
 *   usa). Por eso hay que preguntar después de que el texto exista en la
 *   página, no antes.
 */

/** El peso con el que se componen las tipografías del catálogo. */
export const CATALOGUE_FONT_WEIGHT = 600;

/**
 * ¿Está disponible la tipografía pedida (con el peso del catálogo)?
 *
 * En un entorno sin DOM (o sin la API de fuentes) devuelve `false`: sin
 * poder comprobarlo, no se da por buena ninguna medida.
 */
export function isFontAvailable(
  family: string,
  weight: number = CATALOGUE_FONT_WEIGHT,
): boolean {
  if (typeof document === "undefined" || !document.fonts) return false;
  try {
    return document.fonts.check(`${weight} 16px "${family}"`);
  } catch {
    return false;
  }
}
