/**
 * Pure physical transform + diagnostics for the production lab (P1, S1–S8).
 * No DOM, no React, no SVG parsing, no re-sanitization. All outputs are data
 * for the physical UI to consume without rederiving equations.
 *
 * Sizing strategy (C1): the frame carries `strategy`. Mode A
 * (outer-diameter, product default): Ro = Do/2, Ri = Di/2,
 * positionSlope = (Ro - Ri)/131, sizeFactor = Ro/423. Mode B
 * (band-thickness, lab-only): SAME anchors/mapping, sizeFactor =
 * (Ro - Ri)/131 = positionSlope. BOTH reference radii come out exact in
 * both modes; artwork may spill past the band and that spill is reported,
 * never auto-shrunk, repositioned, or radially warped. Every placement
 * derives from immutable source units + the current frame, so repeated
 * strategy/measure changes never accumulate scaling.
 */
import {
  EXPORT_CENTER,
  VIROLA_INNER_RADIUS,
  VIROLA_OUTER_RADIUS,
  lineRadiiForMode,
} from "../export/geometry";
import {
  approvedDisplaySize,
  approvedEnvelopeRadius,
  approvedKnockoutRadius,
  type ApprovedDesignInstance,
} from "../approved-designs/approvedDesign";
import type { DesignIcon } from "../components/IconElement";
import type { TextElement } from "../components/CurvedText";
import type {
  DiameterIssue,
  ElementClearance,
  FrameResult,
  LineClearance,
  LineKnockout,
  PhysicalFrame,
  PhysicalPoint,
  PhysicalReport,
  PhysicalWarning,
  PlacedApproved,
  PlacedCircularLine,
  PlacedIcon,
  PlacedText,
  ReportInput,
  ReportResult,
  SerializeResult,
  SizingStrategy,
  TextMeasurement,
} from "./types";

/** Source reference imported from the shared export/geometry baseline. */
export const SOURCE_CENTER = EXPORT_CENTER;
export const SOURCE_INNER_RADIUS = VIROLA_INNER_RADIUS;
export const SOURCE_OUTER_RADIUS = VIROLA_OUTER_RADIUS;
export const SOURCE_BAND_WIDTH = VIROLA_OUTER_RADIUS - VIROLA_INNER_RADIUS;

/**
 * Circular-line source radii. Single source of truth is the shared exporter
 * baseline (`export/geometry` lineRadiiForMode, also used by productionSvg);
 * this alias only freezes its outputs for the lab (read-only reuse, no
 * second table to drift). Stroke width 2 stays a named source fact.
 */
export const SOURCE_LINE_RADII = {
  single: lineRadiiForMode("single"),
  double: lineRadiiForMode("double"),
} as const;
/** Actual decorative-line stroke width in source units (not CSS px). */
export const SOURCE_LINE_STROKE_WIDTH = 2;

/** Actual CurvedText source parameters (editor-scale units). */
export const SOURCE_TEXT = {
  fontSize: 35,
  letterSpacing: 2,
  invertedDy: 26,
  baselineOffset: 14,
  halfSpanMin: 7,
  halfSpanMax: 135,
} as const;

/**
 * Actual icon source paint model: 32x32 viewport paths rendered under
 * scale(1.4) translate(-16 -16) with strokeWidth 1.7, round caps/joins.
 * Conservative envelope = full-viewport half-diagonal plus the stroked cap
 * reach. PROVEN, not merely claimed, against the real catalog: all 29 icons
 * re-measured with the existing analytic path bounds under the actual
 * transform and stroke — worst rotation-invariant stroked corner is
 * sun/arg-sun at 31.381398949058983 source units, inside this 32.868... bound
 * (see the catalog-wide spec). A path envelope, never an ink measurement;
 * the UI knockout (+4) and selection halo are never used here.
 */
export const ICON_SOURCE = {
  artSize: 32,
  fitScale: 1.4,
  strokeWidth: 1.7,
} as const;

export const ICON_ENVELOPE_PROVENANCE =
  "icon-catalog-path-envelope-conservative: full 32x32 viewport half-diagonal at fit 1.4 plus stroke 1.7 round-cap reach; proven over all 29 catalog icons (worst measured stroked corner 31.381398949058983 source units); path envelope, not ink measurement";
/**
 * Exact line-stroke clearance provenance: signed half-stroke accounting on
 * the UNDERLYING circular stroke before the visual knockout; negative is a
 * potential paint crossing, never a fabrication threshold.
 */
