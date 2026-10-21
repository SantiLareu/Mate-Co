import type { RenderableDesign } from "../admin-lab/types";
import type { ImportedGeometry } from "../admin-lab/importedGeometry";
import {
  ICON_CENTER,
  ICON_RADIUS,
  clampIconScaleAtRadius,
} from "../components/IconElement";

/**
 * Immutable approved-design instance model.
 *
 * Pose fields (angle/radius/scale/rotation/mirrored/inverted) match the
 * existing icon/graphic model and reuse its bounds: only the outer wrapper
 * transforms the asset as a unit. The `snapshot` detaches the
 * repository-validated `RenderableDesign` taken at creation time, keyed by
 * `approvedDesignId` identity — later admin update/delete/disable affects
 * only the future picker, never placed instances. No internal SVG editing,
 * flattening, or re-sanitization happens here.
 *
 * Copy policy (cheap immutability): v3 assets are multi-KB/MB strings and
 * strings are already immutable, so the snapshot is a shallow metadata copy
 * holding the SAME string reference — never a JSON deep clone of the bytes.
 * Only the mutable v1/v2 controlled trees (paths/nodes/bounds arrays) are
 * copied element-wise. The snapshot is frozen so later catalog object
 * reuse cannot mutate placed instances.
 */

export type ApprovedDesignSnapshot = RenderableDesign;

export type ApprovedDesignInstance = {
  id: string;
  type: "approved-design";
  approvedDesignId: string;
  snapshot: ApprovedDesignSnapshot;
  angle: number;
  radius: number;
  scale: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
};

export const APPROVED_CENTER = ICON_CENTER;
export const APPROVED_RADIUS = ICON_RADIUS;
export const approvedRadiusBounds = () => ICON_RADIUS;

export function normalizeApprovedDesign(
  instance: ApprovedDesignInstance,
): ApprovedDesignInstance {
  return {
    ...instance,
    scale: clampIconScaleAtRadius(instance.scale),
    radius: Math.max(
      ICON_RADIUS.min,
      Math.min(ICON_RADIUS.max, instance.radius),
    ),
  };
}

/** Longest side of the placed asset in mate SVG units. */
export const APPROVED_ART_SIZE = 64;

export function approvedDesignFromCatalog(
  design: RenderableDesign,
  angle: number,
): ApprovedDesignInstance {
  const snapshot = snapshotFromCatalog(design);
  return normalizeApprovedDesign({
    id: crypto.randomUUID(),
    type: "approved-design",
    approvedDesignId: design.id,
    snapshot,
    angle,
    radius: APPROVED_CENTER,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  });
}

function copyGeometry(geometry: ImportedGeometry): ImportedGeometry {
  return {
    ...geometry,
    paths: geometry.paths.map((path) => ({
      ...path,
      matrix: { ...path.matrix },
      style: { ...path.style, dasharray: [...path.style.dasharray] },
    })),
    nodes: geometry.nodes.map((node) =>
      node.kind === "group"
        ? { ...node, children: [...node.children] }
        : { ...node },
    ),
    centerlineBounds: { ...geometry.centerlineBounds },
    artBounds: { ...geometry.artBounds },
  };
}

function snapshotFromCatalog(design: RenderableDesign): ApprovedDesignSnapshot {
  if (design.version === 3) {
    const viewBox = design.viewBox
      ? Object.freeze({ ...design.viewBox })
      : null;
    return Object.freeze({ ...design, viewBox }) as ApprovedDesignSnapshot;
  }
  if (design.version === 2) {
    return Object.freeze({
      ...design,
      geometry: copyGeometry(design.geometry),
    }) as ApprovedDesignSnapshot;
  }
  return Object.freeze({
    ...design,
    paths: design.paths.map((path) => ({ ...path })),
    artBounds: { ...design.artBounds },
    geometry: copyGeometry(design.geometry),
  }) as ApprovedDesignSnapshot;
}

function sourceBox(snapshot: ApprovedDesignSnapshot): {
  width: number;
  height: number;
} {
  if (snapshot.version === 3) {
    const w =
      (snapshot.width ?? snapshot.viewBox?.width ?? 0) > 0
        ? (snapshot.width ?? snapshot.viewBox?.width ?? 0)
        : 0;
    const h =
      (snapshot.height ?? snapshot.viewBox?.height ?? 0) > 0
        ? (snapshot.height ?? snapshot.viewBox?.height ?? 0)
        : 0;
    if (w > 0 && h > 0) return { width: w, height: h };
    return { width: 1, height: 1 };
  }
  const bounds = snapshot.geometry.artBounds;
  return {
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

/** Display size preserving the source aspect (viewBox / art bounds). */
export function approvedDisplaySize(snapshot: ApprovedDesignSnapshot): {
  width: number;
  height: number;
} {
  const box = sourceBox(snapshot);
  const scale = APPROVED_ART_SIZE / Math.max(box.width, box.height);
  return { width: box.width * scale, height: box.height * scale };
}

export function approvedDisplayAspect(
  snapshot: ApprovedDesignSnapshot,
): string {
  const box = sourceBox(snapshot);
  return `${box.width} / ${box.height}`;
}

/**
 * Circumscribed radius of the FITTED asset (half its display diagonal) at
 * scale 1, in mate SVG units. Rotation, mirror and invert only spin or flip
 * the art inside its own circle, so the envelope is invariant under pose —
 * the knockout derived from it needs no rotation term. The legacy
 * 25*scale*sqrt2 constant described a 50-unit square icon core and
 * undersized real 64-unit art (square corners at 45.25, a 4:3 asset at 40).
 */
export function approvedEnvelopeRadius(
  snapshot: ApprovedDesignSnapshot,
): number {
  const size = approvedDisplaySize(snapshot);
  return Math.hypot(size.width, size.height) / 2;
}

/** Knockout halo: circumscribed envelope at scale plus conservative padding. */
export function approvedKnockoutRadius(
  snapshot: ApprovedDesignSnapshot,
  scale: number,
): number {
  return approvedEnvelopeRadius(snapshot) * scale + 4;
}
