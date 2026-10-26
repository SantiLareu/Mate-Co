import { expect, test } from "@playwright/test";
import { buildPhysicalReport } from "../src/production-lab/geometry";
import type { PhysicalReport, ReportInput } from "../src/production-lab/types";
import type { ApprovedDesignInstance } from "../src/approved-designs/approvedDesign";
import type { DesignIcon } from "../src/components/IconElement";
import type { TextElement } from "../src/components/CurvedText";
import { buildLabPhysicalSvg } from "../src/production-lab/exportSvg";
import {
  knockoutBandFor,
  knockoutDiskFor,
  lineEngravingSegments,
} from "../src/production-lab/exportKnockouts";
import { checkLabTextsBlocked } from "../src/production-lab/exportTextOutlines";

/**
 * E1 pure export core (Stage 3, fonts-block-gate L2). Node-only pattern:
 * hand-computed literals, never derived from the implementation under test.
 *
 * Reference arithmetic (node calculator):
 * 80/60 B: Ro=40, Ri=30, k=(40-30)/131=0.07633587786259542.
 * 85/50 B: Ro=42.5, Ri=25, k=17.5/131=0.13358778625954199.
 * 75/65 B: k=5/131=0.03816793893129771.
 */

const reportOrThrow = (input: ReportInput): PhysicalReport => {
  const result = buildPhysicalReport(input);
  if (!result.ok)
    throw new Error(`report rejected: ${JSON.stringify(result.issues)}`);
  return result.report;
};

const sparkIcon = (id: string, angle: number, radius: number): DesignIcon => ({
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

test("E1 root/mm contract + ring reference group (80/60 strategy B, empty)", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const result = buildLabPhysicalSvg({ report, iconPaths: {} });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.meta.outerDiameterMm).toBe(80);
  expect(result.meta.innerDiameterMm).toBe(60);
  expect(result.meta.strategy).toBe("band-thickness");
  // Empty composition is valid: rings only (documented decision).
  expect(result.svg).toContain('width="80mm"');
  expect(result.svg).toContain('height="80mm"');
  expect(result.svg).toContain('viewBox="0 0 80 80"');
  expect(result.svg).toContain('id="lab-ring-reference"');
  expect(result.svg).toContain('id="lab-engraving"');
  // Ring group is a SIBLING of the engraving group, never nested inside it.
  const ringIndex = result.svg.indexOf('id="lab-ring-reference"');
  const engravingIndex = result.svg.indexOf('id="lab-engraving"');
  expect(ringIndex).toBeGreaterThan(-1);
  expect(engravingIndex).toBeGreaterThan(-1);
  expect(ringIndex).toBeLessThan(engravingIndex);
  expect(result.svg).toContain('<circle cx="40" cy="40" r="40"');
  expect(result.svg).toContain('<circle cx="40" cy="40" r="30"');
  // Measurement-reference paint per product convention (#0000FF 1.5).
  expect(result.svg).toContain('stroke="#0000FF"');
  expect(result.svg).toContain('stroke-width="1.5"');
});

test("E1 decimal measures stay exact (80.5 outer)", () => {
  const report = reportOrThrow({
    outerDiameter: 80.5,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const result = buildLabPhysicalSvg({ report, iconPaths: {} });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).toContain('width="80.5mm"');
  expect(result.svg).toContain('height="80.5mm"');
  expect(result.svg).toContain('viewBox="0 0 80.5 80.5"');
  expect(result.svg).toContain('<circle cx="40.25" cy="40.25" r="40.25"');
  expect(result.svg).toContain('<circle cx="40.25" cy="40.25" r="30"');
});

test("E1 strategy-B factor table + one full icon placement (85/50, 75/65)", () => {
  for (const [outer, inner, expected] of [
    [85, 50, 0.13358778625954199],
    [75, 65, 0.03816793893129771],
  ] as const) {
    const report = reportOrThrow({
      outerDiameter: outer,
      innerDiameter: inner,
      strategy: "band-thickness",
      texts: [],
      icons: [],
      approved: [],
      circularLines: "none",
    });
    const result = buildLabPhysicalSvg({ report, iconPaths: {} });
    if (!result.ok) throw new Error(`export rejected: ${result.code}`);
    expect(result.meta.strategy).toBe("band-thickness");
    expect(result.svg).toContain(`data-size-factor="${String(expected)}"`);
  }
  // Full placement: icon angle 0 (TOP) radius 360 scale 1, 85/50 B.
  // mapR = 25 + 68*17.5/131 = 34.083969465648856; center (0, -mapR).
  // h = Ro = 42.5 (icon + envelope 38.47 < 42.5), so export center (42.5,42.5)
  // and icon at (42.5, 42.5-34.083969465648856 = 8.416030534351144).
  const report = reportOrThrow({
    outerDiameter: 85,
    innerDiameter: 50,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-e1", 0, 360)],
    approved: [],
    circularLines: "none",
  });
  const result = buildLabPhysicalSvg({
    report,
    iconPaths: {
      "icon-e1": ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
    },
  });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).toContain('width="85mm"');
  expect(result.svg).toContain("translate(42.5 8.416030534351144)");
  expect(result.svg).toContain(
    "scale(0.13358778625954199 0.13358778625954199)",
  );
  expect(result.svg).toContain(
    "M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z",
  );
  // PhysicalIcon paint model mirrored exactly.
  expect(result.svg).toContain('stroke="#171717"');
  expect(result.svg).toContain("scale(1.4) translate(-16 -16)");
});

