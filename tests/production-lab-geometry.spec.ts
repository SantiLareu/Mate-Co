import { expect, test } from "@playwright/test";
import {
  ICON_SOURCE,
  SOURCE_BAND_WIDTH,
  SOURCE_CENTER,
  SOURCE_INNER_RADIUS,
  SOURCE_LINE_RADII,
  SOURCE_LINE_STROKE_WIDTH,
  SOURCE_OUTER_RADIUS,
  SOURCE_TEXT,
  createPhysicalFrame,
  clearanceFor,
  iconConservativeEnvelopeMm,
  iconKnockoutRadiusMm,
  mapAngleToPoint,
  mapSourceRadius,
  placeApproved,
  placeCircularLines,
  placeIcon,
  resolveText,
  scaleToPhysical,
  textArcPathMm,
  textHalfSpanDegrees,
  buildPhysicalReport,
  serializeReport,
} from "../src/production-lab/geometry";
import { createProductionLabFixture } from "../src/production-lab/fixture";
import {
  approvedEnvelopeRadius,
  approvedKnockoutRadius,
} from "../src/approved-designs/approvedDesign";
import type { ApprovedDesignInstance } from "../src/approved-designs/approvedDesign";
import type { DesignIcon } from "../src/components/IconElement";
import type { TextElement } from "../src/components/CurvedText";

/**
 * P1 pure-foundation specs (S1–S8 geometry decision: scale by OUTER diameter).
 * All expected numbers are hand-computed literals (node calculator), never
 * derived by calling the implementation under test. Precision 9 assertions
 * cover float roundoff only — no fabrication tolerance is introduced.
 *
 * Reference case used across tests: Do = 100 mm, Di = 60 mm, so
 * Ro = 50, Ri = 30, positionSlope = 20/131, sizeFactor = 50/423.
 */

import { lineRadiiForMode } from "../src/export/geometry";
import { parseTransformList } from "../src/svg-import/transforms";
import { measureControlledPaths } from "../src/admin-lab/geometry";
import type { ControlledStyle } from "../src/admin-lab/importedGeometry";
import { icons } from "../src/data/icons";
import { clampTextRadius, clampTextScale } from "../src/components/CurvedText";
import {
  ICON_RADIUS,
  clampIconScaleAtRadius,
} from "../src/components/IconElement";

const frameOrThrow = (outerDiameter: number, innerDiameter: number) => {
  const result = createPhysicalFrame(outerDiameter, innerDiameter);
  if (!result.ok)
    throw new Error(`fixture frame rejected: ${JSON.stringify(result.issues)}`);
  return result.frame;
};

test("source reference constants match the editor/export baseline", () => {
  expect(SOURCE_CENTER).toBe(450);
  expect(SOURCE_INNER_RADIUS).toBe(292);
  expect(SOURCE_OUTER_RADIUS).toBe(423);
  expect(SOURCE_BAND_WIDTH).toBe(131);
  expect(SOURCE_TEXT.fontSize).toBe(35);
  expect(SOURCE_TEXT.letterSpacing).toBe(2);
  expect(SOURCE_TEXT.invertedDy).toBe(26);
  expect(SOURCE_TEXT.baselineOffset).toBe(14);
  expect(SOURCE_LINE_STROKE_WIDTH).toBe(2);
  expect(ICON_SOURCE.artSize).toBe(32);
  expect(ICON_SOURCE.fitScale).toBe(1.4);
  expect(ICON_SOURCE.strokeWidth).toBe(1.7);
});

test("both diameters map exactly to the physical ring boundaries", () => {
  const frame = frameOrThrow(100, 60);
  expect(frame.outerRadius).toBe(50);
  expect(frame.innerRadius).toBe(30);
  expect(frame.positionSlope).toBeCloseTo(0.152671755725191, 9);
  expect(frame.sizeFactor).toBeCloseTo(0.118203309692671, 9);
  // BOTH reference radii exact: inner source maps to Ri, outer source to Ro.
  expect(mapSourceRadius(292, frame)).toBe(30);
  expect(mapSourceRadius(423, frame)).toBe(50);
  // Interior anchors extrapolate linearly, no legacy 305..410 clamping.
  expect(mapSourceRadius(357, frame)).toBeCloseTo(39.9236641221374, 9);
  expect(mapSourceRadius(347, frame)).toBeCloseTo(38.3969465648855, 9);
  expect(mapSourceRadius(367, frame)).toBeCloseTo(41.4503816793893, 9);
  expect(mapSourceRadius(500, frame)).toBeCloseTo(61.7557251908397, 9);
});

test("cardinal angles follow angle-0-TOP clockwise y-down", () => {
  const frame = frameOrThrow(100, 60);
  const radius = 39.9236641221374; // hand-computed mapRadius(357)
  const top = mapAngleToPoint(0, 357, frame);
  expect(top.x).toBeCloseTo(0, 9);
  expect(top.y).toBeCloseTo(-radius, 9);
  const right = mapAngleToPoint(90, 357, frame);
  expect(right.x).toBeCloseTo(radius, 9);
  expect(right.y).toBeCloseTo(0, 9);
  const bottom = mapAngleToPoint(180, 357, frame);
  expect(bottom.x).toBeCloseTo(0, 9);
  expect(bottom.y).toBeCloseTo(radius, 9);
  const left = mapAngleToPoint(270, 357, frame);
  expect(left.x).toBeCloseTo(-radius, 9);
  expect(left.y).toBeCloseTo(0, 9);
});

test("icon pose is preserved and local scale is uniform outer-diameter size", () => {
  const frame = frameOrThrow(100, 60);
  const icon: DesignIcon = {
    id: "icon-pose",
    type: "icon",
    iconId: "spark",
    angle: 90,
    radius: 360,
    scale: 2,
    rotation: 30,
    mirrored: true,
    inverted: true,
  };
  const placed = placeIcon(icon, frame);
  // Center on +x axis at the mapped anchor radius.
  expect(placed.center.x).toBeCloseTo(40.381679389313, 9);
  expect(placed.center.y).toBeCloseTo(0, 9);
  expect(placed.centerRadiusMm).toBeCloseTo(40.381679389313, 9);
  // Uniform local scale: source scale * sizeFactor; pose untouched.
  expect(placed.localScale).toBeCloseTo(2 * 0.118203309692671, 9);
  expect(placed.localScaleX).toBeCloseTo(placed.localScale, 12);
  expect(placed.localScaleY).toBeCloseTo(placed.localScale, 12);
  expect(placed.rotation).toBe(30);
  expect(placed.mirrored).toBe(true);
  expect(placed.inverted).toBe(true);
  // Conservative envelope is viewport + stroke math, NOT the +4 UI halo.
  expect(iconConservativeEnvelopeMm(1, frame)).toBeCloseTo(3.88515174907297, 9);
  expect(placed.envelopeMm).toBeCloseTo(2 * 3.88515174907297, 9);
  expect(placed.envelopeProvenance).toMatch(/conservative/);
});