export const LINE_CLEARANCE_PROVENANCE =
  "exact-line-stroke-clearance: Ro-(r+stroke/2), (r-stroke/2)-Ri on the underlying circular stroke before visual knockout; rings are strokes, never filled disks (excluded from disk pair logic)";
/**
 * Artistic-mask provenance, shared by every line-knockout descriptor.
 * Fuente: regla visual original; no margen de fabricación.
 */
export const LINE_KNOCKOUT_PROVENANCE =
  "fuente: regla visual original; no margen de fabricación";
export const APPROVED_ENVELOPE_PROVENANCE =
  "approved-display-viewport-conservative: circumscribed diagonal of the fit-64 display size; v3 full-SVG Blob paint is bounded by its image viewport (sanitizer preserves effects, filters may add bleed — not certified)";
export const FRAME_PROVENANCE =
  "outer-diameter-size: Ro=Do/2, Ri=Di/2, positionSlope=(Ro-Ri)/131, sizeFactor=Ro/423; angle 0 TOP clockwise y-down, physical center (0,0)";
/** Mode B frame provenance: same rings/anchors, band-thickness size. */
export const FRAME_PROVENANCE_BAND =
  "band-thickness-size: Ro=Do/2, Ri=Di/2, positionSlope=(Ro-Ri)/131, sizeFactor=(Ro-Ri)/131=positionSlope; angle 0 TOP clockwise y-down, physical center (0,0)";
const REPORT_PROVENANCE =
  "production-lab-p1: exact refs/anchors/uniform outer-diameter size; conservative envelopes; no fabricated thresholds; selection halos (+4 UI units) never used as fabrication limits";
const REPORT_PROVENANCE_BAND =
  "production-lab-p1: exact refs/anchors/uniform band-thickness size; conservative envelopes; no fabricated thresholds; selection halos (+4 UI units) never used as fabrication limits";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const invalidDiameter = (value: unknown): boolean => !isFiniteNumber(value);

/** Structured validation: positive finite diameters with 0 < Di < Do. */
export function validateDiameters(
  outerDiameter: number,
  innerDiameter: number,
): DiameterIssue[] {
  const issues: DiameterIssue[] = [];
  if (invalidDiameter(outerDiameter)) {
    issues.push({
      code: "NOT_FINITE",
      field: "outerDiameter",
      message: "El diámetro exterior debe ser un número finito.",
    });
  } else if (outerDiameter <= 0) {
    issues.push({
      code: "NOT_POSITIVE",
      field: "outerDiameter",
      message: "El diámetro exterior debe ser positivo.",
    });
  }
  if (invalidDiameter(innerDiameter)) {
    issues.push({
      code: "NOT_FINITE",
      field: "innerDiameter",
      message: "El diámetro interior debe ser un número finito.",
    });
  } else if (innerDiameter <= 0) {
    issues.push({
      code: "NOT_POSITIVE",
      field: "innerDiameter",
      message: "El diámetro interior debe ser positivo.",
    });
  }
  if (issues.length === 0 && !(innerDiameter < outerDiameter)) {
    issues.push({
      code: "INNER_NOT_LESS_THAN_OUTER",
      field: "innerDiameter",
      message: "El diámetro interior debe ser menor que el exterior.",
    });
  }
  return issues;
}

/**
 * Deterministic frame from one validated diameter pair + sizing strategy;
 * frozen. The default strategy is outer-diameter, so existing callers get
 * byte-identical frames. Anchors never depend on the strategy.
 */
export function createPhysicalFrame(
  outerDiameter: number,
  innerDiameter: number,
  strategy: SizingStrategy = "outer-diameter",
): FrameResult {
  const issues = validateDiameters(outerDiameter, innerDiameter);
  if (issues.length > 0) return { ok: false, issues };
  const outerRadius = outerDiameter / 2;
  const innerRadius = innerDiameter / 2;
  const positionSlope = (outerRadius - innerRadius) / SOURCE_BAND_WIDTH;
  // Single sizing seam: every consumer below scales source units by
  // frame.sizeFactor exactly once. Mode B reuses the anchor slope, so
  // source rim contact (r ± envelope = 292/423) lands exactly on Ri/Ro.
  const sizeFactor =
    strategy === "band-thickness"
      ? positionSlope
      : outerRadius / SOURCE_OUTER_RADIUS;
  for (const value of [outerRadius, innerRadius, positionSlope, sizeFactor]) {
    if (!isFiniteNumber(value)) {
      return {
        ok: false,
        issues: [
          {
            code: "NUMERIC_OVERFLOW",
            field: "derived",
            message:
              "Las medidas producen un cálculo no finito (desbordamiento numérico).",
          },
        ],
      };
    }
  }
  return {
    ok: true,
    frame: Object.freeze({
      outerDiameter,
      innerDiameter,
      outerRadius,
      innerRadius,
      positionSlope,
      sizeFactor,
      strategy,
      source: {
        center: SOURCE_CENTER,
        innerRadius: SOURCE_INNER_RADIUS,
        outerRadius: SOURCE_OUTER_RADIUS,
        bandWidth: SOURCE_BAND_WIDTH,
      },
      provenance:
        strategy === "band-thickness"
          ? FRAME_PROVENANCE_BAND
          : FRAME_PROVENANCE,
    }),
  };
}