test("E1 fonts-block-gate: any text fails closed with evidence", () => {
  const element: TextElement = {
    id: "text-e1",
    text: "Hola",
    fontFamily: "Georgia",
    angle: 0,
    radius: 374,
    inverted: false,
  };
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [
      {
        element,
        measurement: {
          lengthMm: 40,
          provenance: "browser-getComputedTextLength",
        },
      },
    ],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const gate = checkLabTextsBlocked(report.texts);
  expect(gate.ok).toBe(false);
  if (gate.ok) throw new Error("font gate passed with text present");
  expect(gate.code).toBe("FONT_OUTLINES_UNAVAILABLE");
  const result = buildLabPhysicalSvg({ report, iconPaths: {} });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("export passed with text present");
  expect(result.code).toBe("FONT_OUTLINES_UNAVAILABLE");
  expect(result.reason.length).toBeGreaterThan(50);
  expect(result.reason).toMatch(/Bloqueo/);
  // Etapa 4: el bloqueo sigue si los contornos no están calculados, y también
  // si faltan los de algún texto concreto (nunca un archivo incompleto).
  const partial = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    textOutlines: { "otro-texto": { paths: [], shaperVersion: "15.0.0", advanceMm: 0 } },
  });
  expect(partial.ok).toBe(false);
  if (partial.ok) throw new Error("export passed with missing outlines");
  expect(partial.code).toBe("FONT_OUTLINES_UNAVAILABLE");
  expect(partial.reason).toMatch(/text-e1/);
});

test("E1 asset flags fail closed with exact codes", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const raster = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    assetFlags: {
      hasRaster: true,
      hasUnsupportedFeature: false,
      hasText: false,
    },
  });
  expect(raster.ok).toBe(false);
  if (raster.ok) throw new Error("raster accepted");
  expect(raster.code).toBe("RASTER_ASSET_BLOCKED");
  const unsupported = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    assetFlags: {
      hasRaster: false,
      hasUnsupportedFeature: true,
      hasText: false,
    },
  });
  expect(unsupported.ok).toBe(false);
  if (unsupported.ok) throw new Error("unsupported feature accepted");
  expect(unsupported.code).toBe("UNSUPPORTED_ASSET_FEATURE");
  const textInAsset = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    assetFlags: {
      hasRaster: false,
      hasUnsupportedFeature: false,
      hasText: true,
    },
  });
  expect(textInAsset.ok).toBe(false);
  if (textInAsset.ok) throw new Error("text-in-asset accepted");
  expect(textInAsset.code).toBe("FONT_OUTLINES_UNAVAILABLE");
});

test("E1 single line interrupted by one icon disk: exact uncovered arc", () => {
  // 80/60 B: line 357 -> R = 30+65*10/131 = 34.961832061068705.
  // Icon angle 90 radius 360 -> center (35.19083969465649, 0), arc-angle 0,
  // knockout rho = (25*sqrt2+4)*10/131 = 3.0042243556738457,
  // half = acos((R^2+d^2-rho^2)/2Rd) = 4.894515096911905 deg.
  // Uncovered single segment [4.894515096911905, 355.1054849030881].
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-ko", 90, 360)],
    approved: [],
    circularLines: "single",
  });
  expect(report.lineKnockouts).toHaveLength(1);
  const result = buildLabPhysicalSvg({
    report,
    iconPaths: {
      "icon-ko": ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
    },
  });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).toContain(
    'd="M34.83 2.98 A34.96 34.96 0 1 1 34.83 -2.98"',
  );
  expect(result.svg).toContain('stroke-width="0.15267175572519084"');
  // No text band exists when texts are absent.
  expect(
    report.lineKnockouts.some((knockout) => knockout.kind === "text-band"),
  ).toBe(false);
  // Double mode: both rings emit their own interrupted arc with the same
  // per-line stroke width (one icon disk knocks both rings).
  const doubleReport = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-ko", 90, 360)],
    approved: [],
    circularLines: "double",
  });
  const doubleResult = buildLabPhysicalSvg({
    report: doubleReport,
    iconPaths: {
      "icon-ko": ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
    },
  });
  if (!doubleResult.ok)
    throw new Error(`export rejected: ${doubleResult.code}`);
  expect(
    doubleResult.svg.split('stroke-width="0.15267175572519084"').length - 1,
  ).toBe(2);
});

test("E1 knockout converters: disk descriptor + band interval math", () => {
  const disk = knockoutDiskFor(
    { x: 35.19083969465649, y: 0 },
    3.0042243556738457,
  );
  expect(disk.angleDegrees).toBe(0);
  expect(disk.distance).toBe(35.19083969465649);
  expect(disk.radius).toBe(3.0042243556738457);
  // Text band: radius=anchor, halfWidth=stroke/2+sizeFactor, offset=design angle.
  const band = knockoutBandFor(
    {
      kind: "text-band",
      id: "text-ko",
      angle: 0,
      anchorRadiusMm: 34.961832061068705,
      halfSpanDegrees: 30,
      strokeWidthMm: 0.15267175572519084,
      provenance: "test",
    },
    0.07633587786259542,
  );
  expect(band.radius).toBe(34.961832061068705);
  expect(band.halfWidth).toBeCloseTo(
    0.15267175572519084 / 2 + 0.07633587786259542,
    12,
  );
  expect(band.halfSpanDegrees).toBe(30);
  expect(band.angleOffsetDegrees).toBe(0);
  // Band centered at arc 270 (top = design 0): covered [240,300],
  // uncovered [0,240] + [300,360] with exact arcPath serialization.
  const segments = lineEngravingSegments(
    {
      id: "line-357",
      sourceRadius: 357,
      radiusMm: 34.961832061068705,
      strokeWidthMm: 0.15267175572519084,
    },
    [],
    [
      {
        radius: 34.961832061068705,
        halfWidth: 0.15267175572519084,
        halfSpanDegrees: 30,
        angleOffsetDegrees: 0,
      },
    ],
  );
  expect(segments.full).toBe(false);
  expect(segments.spans).toEqual([
    { start: 0, end: 240 },
    { start: 300, end: 360 },
  ]);
  expect(segments.paths).toEqual([
    "M34.96 0 A34.96 34.96 0 1 1 -17.48 -30.28",
    "M17.48 -30.28 A34.96 34.96 0 0 1 34.96 0",
  ]);
});

