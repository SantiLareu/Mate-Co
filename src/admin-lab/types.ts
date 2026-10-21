/** Controlled admin art in source user units; physical placement is a separate adapter. */
import type { ImportedGeometry } from "./importedGeometry";
import type { SvgAssetViewBox } from "./svgAssetImport";

export type ApprovedFillRule = "nonzero" | "evenodd";
export interface ApprovedPath {
  d: string;
  transform?: string;
}
export interface ArtBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DesignMetadata {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  createdAt: string;
}
/** Historical persisted shape. Original paths/transforms and global rule stay intact. */
export interface LegacyApprovedDesign extends DesignMetadata {
  version: 1;
  paths: ApprovedPath[];
  artBounds: ArtBounds;
  fillRule: ApprovedFillRule;
}
export interface ControlledApprovedDesign extends DesignMetadata {
  version: 2;
  geometry: ImportedGeometry;
}
/**
 * Sanitized full-SVG asset record. `svg` is canonical sanitizer output
 * (never trusted as stored: re-parsed + re-sanitized to a stable fixed
 * point on every read, with derived fields checked for consistency — no
 * byte-equality required; safety comes from re-sanitization);
 * width/height/viewBox mirror SvgAsset and must match the re-derived fields.
 */
export interface AssetApprovedDesign extends DesignMetadata {
  version: 3;
  svg: string;
  width: number | null;
  height: number | null;
  viewBox: SvgAssetViewBox | null;
}
export type ApprovedDesign =
  LegacyApprovedDesign | ControlledApprovedDesign | AssetApprovedDesign;
/**
 * Only repository-validated records enter UI state, including normalized v1
 * art. The union discriminates by `version`: v1/v2 project validated
 * `geometry`; v3 carries ONLY its sanitized asset (metadata + svg +
 * width/height/viewBox, no geometry key at runtime). Callers switch on
 * version to render: GeometryPreview for v1/v2, blob-URL <img> for v3.
 */
export type RenderableLegacyDesign = LegacyApprovedDesign & {
  geometry: ImportedGeometry;
};
export type RenderableControlledDesign = ControlledApprovedDesign & {
  geometry: ImportedGeometry;
};
export type RenderableAssetDesign = AssetApprovedDesign;
export type RenderableDesign =
  RenderableLegacyDesign | RenderableControlledDesign | RenderableAssetDesign;