/** Annular anchor mapping: extrapolates past the source band, never clamps. */
export function mapSourceRadius(
  sourceRadius: number,
  frame: PhysicalFrame,
): number {
  return (
    frame.innerRadius +
    (sourceRadius - SOURCE_INNER_RADIUS) * frame.positionSlope
  );
}

/**
 * Actual source polar convention with physical center (0, 0):
 * angle 0 at TOP, clockwise, y down.
 */
export function mapAngleToPoint(
  angleDegrees: number,
  sourceRadius: number,
  frame: PhysicalFrame,
): PhysicalPoint {
  const mapped = mapSourceRadius(sourceRadius, frame);
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return { x: mapped * Math.cos(radians), y: mapped * Math.sin(radians) };
}

/** Uniform per-strategy size: source units (not CSS px) to mm. */
export function scaleToPhysical(
  sourceUnits: number,
  frame: PhysicalFrame,
): number {
  return sourceUnits * frame.sizeFactor;
}

export function placeCircularLines(
  mode: "none" | "single" | "double",
  frame: PhysicalFrame,
): PlacedCircularLine[] {
  const radii =
    mode === "single"
      ? SOURCE_LINE_RADII.single
      : mode === "double"
        ? SOURCE_LINE_RADII.double
        : [];
  return radii.map((sourceRadius) => ({
    id: `line-${sourceRadius}`,
    sourceRadius,
    radiusMm: mapSourceRadius(sourceRadius, frame),
    strokeWidthMm: SOURCE_LINE_STROKE_WIDTH * frame.sizeFactor,
  }));
}

/**
 * Exact underlying-stroke clearance of one decorative ring. Rings are
 * strokes, never filled disks — kept OUT of the disk pair logic.
 */
export function lineClearanceFor(
  line: PlacedCircularLine,
  frame: PhysicalFrame,
): LineClearance {
  const halfStroke = line.strokeWidthMm / 2;
  return {
    lineId: line.id,
    sourceRadius: line.sourceRadius,
    radiusMm: line.radiusMm,
    strokeWidthMm: line.strokeWidthMm,
    outerSignedMm: frame.outerRadius - (line.radiusMm + halfStroke),
    innerSignedMm: line.radiusMm - halfStroke - frame.innerRadius,
    provenance: LINE_CLEARANCE_PROVENANCE,
  };
}

/**
 * Actual source icon-knockout rule (IconElement, inline formula — no
 * exported helper exists there and IconElement is outside the lab surface):
 * r = 25*scale*sqrt2 + 4 source units. Artistic mask, never a margin.
 */
export function iconKnockoutRadiusMm(
  sourceScale: number,
  frame: PhysicalFrame,
): number {
  return (25 * sourceScale * Math.SQRT2 + 4) * frame.sizeFactor;
}

/**
 * Actual source approved-knockout rule: the shared approvedKnockoutRadius
 * helper (envelope*scale + 4) scaled by the frame's per-strategy sizeFactor.
 */
export function approvedKnockoutRadiusMm(
  snapshot: PlacedApproved["snapshot"],
  sourceScale: number,
  frame: PhysicalFrame,
): number {
  return approvedKnockoutRadius(snapshot, sourceScale) * frame.sizeFactor;
}

/**
 * Actual source text-knockout rule (CurvedText `text-knockout-*`): a stroked
 * arc band at the text anchor radius, width 35*scale+10 source units, round
 * caps, spanning the measured layout half-span. Only emitted when the
 * browser advance is known (no span is invented for unmeasured text).
 */
export function textKnockoutStrokeWidthMm(
  sourceScale: number,
  frame: PhysicalFrame,
): number {
  return (SOURCE_TEXT.fontSize * sourceScale + 10) * frame.sizeFactor;
}

