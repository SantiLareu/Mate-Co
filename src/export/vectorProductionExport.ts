/**
 * Camino de exportación VECTORIAL del cliente — **EXPERIMENTAL** (E3.1).
 *
 * QUÉ ES
 *   El pre-flight del camino vectorial y el trazador que reutiliza su
 *   composición. El motor (HarfBuzz) y el adaptador (`./vectorTextOutlines`)
 *   NO se duplican: aquí sólo se eligen y se orchestran.
 *
 * POR QUÉ ES EXPERIMENTAL
 *   El SVG vectorial cambia los bytes del archivo del cliente (contornos
 *   exactos en lugar de un trazado de mapa de bits) y todavía no está
 *   validado con el grabador real (E5). Por eso:
 *     - el modo predeterminado sigue siendo `raster` (VTracer), **igual que
 *       hasta ahora** (ver `./clientTextExportMode`);
 *     - la opción `vector` es **interna**: constante interna y, en desarrollo,
 *       parámetro de URL (`?textExport=vector`). El build de producción no
 *       ofrece ninguna vía técnica al cliente final;
 *     - **no hay fallback automático**: si el camino vectorial falla, la
 *       exportación falla con su código explícito. Nunca se cae al raster
 *       en silencio (VTracer es reversión *explícita*, no una reserva).
 *
 * PRE-FLIGHT (sólo en el camino vectorial)
 *   Antes de generar el SVG se comprueba, con los mismos criterios que usa
 *   el motor:
 *     1. la familia de tipografías está en el catálogo aprobado;
 *     2. el motor de HarfBuzz está disponible;
 *     3. el texto se compone (glifos admitidos, NFC compatible);
 *     4. los errores son accionables (código + mensaje en español).
 *
 *   La composición se **reutiliza** en la exportación: no se ejecuta dos
 *   veces una conversión completa.
 *
 * ATOMICIDAD
 *   `buildVectorProductionSvg` propaga el fallo del pre-flight **antes** de
 *   generar el SVG: si algo falla, no existe archivo (el flujo de descarga
 *   sólo escribe cuando recibe el SVG completo).
 *
 * CARGA
 *   Este módulo se importa **bajo demanda** (`import()`) desde la interfaz:
 *   el motor vectorial no debe entrar en el bundle inicial del cliente.
 */
import type { TextElement } from "../components/CurvedText";
import { warmUpTypography } from "../typography";
import {
  buildProductionSvg,
  type ProductionDesignState,
  type TraceTextFn,
} from "./productionSvg";
import {
  buildVectorTrace,
  composeVectorText,
  type ComposedVectorText,
  type VectorTextTraceRequest,
} from "./vectorTextOutlines";

/** El fallo del pre-flight: un código y un mensaje accionable. */
export type VectorPreflightFailure = {
  ok: false;
  code: string;
  message: string;
};

export type VectorExportPlan =
  | { ok: true; traceText: TraceTextFn; checked: number }
  | VectorPreflightFailure;

/** Clave de una petición de traza (para reutilizar la composición). */
function requestKey(request: VectorTextTraceRequest): string {
  return [
    request.text,
    request.fontFamily,
    request.scale,
    request.radius,
    request.inverted,
  ].join("");
}

/**
 * Pre-flight del camino vectorial.
 *
 * Compone cada texto **una sola vez** y devuelve el trazador que reutiliza
 * esa composición: la exportación no vuelve a componer.
 */
export async function planVectorExport(
  texts: readonly TextElement[],
): Promise<VectorExportPlan> {
  // 1. El motor tiene que estar disponible (una sola carga del WASM).
  try {
    await warmUpTypography();
  } catch (error) {
    return {
      ok: false,
      code: "SHAPER_UNAVAILABLE",
      message: `El motor tipográfico no está disponible: ${(error as Error).message}`,
    };
  }

  // 2. Cada texto: catálogo, glifos admitidos y NFC compatible.
  const composed = new Map<string, ComposedVectorText>();
  for (const element of texts) {
    if (!element.text.trim()) continue; // sin contenido dibujable
    const request: VectorTextTraceRequest = {
      text: element.text,
      fontFamily: element.fontFamily,
      scale: element.scale ?? 1,
      radius: element.radius,
      inverted: element.inverted,
    };
    const result = await composeVectorText(request);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: `No se puede exportar el texto «${element.text}»: ${result.message}`,
      };
    }
    composed.set(requestKey(request), result);
  }

  // 3. El trazador reutiliza la composición del pre-flight.
  const traceText: TraceTextFn = async (request) => {
    const cached = composed.get(requestKey(request));
    const result = cached ?? (await composeVectorText(request));
    if (!result.ok) {
      // Sin pre-flight (o con otro texto): fallo explícito, nunca raster.
      throw new Error(`${result.code}: ${result.message}`);
    }
    return buildVectorTrace(result);
  };

  return { ok: true, traceText, checked: composed.size };
}

/**
 * Genera el SVG del cliente con el camino experimental vectorial.
 *
 * Lanza con un error accionable si el pre-flight falla; en ese caso **no**
 * se genera ningún SVG (y por tanto no se descarga nada).
 */
export async function buildVectorProductionSvg(
  state: ProductionDesignState,
): Promise<string> {
  const plan = await planVectorExport(state.texts);
  if (!plan.ok) {
    throw new Error(`${plan.code}: ${plan.message}`);
  }
  return await buildProductionSvg(state, plan.traceText);
}
