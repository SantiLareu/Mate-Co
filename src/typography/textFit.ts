/**
 * Encaje del texto curvo en el recorrido circular de la virola (E4.1).
 *
 * QUÉ RESUELVE
 *   El texto de la vista previa se compone sobre una **circunferencia
 *   cerrada** de radio `radio - 14 * escala` (`CurvedText.tsx`), y el
 *   navegador **centra** el texto en el punto medio de ese recorrido. Si el
 *   texto es más largo que la vuelta, el navegador recorta lo que sobresale
 *   (medido en Chromium, ver `odd/tasks/stage4-client-export-E2.md` §1.2).
 *
 *   Aquí se decide, con las medidas reales, **qué escala hace que el texto
 *   entre completo** y **si un texto dado entra**.
 *
 * LA REGLA
 *   El texto entra si su avance no supera la longitud del recorrido:
 *
 *       avance  <=  2 * PI * (radio - 14 * escala)
 *
 *   Es **conservadora**: el último cluster se pinta si su *centro* cae
 *   dentro del recorrido, y su centro queda un poco más adentro que el
 *   extremo, así que el umbral nunca rechaza un texto que realmente entraría.
 *
 * POR QUÉ HAY UNA MARGEN DE SEGURIDAD
 *   El avance que ve el navegador (`getComputedTextLength`) y el que compone
 *   HarfBuzz (`totalAdvanceMm`) coinciden con una diferencia medida del
 *   **0,06 %–0,09 %** (E2 §1.4). Sin margen, un texto justo en el límite
 *   podría entrar en el editor y quedar recortado en la exportación. El
 *   margen del 1 % cubre esa diferencia con un orden de magnitud de holgura
 *   y mantiene el criterio conservador.
 *
 * POR QUÉ EL AJUSTE TIENE FORMA CERRADA
 *   El avance es **lineal con la escala** (el tamaño de fuente y el
 *   `letter-spacing` escalan juntos, y no hay hinting en la medida del
 *   navegador): `avance(escala) = A0 * escala`, con `A0` el avance por
 *   unidad de escala. Despejando la regla:
 *
 *       A0 * escala  <=  f * 2 * PI * (radio - 14 * escala)
 *       escala * (A0 + f * 28 * PI)  <=  f * 2 * PI * radio
 *       escala  <=  f * 2 * PI * radio / (A0 + f * 28 * PI)
 *
 *   ⇒ **una sola operación, sin iteración y sin realimentación**: el
 *   resultado es una función pura de las medidas, así que no puede oscilar
 *   entre dos tamaños cercanos.
 *
 * UNIDAD DE VERDAD
 *   Este módulo sólo calcula. El tamaño efectivo que se aplica es el que
 *   guarda el elemento del diseño (`TextElement.scale`): lo usan la vista
 *   previa, los tiradores y **los dos exportadores**, así que no puede haber
 *   discrepancias entre lo que se ve, lo que se toca y lo que se graba.
 */

/**
 * El radio del path del texto es `radio - TEXT_PATH_INSET * escala`
 * (`CurvedText.tsx`).
 */
export const TEXT_PATH_INSET = 14;

/**
 * Margen de seguridad (fracción del recorrido) para las diferencias de
 * medición entre el navegador y HarfBuzz (0,06 %–0,09 % medidos).
 */
export const TEXT_FIT_SAFETY_FACTOR = 0.99;

/**
 * El avance del texto por unidad de escala (unidades de diseño por unidad de
 * escala).
 *
 * @param measuredAdvance Avance medido del texto a la escala indicada.
 * @param scale La escala a la que se midió.
 */
export function advancePerScale(measuredAdvance: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(measuredAdvance)) return Infinity;
  return measuredAdvance / scale;
}

/**
 * La longitud máxima del recorrido para un radio y una escala dados
 * (unidades de diseño), con el margen de seguridad aplicado.
 */
export function pathLengthLimit(radius: number, scale: number): number {
  return (
    TEXT_FIT_SAFETY_FACTOR *
    2 *
    Math.PI *
    (radius - TEXT_PATH_INSET * scale)
  );
}

/**
 * ¿Entra el texto completo en el recorrido?
 *
 * @param advance Avance del texto a la escala indicada (unidades de diseño).
 */
export function textFitsPath(
  advance: number,
  radius: number,
  scale: number,
): boolean {
  return advance <= pathLengthLimit(radius, scale);
}

/**
 * La escala máxima con la que el texto entra completo en el recorrido.
 *
 * Forma cerrada (ver la cabecera): sin iteración, sin realimentación y
 * monotónica ⇒ el mismo conjunto de medidas da siempre el mismo resultado.
 *
 * @param advancePerUnitScale El avance por unidad de escala.
 * @param radius Radio del elemento (unidades de diseño).
 */
export function maxFittingScale(
  advancePerUnitScale: number,
  radius: number,
): number {
  if (!Number.isFinite(advancePerUnitScale)) return Infinity;
  const factor = TEXT_FIT_SAFETY_FACTOR;
  return (
    (factor * 2 * Math.PI * radius) /
    (advancePerUnitScale + factor * 2 * Math.PI * TEXT_PATH_INSET)
  );
}

/** El resultado de ajustar un texto al recorrido. */
export type TextFitResult = {
  /** La escala que hay que aplicar (siempre dentro de los límites dados). */
  scale: number;
  /**
   * `true` cuando el texto NO entra ni con la escala mínima: no hay ajuste
   * válido y la exportación debe bloquearse con `TEXT_DOES_NOT_FIT`.
   */
  doesNotFit: boolean;
  /** La escala máxima con la que entraría (sin recortar los límites). */
  maxScale: number;
};

/**
 * Ajusta la escala de un texto para que entre completo en el recorrido.
 *
 * - si el texto **cabe** a la escala pedida, no se cambia nada;
 * - si no cabe, se reduce **sólo** la escala, hasta el máximo que entra;
 * - si no entra ni con la escala mínima, se devuelve la escala mínima y
 *   `doesNotFit: true` (quien llama decide: el editor avisa y la
 *   exportación se bloquea).
 */
export function fitTextToPath(input: {
  /** Avance por unidad de escala (unidades de diseño por unidad de escala). */
  advancePerUnitScale: number;
  /** Radio del elemento (unidades de diseño). */
  radius: number;
  /** La escala que se quiere aplicar. */
  requestedScale: number;
  /** La escala mínima que admite el editor. */
  minScale: number;
  /** La escala máxima que admite el editor. */
  maxScale: number;
}): TextFitResult {
  const maxScale = maxFittingScale(input.advancePerUnitScale, input.radius);
  const requested = Math.min(
    input.maxScale,
    Math.max(input.minScale, input.requestedScale),
  );
  if (maxScale >= requested) {
    return { scale: requested, doesNotFit: false, maxScale };
  }
  if (maxScale < input.minScale) {
    // Ni con la escala mínima entra: no hay ajuste válido.
    return { scale: input.minScale, doesNotFit: true, maxScale };
  }
  return { scale: maxScale, doesNotFit: false, maxScale };
}