test("E1 orphan text-band knockout fails closed (defensive, unreachable)", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "single",
  });
  const tampered: PhysicalReport = {
    ...report,
    lineKnockouts: [
      {
        kind: "text-band",
        id: "orphan",
        angle: 0,
        anchorRadiusMm: 35,
        halfSpanDegrees: 30,
        strokeWidthMm: 1,
        provenance: "tampered",
      },
    ],
  };
  const result = buildLabPhysicalSvg({ report: tampered, iconPaths: {} });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("orphan band accepted");
  expect(result.code).toBe("TEXT_SPAN_UNMEASURED");
});

test("E1 determinism: byte-identical repeat; strategy changes factor", () => {
  const input: ReportInput = {
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-det", 90, 360)],
    approved: [],
    circularLines: "single",
  };
  const report = reportOrThrow(input);
  const iconPaths = {
    "icon-det": ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
  };
  const first = buildLabPhysicalSvg({ report, iconPaths });
  const second = buildLabPhysicalSvg({ report, iconPaths });
  if (!first.ok || !second.ok) throw new Error("determinism export rejected");
  expect(second.svg).toBe(first.svg);
  const reportA = reportOrThrow({ ...input, strategy: "outer-diameter" });
  const other = buildLabPhysicalSvg({ report: reportA, iconPaths });
  if (!other.ok) throw new Error("strategy-A export rejected");
  expect(other.svg).not.toBe(first.svg);
  expect(other.svg).toContain('data-strategy="outer-diameter"');
  expect(first.svg).toContain('data-strategy="band-thickness"');
  expect(other.meta.strategy).toBe("outer-diameter");
});

test("E1 no rasterization and no external references", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-vec", 90, 360)],
    approved: [],
    circularLines: "single",
  });
  const result = buildLabPhysicalSvg({
    report,
    iconPaths: { "icon-vec": ["M16 2 20 12 30 16 12 12Z"] },
  });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).not.toContain("<image");
  expect(result.svg).not.toContain("data:image");
  // The single xmlns declaration is the only permitted URL/namespace.
  const withoutXmlns = result.svg.replace(
    'xmlns="http://www.w3.org/2000/svg"',
    "",
  );
  expect(withoutXmlns).not.toContain("http");
  expect(result.svg).not.toContain("xlink");
  expect(result.svg).not.toContain("href=");
  expect(result.svg).not.toContain("<text");
  expect(result.svg.match(/xmlns=/g)).toHaveLength(1);
  expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test("E1 v1/v2 approved geometry serializes; v3 blocks (E2 scope)", () => {
  const snapshotV2 = {
    version: 2 as const,
    id: "design-v2",
    name: "Cuadrado",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    geometry: {
      version: 2 as const,
      root: 0,
      paths: [
        {
          d: "M0 0H10V10H0Z",
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          style: {
            fill: "black",
            stroke: "none",
            strokeWidth: 1,
            linecap: "butt" as const,
            linejoin: "miter" as const,
            miterlimit: 4,
            dasharray: [],
            dashoffset: 0,
            fillRule: "nonzero" as const,
            fillOpacity: 1,
            strokeOpacity: 1,
          },
        },
      ],
      nodes: [{ kind: "path" as const, opacity: 1, path: 0 }],
      centerlineBounds: { x: 0, y: 0, width: 10, height: 10 },
      artBounds: { x: 0, y: 0, width: 10, height: 10 },
    },
  };
  const instance: ApprovedDesignInstance = {
    id: "ap-v2",
    type: "approved-design",
    approvedDesignId: "design-v2",
    snapshot: snapshotV2,
    angle: 0,
    radius: 360,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  };
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [instance],
    circularLines: "none",
  });
  const result = buildLabPhysicalSvg({ report, iconPaths: {} });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).toContain("M0 0H10V10H0Z");
  expect(result.svg).toContain("matrix(1 0 0 1 0 0)");
  expect(result.svg).not.toContain("<image");
  const snapshotV3 = {
    version: 3 as const,
    id: "design-v3",
    name: "Asset",
    category: "Clásica",
    enabled: true,
    createdAt: "2026-01-01",
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    width: 80,
    height: 80,
    viewBox: { x: 0, y: 0, width: 80, height: 80 },
  };
  const reportV3 = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [
      {
        id: "ap-v3",
        type: "approved-design",
        approvedDesignId: "design-v3",
        snapshot: snapshotV3,
        angle: 0,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    circularLines: "none",
  });
  const blocked = buildLabPhysicalSvg({ report: reportV3, iconPaths: {} });
  expect(blocked.ok).toBe(false);
  if (blocked.ok) throw new Error("v3 accepted in E1");
  expect(blocked.code).toBe("UNSUPPORTED_ASSET_FEATURE");
});