/**
 * Layout arc half-span from a BROWSER-MEASURED ADVANCE text length, using the
 * actual source formula: halfSpan = clamp((length/2 + padding) / anchor * 180/π).
 * All inputs share one unit (mm on the physical render). The padding is 14
 * SOURCE units converted with the frame's sizeFactor — never the raw 14 mixed
 * with mm, never 14*positionSlope, never 14*elementScale: CurvedText computes
 * (getComputedTextLength()/2 + 14)/radius independent of text scale (the
 * measured advance already carries scale; the baseline offset, in contrast,
 * IS 14*scale). The 7..135 clamp mirrors the source editor's own layout clamp
 * — saturation is reported (text-span-clamped), never a shop fitness claim.
 * Provenance is font-dependent: the caller passes the ADVANCE length of
 * getComputedTextLength on the real render (not an ink bbox — ink stays
 * unmeasured until a UI getBBox stage); no outlining, raster, canvas, or
 * VTracer involved, glyphs never tangentially stretched.
 */
export function textHalfSpanDegrees(
  measuredLengthMm: number,
  anchorRadiusMm: number,
  frame: PhysicalFrame,
): number {
  return clampedTextHalfSpan(
    rawTextHalfSpan(measuredLengthMm, anchorRadiusMm, frame),
  );
}

/** Unclamped source span; resolveText derives the exported clamp state from this. */
const rawTextHalfSpan = (
  measuredLengthMm: number,
  anchorRadiusMm: number,
  frame: PhysicalFrame,
): number => {
  const paddingMm = SOURCE_TEXT.baselineOffset * frame.sizeFactor;
  return (
    (((measuredLengthMm / 2 + paddingMm) / anchorRadiusMm) * 180) / Math.PI
  );
};

const clampedTextHalfSpan = (raw: number): number =>
  Math.min(SOURCE_TEXT.halfSpanMax, Math.max(SOURCE_TEXT.halfSpanMin, raw));

/**
 * Arc path render commands in mm for the UI's physical SVG: the source's
 * full-circle two-arc baseline path recentered at physical (0, 0).
 * The layout half-span is deliberately NOT baked into this path (same as the
 * source, whose curve path is always full-circle): the span only drives the
 * text-knockout/hit band and the 7..135 clamp state, never path clipping.
 */
export function textArcPathMm(
  baselineRadiusMm: number,
  halfSpanDegrees: number,
  inverted: boolean,
): string {
  const round4 = (value: number) => Math.round(value * 10000) / 10000;
  const radius = round4(baselineRadiusMm);
  const sweep = inverted ? 0 : 1;
  void halfSpanDegrees;
  return `M0 ${radius} A${radius} ${radius} 0 0 ${sweep} 0 ${-radius} A${radius} ${radius} 0 0 ${sweep} 0 ${radius}`;
}

/** Conservative icon paint envelope in mm (viewport + stroke math). */
export function iconConservativeEnvelopeMm(
  sourceScale: number,
  frame: PhysicalFrame,
): number {
  const halfSide = (ICON_SOURCE.artSize / 2) * ICON_SOURCE.fitScale;
  const source =
    halfSide * Math.SQRT2 +
    (ICON_SOURCE.strokeWidth * ICON_SOURCE.fitScale) / 2;
  return source * sourceScale * frame.sizeFactor;
}

export function placeIcon(
  source: DesignIcon,
  frame: PhysicalFrame,
): PlacedIcon {
  const centerRadiusMm = mapSourceRadius(source.radius, frame);
  const localScale = source.scale * frame.sizeFactor;
  return {
    kind: "icon",
    id: source.id,
    center: mapAngleToPoint(source.angle, source.radius, frame),
    centerRadiusMm,
    localScale,
    localScaleX: localScale,
    localScaleY: localScale,
    rotation: source.rotation,
    mirrored: source.mirrored,
    inverted: source.inverted,
    envelopeMm: iconConservativeEnvelopeMm(source.scale, frame),
    envelopeProvenance: ICON_ENVELOPE_PROVENANCE,
  };
}

export function placeApproved(
  source: ApprovedDesignInstance,
  frame: PhysicalFrame,
): PlacedApproved {
  const centerRadiusMm = mapSourceRadius(source.radius, frame);
  const localScale = source.scale * frame.sizeFactor;
  const display = approvedDisplaySize(source.snapshot);
  return {
    kind: "approved",
    id: source.id,
    approvedDesignId: source.approvedDesignId,
    snapshot: source.snapshot,
    center: mapAngleToPoint(source.angle, source.radius, frame),
    centerRadiusMm,
    localScale,
    localScaleX: localScale,
    localScaleY: localScale,
    rotation: source.rotation,
    mirrored: source.mirrored,
    inverted: source.inverted,
    envelopeMm:
      approvedEnvelopeRadius(source.snapshot) * source.scale * frame.sizeFactor,
    envelopeProvenance: APPROVED_ENVELOPE_PROVENANCE,
    displaySizeMm: {
      width: display.width * frame.sizeFactor,
      height: display.height * frame.sizeFactor,
    },
  };
}

