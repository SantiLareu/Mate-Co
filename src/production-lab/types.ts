import type { CircularLines } from "../App";
import type {
  ApprovedDesignInstance,
  ApprovedDesignSnapshot,
} from "../approved-designs/approvedDesign";
import type { DesignIcon } from "../components/IconElement";
import type { TextElement } from "../components/CurvedText";

/**
 * Pure physical-lab model (P1, S1–S8). No DOM, no React, no parsing.
 *
 * Geometry decision: with measured diameters Do (outer) and Di (inner),
 * Ro = Do/2, Ri = Di/2, positionSlope = (Ro - Ri)/131,
 * mapRadius(r) = Ri + (r - 292) * positionSlope, physical center (0, 0),
 * x = rMap * cos((angle - 90)°), y = rMap * sin((angle - 90)°), i.e. the
 * actual source convention: angle 0 at TOP, clockwise, y down (the legacy
 * "angle 0 points down" source comment is false; the formula is what ships).
 *
 * Sizing strategy (C1): the anchor mapping above is IDENTICAL in both
 * strategies; only sizeFactor changes. Mode A (outer-diameter, product
 * default): sizeFactor = Ro/423. Mode B (band-thickness, lab-only):
 * sizeFactor = (Ro - Ri)/131 = positionSlope, so a source envelope in rim
 * contact (r ± envelope = 292/423) maps exactly onto Ri/Ro. Every placement
 * derives from immutable source units + the current frame, so toggling
 * strategy or measures never accumulates scaling.
 */

export type SizingStrategy = "outer-diameter" | "band-thickness";

export type DiameterField = "outerDiameter" | "innerDiameter" | "derived";

export type DiameterIssueCode =
  | "NOT_FINITE"
  | "NOT_POSITIVE"
  | "INNER_NOT_LESS_THAN_OUTER"
  | "NUMERIC_OVERFLOW";

export type DiameterIssue = {
  code: DiameterIssueCode;
  field: DiameterField;
  /** User-facing Spanish string; codes stay machine-stable. */
  message: string;
};

export type SourceReference = {
  center: number;
  innerRadius: number;
  outerRadius: number;
  bandWidth: number;
};

/** Frozen deterministic frame derived from one validated diameter pair. */
export type PhysicalFrame = {
  outerDiameter: number;
  innerDiameter: number;
  outerRadius: number;
  innerRadius: number;
  positionSlope: number;
  /**
   * Per-strategy size: Ro/423 (outer-diameter) or (Ro-Ri)/131 = positionSlope
   * (band-thickness). Every consumer scales source units by this one factor,
   * exactly once; anchors never depend on it.
   */
  sizeFactor: number;
  /** Active sizing strategy; outer-diameter is the backward-compatible default. */
  strategy: SizingStrategy;
  source: SourceReference;
  provenance: string;
};

export type FrameResult =
  { ok: true; frame: PhysicalFrame } | { ok: false; issues: DiameterIssue[] };

export type PhysicalPoint = { x: number; y: number };

/**
 * Browser-measured text ADVANCE length (getComputedTextLength), in the SAME
 * unit as the radii it is combined with (mm when measured on the
 * physical-size render, source units when measured on the editor-scale
 * render — convert with scaleToPhysical first). This is an advance length,
 * NOT an ink bbox: `measured` on PlacedText means advance-length known, ink
 * still unknown until a UI getBBox stage supplies real ink bounds — never
 * invent an envelope from the advance. Provenance: browser
 * getComputedTextLength, therefore font-dependent; never machine-certified.
 */
export type TextMeasurement = {
  lengthMm: number;
  provenance: string;
};

export type PlacedText = {
  kind: "text";
  id: string;
  angle: number;
  anchorRadiusMm: number;
  /** Null with baselineIssue when the baseline radius is nonpositive. */
  baselineRadiusMm: number | null;
  baselineIssue: string | null;
  center: PhysicalPoint;
  fontSizeMm: number;
  letterSpacingMm: number;
  /** Null for non-inverted text (source renders no dy then). */
  invertedDyMm: number | null;
  sweep: 0 | 1;
  /** Null when no browser measurement was supplied. */
  halfSpanDegrees: number | null;
  /**
   * True when the measured span saturated at the source editor clamp
   * (7..135°); the report carries an explicit text-span-clamped warning.
   * False when unmeasured or inside the clamp.
   */
  spanClamped: boolean;
  /**
   * True when a browser ADVANCE length was supplied. Advance known does NOT
   * mean ink known: ink stays unmeasured (text-ink-unmeasured) until a UI
   * getBBox stage.
   */
  measured: boolean;
};