test("E1 invalid report rejected defensively", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const tampered: PhysicalReport = {
    ...report,
    frame: { ...report.frame, outerRadius: Number.NaN },
  };
  const result = buildLabPhysicalSvg({ report: tampered, iconPaths: {} });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("NaN frame accepted");
  expect(result.code).toBe("INVALID_MEASURES");
});

/*
 * E2 browser suite: approved v3 inline embedding (DOM ID namespacing +
 * fail-closed scan) + "Exportar SVG físico" UI in demo and ?jobId modes.
 * RED basis: src/production-lab/exportApprovedAsset.ts and the lab export
 * panel do not exist yet, so every test below fails before implementation.
 */
import type { Page as E2Page } from "@playwright/test";
import { readFileSync as e2ReadFileSync } from "node:fs";
import { fileURLToPath as e2FileUrl } from "node:url";

const E2_JOBS_DB = "mateco.jobs.v1";
const e2MessiRaw = (): string =>
  e2ReadFileSync(
    e2FileUrl(new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url)),
    "utf8",
  );

/** Vector keep-case asset: gradient + clipPath + class style. */
const E2_GRADIENT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/>' +
  '<stop offset="1" stop-color="#ffffff"/></linearGradient>' +
  '<clipPath id="c"><rect x="10" y="10" width="60" height="60"/></clipPath></defs>' +
  '<rect x="10" y="10" width="60" height="60" fill="url(#g)" clip-path="url(#c)"/>' +
  "<style>.k{fill:#000000}</style>" +
  '<rect x="20" y="20" width="10" height="10" class="k"/></svg>';
const E2_GRADIENT_SVG_B = E2_GRADIENT_SVG.replace("#000000", "#aa0000").replace(
  "#ffffff",
  "#0000aa",
);
const E2_RASTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
  '<image href="data:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="10" height="10"/></svg>';
const E2_EXTERNAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
  '<image href="https://example.com/a.png" x="0" y="0" width="10" height="10"/></svg>';
const E2_FILTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter>' +
  '<rect x="2" y="2" width="16" height="16" filter="url(#f)"/></svg>';
const E2_TEXT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' +
  '<text font-family="Arial" font-size="10" x="2" y="12">Hola</text></svg>';
const E2_DANGLING_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
  '<rect x="10" y="10" width="60" height="60" fill="url(#missing)"/></svg>';
const E2_TYPE_STYLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  "<style>rect{fill:#ff0000}</style>" +
  '<rect x="2" y="2" width="16" height="16"/></svg>';

type E2Seed = {
  texts?: Array<{
    id: string;
    text: string;
    fontFamily: string;
    angle: number;
    radius: number;
    inverted: boolean;
    scale: number;
  }>;
  icons?: Array<{
    id: string;
    iconId: string;
    angle: number;
    radius: number;
    scale: number;
    rotation: number;
    mirrored: boolean;
    inverted: boolean;
  }>;
  lines?: "none" | "single" | "double";
  approvedSvgs?: Array<{ id: string; svg: string }>;
};

async function e2GotoReady(page: E2Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.getElementById("root")?.childElementCount ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

async function e2GotoLab(page: E2Page, jobId?: string): Promise<void> {
  await page.goto(jobId ? `/production-lab?jobId=${jobId}` : "/production-lab");
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toBeVisible();
}

async function e2ClearJobsDb(page: E2Page): Promise<void> {
  await page.evaluate(async (name: string) => {
    try {
      if (typeof indexedDB === "undefined" || indexedDB == null) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, E2_JOBS_DB);
}

/** Seed one lab job through the real repository + snapshot modules. */
async function e2SeedJob(
  page: E2Page,
  attemptKey: string,
  seed: E2Seed,
): Promise<void> {
  await page.evaluate(
    async ({ name, key, job }: { name: string; key: string; job: E2Seed }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
      const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
      const svgAsset = await import(
        /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
      );
      const store = repo.createJobsRepository({ name });
      const approved = [];
      for (const entry of job.approvedSvgs ?? []) {
        const admitted = svgAsset.importSvgAsset(entry.svg);
        if (!admitted.ok)
          throw new Error("seed v3 rejected: " + admitted.reason);
        approved.push({
          id: entry.id,
          type: "approved-design",
          approvedDesignId: "dsn-" + entry.id,
          snapshot: {
            version: 3,
            id: "dsn-" + entry.id,
            name: entry.id,
            category: "Arte",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            svg: admitted.asset.svg,
            width: admitted.asset.width,
            height: admitted.asset.height,
            viewBox: admitted.asset.viewBox,
          },
          angle: 180,
          radius: 357.5,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        });
      }
      const captured = snapshot.captureComposition({
        texts: job.texts ?? [],
        icons: (job.icons ?? []).map((icon) => ({ ...icon, type: "icon" })),
        graphics: [],
        approved,
        circularLines: job.lines ?? "none",
        resolveIcon: (iconId: string) => {
          const found = (
            icons as unknown as {
              iconById: Record<
                string,
                { id: string; name: string; category: string; paths: string[] }
              >;
            }
          ).iconById[iconId];
          if (!found) return null;
          return {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          };
        },
      });
      if (!captured.ok) throw new Error("seed capture failed");
      const created = await store.create({
        attemptKey: key,
        composition: captured.composition,
      });
      if (!created.ok) throw new Error("seed create failed");
    },
    { name: E2_JOBS_DB, key: attemptKey, job: seed },
  );
}

async function e2StoredBytes(
  page: E2Page,
  attemptKey: string,
): Promise<string> {
  return page.evaluate(
    async ({ name, key }: { name: string; key: string }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const store = repo.createJobsRepository({ name });
      const gotten = await store.get(key);
      if (!gotten.ok) throw new Error("get failed: " + gotten.error.code);
      return JSON.stringify(gotten.job);
    },
    { name: E2_JOBS_DB, key: attemptKey },
  );
}

async function e2FillDiameters(
  page: E2Page,
  outer: string,
  inner: string,
): Promise<void> {
  await page.getByTestId("lab-outer-input").fill(outer);
  await page.getByTestId("lab-inner-input").fill(inner);
}

async function e2ExpectMeasured(page: E2Page): Promise<void> {
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-measuring")).toHaveCount(0);
}

async function e2ExportBytes(
  page: E2Page,
): Promise<{ fileName: string; bytes: string }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("lab-export-button").click(),
  ]);
  const fileName = download.suggestedFilename();
  const path = await download.path();
  if (!path) throw new Error("download has no path");
  return { fileName, bytes: e2ReadFileSync(path, "utf8") };
}

