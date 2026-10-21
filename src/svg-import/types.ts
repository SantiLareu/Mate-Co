/**
 * Tipos públicos del importador aislado de SVG (laboratorio).
 *
 * Este módulo NO depende del pipeline raster (máscaras, estrategias, VTracer).
 * La salida es una estructura de datos propia: nunca se conserva un DOM SVG
 * arbitrario ejecutable.
 */

export type SvgImportBox = { x: number; y: number; width: number; height: number };

export type SvgImportViewBox = { x: number; y: number; width: number; height: number };

/** Geometría normalizada lista para usar. `transform` es una matriz 2D
 *  compuesta `matrix(a b c d e f)` o ausente cuando es identidad. */
export type SvgImportPath = { d: string; transform?: string };

export type SvgPrimitiveKind = 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon';

export type SvgImportDiagnostics = {
  sourceChars: number;
  viewBox: SvgImportViewBox;
  /** Ancho/alto declarados en px (o derivados del viewBox cuando no se declaran). */
  widthPx: number;
  heightPx: number;
  pathCount: number;
  /** Conteo por primitiva de origen (antes de convertir a path). */
  primitiveCounts: Record<SvgPrimitiveKind | 'g', number>;
  /** Funciones de transform encontradas (translate, scale, rotate, matrix, ...). */
  transformsUsed: string[];
  transformedElementCount: number;
  /** Fills/strokes/fill-rules originales resueltos con herencia (minúsculas). */
  fills: string[];
  strokes: string[];
  fillRules: string[];
  /** Opacidades distintas encontradas; el normalizado se aplana a opaco (grabado). */
  opacities: number[];
  opacityFlattened: boolean;
  hasRaster: boolean;
  hasText: boolean;
  hasExternalRefs: boolean;
  skippedInvisibleCount: number;
  ignoredDefsCount: number;
  normalizedBoundingBox: SvgImportBox;
  warnings: string[];
};

export type SvgImportResult = {
  /** Geometría normalizada: `d` originales intactos + transforms compuestos. */
  paths: SvgImportPath[];
  viewBox: SvgImportViewBox;
  widthPx: number;
  heightPx: number;
  pathCount: number;
  normalizedBoundingBox: SvgImportBox;
  diagnostics: SvgImportDiagnostics;
};

/** Códigos de rechazo estables (útiles para tests e integración futura). */
export type SvgImportErrorCode =
  | 'EMPTY'
  | 'FILE_TOO_LARGE'
  | 'MALFORMED'
  | 'UNSAFE_DOCTYPE'
  | 'NOT_SVG'
  | 'INVALID_DIMENSIONS'
  | 'CONTAINS_SCRIPT'
  | 'CONTAINS_FOREIGN_OBJECT'
  | 'CONTAINS_ACTIVE_CONTENT'
  | 'CONTAINS_EVENT_HANDLER'
  | 'CONTAINS_RASTER_IMAGE'
  | 'CONTAINS_LIVE_TEXT'
  | 'EXTERNAL_REFERENCE'
  | 'UNSUPPORTED_ELEMENT'
  | 'UNSUPPORTED_USE'
  | 'UNSUPPORTED_STYLE'
  | 'UNSUPPORTED_PAINT_SERVER'
  | 'UNSUPPORTED_PERCENTAGE'
  | 'CONTAINS_VISIBLE_STROKE'
  | 'INVALID_TRANSFORM'
  | 'INVALID_GEOMETRY'
  | 'TOO_MANY_NODES'
  | 'TOO_MANY_PATHS'
  | 'GROUP_DEPTH_EXCEEDED'
  | 'NO_GEOMETRY';

export type SvgImportError = { code: SvgImportErrorCode; message: string };

export type SvgImportOutcome = { ok: true; result: SvgImportResult } | { ok: false; error: SvgImportError };
