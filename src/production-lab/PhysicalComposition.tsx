import { useApprovedAssetUrl } from "../approved-designs/assetUrl";
import {
  approvedDisplaySize,
  type ApprovedDesignSnapshot,
} from "../approved-designs/approvedDesign";
import { ControlledGeometry } from "../components/ApprovedDesignElement";
import type { TextElement } from "../components/CurvedText";
import type { DesignIcon } from "../components/IconElement";
import { artTransformForBounds } from "../components/UploadedGraphic";
import { iconById } from "../data/icons";
import { textArcPathMm } from "./geometry";
import type {
  LineKnockout,
  PhysicalReport,
  PlacedApproved,
  PlacedIcon,
  PlacedText,
} from "./types";

type Props = {
  report: PhysicalReport;
  sourceTexts: readonly TextElement[];
  sourceIcons: readonly DesignIcon[];
  /**
   * Null while the browser advance probe is still measuring; a (possibly
   * empty) map once it has published. Lets pending vs explicitly-unavailable
   * text states render distinctly instead of pending forever.
   */
  completedAdvances: ReadonlyMap<string, number> | null;
};

/** Lab mask id namespace: never collides with the source fixed ids. */
export const PHYSICAL_LINES_MASK_ID = "lab-physical-lines-knockout";

/**
 * Source `hitArc` semantics (CurvedText) recentered at physical (0, 0): arc
 * from -halfSpan to +halfSpan at the anchor radius, same large-arc rule.
 */
