/**
 * Límites defensivos del importador de SVG (laboratorio V1).
 *
 * Criterio: lo bastante altos para aceptar archivos reales de PicSVG
 * (fixtures de ~939 y ~408 paths con coordenadas grandes), lo bastante
 * bajos para que un archivo hostil no cuelgue la pestaña.
 *
 * | Límite              | Valor      | Motivo                                    |
 * |---------------------|------------|-------------------------------------------|
 * | MAX_FILE_CHARS      | 8.000.000  | ~8 MB de texto (≈ bytes en SVG ASCII)     |
 * | MAX_ELEMENT_NODES   | 30.000     | fixtures reales usan ~1.000               |
 * | MAX_PATHS           | 5.000      | fixture mayor: ~939 paths (margen ×5)     |
 * | MAX_GROUP_DEPTH     | 32         | anidamiento real típico: 2–4              |
 * | MAX_TRANSFORM_CHARS | 2.000      | una lista de transforms sana mide < 200   |
 * | MAX_D_CHARS         | 1.000.000  | un `d` individual no debería acercarse    |
 */
export const SVG_IMPORT_LIMITS = {
  MAX_FILE_CHARS: 8_000_000,
  MAX_ELEMENT_NODES: 30_000,
  MAX_PATHS: 5_000,
  MAX_GROUP_DEPTH: 32,
  MAX_TRANSFORM_CHARS: 2_000,
  MAX_D_CHARS: 1_000_000,
} as const;