test("text parameters remap with the baseline-offset slope distinction", () => {
  const frame = frameOrThrow(100, 60);
  const element: TextElement = {
    id: "text-a",
    text: "Hola",
    fontFamily: "Georgia",
    angle: 0,
    radius: 374,
    inverted: false,
  };
  const placed = resolveText(element, frame, {
    lengthMm: 120,
    provenance: "browser-getComputedTextLength",
  });
  expect(placed.anchorRadiusMm).toBeCloseTo(42.5190839694656, 9);
  // baseR = anchorR - 14*scale*sizeFactor, NOT mapRadius(radius - 14*scale).
  expect(placed.baselineRadiusMm).toBeCloseTo(40.8642376337682, 9);
  expect(placed.fontSizeMm).toBeCloseTo(4.1371158392435, 9);
  expect(placed.letterSpacingMm).toBeCloseTo(0.236406619385343, 9);
  expect(placed.invertedDyMm).toBeNull();
  expect(placed.sweep).toBe(1);
  // Span padding is 14 SOURCE units converted to mm (14*sizeFactor), never
  // the raw 14 mixed with mm and never scaled by element scale: the source
  // editor computes (length/2 + 14)/radius independent of text scale, while
  // the baseline offset IS scaled (14*scale). Independent node recomputation
  // for lengthMm=120: (60 + 700/423)/42.5190839694656*180/pi = 83.0818...
  expect(textHalfSpanDegrees(120, 42.5190839694656, frame)).toBeCloseTo(
    83.0818106076777,
    9,
  );
  expect(placed.halfSpanDegrees).toBeCloseTo(83.0818106076777, 9);
  expect(placed.spanClamped).toBe(false);
  // Parent-independent case: 400 source units at r374 measure 47.2813... mm.
  expect(
    textHalfSpanDegrees(47.28132387706856, 42.5190839694656, frame),
  ).toBeCloseTo(34.08647904532789, 9);
  // Non-unit scale moves the baseline but NOT the span padding.
  const scaled = resolveText({ ...element, scale: 2 }, frame, {
    lengthMm: 120,
    provenance: "browser-getComputedTextLength",
  });
  expect(scaled.baselineRadiusMm).toBeCloseTo(39.20939129807085, 9);
  expect(scaled.halfSpanDegrees).toBeCloseTo(83.0818106076777, 9);
  // Half-span clamps mirror the source editor (7..135), never a shop threshold.
  expect(textHalfSpanDegrees(0.001, 10000, frame)).toBe(7);
  expect(textHalfSpanDegrees(100000, 42.5190839694656, frame)).toBe(135);
  // Inverted text carries the dy offset and flipped sweep.
  const inverted = resolveText({ ...element, inverted: true }, frame, {
    lengthMm: 120,
    provenance: "browser-getComputedTextLength",
  });
  expect(inverted.invertedDyMm).toBeCloseTo(3.07328605200946, 9);
  expect(inverted.sweep).toBe(0);
});

test("text arc helper emits full-circle mm render commands", () => {
  const path = textArcPathMm(40.8642376337682, 90, false);
  expect(path).toContain("M0 40.8642");
  expect(path).toContain("A40.8642 40.8642");
  expect(path.match(/A40\.8642 40\.8642 0 0 1/g)).toHaveLength(2);
  const inverted = textArcPathMm(40.8642376337682, 90, true);
  expect(inverted.match(/A40\.8642 40\.8642 0 0 0/g)).toHaveLength(2);
});

test("approved snapshot keeps identity, fit-64 metadata and internal pose", () => {
  const frame = frameOrThrow(100, 60);
  const snapshot = {
    version: 3 as const,
    id: "design-1",
    name: "Guarda",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 100,
    height: 50,
    viewBox: { x: 0, y: 0, width: 100, height: 50 },
  };
  const instance: ApprovedDesignInstance = {
    id: "approved-1",
    type: "approved-design",
    approvedDesignId: "design-1",
    snapshot,
    angle: 270,
    radius: 360,
    scale: 1,
    rotation: -15,
    mirrored: true,
    inverted: false,
  };
  const placed = placeApproved(instance, frame);
  // Identity retained: same snapshot reference, existing fit-64 metadata reused.
  expect(placed.snapshot).toBe(snapshot);
  expect(approvedEnvelopeRadius(snapshot)).toBeCloseTo(35.7770876399966, 9);
  expect(placed.envelopeMm).toBeCloseTo(4.22897017021237, 9);
  expect(placed.envelopeProvenance).toMatch(/viewport/);
  expect(placed.displaySizeMm.width).toBeCloseTo(64 * 0.118203309692671, 9);
  expect(placed.displaySizeMm.height).toBeCloseTo(32 * 0.118203309692671, 9);
  // Center on -x axis; internal pose preserved, uniform scale.
  expect(placed.center.x).toBeCloseTo(-40.381679389313, 9);
  expect(placed.center.y).toBeCloseTo(0, 9);
  expect(placed.localScale).toBeCloseTo(0.118203309692671, 9);
  expect(placed.rotation).toBe(-15);
  expect(placed.mirrored).toBe(true);
  expect(placed.inverted).toBe(false);
});

test("circular lines map source radii with scaled stroke", () => {
  const frame = frameOrThrow(100, 60);
  const single = placeCircularLines("single", frame);
  expect(single).toHaveLength(1);
  expect(single[0].sourceRadius).toBe(357);
  expect(single[0].radiusMm).toBeCloseTo(39.9236641221374, 9);
  expect(single[0].strokeWidthMm).toBeCloseTo(2 * 0.118203309692671, 9);
  const double = placeCircularLines("double", frame);
  expect(double.map((line) => line.sourceRadius)).toEqual([347, 367]);
  expect(double[0].radiusMm).toBeCloseTo(38.3969465648855, 9);
  expect(double[1].radiusMm).toBeCloseTo(41.4503816793893, 9);
  expect(placeCircularLines("none", frame)).toEqual([]);
});