function lineKnockoutArcPathMm(
  radiusMm: number,
  halfSpanDegrees: number,
): string {
  const round4 = (value: number) => Math.round(value * 10000) / 10000;
  const at = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return {
      x: round4(radiusMm * Math.cos(radians)),
      y: round4(radiusMm * Math.sin(radians)),
    };
  };
  const radius = round4(radiusMm);
  const start = at(-halfSpanDegrees);
  const end = at(halfSpanDegrees);
  const largeArc = halfSpanDegrees > 90 ? 1 : 0;
  return `M${start.x} ${start.y} A${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function LineKnockoutShape({ knockout }: { knockout: LineKnockout }) {
  if (knockout.kind === "text-band") {
    return (
      <g transform={`rotate(${knockout.angle})`}>
        <path
          data-testid={`lab-physical-knockout-${knockout.id}`}
          d={lineKnockoutArcPathMm(
            knockout.anchorRadiusMm,
            knockout.halfSpanDegrees,
          )}
          fill="none"
          stroke="#000"
          strokeWidth={knockout.strokeWidthMm}
          strokeLinecap="round"
        />
      </g>
    );
  }
  return (
    <circle
      data-testid={`lab-physical-knockout-${knockout.id}`}
      cx={knockout.center.x}
      cy={knockout.center.y}
      r={knockout.radiusMm}
      fill="#000"
    />
  );
}

/**
 * Bare calculated-mm scene (P2, S4–S5). Every position/scale/angle is a
 * SAME-report number in an attr or transform — no new formulas, no clamps,
 * no autoshrink. Reference circles, math envelopes and pending/ink states
 * are drawn as geometry; glyphs are labeled browser-dependent simulation.
 * Decorative lines reuse the report's line-knockout descriptors (the source
 * composition mask rules) under their own mask id; reference circles are
 * never masked. Line paint shown is the simulated masked appearance; the
 * mathematical ring geometry lives in the report line clearances.
 */

function PhysicalIcon({
  placed,
  source,
}: {
  placed: PlacedIcon;
  source: DesignIcon;
}) {
  const definition = iconById[source.iconId];
  if (!definition) return null;
  // Pose exactly like the source IconElement: angle lives ONLY in the
  // placed center (position), rotation/mirror/invert in the inner wrapper —
  // never the angle re-applied as a rotation (no double transform).
  const scaleX = placed.localScale * (placed.mirrored ? -1 : 1);
  const scaleY = placed.localScale * (placed.inverted ? -1 : 1);
  return (
    <g
      data-testid={`lab-physical-icon-${placed.id}`}
      data-center-x={placed.center.x}
      data-center-y={placed.center.y}
      data-center-radius-mm={placed.centerRadiusMm}
      data-local-scale={placed.localScale}
      data-rotation={placed.rotation}
      data-mirrored={placed.mirrored}
      data-inverted={placed.inverted}
      data-envelope-mm={placed.envelopeMm}
      transform={`translate(${placed.center.x} ${placed.center.y})`}
    >
      <g transform={`rotate(${placed.rotation}) scale(${scaleX} ${scaleY})`}>
        <g
          transform="scale(1.4) translate(-16 -16)"
          fill="none"
          stroke="#171717"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {definition.paths.map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>
      </g>
      <circle
        data-testid={`lab-envelope-${placed.id}`}
        cx={0}
        cy={0}
        r={placed.envelopeMm}
        fill="none"
        stroke="#888"
        strokeWidth={placed.envelopeMm * 0.06}
        strokeDasharray={`${placed.envelopeMm * 0.2} ${placed.envelopeMm * 0.12}`}
      />
    </g>
  );
}

function AssetArt({
  snapshot,
  approvedId,
}: {
  snapshot: Extract<ApprovedDesignSnapshot, { version: 3 }>;
  approvedId: string;
}) {
  // v3: full safe Blob image via the existing asset-URL helper. Source
  // bytes (intrinsic viewport, local refs, group transform) are preserved;
  // no canvas, raster or flatten. Image size is the fitted display size in
  // source units, scaled to mm by the reported uniform local scale above.
  const url = useApprovedAssetUrl(snapshot.svg);
  const size = approvedDisplaySize(snapshot);
  if (!url)
    return (
      <circle
        data-testid={`lab-physical-approved-pending-${approvedId}`}
        r={Math.max(size.width, size.height) / 2}
        fill="none"
        stroke="#888"
        strokeDasharray="4 3"
      />
    );
  return (
    <image
      data-testid="lab-physical-approved-img"
      href={url}
      x={-size.width / 2}
      y={-size.height / 2}
      width={size.width}
      height={size.height}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

function GeometryArt({ snapshot }: { snapshot: ApprovedDesignSnapshot }) {
  // v1/v2 only: controlled geometry through the safe stateless helper.
  if (snapshot.version === 3) return null;
  const fit = artTransformForBounds(snapshot.geometry.artBounds);
  return (
    <g
      transform={`translate(${fit.translateX} ${fit.translateY}) scale(${fit.scale})`}
    >
      <ControlledGeometry geometry={snapshot.geometry} />
    </g>
  );
}

function PhysicalApproved({
  placed,
  sizeFactor,
}: {
  placed: PlacedApproved;
  sizeFactor: number;
}) {
  const scaleX = placed.localScale * (placed.mirrored ? -1 : 1);
  const scaleY = placed.localScale * (placed.inverted ? -1 : 1);
  // displaySizeMm is the scale-1 base (display × sizeFactor); the placed
  // footprint multiplies back the element source scale (localScale/sizeFactor).
  const sourceScale = sizeFactor !== 0 ? placed.localScale / sizeFactor : 1;
  return (
    <g
      data-testid={`lab-physical-approved-${placed.id}`}
      data-center-x={placed.center.x}
      data-center-y={placed.center.y}
      data-center-radius-mm={placed.centerRadiusMm}
      data-local-scale={placed.localScale}
      data-rotation={placed.rotation}
      data-mirrored={placed.mirrored}
      data-inverted={placed.inverted}
      data-envelope-mm={placed.envelopeMm}
      data-display-base-w-mm={placed.displaySizeMm.width}
      data-display-base-h-mm={placed.displaySizeMm.height}
      data-w-mm={placed.displaySizeMm.width * sourceScale}
      data-h-mm={placed.displaySizeMm.height * sourceScale}
      transform={`translate(${placed.center.x} ${placed.center.y})`}
    >
      <g transform={`rotate(${placed.rotation}) scale(${scaleX} ${scaleY})`}>
        {placed.snapshot.version === 3 ? (
          <AssetArt snapshot={placed.snapshot} approvedId={placed.id} />
        ) : (
          <GeometryArt snapshot={placed.snapshot} />
        )}
      </g>
      <circle
        data-testid={`lab-envelope-${placed.id}`}
        cx={0}
        cy={0}
        r={placed.envelopeMm}
        fill="none"
        stroke="#888"
        strokeWidth={placed.envelopeMm * 0.06}
        strokeDasharray={`${placed.envelopeMm * 0.2} ${placed.envelopeMm * 0.12}`}
      />
    </g>
  );
}

function PhysicalText({
  placed,
  source,
  completedAdvances,
}: {
  placed: PlacedText;
  source: TextElement;
  completedAdvances: ReadonlyMap<string, number> | null;
}) {
  // Nonpositive baseline: explicit marker, never a clamped fake path.
  if (placed.baselineRadiusMm === null || placed.baselineRadiusMm <= 0) {
    return (
      <g
        data-testid={`lab-text-unfit-${placed.id}`}
        data-center-x={placed.center.x}
        data-center-y={placed.center.y}
      >
        <circle
          cx={placed.center.x}
          cy={placed.center.y}
          r={placed.fontSizeMm}
          fill="none"
          stroke="#a00"
          strokeDasharray="4 3"
        />
        <text
          x={placed.center.x}
          y={placed.center.y}
          textAnchor="middle"
          fontSize={placed.fontSizeMm}
        >
          sin geometría: radio base no positivo
        </text>
      </g>
    );
  }
  // Until the browser advance is known: pending while measuring, explicit
  // unavailable once the probe completed — never an invented span.
  if (placed.halfSpanDegrees === null) {
    if (completedAdvances !== null) {
      return (
        <g
          data-testid={`lab-text-unavailable-${placed.id}`}
          data-center-x={placed.center.x}
          data-center-y={placed.center.y}
        >
          <circle
            cx={placed.center.x}
            cy={placed.center.y}
            r={1.5}
            fill="#777"
          />
          <text
            x={placed.center.x}
            y={placed.center.y - 2}
            textAnchor="middle"
            fontSize={placed.fontSizeMm}
            fill="#777"
          >
            avance no disponible (medición del navegador no disponible)
          </text>
        </g>
      );
    }
    return (
      <g
        data-testid={`lab-text-pending-${placed.id}`}
        data-center-x={placed.center.x}
        data-center-y={placed.center.y}
      >
        <circle cx={placed.center.x} cy={placed.center.y} r={1.5} fill="#777" />
        <text
          x={placed.center.x}
          y={placed.center.y - 2}
          textAnchor="middle"
          fontSize={placed.fontSizeMm}
          fill="#777"
        >
          pendiente de medición
        </text>
      </g>
    );
  }
  // Same paint contract as CurvedText (font/content/weight/spacing/dy/sweep/
  // middle anchor) but sized/positioned from the placed report values, on
  // its own path id namespace (never the original fixed curve-* ids).
  const pathId = `lab-physical-curve-${placed.id}`;
  return (
    <g transform={`rotate(${placed.angle})`}>
      <circle
        data-testid={`lab-text-baseline-${placed.id}`}
        cx={0}
        cy={0}
        r={placed.baselineRadiusMm}
        fill="none"
        stroke="#666"
        strokeWidth={placed.baselineRadiusMm * 0.02}
        strokeDasharray={`${placed.baselineRadiusMm * 0.08} ${placed.baselineRadiusMm * 0.05}`}
      />
      <defs>
        <path
          id={pathId}
          d={textArcPathMm(
            placed.baselineRadiusMm,
            placed.halfSpanDegrees,
            placed.sweep === 0,
          )}
        />
      </defs>
      <g
        data-testid={`lab-physical-text-${placed.id}`}
        data-font-size-mm={placed.fontSizeMm}
        data-half-span={placed.halfSpanDegrees}
        data-baseline-r={placed.baselineRadiusMm}
        data-anchor-r={placed.anchorRadiusMm}
        data-sweep={placed.sweep}
        data-span-clamped={placed.spanClamped}
      >
        <text
          fontFamily={source.fontFamily}
          fontSize={placed.fontSizeMm}
          fontWeight={600}
          letterSpacing={placed.letterSpacingMm}
          textAnchor="middle"
          dy={placed.invertedDyMm ?? undefined}
          fill="#444"
        >
          <textPath href={`#${pathId}`} startOffset="50%">
            {source.text}
          </textPath>
        </text>
      </g>
    </g>
  );
}