/**
 * Text placement. anchorR = mapRadius(source.radius);
 * baseR = anchorR - 14 * source.scale * sizeFactor — deliberately NOT
 * mapRadius(radius - 14*scale), because the anchor slope and the size slope
 * differ under outer-diameter sizing (under band-thickness sizing both equal
 * positionSlope, so the two forms coincide). Nonpositive baseR yields an explicit
 * geometry problem (never clamped to a fake positive); without a browser
 * measurement the span is unavailable and ink stays marked unmeasured.
 * Span saturation at the 7..135 source clamp sets spanClamped for an
 * explicit report warning.
 */
export function resolveText(
  source: TextElement,
  frame: PhysicalFrame,
  measurement?: TextMeasurement,
): PlacedText {
  const scale = source.scale ?? 1;
  const anchorRadiusMm = mapSourceRadius(source.radius, frame);
  const baselineRadiusMm =
    anchorRadiusMm - SOURCE_TEXT.baselineOffset * scale * frame.sizeFactor;
  const measured = measurement !== undefined;
  const rawSpan =
    measured && baselineRadiusMm > 0
      ? rawTextHalfSpan(measurement.lengthMm, anchorRadiusMm, frame)
      : null;
  const halfSpanDegrees =
    rawSpan === null ? null : clampedTextHalfSpan(rawSpan);
  const spanClamped = rawSpan === null ? false : halfSpanDegrees !== rawSpan;
  return {
    kind: "text",
    id: source.id,
    angle: source.angle,
    anchorRadiusMm,
    baselineRadiusMm: baselineRadiusMm > 0 ? baselineRadiusMm : null,
    baselineIssue:
      baselineRadiusMm > 0
        ? null
        : "El radio base del texto no es positivo: geometría no disponible, no se inventa trazado.",
    center: mapAngleToPoint(source.angle, source.radius, frame),
    fontSizeMm: SOURCE_TEXT.fontSize * scale * frame.sizeFactor,
    letterSpacingMm: SOURCE_TEXT.letterSpacing * scale * frame.sizeFactor,
    invertedDyMm: source.inverted
      ? SOURCE_TEXT.invertedDy * scale * frame.sizeFactor
      : null,
    sweep: source.inverted ? 0 : 1,
    halfSpanDegrees,
    spanClamped,
    measured,
  };
}

/** Signed clearances: outer Ro - (r + envelope), inner (r - envelope) - Ri. */
export function clearanceFor(
  centerRadiusMm: number,
  envelopeMm: number,
  frame: PhysicalFrame,
): { outerSignedMm: number; innerSignedMm: number } {
  return {
    outerSignedMm: frame.outerRadius - (centerRadiusMm + envelopeMm),
    innerSignedMm: centerRadiusMm - envelopeMm - frame.innerRadius,
  };
}

const allFinite = (values: number[]): boolean => values.every(isFiniteNumber);

