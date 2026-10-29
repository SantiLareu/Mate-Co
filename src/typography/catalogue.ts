/**
 * Catálogo tipográfico: fuente única de verdad para mapear una familia
 * VISIBLE (la que ve el cliente en el selector) al identificador de fuente
 * del motor.
 *
 * POR QUÉ VIVE AQUÍ
 *   El mapa familia → id es una decisión de producto (qué tipografías se
 *   ofrecen) y pertenece al catálogo, no a un consumidor concreto. Antes
 *   vivía en `src/production-lab/typographyOutlines.ts`, y eso obligaba a
 *   que cualquier otro consumidor (por ejemplo el exportador del cliente)
 *   dependiera del módulo del laboratorio: `src/export` no debe saber nada
 *   del laboratorio. Aquí vive la tabla y el laboratorio la importa.
 *
 * SIN SUSTITUCIÓN SILENCIOSA
 *   Una familia que no está en el catálogo devuelve `null`: quien llama
 *   decide (normalmente, fallar cerrado). Nunca se cambia una tipografía por
 *   otra, igual que el motor nunca sustituye un glifo.
 */
import { TYPOGRAPHY_FONTS, type TypographyFontId } from "./fonts";

/** Familias del catálogo empaquetado, por nombre visible. */
const FAMILY_TO_ID = new Map<string, TypographyFontId>(
  Object.values(TYPOGRAPHY_FONTS).map((font) => [font.family, font.id]),
);

/**
 * Mapea una familia de texto al catálogo empaquetado.
 *
 * Devuelve `null` si la familia no está en el catálogo: el llamante debe
 * bloquear el caso explícitamente (nunca sustituir la fuente).
 */
export function catalogueFontForFamily(family: string): TypographyFontId | null {
  return FAMILY_TO_ID.get(family.trim()) ?? null;
}

/**
 * Las familias del catálogo, como lista legible para los mensajes de error.
 *
 * E4.3: el mensaje de "fuera del catálogo" tiene que decir **qué elegir**,
 * igual en los dos caminos de exportación (raster y vectorial). Esta lista
 * es la única fuente de verdad de los nombres visibles.
 */
export function catalogueFamilyList(): string {
  return Object.values(TYPOGRAPHY_FONTS)
    .map((font) => font.family)
    .join(", ");
}