export type PlacedIcon = {
  kind: "icon";
  id: string;
  center: PhysicalPoint;
  centerRadiusMm: number;
  /** Uniform local scale: source scale * sizeFactor (aspect preserved). */
  localScale: number;
  localScaleX: number;
  localScaleY: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
  envelopeMm: number;
  envelopeProvenance: string;
};

export type PlacedApproved = {
  kind: "approved";
  id: string;
  approvedDesignId: string;
  /** Same reference as the source instance: identity retained, never copied. */
  snapshot: ApprovedDesignSnapshot;
  center: PhysicalPoint;
  centerRadiusMm: number;
  localScale: number;
  localScaleX: number;
  localScaleY: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
  envelopeMm: number;
  envelopeProvenance: string;
  displaySizeMm: { width: number; height: number };
};

export type PlacedCircularLine = {
  /** Stable id: `line-<sourceRadius>` (rings are strokes, never filled disks). */
  id: string;
  sourceRadius: number;
  radiusMm: number;
  strokeWidthMm: number;
};

/**
 * Exact stroke clearance of one decorative ring: Ro-(r+sw/2) outside,
 * (r-sw/2)-Ri inside. Underlying circular-stroke geometry BEFORE the visual
 * knockout (see LineKnockout): negative means the stroke paint may cross the
 * reference edge, never a fabrication threshold.
 */
export type LineClearance = {
  lineId: string;
  sourceRadius: number;
  radiusMm: number;
  strokeWidthMm: number;
  outerSignedMm: number;
  innerSignedMm: number;
  provenance: string;
};

/**
 * Visual-knockout descriptor for the decorative lines, mirroring the ACTUAL
 * source `decorative-lines-knockout` mask rules (MatePreview + CurvedText +
 * IconElement + ApprovedDesignElement) under the lab's annular-anchor +
 * per-strategy size policy. Artistic mask, part of the original decor — NEVER a
 * manufacturing margin: clearance envelopes/reports must not use these.
 */
export type LineKnockout =
  | {
      kind: "icon-disk";
      id: string;
      center: PhysicalPoint;
      radiusMm: number;
      provenance: string;
    }
  | {
      kind: "approved-disk";
      id: string;
      center: PhysicalPoint;
      radiusMm: number;
      provenance: string;
    }
  | {
      kind: "text-band";
      id: string;
      angle: number;
      anchorRadiusMm: number;
      halfSpanDegrees: number;
      strokeWidthMm: number;
      provenance: string;
    };

export type ElementClearance = {
  elementId: string;
  elementKind: "text" | "icon" | "approved";
  centerRadiusMm: number;
  /** Null for unmeasured text: no envelope is invented. */
  envelopeMm: number | null;
  /** Ro - (r + envelope). Null when the envelope is unknown. */
  outerSignedMm: number | null;
  /** (r - envelope) - Ri. Null when the envelope is unknown. */
  innerSignedMm: number | null;
  envelopeProvenance: string;
};

export type PairClearance = {
  firstId: string;
  secondId: string;
  centerDistanceMm: number;
  /** centerDistance - e1 - e2: guaranteed lower bound, never ink truth. */
  pairClearanceMm: number;
  potentialOverlap: boolean;
};

export type PhysicalWarning =
  | {
      kind: "boundary-spill";
      elementId: string;
      side: "outer" | "inner";
      signedClearanceMm: number;
      message: string;
      provenance: string;
    }
  | {
      kind: "definitely-outside";
      elementId: string;
      side: "outer" | "inner";
      message: string;
      provenance: string;
    }
  | {
      kind: "potential-overlap";
      firstId: string;
      secondId: string;
      pairClearanceMm: number;
      message: string;
      provenance: string;
    }
  | {
      kind: "line-boundary-spill";
      lineId: string;
      side: "outer" | "inner";
      signedClearanceMm: number;
      message: string;
      provenance: string;
    }
  | {
      kind: "text-ink-unmeasured";
      elementId: string;
      message: string;
      provenance: string;
    }
  | {
      kind: "text-baseline-unavailable";
      elementId: string;
      message: string;
      provenance: string;
    }
  | {
      kind: "text-span-clamped";
      elementId: string;
      halfSpanDegrees: number;
      message: string;
      provenance: string;
    }
  | {
      kind: "numeric-unsupported";
      elementId: string;
      message: string;
      provenance: string;
    };