export function buildPhysicalReport(input: ReportInput): ReportResult {
  const frameResult = createPhysicalFrame(
    input.outerDiameter,
    input.innerDiameter,
    input.strategy ?? "outer-diameter",
  );
  if (!frameResult.ok) return frameResult;
  const frame = frameResult.frame;
  // Provenance tag naming the active sizing strategy; Mode A keeps the
  // exact historical strings (byte-identical outputs).
  const sizeTag =
    frame.strategy === "band-thickness"
      ? "band-size scaled"
      : "outer-size scaled";

  const texts = input.texts.map(({ element, measurement }) =>
    resolveText(element, frame, measurement),
  );
  const icons = input.icons.map((icon) => placeIcon(icon, frame));
  const approved = input.approved.map((item) => placeApproved(item, frame));
  const lines = placeCircularLines(input.circularLines, frame);
  const lineClearances = lines.map((line) => lineClearanceFor(line, frame));

  // Visual-knockout descriptors mirror the source decorative-lines-knockout
  // mask (artistic, never margins). Text bands need a measured span.
  const lineKnockouts: LineKnockout[] = [
    ...icons.map((icon): LineKnockout => ({
      kind: "icon-disk",
      id: icon.id,
      center: icon.center,
      radiusMm: iconKnockoutRadiusMm(
        input.icons.find((source) => source.id === icon.id)?.scale ?? 1,
        frame,
      ),
      provenance: `icon-knockout 25*scale*sqrt2+4 ${sizeTag}; ${LINE_KNOCKOUT_PROVENANCE}`,
    })),
    ...approved.map((item): LineKnockout => ({
      kind: "approved-disk",
      id: item.id,
      center: item.center,
      radiusMm: approvedKnockoutRadiusMm(
        item.snapshot,
        input.approved.find((source) => source.id === item.id)?.scale ?? 1,
        frame,
      ),
      provenance: `approved-knockout helper ${sizeTag}; ${LINE_KNOCKOUT_PROVENANCE}`,
    })),
  ];
  texts.forEach((text, index) => {
    if (text.halfSpanDegrees === null) return;
    const source = input.texts[index].element;
    lineKnockouts.push({
      kind: "text-band",
      id: text.id,
      angle: source.angle,
      anchorRadiusMm: text.anchorRadiusMm,
      halfSpanDegrees: text.halfSpanDegrees,
      strokeWidthMm: textKnockoutStrokeWidthMm(source.scale ?? 1, frame),
      provenance: `text-knockout stroked arc 35*scale+10 ${sizeTag}; ${LINE_KNOCKOUT_PROVENANCE}`,
    });
  });

  // Numeric guard: any nonfinite calculated output is a structured error.
  const numerics: number[] = [
    frame.outerRadius,
    frame.innerRadius,
    frame.positionSlope,
    frame.sizeFactor,
    ...texts.flatMap((text) => [
      text.anchorRadiusMm,
      text.center.x,
      text.center.y,
      text.fontSizeMm,
      text.letterSpacingMm,
      ...(text.baselineRadiusMm !== null ? [text.baselineRadiusMm] : []),
      ...(text.invertedDyMm !== null ? [text.invertedDyMm] : []),
      ...(text.halfSpanDegrees !== null ? [text.halfSpanDegrees] : []),
    ]),
    ...icons.flatMap((icon) => [
      icon.center.x,
      icon.center.y,
      icon.centerRadiusMm,
      icon.localScale,
      icon.envelopeMm,
    ]),
    ...approved.flatMap((item) => [
      item.center.x,
      item.center.y,
      item.centerRadiusMm,
      item.localScale,
      item.envelopeMm,
      item.displaySizeMm.width,
      item.displaySizeMm.height,
    ]),
    ...lines.flatMap((line) => [line.radiusMm, line.strokeWidthMm]),
    ...lineClearances.flatMap((entry) => [
      entry.radiusMm,
      entry.strokeWidthMm,
      entry.outerSignedMm,
      entry.innerSignedMm,
    ]),
    ...lineKnockouts.flatMap((knockout) =>
      knockout.kind === "text-band"
        ? [
            knockout.anchorRadiusMm,
            knockout.halfSpanDegrees,
            knockout.strokeWidthMm,
            knockout.angle,
          ]
        : [knockout.center.x, knockout.center.y, knockout.radiusMm],
    ),
  ];
  if (!allFinite(numerics)) {
    return {
      ok: false,
      issues: [
        {
          code: "NUMERIC_OVERFLOW",
          field: "derived",
          message:
            "La geometría calculada no es finita (desbordamiento numérico).",
        },
      ],
    };
  }

  const warnings: PhysicalWarning[] = [];
  const clearances: ElementClearance[] = [];

  // Line-ring stroke clearances: exact underlying-stroke numbers before the
  // visual knockout. Rings stay out of the disk pair logic below.
  for (const entry of lineClearances) {
    if (entry.outerSignedMm < 0) {
      warnings.push({
        kind: "line-boundary-spill",
        lineId: entry.lineId,
        side: "outer",
        signedClearanceMm: entry.outerSignedMm,
        message: `«${entry.lineId}» puede cruzar el borde exterior (holgura firmada ${entry.outerSignedMm.toFixed(2)} mm): trazo circular subyacente antes del recorte visual; no es umbral de fabricación.`,
        provenance: LINE_CLEARANCE_PROVENANCE,
      });
    }
    if (entry.innerSignedMm < 0) {
      warnings.push({
        kind: "line-boundary-spill",
        lineId: entry.lineId,
        side: "inner",
        signedClearanceMm: entry.innerSignedMm,
        message: `«${entry.lineId}» puede cruzar el borde interior (holgura firmada ${entry.innerSignedMm.toFixed(2)} mm): trazo circular subyacente antes del recorte visual; no es umbral de fabricación.`,
        provenance: LINE_CLEARANCE_PROVENANCE,
      });
    }
  }

  const bounded: Array<{
    id: string;
    kind: "icon" | "approved";
    centerRadiusMm: number;
    envelopeMm: number;
    provenance: string;
  }> = [
    ...icons.map((icon) => ({
      id: icon.id,
      kind: "icon" as const,
      centerRadiusMm: icon.centerRadiusMm,
      envelopeMm: icon.envelopeMm,
      provenance: icon.envelopeProvenance,
    })),
    ...approved.map((item) => ({
      id: item.id,
      kind: "approved" as const,
      centerRadiusMm: item.centerRadiusMm,
      envelopeMm: item.envelopeMm,
      provenance: item.envelopeProvenance,
    })),
  ];
  for (const entry of bounded) {
    const { outerSignedMm, innerSignedMm } = clearanceFor(
      entry.centerRadiusMm,
      entry.envelopeMm,
      frame,
    );
    clearances.push({
      elementId: entry.id,
      elementKind: entry.kind,
      centerRadiusMm: entry.centerRadiusMm,
      envelopeMm: entry.envelopeMm,
      outerSignedMm,
      innerSignedMm,
      envelopeProvenance: entry.provenance,
    });
    if (entry.centerRadiusMm > frame.outerRadius) {
      warnings.push({
        kind: "definitely-outside",
        elementId: entry.id,
        side: "outer",
        message: `«${entry.id}» está definitivamente fuera del borde exterior: su centro (${entry.centerRadiusMm.toFixed(2)} mm) supera el radio exterior (${frame.outerRadius.toFixed(2)} mm).`,
        provenance: "exact-anchor-vs-reference",
      });
    } else if (entry.centerRadiusMm < frame.innerRadius) {
      warnings.push({
        kind: "definitely-outside",
        elementId: entry.id,
        side: "inner",
        message: `«${entry.id}» está definitivamente fuera del borde interior: su centro (${entry.centerRadiusMm.toFixed(2)} mm) está dentro del radio interior (${frame.innerRadius.toFixed(2)} mm).`,
        provenance: "exact-anchor-vs-reference",
      });
    } else {
      if (outerSignedMm < 0) {
        warnings.push({
          kind: "boundary-spill",
          elementId: entry.id,
          side: "outer",
          signedClearanceMm: outerSignedMm,
          message: `«${entry.id}» puede cruzar el borde exterior (holgura firmada ${outerSignedMm.toFixed(2)} mm): envolvente conservadora, no colisión de tinta probada.`,
          provenance: "conservative-envelope-signed-clearance",
        });
      }
      if (innerSignedMm < 0) {
        warnings.push({
          kind: "boundary-spill",
          elementId: entry.id,
          side: "inner",
          signedClearanceMm: innerSignedMm,
          message: `«${entry.id}» puede cruzar el borde interior (holgura firmada ${innerSignedMm.toFixed(2)} mm): envolvente conservadora, no colisión de tinta probada.`,
          provenance: "conservative-envelope-signed-clearance",
        });
      }
    }
  }

  for (const text of texts) {
    clearances.push({
      elementId: text.id,
      elementKind: "text",
      centerRadiusMm: text.anchorRadiusMm,
      envelopeMm: null,
      outerSignedMm: null,
      innerSignedMm: null,
      envelopeProvenance:
        "unmeasured: browser/font-dependent ink bounds not supplied, no dimensions invented",
    });
    // Exact text-anchor geometry: an anchor outside [Ri, Ro] is
    // definitely-outside (same wording family as icons/approved, exact
    // anchorRadiusMm provenance) — no envelope is invented for text.
    if (text.anchorRadiusMm > frame.outerRadius) {
      warnings.push({
        kind: "definitely-outside",
        elementId: text.id,
        side: "outer",
        message: `«${text.id}» está definitivamente fuera del borde exterior: su ancla (${text.anchorRadiusMm.toFixed(2)} mm) supera el radio exterior (${frame.outerRadius.toFixed(2)} mm).`,
        provenance: "exact-anchor-vs-reference",
      });
    } else if (text.anchorRadiusMm < frame.innerRadius) {
      warnings.push({
        kind: "definitely-outside",
        elementId: text.id,
        side: "inner",
        message: `«${text.id}» está definitivamente fuera del borde interior: su ancla (${text.anchorRadiusMm.toFixed(2)} mm) está dentro del radio interior (${frame.innerRadius.toFixed(2)} mm).`,
        provenance: "exact-anchor-vs-reference",
      });
    }
    if (text.baselineIssue) {
      warnings.push({
        kind: "text-baseline-unavailable",
        elementId: text.id,
        message: `«${text.id}»: ${text.baselineIssue}`,
        provenance: "exact-baseline-radius-check",
      });
    }
    if (text.spanClamped) {
      // Floor vs ceiling: a span clamped at 7° means the arc is WIDER than
      // the glyph run (knockout band only — the text path is never clipped);
      // a span clamped at 135° means the arc saturates the source top.
      // Same 7..135 source clamp mirror, distinct wording per bound.
      const atFloor = text.halfSpanDegrees === SOURCE_TEXT.halfSpanMin;
      warnings.push({
        kind: "text-span-clamped",
        elementId: text.id,
        halfSpanDegrees: text.halfSpanDegrees ?? SOURCE_TEXT.halfSpanMax,
        message: atFloor
          ? `«${text.id}»: el arco del texto alcanza el piso de la fuente (7°): el arco es más ancho que el recorrido de glifos, solo banda de recorte; el camino del texto nunca se recorta. Se espeja el clamp del editor (7..135°), no es aptitud de fabricación.`
          : `«${text.id}»: el arco del texto satura el tope de la fuente (7..135°): se espeja el clamp del editor, no es aptitud de fabricación.`,
        provenance:
          "source-arc-clamp-mirror: CurvedText clamps layout half-span to 7..135 degrees",
      });
    }
    warnings.push({
      kind: "text-ink-unmeasured",
      elementId: text.id,
      message: `«${text.id}»: tinta sin métricas de tinta medidas del navegador; no se afirma invasión ni holgura de tinta.`,
      provenance: "measured-font-envelope-absent",
    });
  }

  // Pairwise conservative lower bounds over bounded (enveloped) elements.
  const points = [...icons, ...approved].map((entry) => ({
    id: entry.id,
    x: entry.center.x,
    y: entry.center.y,
    envelopeMm: entry.envelopeMm,
  }));
  const pairClearances: PhysicalReport["pairClearances"] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      const centerDistanceMm = Math.hypot(a.x - b.x, a.y - b.y);
      const pairClearanceMm = centerDistanceMm - a.envelopeMm - b.envelopeMm;
      pairClearances.push({
        firstId: a.id,
        secondId: b.id,
        centerDistanceMm,
        pairClearanceMm,
        potentialOverlap: pairClearanceMm < 0,
      });
      if (pairClearanceMm < 0) {
        warnings.push({
          kind: "potential-overlap",
          firstId: a.id,
          secondId: b.id,
          pairClearanceMm,
          message: `«${a.id}» y «${b.id}» tienen envolventes que pueden superponerse (cota inferior ${pairClearanceMm.toFixed(2)} mm): POTENTIAL ENVELOPE overlap, no colisión de tinta probada.`,
          provenance: "pairwise-conservative-lower-bound: centerDistance-e1-e2",
        });
      }
    }
  }
  if (
    !allFinite(
      pairClearances.flatMap((pair) => [
        pair.centerDistanceMm,
        pair.pairClearanceMm,
      ]),
    )
  ) {
    return {
      ok: false,
      issues: [
        {
          code: "NUMERIC_OVERFLOW",
          field: "derived",
          message:
            "La geometría calculada no es finita (desbordamiento numérico).",
        },
      ],
    };
  }

  return {
    ok: true,
    report: {
      frame,
      texts,
      icons,
      approved,
      lines,
      lineClearances,
      lineKnockouts,
      clearances,
      pairClearances,
      warnings,
      provenance:
        frame.strategy === "band-thickness"
          ? REPORT_PROVENANCE_BAND
          : REPORT_PROVENANCE,
    },
  };
}

/**
 * JSON serialization guard: finite outputs serialize; anything nonfinite is
 * an explicit numeric-unsupported error, never silent null/Infinity JSON.
 * Exact 0 boundary: clearances compare against 0 with no safety threshold.
 */
export function serializeReport(report: PhysicalReport): SerializeResult {
  const numbers: number[] = [];
  JSON.stringify(report, (_key, value: unknown) => {
    if (typeof value === "number") numbers.push(value);
    return value;
  });
  if (!allFinite(numbers)) {
    return {
      ok: false,
      code: "NUMERIC_UNSUPPORTED",
      reason:
        "El reporte contiene valores no finitos y no puede serializarse a JSON.",
    };
  }
  return { ok: true, json: JSON.stringify(report) };
}