test("very thin band keeps distinct slopes and reports spill without shrinking", () => {
  const frame = frameOrThrow(100, 96);
  expect(frame.positionSlope).toBeCloseTo(0.0152671755725191, 9);
  // sizeFactor still follows the OUTER diameter only.
  expect(frame.sizeFactor).toBeCloseTo(0.118203309692671, 9);
  const icon: DesignIcon = {
    id: "thin-icon",
    type: "icon",
    iconId: "spark",
    angle: 0,
    radius: 360,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  };
  const placed = placeIcon(icon, frame);
  expect(placed.centerRadiusMm).toBeCloseTo(49.0381679389313, 9);
  expect(placed.localScale).toBeCloseTo(0.118203309692671, 9);
  const clearance = clearanceFor(
    placed.centerRadiusMm,
    placed.envelopeMm,
    frame,
  );
  expect(clearance.outerSignedMm).toBeCloseTo(-2.92331968800426, 9);
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 96,
    texts: [],
    icons: [icon],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("thin-band report rejected");
  expect(
    report.report.warnings.some(
      (warning) =>
        warning.kind === "boundary-spill" && warning.elementId === "thin-icon",
    ),
  ).toBe(true);
  // No remedial fit: the placed scale is unchanged by the spill.
  expect(report.report.icons[0].localScale).toBeCloseTo(0.118203309692671, 9);
});

