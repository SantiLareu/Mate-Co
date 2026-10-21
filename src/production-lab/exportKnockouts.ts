/**
 * E1 line-knockout conversion (Stage 3 S5). Pure, sync, DOM-free.
 *
 * Converts PhysicalReport LineKnockout[] descriptors into the covered
 * angular intervals of each decorative ring using the SAME
 * src/export/geometry.ts helpers productionSvg.ts uses (center = 0, mm
 * units), then complements them into explicit interrupted-arc segments.
 *
 * Angle conventions (verified against export/geometry + productionSvg):
 * - Helper arc coordinates: designAngle = arcCoord + 90 (mod 360), i.e.
 *   arc 270 = TOP = design 0, where startOffset="50%" places glyphs.
 * - Icon/approved disk: design angle theta satisfies
 *   (theta - 90) = atan2(y, x) under the lab polar convention
 *   (x = r*cos(theta-90), y = r*sin(theta-90)), so
 *   angleDegrees = normalize(atan2(y,x)*180/pi) = theta - 90 (mod 360),
 *   exactly the productionSvg `icon.angle - 90` form.
 * - Text band: covered center must sit at design theta, i.e.
 *   270 + offset = theta - 90 (mod 360), so
 *   angleOffsetDegrees = normalize(theta), exactly the productionSvg
 *   `angleOffsetDegrees: element.angle` form. radius = anchorRadiusMm and
 *   halfWidth = strokeWidthMm/2 + 1*sizeFactor mirror the productionSvg
 *   `(35*scale+10)/2 + 1` source-unit rule converted with the frame's
 *   per-strategy sizeFactor.
 *
 * Round-cap delta (documented, NOT silently fixed): the lab preview mask
 * paints knockouts with round caps/round disks, while these helpers emit
 * butt-end arc segments ending exactly at the uncovered boundaries. A
 * round-cap machine pass would over-paint ~strokeWidthMm/2 past each end;
 * the export keeps the analytic boundary so the file states exact geometry.
 */
import {
  arcPath,
  bandToCoveredInterval,
  disksToCoveredIntervals,
  mergeIntervals,
  normalizeAngle,
  uncoveredArcs,
  type AngularInterval,
  type KnockoutDisk,
  type TextKnockoutBand,
} from "../export/geometry";
import type { LineKnockout, PlacedCircularLine } from "./types";

/** Disk descriptor from a placed mm center (physical origin = center 0). */
export function knockoutDiskFor(
  center: { x: number; y: number },
  radiusMm: number,
): KnockoutDisk {
  return {
    angleDegrees: normalizeAngle(
      (Math.atan2(center.y, center.x) * 180) / Math.PI,
    ),
    distance: Math.hypot(center.x, center.y),
    radius: radiusMm,
  };
}

/**
 * Band descriptor from a text-band knockout. The trailing `1 * sizeFactor`
 * is the line half-width (source stroke 2 / 2) in mm, mirroring the
 * productionSvg `+ 1` term.
 */
export function knockoutBandFor(
  knockout: Extract<LineKnockout, { kind: "text-band" }>,
  sizeFactor: number,
): TextKnockoutBand {
  return {
    radius: knockout.anchorRadiusMm,
    halfWidth: knockout.strokeWidthMm / 2 + 1 * sizeFactor,
    halfSpanDegrees: knockout.halfSpanDegrees,
    angleOffsetDegrees: normalizeAngle(knockout.angle),
  };
}

export type LabLineEngraving = {
  lineId: string;
  sourceRadius: number;
  radiusMm: number;
  strokeWidthMm: number;
  /** True when the ring survives whole (single full-circle segment). */
  full: boolean;
  /** Uncovered angular spans in helper arc coordinates (deterministic order). */
  spans: AngularInterval[];
  /** Explicit arcPath serializations (center 0), one per span. */
  paths: string[];
};

/**
 * Partitioned knockout descriptors for one export pass. Bands stay empty
 * while texts block (fonts-block-gate); a future outline stage feeds real
 * bands through this same converter without touching the core.
 */
export function splitLineKnockouts(
  knockouts: readonly LineKnockout[],
  sizeFactor: number,
): { disks: KnockoutDisk[]; bands: TextKnockoutBand[] } {
  const disks: KnockoutDisk[] = [];
  const bands: TextKnockoutBand[] = [];
  for (const knockout of knockouts) {
    if (knockout.kind === "text-band") {
      bands.push(knockoutBandFor(knockout, sizeFactor));
    } else {
      disks.push(knockoutDiskFor(knockout.center, knockout.radiusMm));
    }
  }
  return { disks, bands };
}

/**
 * Explicit interrupted-arc geometry of one decorative ring. Empty spans
 * (fully covered ring) yield no paths; a full circle yields full: true and
 * the caller emits a <circle> instead of a 360-degree arc path.
 */
export function lineEngravingSegments(
  line: PlacedCircularLine,
  disks: KnockoutDisk[],
  bands: TextKnockoutBand[],
): LabLineEngraving {
  const base = {
    lineId: line.id,
    sourceRadius: line.sourceRadius,
    radiusMm: line.radiusMm,
    strokeWidthMm: line.strokeWidthMm,
  };
  const covered = mergeIntervals([
    ...disksToCoveredIntervals(line.radiusMm, disks),
    ...bands.flatMap((band) => bandToCoveredInterval(line.radiusMm, band)),
  ]);
  const open = uncoveredArcs(covered);
  if (open.length === 0) return { ...base, full: false, spans: [], paths: [] };
  if (open.length === 1 && open[0].start <= 0 && open[0].end >= 360) {
    return { ...base, full: true, spans: open, paths: [] };
  }
  return {
    ...base,
    full: false,
    spans: open,
    paths: open.map((span) => arcPath(line.radiusMm, span.start, span.end, 0)),
  };
}
