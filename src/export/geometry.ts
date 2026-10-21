/** Pure geometry for the production SVG exporter. No DOM, no React. */

export const EXPORT_CENTER = 450;

/**
 * Visual limits of the mate's virola (metal rim), in the same 900-unit space
 * as the editor preview. The outer edge is the rim circle and the inner edge
 * is the mouth of the mate; the engraving design lives on the ring between
 * them. Shared with MatePreview so the export matches what the user designed.
 */
export const VIROLA_OUTER_RADIUS = 423;
export const VIROLA_INNER_RADIUS = 292;

export type Box = { x: number; y: number; width: number; height: number };

/** Same polar convention as the editor: angle 0 points down (+y). */
export function polarPoint(angleDegrees: number, radius: number, center = EXPORT_CENTER) {
  const radians = (angleDegrees - 90) * Math.PI / 180;
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
}

export const normalizeAngle = (degrees: number) => ((degrees % 360) + 360) % 360;

export type AngularInterval = { start: number; end: number };

/** Split a possibly wrapping interval into non-wrapping [0, 360) pieces. */
export function splitWrappingInterval(start: number, end: number): AngularInterval[] {
  const length = end - start;
  if (length >= 360) return [{ start: 0, end: 360 }];
  if (length <= 0) return [];
  const from = normalizeAngle(start);
  const to = from + length;
  if (to <= 360) return [{ start: from, end: to }];
  return [{ start: from, end: 360 }, { start: 0, end: to - 360 }];
}

export function mergeIntervals(intervals: AngularInterval[]): AngularInterval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: AngularInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

export type KnockoutDisk = { angleDegrees: number; distance: number; radius: number };

/**
 * Angular span of a decorative circle (radius R around the center) covered by
 * knockout disks. Analytic circle-circle intersection; transversal here
 * because every disk sits on the rim far from the center.
 */
export function disksToCoveredIntervals(circleRadius: number, disks: KnockoutDisk[]): AngularInterval[] {
  const covered: AngularInterval[] = [];
  for (const disk of disks) {
    const { distance, radius } = disk;
    if (distance <= 0) {
      if (radius >= circleRadius) covered.push({ start: 0, end: 360 });
      continue;
    }
    if (distance + radius <= circleRadius || distance >= circleRadius + radius) continue;
    if (radius >= distance + circleRadius) {
      covered.push({ start: 0, end: 360 });
      continue;
    }
    const cosHalf = (circleRadius ** 2 + distance ** 2 - radius ** 2) / (2 * circleRadius * distance);
    const half = Math.acos(Math.min(1, Math.max(-1, cosHalf))) * 180 / Math.PI;
    covered.push(...splitWrappingInterval(disk.angleDegrees - half, disk.angleDegrees + half));
  }
  return mergeIntervals(covered);
}

export type TextKnockoutBand = {
  /** Radial center of the editor's knockout stroke. */
  radius: number;
  /** Half of the editor's knockout stroke width, plus the line half-width. */
  halfWidth: number;
  /** Angular half-span of the text, in the editor's arc parametrization. */
  halfSpanDegrees: number;
  /** Element rotation applied on top of the unrotated arc. */
  angleOffsetDegrees: number;
};

/**
 * Text knockout bands behave as arc sectors centered at standard angle 270°
 * (top of the circle), where startOffset="50%" places the glyphs.
 */
export function bandToCoveredInterval(circleRadius: number, band: TextKnockoutBand): AngularInterval[] {
  if (Math.abs(circleRadius - band.radius) > band.halfWidth) return [];
  return splitWrappingInterval(
    270 - band.halfSpanDegrees + band.angleOffsetDegrees,
    270 + band.halfSpanDegrees + band.angleOffsetDegrees,
  );
}

/** Complement of the covered spans: the visible arc segments of a full circle. */
export function uncoveredArcs(covered: AngularInterval[]): AngularInterval[] {
  const merged = mergeIntervals(covered);
  if (!merged.length) return [{ start: 0, end: 360 }];
  if (merged[0].start <= 0 && merged[0].end >= 360) return [];
  const open: AngularInterval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start > cursor) open.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < 360) open.push({ start: cursor, end: 360 });
  return open;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Arc segment of a circle around the center, from standard-angle start to end. */
export function arcPath(circleRadius: number, start: number, end: number, center = EXPORT_CENTER) {
  const from = polarPoint(start + 90, circleRadius, center);
  const to = polarPoint(end + 90, circleRadius, center);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M${round2(from.x)} ${round2(from.y)} A${round2(circleRadius)} ${round2(circleRadius)} 0 ${largeArc} 1 ${round2(to.x)} ${round2(to.y)}`;
}

export type CircularLinesMode = 'none' | 'single' | 'double';

export const lineRadiiForMode = (mode: CircularLinesMode) =>
  mode === 'single' ? [357] : mode === 'double' ? [347, 367] : [];

export function unionBoxes(boxes: Box[]): Box | null {
  let union: Box | null = null;
  for (const box of boxes) {
    if (!(box.width > 0 && box.height > 0)) continue;
    union = union
      ? {
        x: Math.min(union.x, box.x),
        y: Math.min(union.y, box.y),
        width: Math.max(union.x + union.width, box.x + box.width) - Math.min(union.x, box.x),
        height: Math.max(union.y + union.height, box.y + box.height) - Math.min(union.y, box.y),
      }
      : { ...box };
  }
  return union;
}

/** Rotate a box around the center by standard degrees; returns the new AABB. */
export function rotateBox(box: Box, angleDegrees: number, center = EXPORT_CENTER) {
  const radians = angleDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map(({ x, y }) => {
    const dx = x - center;
    const dy = y - center;
    return { x: center + dx * cos - dy * sin, y: center + dy * cos + dx * sin };
  });
  const xs = corners.map(corner => corner.x);
  const ys = corners.map(corner => corner.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}