/** Unresolved local refs left in an exported file (must be empty). */
function e2DanglingRefs(svg: string): string[] {
  const ids = new Set<string>();
  for (const match of svg.matchAll(/id="([^"]+)"/g)) ids.add(match[1]);
  const missing = new Set<string>();
  for (const match of svg.matchAll(/url\(#([^)]+)\)/g))
    if (!ids.has(match[1])) missing.add("url(#" + match[1] + ")");
  for (const match of svg.matchAll(/href="#([^"]+)"/g))
    if (!ids.has(match[1])) missing.add("href(#" + match[1] + ")");
  return [...missing];
}

test("E2 demo con texto: export habilitado con contornos vectoriales (Etapa 4)", async ({
  page,
}) => {
  await e2GotoLab(page);
  await e2FillDiameters(page, "100", "60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  const section = page.getByTestId("lab-export-section");
  await expect(section).toBeVisible();
  // Etapa 4: los textos del demo se exportan con sus contornos vectoriales
  // reales; el botón se habilita cuando el motor los ha calculado.
  await expect(page.getByTestId("lab-export-button")).toBeEnabled({
    timeout: 20000,
  });
  await expect(page.getByTestId("lab-export-status")).not.toContainText(
    "FONT_OUTLINES_UNAVAILABLE",
  );
  // Experimental label, never an apt-for-engraving mark.
  await expect(page.getByTestId("lab-export-experimental")).toContainText(
    /pendiente de validaci.n con el grabador/,
  );
  await expect(section).not.toContainText(/apto para grabar/i);
  await e2ClearJobsDb(page);
});

test("E2 scan contract: messi and keep-features pass; raster/filter/text/external block", async ({
  page,
}) => {
  await e2GotoLab(page);
  const verdict = await page.evaluate(
    async (inputs: {
      messi: string;
      keep: string;
      raster: string;
      external: string;
      filter: string;
      text: string;
      malformed: string;
    }) => {
      const asset = await import(
        /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
      );
      const probe = await import(
        /* @vite-ignore */ "/src/production-lab/exportApprovedAsset.ts"
      );
      const clean = (raw: string): string => {
        const admitted = asset.importSvgAsset(raw);
        if (!admitted.ok)
          throw new Error("fixture rejected: " + admitted.reason);
        return admitted.asset.svg;
      };
      return {
        messi: probe.scanApprovedAssetFlags(clean(inputs.messi)),
        keep: probe.scanApprovedAssetFlags(clean(inputs.keep)),
        raster: probe.scanApprovedAssetFlags(clean(inputs.raster)),
        external: probe.scanApprovedAssetFlags(inputs.external),
        filter: probe.scanApprovedAssetFlags(clean(inputs.filter)),
        text: probe.scanApprovedAssetFlags(clean(inputs.text)),
        malformed: probe.scanApprovedAssetFlags(inputs.malformed),
      };
    },
    {
      messi: e2MessiRaw(),
      keep: E2_GRADIENT_SVG,
      raster: E2_RASTER_SVG,
      external: E2_EXTERNAL_SVG,
      filter: E2_FILTER_SVG,
      text: E2_TEXT_SVG,
      malformed: "esto no es xml <",
    },
  );
  // Messi v3 (paths + fill only) passes the fail-closed scan.
  expect(verdict.messi).toEqual({
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  });
  // Gradients + clipPath + class style are exportable when namespaced.
  expect(verdict.keep).toEqual({
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  });
  expect(verdict.raster.hasRaster).toBe(true);
  expect(verdict.raster.hasText).toBe(false);
  expect(verdict.external.hasRaster).toBe(true);
  expect(verdict.filter.hasUnsupportedFeature).toBe(true);
  expect(verdict.filter.hasRaster).toBe(false);
  expect(verdict.text.hasText).toBe(true);
  expect(verdict.text.hasRaster).toBe(false);
  // Unparseable input never scans clean.
  expect(verdict.malformed.hasUnsupportedFeature).toBe(true);
  await e2ClearJobsDb(page);
});

test("E2 embed: identical internal ids namespaced per instance; dangling and type-style block", async ({
  page,
}) => {
  await e2GotoLab(page);
  const verdict = await page.evaluate(
    async (inputs: { keep: string; dangling: string; typeStyle: string }) => {
      const probe = await import(
        /* @vite-ignore */ "/src/production-lab/exportApprovedAsset.ts"
      );
      const first = probe.embedApprovedAsset(inputs.keep, "a1");
      const second = probe.embedApprovedAsset(inputs.keep, "a2");
      return {
        first,
        second,
        dangling: probe.embedApprovedAsset(inputs.dangling, "a3"),
        typeStyle: probe.embedApprovedAsset(inputs.typeStyle, "a4"),
      };
    },
    {
      keep: E2_GRADIENT_SVG,
      dangling: E2_DANGLING_SVG,
      typeStyle: E2_TYPE_STYLE_SVG,
    },
  );
  if (!verdict.first.ok || !verdict.second.ok)
    throw new Error("keep-case embed rejected");
  // Per-instance prefixes, no bare survivors.
  expect(verdict.first.svg).toContain('id="lab-x-a1-g"');
  expect(verdict.second.svg).toContain('id="lab-x-a2-g"');
  expect(verdict.first.svg).toContain("url(#lab-x-a1-g)");
  expect(verdict.second.svg).toContain("url(#lab-x-a2-g)");
  expect(verdict.first.svg).not.toContain("url(#g)");
  expect(verdict.first.svg).not.toContain('id="g"');
  // Class anti-collision hardening: attribute + selector travel together.
  expect(verdict.first.svg).toContain('class="lab-x-a1-k"');
  expect(verdict.first.svg).toContain(".lab-x-a1-k");
  expect(verdict.second.svg).toContain(".lab-x-a2-k");
  // Nested svg keeps its own viewBox.
  expect(verdict.first.svg).toContain('viewBox="0 0 80 80"');
  // Dangling refs block instead of degrading.
  expect(verdict.dangling.ok).toBe(false);
  // Bare type selectors would bleed document-wide: blocked, not namespaced.
  expect(verdict.typeStyle.ok).toBe(false);
  await e2ClearJobsDb(page);
});

test("E2 job without text exports: consistency both strategies, deterministic, snapshot immutable", async ({
  page,
}) => {
  await e2GotoReady(page);
  await e2SeedJob(page, "lab-job-e2-plain", {
    icons: [
      {
        id: "i-e2",
        iconId: "spark",
        angle: 90,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    lines: "single",
  });
  const before = await e2StoredBytes(page, "lab-job-e2-plain");
  await e2GotoLab(page, "lab-job-e2-plain");
  await expect(page.getByTestId("lab-job-original")).toBeVisible();
  await e2FillDiameters(page, "100", "60");
  await e2ExpectMeasured(page);
  const readout = page.getByTestId("lab-strategy-readout");
  // Strategy B default respected.
  await expect(readout).toHaveAttribute("data-strategy", "band-thickness");
  const factorB = await readout.getAttribute("data-size-factor");
  await expect(page.getByTestId("lab-export-filename")).toContainText(
    "physical-virola-100x60-band-thickness.svg",
  );
  await expect(page.getByTestId("lab-export-button")).toBeEnabled();
  const first = await e2ExportBytes(page);
  expect(first.fileName).toBe("physical-virola-100x60-band-thickness.svg");
  // Preview-export consistency: exported attrs equal rendered data-* attrs.
  expect(first.bytes).toContain('data-strategy="band-thickness"');
  expect(first.bytes).toContain('data-size-factor="' + factorB + '"');
  expect(first.bytes).toContain('id="lab-ring-reference"');
  expect(first.bytes).toContain('id="lab-engraving"');
  expect(first.bytes).not.toContain("<text");
  expect(first.bytes).not.toContain("data:image");
  expect(first.bytes).not.toContain("blob:");
  await expect(page.getByTestId("lab-export-status")).toContainText(
    "physical-virola-100x60-band-thickness.svg",
  );
  // Determinism in browser: same input twice, byte-identical.
  const second = await e2ExportBytes(page);
  expect(second.bytes).toBe(first.bytes);
  // Strategy A re-derives: different factor, matching attrs + file name.
  await page.getByTestId("lab-strategy-a").check();
  await expect(readout).toHaveAttribute("data-strategy", "outer-diameter");
  const factorA = await readout.getAttribute("data-size-factor");
  expect(factorA).not.toBe(factorB);
  await expect(page.getByTestId("lab-export-filename")).toContainText(
    "physical-virola-100x60-outer-diameter.svg",
  );
  const third = await e2ExportBytes(page);
  expect(third.fileName).toBe("physical-virola-100x60-outer-diameter.svg");
  expect(third.bytes).toContain('data-strategy="outer-diameter"');
  expect(third.bytes).toContain('data-size-factor="' + factorA + '"');
  expect(third.bytes).not.toBe(first.bytes);
  // Read-only job flow: public get bytes unchanged after all exports.
  expect(await e2StoredBytes(page, "lab-job-e2-plain")).toBe(before);
  await e2ClearJobsDb(page);
});

test("E2 messi v3 inlines with prefixed ids, own viewBox, no blob or raster", async ({
  page,
}) => {
  await e2GotoReady(page);
  await e2SeedJob(page, "lab-job-e2-messi", {
    icons: [
      {
        id: "i-e2m",
        iconId: "spark",
        angle: 90,
        radius: 360,
        scale: 1,
        rotation: 0,
        mirrored: false,
        inverted: false,
      },
    ],
    lines: "double",
    approvedSvgs: [{ id: "a-messi", svg: e2MessiRaw() }],
  });
  const before = await e2StoredBytes(page, "lab-job-e2-messi");
  await e2GotoLab(page, "lab-job-e2-messi");
  await e2FillDiameters(page, "100", "60");
  await e2ExpectMeasured(page);
  await expect(page.getByTestId("lab-export-button")).toBeEnabled();
  const exported = await e2ExportBytes(page);
  expect(exported.fileName).toBe("physical-virola-100x60-band-thickness.svg");
  // Messi group art travels inline (silhouette transform present).
  expect(exported.bytes).toContain("translate(0.000000,225.000000)");
  // Nested svg keeps its own viewBox; fit-64 display box centers the art.
  expect(exported.bytes).toContain('viewBox="0 0 300.000000 225.000000"');
  expect(exported.bytes).toContain('width="64"');
  expect(exported.bytes).toContain('height="48"');
  // Never a Blob image, never raster bytes, never an <image> fallback.
  expect(exported.bytes).not.toContain("blob:");
  expect(exported.bytes).not.toContain("data:image");
  expect(exported.bytes).not.toContain("<image");
  // Every local ref resolves inside the file (no dangling after rewrite).
  expect(e2DanglingRefs(exported.bytes)).toEqual([]);
  expect(await e2StoredBytes(page, "lab-job-e2-messi")).toBe(before);
  await e2ClearJobsDb(page);
});

test("E2 two approved assets with identical internal ids both resolve", async ({
  page,
}) => {
  await e2GotoReady(page);
  await e2SeedJob(page, "lab-job-e2-twins", {
    lines: "none",
    approvedSvgs: [
      { id: "a1", svg: E2_GRADIENT_SVG },
      { id: "a2", svg: E2_GRADIENT_SVG_B },
    ],
  });
  await e2GotoLab(page, "lab-job-e2-twins");
  await e2FillDiameters(page, "100", "60");
  await e2ExpectMeasured(page);
  await expect(page.getByTestId("lab-export-button")).toBeEnabled();
  const exported = await e2ExportBytes(page);
  // Same internal "g"/"c" namespaced apart per instance, both paints kept.
  expect(exported.bytes).toContain('id="lab-x-a1-g"');
  expect(exported.bytes).toContain('id="lab-x-a2-g"');
  expect(exported.bytes).toContain("url(#lab-x-a1-g)");
  expect(exported.bytes).toContain("url(#lab-x-a2-g)");
  expect(exported.bytes).not.toContain("url(#g)");
  expect(exported.bytes).toContain("#aa0000");
  expect(exported.bytes).toContain(".lab-x-a1-k");
  expect(exported.bytes).toContain(".lab-x-a2-k");
  expect(e2DanglingRefs(exported.bytes)).toEqual([]);
  await e2ClearJobsDb(page);
});

test("E2 simple and double decorative lines export as interrupted arcs", async ({
  page,
}) => {
  await e2GotoReady(page);
  const spark = {
    id: "i-arc",
    iconId: "spark",
    angle: 90,
    radius: 360,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
  };
  await e2SeedJob(page, "lab-job-e2-single", {
    icons: [{ ...spark }],
    lines: "single",
  });
  await e2SeedJob(page, "lab-job-e2-double", {
    icons: [{ ...spark }],
    lines: "double",
  });
  for (const key of ["lab-job-e2-single", "lab-job-e2-double"]) {
    await e2GotoLab(page, key);
    await e2FillDiameters(page, "100", "60");
    await e2ExpectMeasured(page);
    const exported = await e2ExportBytes(page);
    // Icon-disk knockout interrupts the ring: explicit arc paths, not circles.
    expect(exported.bytes).toContain(" A");
    expect(exported.bytes).toContain("<path");
  }
  await e2ClearJobsDb(page);
});

test("E2 invalid diameters keep export disabled", async ({ page }) => {
  await e2GotoLab(page);
  await e2FillDiameters(page, "100", "120");
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  const section = page.getByTestId("lab-export-section");
  await expect(section).toBeVisible();
  await expect(page.getByTestId("lab-export-button")).toBeDisabled();
  await expect(page.getByTestId("lab-export-status")).not.toBeEmpty();
  // Recovery restores the panel path (demo stays font-gated, job exports).
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(section).toBeVisible();
  await e2ClearJobsDb(page);
});

/*
 * E3 surgical corrections (independent review, pre-fix RED basis: every
 * test below fails on the pre-fix tree for the documented reason).
 */

const E3_NO_VIEWBOX_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="225">' +
  '<rect x="10" y="10" width="280" height="205" fill="#000000"/></svg>';
const E3_PAR_NONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" preserveAspectRatio="none">' +
  '<rect x="10" y="10" width="60" height="60" fill="#000000"/></svg>';
const E3_PAR_SLICE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" preserveAspectRatio="xMidYMid slice">' +
  '<rect x="10" y="10" width="60" height="60" fill="#000000"/></svg>';
const E3_PAR_MEET_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" preserveAspectRatio="xMidYMid meet">' +
  '<rect x="10" y="10" width="60" height="60" fill="#000000"/></svg>';
const E3_ROOT_TRANSFORM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" transform="translate(5 5)">' +
  '<rect x="10" y="10" width="60" height="60" fill="#000000"/></svg>';

test("E3 graphics gate: traced job paths block with GRAPHICS_NOT_EXPORTED", () => {
  const report = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const blocked = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    graphicsCount: 1,
  });
  expect(blocked.ok).toBe(false);
  if (blocked.ok) throw new Error("graphics accepted silently");
  expect(blocked.code).toBe("GRAPHICS_NOT_EXPORTED");
  expect(blocked.reason).toMatch(/imágenes/);
  // Without graphics the same composition stays exportable.
  const clean = buildLabPhysicalSvg({ report, iconPaths: {} });
  if (!clean.ok) throw new Error(`export rejected: ${clean.code}`);
  const zero = buildLabPhysicalSvg({
    report,
    iconPaths: {},
    graphicsCount: 0,
  });
  if (!zero.ok) throw new Error(`export rejected: ${zero.code}`);
  expect(zero.svg).toBe(clean.svg);
});

test("E3 null report fails closed as INVALID_MEASURES (gate first)", () => {
  const result = buildLabPhysicalSvg({
    report: null as unknown as PhysicalReport,
    iconPaths: {},
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("null report accepted");
  expect(result.code).toBe("INVALID_MEASURES");
});

test("E3 half-extent ceils to 0.01 mm: rings-only exact, spilled art never clips", () => {
  // Rings-only exactness at 10µm granularity: 80 -> 80, not 80.01.
  const plain = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [],
    approved: [],
    circularLines: "none",
  });
  const first = buildLabPhysicalSvg({ report: plain, iconPaths: {} });
  if (!first.ok) throw new Error(`export rejected: ${first.code}`);
  expect(first.svg).toContain('width="80mm"');
  // Spilled art: extent 40.005 mm ceils half to 40.01 -> 80.02 file.
  const base = reportOrThrow({
    outerDiameter: 80,
    innerDiameter: 60,
    strategy: "band-thickness",
    texts: [],
    icons: [sparkIcon("icon-spill", 0, 360)],
    approved: [],
    circularLines: "none",
  });
  const spilled: PhysicalReport = {
    ...base,
    icons: [
      { ...base.icons[0], centerRadiusMm: 40, envelopeMm: 0.005 },
    ],
  };
  const result = buildLabPhysicalSvg({
    report: spilled,
    iconPaths: {
      "icon-spill": ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
    },
  });
  if (!result.ok) throw new Error(`export rejected: ${result.code}`);
  expect(result.svg).toContain('width="80.02mm"');
  expect(result.svg).toContain('viewBox="0 0 80.02 80.02"');
});

test("E3 v3 without viewBox synthesizes the fit-box viewBox (no oversize)", async ({
  page,
}) => {
  await e2GotoLab(page);
  const verdict = await page.evaluate(async (raw: string) => {
    const probe = await import(
      /* @vite-ignore */ "/src/production-lab/exportApprovedAsset.ts"
    );
    return {
      scan: probe.scanApprovedAssetFlags(raw),
      embed: probe.embedApprovedAsset(raw, "novb"),
    };
  }, E3_NO_VIEWBOX_SVG);
  expect(verdict.scan).toEqual({
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  });
  if (!verdict.embed.ok)
    throw new Error("no-viewBox embed rejected: " + verdict.embed.reason);
  // Fit-64 box of a 300x225 source is 64x48; the synthesized viewBox makes
  // nested user space == fit box instead of 300x225 intrinsic units.
  expect(verdict.embed.svg).toContain('width="64"');
  expect(verdict.embed.svg).toContain('height="48"');
  expect(verdict.embed.svg).toContain('viewBox="0 0 64 48"');
  await e2ClearJobsDb(page);
});

test("E3 asset root preserveAspectRatio/transform fail closed (preview parity)", async ({
  page,
}) => {
  await e2GotoLab(page);
  const verdict = await page.evaluate(
    async (inputs: {
      none: string;
      slice: string;
      meet: string;
      transform: string;
    }) => {
      const asset = await import(
        /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
      );
      const probe = await import(
        /* @vite-ignore */ "/src/production-lab/exportApprovedAsset.ts"
      );
      const clean = (raw: string): string => {
        const admitted = asset.importSvgAsset(raw);
        if (!admitted.ok)
          throw new Error("fixture rejected: " + admitted.reason);
        return admitted.asset.svg;
      };
      const none = clean(inputs.none);
      const slice = clean(inputs.slice);
      const meet = clean(inputs.meet);
      const transform = clean(inputs.transform);
      return {
        none: probe.scanApprovedAssetFlags(none),
        slice: probe.scanApprovedAssetFlags(slice),
        meet: probe.scanApprovedAssetFlags(meet),
        transform: probe.scanApprovedAssetFlags(transform),
        noneEmbed: probe.embedApprovedAsset(none, "par1"),
        sliceEmbed: probe.embedApprovedAsset(slice, "par2"),
        meetEmbed: probe.embedApprovedAsset(meet, "par3"),
        transformEmbed: probe.embedApprovedAsset(transform, "par4"),
      };
    },
    {
      none: E3_PAR_NONE_SVG,
      slice: E3_PAR_SLICE_SVG,
      meet: E3_PAR_MEET_SVG,
      transform: E3_ROOT_TRANSFORM_SVG,
    },
  );
  // Preview renders v3 via <image xMidYMid meet> with no root transform:
  // none/slice/root-transform diverge, so they block; explicit meet stays.
  expect(verdict.none.hasUnsupportedFeature).toBe(true);
  expect(verdict.slice.hasUnsupportedFeature).toBe(true);
  expect(verdict.transform.hasUnsupportedFeature).toBe(true);
  expect(verdict.meet).toEqual({
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  });
  expect(verdict.noneEmbed.ok).toBe(false);
  expect(verdict.sliceEmbed.ok).toBe(false);
  expect(verdict.transformEmbed.ok).toBe(false);
  expect(verdict.meetEmbed.ok).toBe(true);
  await e2ClearJobsDb(page);
});
