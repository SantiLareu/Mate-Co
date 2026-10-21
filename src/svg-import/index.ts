/**
 * API pública del importador aislado de SVG (laboratorio).
 *
 * Camino futuro previsto:
 * `.svg` → `parseSvgImport()` → representación vectorial segura →
 * adaptador a `UploadedGraphicElement` → drag/scale/rotate del editor →
 * exportador SVG de producción. La integración NO está implementada.
 */
export { parseSvgImport } from './parseSvgImport';
export { SVG_IMPORT_LIMITS } from './limits';
export {
  IDENTITY_MATRIX,
  applyMatrix,
  isIdentityMatrix,
  multiplyMatrices,
  parseTransformList,
  serializeMatrix,
  type SvgMatrix,
} from './transforms';
export {
  circleToPath,
  ellipseToPath,
  lineToPath,
  polylineToPath,
  readLength,
  rectToPath,
} from './geometry';
export {
  boundsOfPoints,
  flattenPathData,
  pathDataBounds,
  transformedPathBounds,
  unionBoxes,
  type FlatPoint,
} from './measure';
export { buildOriginalPreviewUrl, buildSanitizedOriginalMarkup, revokePreviewUrl } from './safeRender';
export type {
  SvgImportBox,
  SvgImportDiagnostics,
  SvgImportError,
  SvgImportErrorCode,
  SvgImportOutcome,
  SvgImportPath,
  SvgImportResult,
  SvgImportViewBox,
  SvgPrimitiveKind,
} from './types';