export default function PhysicalComposition({
  report,
  sourceTexts,
  sourceIcons,
  completedAdvances,
}: Props) {
  const { frame } = report;
  // Display-only fitting: reference + conservative envelopes (+ text ring
  // padding, honest display allowance, not an ink claim). Never clips
  // invading art to the ring; svg overflow stays visible.
  const extents: number[] = [
    frame.outerRadius,
    frame.innerRadius,
    ...report.lines.map((line) => line.radiusMm),
    ...report.icons.map((icon) => icon.centerRadiusMm + icon.envelopeMm),
    ...report.approved.map((item) => item.centerRadiusMm + item.envelopeMm),
    ...report.texts.map((text) => text.anchorRadiusMm + text.fontSizeMm * 1.5),
  ];
  const maxRadius = Math.max(...extents);
  const half = maxRadius + Math.max(2, maxRadius * 0.1);
  return (
    <svg
      data-testid="lab-physical-svg"
      data-strategy={frame.strategy}
      data-size-factor={String(frame.sizeFactor)}
      className="lab-physical-svg"
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      role="img"
      aria-label="Composición física calculada en milímetros"
      style={{ overflow: "visible" }}
    >
      <mask
        id={PHYSICAL_LINES_MASK_ID}
        data-testid="lab-physical-lines-mask"
        maskUnits="userSpaceOnUse"
        x={-half}
        y={-half}
        width={half * 2}
        height={half * 2}
        style={{ maskType: "luminance" }}
      >
        <rect
          x={-half}
          y={-half}
          width={half * 2}
          height={half * 2}
          fill="#fff"
        />
        {report.lineKnockouts.map((knockout) => (
          <LineKnockoutShape key={knockout.id} knockout={knockout} />
        ))}
      </mask>
      <circle
        data-testid="lab-outer-circle"
        cx={0}
        cy={0}
        r={frame.outerRadius}
        fill="none"
        stroke="#333"
        strokeWidth={half * 0.008}
      />
      <circle
        data-testid="lab-inner-circle"
        cx={0}
        cy={0}
        r={frame.innerRadius}
        fill="none"
        stroke="#333"
        strokeWidth={half * 0.008}
      />
      <text
        data-testid="lab-outer-label"
        x={0}
        y={-frame.outerRadius - half * 0.03}
        textAnchor="middle"
        fontSize={half * 0.055}
        fill="#333"
      >
        {`⌀ exterior ${frame.outerDiameter} mm`}
      </text>
      <text
        data-testid="lab-inner-label"
        x={0}
        y={frame.innerRadius + half * 0.075}
        textAnchor="middle"
        fontSize={half * 0.055}
        fill="#333"
      >
        {`⌀ interior ${frame.innerDiameter} mm`}
      </text>
      <g
        data-testid="lab-physical-lines"
        mask={`url(#${PHYSICAL_LINES_MASK_ID})`}
      >
        {report.lines.map((line) => (
          <circle
            key={line.id}
            data-testid={`lab-line-${line.sourceRadius}`}
            data-line-id={line.id}
            data-source-radius={line.sourceRadius}
            data-radius-mm={line.radiusMm}
            cx={0}
            cy={0}
            r={line.radiusMm}
            fill="none"
            stroke="#65513c"
            strokeWidth={line.strokeWidthMm}
          />
        ))}
      </g>
      {report.icons.map((placed) => {
        const source = sourceIcons.find((item) => item.id === placed.id);
        if (!source) return null;
        return <PhysicalIcon key={placed.id} placed={placed} source={source} />;
      })}
      {report.approved.map((placed) => (
        <PhysicalApproved
          key={placed.id}
          placed={placed}
          sizeFactor={frame.sizeFactor}
        />
      ))}
      {report.texts.map((placed) => {
        const source = sourceTexts.find((item) => item.id === placed.id);
        if (!source) return null;
        return (
          <PhysicalText
            key={placed.id}
            placed={placed}
            source={source}
            completedAdvances={completedAdvances}
          />
        );
      })}
    </svg>
  );
}