test("center outside the ring is definitely-outside, not envelope-may-cross", () => {
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [
      {
        id: "far-icon",
        type: "icon",
        iconId: "spark",
        angle: 0,
        radius: 500,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("outside report rejected");
  const warning = report.report.warnings.find(
    (entry) => entry.elementId === "far-icon",
  );
  expect(warning?.kind).toBe("definitely-outside");
});

test("nonpositive baseline radius is an explicit geometry problem", () => {
  // scale 30 is finite but far above the editor clamp (max 3): the lab must
  // NOT auto-clamp it — the defensive branch reports and leaves the input
  // untouched, never inventing a path.
  const frame = frameOrThrow(100, 60);
  const element: TextElement = {
    id: "tiny-text",
    text: "Hola",
    fontFamily: "Georgia",
    angle: 0,
    radius: 305,
    inverted: false,
    scale: 30,
  };
  const before = JSON.stringify(element);
  const placed = resolveText(element, frame, {
    lengthMm: 1,
    provenance: "browser-getComputedTextLength",
  });
  // anchor(305) = 31.98473282442748; baseline = anchor - 14*30*sizeFactor < 0.
  expect(placed.anchorRadiusMm).toBeCloseTo(31.98473282442748, 9);
  expect(placed.baselineRadiusMm).toBeNull();
  expect(placed.baselineIssue).toMatch(/no es positivo/);
  expect(placed.measured).toBe(true);
  expect(placed.halfSpanDegrees).toBeNull();
  expect(placed.spanClamped).toBe(false);
  expect(JSON.stringify(element)).toBe(before);
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [
      {
        element,
        measurement: {
          lengthMm: 1,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("baseline report rejected");
  expect(report.report.texts[0].baselineRadiusMm).toBeNull();
  expect(
    report.report.warnings.some(
      (warning) =>
        warning.kind === "text-baseline-unavailable" &&
        warning.elementId === "tiny-text",
    ),
  ).toBe(true);
});

test("invalid diameters return structured errors with no stale output", () => {
  for (const [outerDiameter, innerDiameter] of [
    [-100, 60],
    [0, 60],
    [100, -60],
    [100, 0],
    [Number.NaN, 60],
    [100, Number.NaN],
    [Number.POSITIVE_INFINITY, 60],
    [100, Number.POSITIVE_INFINITY],
    [60, 60],
    [60, 80],
  ] as const) {
    const result = createPhysicalFrame(outerDiameter, innerDiameter);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("invalid frame accepted");
    expect(result.issues.length).toBeGreaterThan(0);
    expect("frame" in result).toBe(false);
  }
  const report = buildPhysicalReport({
    outerDiameter: 0,
    innerDiameter: 0,
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  expect(report.ok).toBe(false);
});

test("nonfinite calculated geometry returns explicit numeric-unsupported", () => {
  const frame = frameOrThrow(100, 60);
  const absurd: DesignIcon = {
    id: "absurd",
    type: "icon",
    iconId: "spark",
    angle: 0,
    radius: 360,
    scale: 1e308,
    rotation: 0,
    mirrored: false,
    inverted: false,
  };
  expect(Number.isFinite(iconConservativeEnvelopeMm(1e308, frame))).toBe(false);
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [absurd],
    approved: [],
    circularLines: "none",
  });
  expect(report.ok).toBe(false);
  if (report.ok) throw new Error("overflow accepted");
  expect(report.issues.some((issue) => issue.code === "NUMERIC_OVERFLOW")).toBe(
    true,
  );
  const good = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!good.ok) throw new Error("good report rejected");
  const serialized = serializeReport({
    ...good.report,
    frame: { ...good.report.frame, sizeFactor: Number.NaN },
  });
  expect(serialized.ok).toBe(false);
  const serializedGood = serializeReport(good.report);
  expect(serializedGood.ok).toBe(true);
  if (!serializedGood.ok) throw new Error("serialization failed");
  expect(JSON.parse(serializedGood.json).frame.outerRadius).toBe(50);
});

test("original inputs stay immutable and frozen graphs pass through", () => {
  const icon: DesignIcon = Object.freeze({
    id: "frozen-icon",
    type: "icon",
    iconId: "spark",
    angle: 45,
    radius: 360,
    scale: 1,
    rotation: 10,
    mirrored: false,
    inverted: true,
  }) as DesignIcon;
  const element: TextElement = Object.freeze({
    id: "frozen-text",
    text: "Froze",
    fontFamily: "Georgia",
    angle: 10,
    radius: 374,
    inverted: false,
  }) as TextElement;
  const before = JSON.stringify({ icon, element });
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [
      {
        element,
        measurement: {
          lengthMm: 40,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [icon],
    approved: [],
    circularLines: "single",
  });
  if (!report.ok) throw new Error("frozen report rejected");
  expect(JSON.stringify({ icon, element })).toBe(before);
  expect(Object.isFrozen(report.report.frame)).toBe(true);
});

test("pair lower bound distinguishes potential overlap from clear spacing", () => {
  const frame = frameOrThrow(100, 60);
  const at = (id: string, angle: number, radius: number): DesignIcon => ({
    id,
    type: "icon",
    iconId: "spark",
    angle,
    radius,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  });
  // Opposite anchors: distance 79.8473282442748, envelopes 3.88515174907297 each.
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [at("icon-a", 0, 357), at("icon-b", 180, 357)],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("pair report rejected");
  expect(report.report.pairClearances).toHaveLength(1);
  expect(report.report.pairClearances[0].centerDistanceMm).toBeCloseTo(
    79.8473282442748,
    9,
  );
  expect(report.report.pairClearances[0].pairClearanceMm).toBeCloseTo(
    79.8473282442748 - 2 * 3.88515174907297,
    9,
  );
  expect(report.report.pairClearances[0].potentialOverlap).toBe(false);
  // Coincident anchors: negative lower bound means POTENTIAL envelope overlap.
  const clash = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [at("icon-c", 0, 357), at("icon-d", 0, 357)],
    approved: [],
    circularLines: "none",
  });
  if (!clash.ok) throw new Error("clash report rejected");
  expect(clash.report.pairClearances[0].pairClearanceMm).toBeCloseTo(
    -2 * 3.88515174907297,
    9,
  );
  expect(clash.report.pairClearances[0].potentialOverlap).toBe(true);
  const warning = clash.report.warnings.find(
    (entry) => entry.kind === "potential-overlap",
  );
  expect(warning?.provenance).toMatch(/lower-bound/);
  expect(JSON.stringify(warning)).toMatch(/POTENTIAL/);
});

test("signed clearances for a centered icon stay exact", () => {
  const frame = frameOrThrow(100, 60);
  // Icon at source 357 scale 1: center 39.9236641221374, envelope 3.88515174907297.
  const clearance = clearanceFor(39.9236641221374, 3.88515174907297, frame);
  expect(clearance.outerSignedMm).toBeCloseTo(
    50 - (39.9236641221374 + 3.88515174907297),
    9,
  );
  expect(clearance.innerSignedMm).toBeCloseTo(
    39.9236641221374 - 3.88515174907297 - 30,
    9,
  );
  expect(scaleToPhysical(423, frame)).toBe(50);
  expect(scaleToPhysical(131, frame)).toBeCloseTo(131 * 0.118203309692671, 9);
});

test("icon envelope bounds every catalog icon path including stroke", () => {
  const frame = frameOrThrow(100, 60);
  // Actual icon paint model from IconElement: paths share a 32x32 box and
  // render under scale(1.4) translate(-16 -16), fill none, stroke #171717
  // width 1.7, round caps/joins. Re-measure every catalog icon with the
  // existing analytic helper (no raster, no flatten, no new engine) and prove
  // the placed envelope covers each rotation-invariant stroked corner.
  const parsed = parseTransformList("scale(1.4) translate(-16 -16)");
  if (!parsed.ok) throw new Error("icon transform rejected");
  const style: ControlledStyle = {
    fill: "none",
    stroke: "#171717",
    strokeWidth: 1.7,
    linecap: "round",
    linejoin: "round",
    miterlimit: 4,
    dasharray: [],
    dashoffset: 0,
    fillRule: "nonzero",
    fillOpacity: 1,
    strokeOpacity: 1,
  };
  expect(icons.length).toBeGreaterThan(0);
  let catalogMax = 0;
  const covered: string[] = [];
  for (const icon of icons) {
    const result = measureControlledPaths(
      icon.paths.map((d) => ({ d, matrix: parsed.matrix, style })),
    );
    if (!result.ok)
      throw new Error(`icon ${icon.id} unmeasurable: ${result.reason}`);
    const b = result.artBounds;
    const corner = Math.max(
      Math.hypot(b.x, b.y),
      Math.hypot(b.x + b.width, b.y),
      Math.hypot(b.x, b.y + b.height),
      Math.hypot(b.x + b.width, b.y + b.height),
    );
    catalogMax = Math.max(catalogMax, corner);
    covered.push(icon.id);
    // Path envelope, not ink measurement: rotation-invariant corner radius.
    expect(
      iconConservativeEnvelopeMm(1, frame) / frame.sizeFactor,
    ).toBeGreaterThanOrEqual(corner);
  }
  // Every catalog icon measured (29 on 2026-10-17; the handoff said 28 but
  // the source holds 29). A catalog addition without envelope re-proof fails.
  expect(covered).toHaveLength(icons.length);
  expect(icons.length).toBe(29);
  // Proven worst case (sun/arg-sun): 31.381398949058983 source units, inside
  // the constant 32.86838379715733 from viewport diagonal + stroke reach.
  expect(catalogMax).toBeCloseTo(31.381398949058983, 9);
});

test("circular line source radii reuse the shared export helper", () => {
  // Single source of truth: export/geometry lineRadiiForMode. The lab only
  // freezes its outputs (read-only reuse, no second table to drift).
  expect(SOURCE_LINE_RADII.single).toEqual(lineRadiiForMode("single"));
  expect(SOURCE_LINE_RADII.double).toEqual(lineRadiiForMode("double"));
  expect(lineRadiiForMode("single")).toEqual([357]);
  expect(lineRadiiForMode("double")).toEqual([347, 367]);
  expect(lineRadiiForMode("none")).toEqual([]);
});

test("arc span saturation is an explicit warning, not silent fit", () => {
  // Long measured text on a 1 mm ring: the span saturates at the SOURCE
  // editor clamp (135) and the report says so; ink stays unmeasured-marked.
  const report = buildPhysicalReport({
    outerDiameter: 2,
    innerDiameter: 1,
    texts: [
      {
        element: {
          id: "clamp-text",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 292,
          inverted: false,
          scale: 3,
        },
        measurement: {
          lengthMm: 400,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("clamp report rejected");
  expect(report.report.texts[0].halfSpanDegrees).toBe(135);
  expect(report.report.texts[0].spanClamped).toBe(true);
  expect(
    report.report.warnings.some(
      (warning) =>
        warning.kind === "text-span-clamped" &&
        warning.elementId === "clamp-text",
    ),
  ).toBe(true);
  expect(
    report.report.warnings.some(
      (warning) => warning.kind === "text-ink-unmeasured",
    ),
  ).toBe(true);
});

test("fixture uses real source models without duplicating art or Messi bytes", () => {
  const fixture = createProductionLabFixture();
  expect(fixture.circularLines).toBe("double");
  expect(fixture.texts.length).toBeGreaterThan(0);
  expect(fixture.icons.length).toBeGreaterThan(0);
  expect(fixture.approved).toEqual([]);
  for (const icon of fixture.icons) {
    expect(icon.type).toBe("icon");
    expect(typeof icon.iconId).toBe("string");
  }
  const serialized = JSON.stringify(fixture);
  expect(serialized).not.toMatch(/MESSI/i);
  expect(serialized).not.toMatch(/path d=/);
  // Supplied validated snapshots pass through by identity, never re-sanitized.
  const snapshot = {
    version: 3 as const,
    id: "design-9",
    name: "Messi",
    category: "Deportes",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 80,
    height: 80,
    viewBox: { x: 0, y: 0, width: 80, height: 80 },
  };
  const withApproved = createProductionLabFixture(snapshot);
  expect(withApproved.approved).toHaveLength(1);
  const instance: ApprovedDesignInstance = withApproved.approved[0];
  expect(instance.snapshot).toBe(snapshot);
  expect(instance.type).toBe("approved-design");
  // The fixture feeds the pure report without DOM or raw bundling.
  const frame = frameOrThrow(100, 60);
  const placed = placeApproved(instance, frame);
  expect(placed.snapshot).toBe(snapshot);
});

test("line stroke clearances are exact at narrow 100/99.5 with no autoadjust", () => {
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 99.5,
    texts: [],
    icons: [],
    approved: [],
    circularLines: "double",
  });
  if (!report.ok) throw new Error("narrow line report rejected");
  expect(report.report.lines.map((line) => line.id)).toEqual([
    "line-347",
    "line-367",
  ]);
  const byId = new Map(
    report.report.lineClearances.map((entry) => [entry.lineId, entry]),
  );
  expect(byId.get("line-367")?.radiusMm).toBeCloseTo(49.89312977099237, 9);
  expect(byId.get("line-347")?.radiusMm).toBeCloseTo(49.85496183206107, 9);
  // Exact stroke-half-width accounting: Ro-(r+sw/2), (r-sw/2)-Ri.
  expect(byId.get("line-367")?.outerSignedMm).toBeCloseTo(
    -0.011333080685041352,
    9,
  );
  expect(byId.get("line-347")?.innerSignedMm).toBeCloseTo(
    -0.01324147763160255,
    9,
  );
  expect(byId.get("line-367")?.innerSignedMm).toBeCloseTo(
    0.02492646129969245,
    9,
  );
  expect(byId.get("line-347")?.outerSignedMm).toBeCloseTo(
    0.026834858246253646,
    9,
  );
  const spills = report.report.warnings.filter(
    (warning) => warning.kind === "line-boundary-spill",
  );
  expect(spills).toHaveLength(2);
  for (const warning of spills) {
    expect(JSON.stringify(warning)).toMatch(/no es umbral de fabricaci/);
  }
  // No remedial fit: the underlying stroke geometry is unchanged by spill.
  expect(report.report.lines[0].strokeWidthMm).toBeCloseTo(100 / 423, 9);
  expect(report.report.lines[1].strokeWidthMm).toBeCloseTo(100 / 423, 9);
});

test("line rings stay out of disk pair logic", () => {
  const icon: DesignIcon = {
    id: "solo-icon",
    type: "icon",
    iconId: "spark",
    angle: 0,
    radius: 360,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  };
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [icon],
    approved: [],
    circularLines: "double",
  });
  if (!report.ok) throw new Error("pair exclusion report rejected");
  // Rings are strokes, not filled disks: one disk plus two rings → no pairs.
  expect(report.report.pairClearances).toEqual([]);
  expect(report.report.lineClearances).toHaveLength(2);
});

test("line knockout descriptors mirror the source decorative-lines-knockout rules", () => {
  const frame = frameOrThrow(100, 60);
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [
      {
        element: {
          id: "text-a",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
        measurement: {
          lengthMm: 47.28132387706856,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [
      {
        id: "icon-a",
        type: "icon",
        iconId: "spark",
        angle: 90,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    approved: [],
    circularLines: "double",
  });
  if (!report.ok) throw new Error("knockout report rejected");
  const iconKo = report.report.lineKnockouts.find((k) => k.id === "icon-a");
  // Actual IconElement rule: r = 25*scale*sqrt2 + 4 source units, outer-size scaled.
  expect(iconKo?.kind).toBe("icon-disk");
  if (iconKo?.kind !== "icon-disk") throw new Error("icon knockout missing");
  expect(iconKo.radiusMm).toBeCloseTo(4.651931330889761, 9);
  expect(iconKo.radiusMm).toBe(iconKnockoutRadiusMm(1, frame));
  expect(iconKo.center.x).toBeCloseTo(report.report.icons[0].center.x, 12);
  expect(iconKo.provenance).toMatch(
    /fuente: regla visual original; no margen de fabricaci/,
  );
  // The artistic +4 lives ONLY in the mask: the clearance envelope is the
  // independent viewport+stroke computation, untouched by knockout rules.
  expect(report.report.icons[0].envelopeMm).toBe(
    iconConservativeEnvelopeMm(1, frame),
  );
  expect(iconKo.radiusMm).not.toBe(report.report.icons[0].envelopeMm);
  const textKo = report.report.lineKnockouts.find((k) => k.id === "text-a");
  expect(textKo?.kind).toBe("text-band");
  if (textKo?.kind !== "text-band") throw new Error("text knockout missing");
  // Actual CurvedText rule: stroked arc, width 35*scale+10 source units.
  expect(textKo.strokeWidthMm).toBeCloseTo(5.319148936170213, 9);
  expect(textKo.anchorRadiusMm).toBe(report.report.texts[0].anchorRadiusMm);
  expect(textKo.halfSpanDegrees).toBe(report.report.texts[0].halfSpanDegrees);
  expect(textKo.provenance).toMatch(
    /fuente: regla visual original; no margen de fabricaci/,
  );
});

test("approved line knockout copies the actual approvedKnockoutRadius helper", () => {
  const frame = frameOrThrow(100, 60);
  const snapshot = {
    version: 3 as const,
    id: "design-ko",
    name: "Guarda",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 400,
    height: 300,
    viewBox: { x: 0, y: 0, width: 400, height: 300 },
  };
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [],
    approved: [
      {
        id: "ap-1",
        type: "approved-design",
        approvedDesignId: "design-ko",
        snapshot,
        angle: 0,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    circularLines: "double",
  });
  if (!report.ok) throw new Error("approved knockout report rejected");
  const ko = report.report.lineKnockouts.find((k) => k.id === "ap-1");
  expect(ko?.kind).toBe("approved-disk");
  if (ko?.kind !== "approved-disk")
    throw new Error("approved knockout missing");
  expect(ko.radiusMm).toBeCloseTo(
    approvedKnockoutRadius(snapshot, 1) * frame.sizeFactor,
    12,
  );
  expect(ko.radiusMm).toBeCloseTo(5.200945626477542, 9);
});

test("fixture sits inside the source editor clamps (lab applies no clamping)", () => {
  // The lab maps raw source radii/scales (no 305..410 clamps on mm, no
  // editor changes). This holds exactly because the frozen fixture already
  // sits inside the editor's own clamps — proved here against the actual
  // source helpers, so lab math == clamped-source math for this composition.
  const fixture = createProductionLabFixture();
  for (const text of fixture.texts) {
    expect(clampTextRadius(text.radius)).toBe(text.radius);
    expect(clampTextScale(text.scale ?? 1)).toBe(text.scale ?? 1);
  }
  for (const icon of fixture.icons) {
    expect(icon.radius).toBeGreaterThanOrEqual(ICON_RADIUS.min);
    expect(icon.radius).toBeLessThanOrEqual(ICON_RADIUS.max);
    expect(clampIconScaleAtRadius(icon.scale, icon.radius)).toBe(icon.scale);
  }
});

/**
 * C1 strategy parametrization (Mode B: band thickness, lab-only).
 * Mode A (outer-diameter) is the unchanged default; Mode B keeps the SAME
 * anchor mapping and only changes the sizeFactor value to positionSlope.
 * Correct reference values (Ro=Do/2, Ri=Di/2, kA=Ro/423, kB=(Ro-Ri)/131):
 * 85/50 → kA=42.5/423≈0.100472813238770, kB=17.5/131≈0.133587786259542;
 * 80/60 → kA=40/423≈0.094562647754137, kB=10/131≈0.076335877862595;
 * 75/65 → kA=37.5/423≈0.088652482269504, kB=5/131≈0.038167938931298.
 */

const bandFrameOrThrow = (outerDiameter: number, innerDiameter: number) => {
  const result = createPhysicalFrame(
    outerDiameter,
    innerDiameter,
    "band-thickness",
  );
  if (!result.ok)
    throw new Error(`band frame rejected: ${JSON.stringify(result.issues)}`);
  return result.frame;
};

test("strategy B sizes by band thickness; A default unchanged (85/50, 80/60, 75/65)", () => {
  const cases = [
    {
      outer: 85,
      inner: 50,
      sizeA: 0.10047281323877,
      sizeB: 0.133587786259542,
    },
    {
      outer: 80,
      inner: 60,
      sizeA: 0.0945626477541371,
      sizeB: 0.0763358778625954,
    },
    {
      outer: 75,
      inner: 65,
      sizeA: 0.0886524822695036,
      sizeB: 0.0381679389312977,
    },
  ];
  for (const { outer, inner, sizeA, sizeB } of cases) {
    const a = frameOrThrow(outer, inner);
    const b = bandFrameOrThrow(outer, inner);
    // Mode A: unchanged default, Ro/423.
    expect(a.strategy).toBe("outer-diameter");
    expect(a.sizeFactor).toBe(a.outerRadius / SOURCE_OUTER_RADIUS);
    expect(a.sizeFactor).toBeCloseTo(sizeA, 9);
    // Mode B: band thickness, sizeFactor IS the anchor slope.
    expect(b.strategy).toBe("band-thickness");
    expect(b.sizeFactor).toBe(b.positionSlope);
    expect(b.sizeFactor).toBe(
      (b.outerRadius - b.innerRadius) / SOURCE_BAND_WIDTH,
    );
    expect(b.sizeFactor).toBeCloseTo(sizeB, 9);
    // Same rings, same anchors: only the size factor differs.
    expect(b.outerRadius).toBe(a.outerRadius);
    expect(b.innerRadius).toBe(a.innerRadius);
    expect(b.positionSlope).toBe(a.positionSlope);
    expect(b.provenance).toMatch(/band-thickness/);
    expect(a.provenance).toMatch(/outer-diameter/);
  }
});

test("default frame is Mode A byte-identical (backward compat)", () => {
  for (const [outer, inner] of [
    [100, 60],
    [85, 50],
    [80, 60],
    [75, 65],
  ] as const) {
    const implicit = createPhysicalFrame(outer, inner);
    const explicit = createPhysicalFrame(outer, inner, "outer-diameter");
    expect(implicit).toEqual(explicit);
    if (!implicit.ok || !explicit.ok) throw new Error("frame rejected");
    expect(implicit.frame.strategy).toBe("outer-diameter");
    expect(JSON.stringify(implicit.frame)).toBe(JSON.stringify(explicit.frame));
  }
});

test("anchor mapping is identical across strategies for the same diameters", () => {
  const a = frameOrThrow(85, 50);
  const b = bandFrameOrThrow(85, 50);
  for (const radius of [292, 300, 347, 357, 367, 374, 390, 423, 500]) {
    expect(mapSourceRadius(radius, b)).toBe(mapSourceRadius(radius, a));
  }
  for (const angle of [0, 45, 90, 180, 270]) {
    expect(mapAngleToPoint(angle, 357, b)).toEqual(
      mapAngleToPoint(angle, 357, a),
    );
  }
});

test("boundary-contact envelope maps exactly to the rim under B", () => {
  const b = bandFrameOrThrow(85, 50);
  const a = frameOrThrow(85, 50);
  // Icon source envelope in source units (viewport diagonal + stroke reach).
  const srcEnvelope = 22.4 * Math.SQRT2 + 1.19;
  const at = (id: string, radius: number): DesignIcon => ({
    id,
    type: "icon",
    iconId: "spark",
    angle: 0,
    radius,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  });
  // Outer rim contact in source units (r + envelope = 423) lands on Ro.
  const outerTouch = placeIcon(at("touch-outer", 423 - srcEnvelope), b);
  const outerClearance = clearanceFor(
    outerTouch.centerRadiusMm,
    outerTouch.envelopeMm,
    b,
  );
  expect(outerClearance.outerSignedMm).toBeCloseTo(0, 9);
  // Inner rim contact in source units (r - envelope = 292) lands on Ri.
  const innerTouch = placeIcon(at("touch-inner", 292 + srcEnvelope), b);
  const innerClearance = clearanceFor(
    innerTouch.centerRadiusMm,
    innerTouch.envelopeMm,
    b,
  );
  expect(innerClearance.innerSignedMm).toBeCloseTo(0, 9);
  // Same element under A does NOT sit on the rim: strategies differ.
  const outerTouchA = placeIcon(at("touch-outer", 423 - srcEnvelope), a);
  const outerClearanceA = clearanceFor(
    outerTouchA.centerRadiusMm,
    outerTouchA.envelopeMm,
    a,
  );
  expect(Math.abs(outerClearanceA.outerSignedMm)).toBeGreaterThan(0.5);
});

test("internal proportions stay uniform per strategy (icon + approved)", () => {
  const a = frameOrThrow(85, 50);
  const b = bandFrameOrThrow(85, 50);
  const icon: DesignIcon = {
    id: "prop-icon",
    type: "icon",
    iconId: "spark",
    angle: 90,
    radius: 360,
    scale: 2,
    rotation: 30,
    mirrored: true,
    inverted: true,
  };
  for (const frame of [a, b]) {
    const placed = placeIcon(icon, frame);
    expect(placed.localScale).toBe(2 * frame.sizeFactor);
    expect(placed.localScaleX).toBe(placed.localScale);
    expect(placed.localScaleY).toBe(placed.localScale);
    expect(placed.rotation).toBe(30);
    expect(placed.mirrored).toBe(true);
    expect(placed.inverted).toBe(true);
  }
  const snapshot = {
    version: 3 as const,
    id: "design-prop",
    name: "Guarda",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 100,
    height: 50,
    viewBox: { x: 0, y: 0, width: 100, height: 50 },
  };
  const instance: ApprovedDesignInstance = {
    id: "prop-approved",
    type: "approved-design",
    approvedDesignId: "design-prop",
    snapshot,
    angle: 270,
    radius: 360,
    scale: 1,
    rotation: -15,
    mirrored: true,
    inverted: false,
  };
  for (const frame of [a, b]) {
    const placed = placeApproved(instance, frame);
    expect(placed.snapshot).toBe(snapshot);
    expect(placed.localScale).toBe(frame.sizeFactor);
    expect(placed.localScaleX).toBe(placed.localScale);
    expect(placed.localScaleY).toBe(placed.localScale);
    expect(placed.envelopeMm).toBe(
      approvedEnvelopeRadius(snapshot) * frame.sizeFactor,
    );
    expect(placed.rotation).toBe(-15);
    expect(placed.mirrored).toBe(true);
    expect(placed.inverted).toBe(false);
  }
});

test("A↔B↔A from the same source yields identical outputs (no accumulation)", () => {
  const snapshot = {
    version: 3 as const,
    id: "design-acc",
    name: "Guarda",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 100,
    height: 50,
    viewBox: { x: 0, y: 0, width: 100, height: 50 },
  };
  const base = {
    outerDiameter: 85,
    innerDiameter: 50,
    texts: [
      {
        element: {
          id: "acc-text",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        } as TextElement,
        measurement: {
          lengthMm: 40,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [
      {
        id: "acc-icon",
        type: "icon",
        iconId: "spark",
        angle: 90,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      } as DesignIcon,
    ],
    approved: [
      {
        id: "acc-approved",
        type: "approved-design",
        approvedDesignId: "design-acc",
        snapshot,
        angle: 270,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      } as ApprovedDesignInstance,
    ],
    circularLines: "double" as const,
  };
  const repA1 = buildPhysicalReport(base);
  const repB1 = buildPhysicalReport({ ...base, strategy: "band-thickness" });
  const repA2 = buildPhysicalReport(base);
  const repB2 = buildPhysicalReport({ ...base, strategy: "band-thickness" });
  if (!repA1.ok || !repB1.ok || !repA2.ok || !repB2.ok)
    throw new Error("accumulation report rejected");
  // Repeated builds from the same immutable source are identical per strategy.
  expect(JSON.stringify(repA2.report)).toBe(JSON.stringify(repA1.report));
  expect(JSON.stringify(repB2.report)).toBe(JSON.stringify(repB1.report));
  // Anchors match across strategies; sizes follow each strategy factor.
  expect(repB1.report.icons[0].center).toEqual(repA1.report.icons[0].center);
  expect(repB1.report.icons[0].centerRadiusMm).toBe(
    repA1.report.icons[0].centerRadiusMm,
  );
  expect(repB1.report.icons[0].localScale).not.toBe(
    repA1.report.icons[0].localScale,
  );
});

test("text element-relative formulas follow the per-strategy factor", () => {
  const a = frameOrThrow(85, 50);
  const b = bandFrameOrThrow(85, 50);
  const element: TextElement = {
    id: "strat-text",
    text: "Hola",
    fontFamily: "Georgia",
    angle: 0,
    radius: 374,
    inverted: true,
  };
  const measurement = {
    lengthMm: 40,
    provenance: "browser-getComputedTextLength",
  };
  for (const frame of [a, b]) {
    const placed = resolveText(element, frame, measurement);
    const k = frame.sizeFactor;
    // baselineR = mapRadius(radius) - 14*scale*sizeFactor (element-relative).
    expect(placed.baselineRadiusMm).toBe(mapSourceRadius(374, frame) - 14 * k);
    expect(placed.fontSizeMm).toBe(35 * k);
    expect(placed.letterSpacingMm).toBe(2 * k);
    expect(placed.invertedDyMm).toBe(26 * k);
    // Span padding is 14*sizeFactor, independent of element scale.
    const anchor = mapSourceRadius(374, frame);
    const expected = (((40 / 2 + 14 * k) / anchor) * 180) / Math.PI;
    expect(placed.halfSpanDegrees).toBeCloseTo(expected, 9);
    const scaled = resolveText({ ...element, scale: 2 }, frame, measurement);
    expect(scaled.baselineRadiusMm).toBe(
      mapSourceRadius(374, frame) - 14 * 2 * k,
    );
    expect(scaled.halfSpanDegrees).toBe(placed.halfSpanDegrees);
  }
  // Anchors shared, text sizes differ by strategy.
  const placedA = resolveText(element, a, measurement);
  const placedB = resolveText(element, b, measurement);
  expect(placedB.anchorRadiusMm).toBe(placedA.anchorRadiusMm);
  expect(placedB.fontSizeMm).not.toBe(placedA.fontSizeMm);
});

test("line stroke follows the per-strategy factor, radii stay anchored", () => {
  const a = frameOrThrow(85, 50);
  const b = bandFrameOrThrow(85, 50);
  const linesA = placeCircularLines("double", a);
  const linesB = placeCircularLines("double", b);
  expect(linesB.map((line) => line.sourceRadius)).toEqual([347, 367]);
  for (const line of linesB) {
    expect(line.strokeWidthMm).toBe(2 * b.sizeFactor);
  }
  for (const line of linesA) {
    expect(line.strokeWidthMm).toBe(2 * a.sizeFactor);
  }
  expect(linesB[0].radiusMm).toBe(linesA[0].radiusMm);
  expect(linesB[1].radiusMm).toBe(linesA[1].radiusMm);
  expect(scaleToPhysical(10, b)).toBe(10 * b.sizeFactor);
  expect(scaleToPhysical(10, a)).toBe(10 * a.sizeFactor);
});

test("invalid diameters rejected in both strategies (NaN/Inf/overflow as today)", () => {
  const strategies = [undefined, "outer-diameter", "band-thickness"] as const;
  for (const strategy of strategies) {
    for (const [outerDiameter, innerDiameter] of [
      [-100, 60],
      [0, 60],
      [100, -60],
      [100, 0],
      [Number.NaN, 60],
      [100, Number.NaN],
      [Number.POSITIVE_INFINITY, 60],
      [100, Number.POSITIVE_INFINITY],
      [60, 60],
      [60, 80],
    ] as const) {
      const result = createPhysicalFrame(
        outerDiameter,
        innerDiameter,
        strategy,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("invalid frame accepted");
    }
    const report = buildPhysicalReport({
      outerDiameter: 0,
      innerDiameter: 0,
      texts: [],
      icons: [],
      approved: [],
      circularLines: "none",
      strategy: strategy ?? "outer-diameter",
    });
    expect(report.ok).toBe(false);
  }
  // Overflow stays a structured error under B as well.
  const frame = bandFrameOrThrow(100, 60);
  expect(Number.isFinite(iconConservativeEnvelopeMm(1e308, frame))).toBe(false);
  const overflow = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [],
    icons: [
      {
        id: "absurd-b",
        type: "icon",
        iconId: "spark",
        angle: 0,
        radius: 360,
        scale: 1e308,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    approved: [],
    circularLines: "none",
    strategy: "band-thickness",
  });
  expect(overflow.ok).toBe(false);
});

test("C3: text-span floor (7°) reports piso distinctly from ceiling saturation", () => {
  const b = bandFrameOrThrow(75, 65);
  // ~120 source-unit advance converted to mm under the thin B band:
  // raw span lands below the 7° floor (reachable under B, unlike A).
  const advanceMm = scaleToPhysical(120, b);
  const report = buildPhysicalReport({
    outerDiameter: 75,
    innerDiameter: 65,
    strategy: "band-thickness",
    texts: [
      {
        element: {
          id: "floor-text",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
        measurement: {
          lengthMm: advanceMm,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("floor report rejected");
  expect(report.report.texts[0].halfSpanDegrees).toBe(7);
  expect(report.report.texts[0].spanClamped).toBe(true);
  const warning = report.report.warnings.find(
    (entry) =>
      entry.kind === "text-span-clamped" && entry.elementId === "floor-text",
  );
  expect(warning).toBeDefined();
  if (warning?.kind !== "text-span-clamped")
    throw new Error("floor warning missing");
  expect(warning.message).toMatch(/piso/);
  expect(warning.message).toMatch(/7°/);
  expect(warning.message).not.toMatch(/tope/);
});

test("C3: text-span ceiling keeps the saturation wording (no floor claim)", () => {
  const report = buildPhysicalReport({
    outerDiameter: 2,
    innerDiameter: 1,
    texts: [
      {
        element: {
          id: "ceiling-text",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 292,
          inverted: false,
          scale: 3,
        },
        measurement: {
          lengthMm: 400,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("ceiling report rejected");
  expect(report.report.texts[0].halfSpanDegrees).toBe(135);
  expect(report.report.texts[0].spanClamped).toBe(true);
  const warning = report.report.warnings.find(
    (entry) =>
      entry.kind === "text-span-clamped" && entry.elementId === "ceiling-text",
  );
  expect(warning).toBeDefined();
  if (warning?.kind !== "text-span-clamped")
    throw new Error("ceiling warning missing");
  expect(warning.message).toMatch(/tope/);
  expect(warning.message).not.toMatch(/piso/);
});

test("C3: text anchor above the outer ring is definitely-outside (exact anchor)", () => {
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    texts: [
      {
        element: {
          id: "text-above",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 500,
          inverted: false,
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("above report rejected");
  // anchor(500) = 61.76 mm > Ro 50: exact geometry, no envelope invented.
  expect(report.report.texts[0].anchorRadiusMm).toBeCloseTo(
    61.7557251908397,
    9,
  );
  const warning = report.report.warnings.find(
    (entry) =>
      entry.kind === "definitely-outside" && entry.elementId === "text-above",
  );
  expect(warning).toBeDefined();
  if (warning?.kind !== "definitely-outside")
    throw new Error("above-outside warning missing");
  expect(warning.side).toBe("outer");
  expect(warning.message).toMatch(/definitivamente fuera/);
  expect(warning.message).toMatch(/ancla/);
  expect(warning.provenance).toBe("exact-anchor-vs-reference");
});

test("C3: text anchor below the inner ring is definitely-outside (band mode)", () => {
  const report = buildPhysicalReport({
    outerDiameter: 100,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [
      {
        element: {
          id: "text-below",
          text: "Hola",
          fontFamily: "Georgia",
          angle: 0,
          radius: 200,
          inverted: false,
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  if (!report.ok) throw new Error("below report rejected");
  // anchor(200) = 15.95 mm < Ri 30: exact geometry, no envelope invented.
  expect(report.report.texts[0].anchorRadiusMm).toBeCloseTo(
    15.954198473282443,
    9,
  );
  const warning = report.report.warnings.find(
    (entry) =>
      entry.kind === "definitely-outside" && entry.elementId === "text-below",
  );
  expect(warning).toBeDefined();
  if (warning?.kind !== "definitely-outside")
    throw new Error("below-outside warning missing");
  expect(warning.side).toBe("inner");
  expect(warning.message).toMatch(/definitivamente fuera/);
  expect(warning.message).toMatch(/ancla/);
  expect(warning.provenance).toBe("exact-anchor-vs-reference");
});