export type PhysicalReport = {
  frame: PhysicalFrame;
  texts: PlacedText[];
  icons: PlacedIcon[];
  approved: PlacedApproved[];
  lines: PlacedCircularLine[];
  /** Exact underlying-stroke clearances per ring (before visual knockout). */
  lineClearances: LineClearance[];
  /** Artistic visual-knockout descriptors (source mask rules, never margins). */
  lineKnockouts: LineKnockout[];
  clearances: ElementClearance[];
  pairClearances: PairClearance[];
  warnings: PhysicalWarning[];
  provenance: string;
};

export type ReportInput = {
  outerDiameter: number;
  innerDiameter: number;
  /** Sizing strategy; omitted means outer-diameter (existing behavior). */
  strategy?: SizingStrategy;
  texts: Array<{ element: TextElement; measurement?: TextMeasurement }>;
  icons: DesignIcon[];
  approved: ApprovedDesignInstance[];
  circularLines: CircularLines;
};

export type ReportResult =
  { ok: true; report: PhysicalReport } | { ok: false; issues: DiameterIssue[] };

export type SerializeResult =
  | { ok: true; json: string }
  | { ok: false; code: "NUMERIC_UNSUPPORTED"; reason: string };

/**
 * E1 physical vector export contract (Stage 3, fonts-block-gate L2).
 * Additive only: every existing report type above is untouched.
 *
 * The core (`exportSvg.ts`) is a pure sync DOM-free serializer:
 * buildLabPhysicalSvg({ report, ... }) -> { ok: true, svg, meta } |
 * { ok: false, code, reason }. Numbers are physical millimetres read from
 * the SAME PhysicalReport the preview renders; radii are ALREADY mm
 * (diameters = 2R). No Date/random/Blob/DOM anywhere in this path.
 */

/**
 * Fail-closed asset descriptor computed by the CALLER (E2 wires the real
 * DOM scan there). A string scan of the SVG is NOT reliable, so the core
 * never sniffs bytes: it trusts these three flags and rejects on true.
 * E2 must set them from the approved-asset DOM pass (raster data:image
 * payloads, filter/fe* features, <text>/<font-family> inside assets).
 */
export type LabExportAssetFlags = {
  hasRaster: boolean;
  hasUnsupportedFeature: boolean;
  hasText: boolean;
};

export type LabExportCode =
  | "FONT_OUTLINES_UNAVAILABLE"
  | "TEXT_SPAN_UNMEASURED"
  | "RASTER_ASSET_BLOCKED"
  | "UNSUPPORTED_ASSET_FEATURE"
  | "GRAPHICS_NOT_EXPORTED"
  | "INVALID_MEASURES";

export type LabExportMeta = {
  outerDiameterMm: number;
  innerDiameterMm: number;
  strategy: SizingStrategy;
  /** Frame sizeFactor (mm per source unit) the export was scaled with. */
  sizeFactor: number;
  fileName: string;
};

export type LabExportResult =
  | { ok: true; svg: string; meta: LabExportMeta }
  | { ok: false; code: LabExportCode; reason: string };

/**
 * Core input. `iconPaths` maps PLACED icon id -> catalog path data; the
 * core never resolves the catalog itself (no iconById import), so the
 * caller supplies the embedded defs (E2 wires iconById there). A placed
 * icon with no entry fails closed as UNSUPPORTED_ASSET_FEATURE.
 */
export type BuildLabPhysicalSvgInput = {
  report: PhysicalReport;
  iconPaths: Record<string, readonly string[]>;
  assetFlags?: LabExportAssetFlags;
  /**
   * E3 job-graphics scope gate (Stage 3 S6, J3 disclosure): number of
   * traced vector graphics (composition.graphics) in the SOURCE job. The
   * physical engine covers texts/icons/approved only, so a count > 0
   * fails closed as GRAPHICS_NOT_EXPORTED instead of silently omitting
   * the paths from the file. Omitted (or 0) means graphics-free.
   */
  graphicsCount?: number;
  /**
   * E2 v3 inline payloads: placed approved id -> namespaced nested-<svg>
   * string from exportApprovedAsset.embedApprovedAsset (DOM rewrite with
   * the `lab-x-<placedId>-` prefix, own viewBox kept, centered fit-64 box).
   * The core stays DOM-free: it only nests the supplied strings under the
   * PhysicalApproved pose wrapper. A v3 placement with no entry fails
   * closed as UNSUPPORTED_ASSET_FEATURE (E1 behavior preserved).
   */
  approvedEmbeds?: Record<string, string>;
  fileName?: string;
};
