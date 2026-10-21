/**
 * J2 — Read-only faithful job preview (Stage 2, S4).
 *
 * Renders a stored job composition with exactly the live MatePreview
 * semantics, but read-only (no editing, selection, guides or handles):
 *
 * - Explicit instance seam: every document-global SVG id used by the
 *   live renderer (text-curve, rim, mate-brown, inner-depth,
 *   decorative-lines-knockout, plus every per-element knockout/curve id)
 *   is prefixed with `instanceId`, so any number of preview cards can
 *   share one document without crosswiring gradients or masks.
 * - Icons render ONLY from their EMBEDDED definitions (frame + paint +
 *   paths stored in the snapshot). This module never imports the live
 *   icon catalog: a deleted/disabled catalog entry cannot break a saved
 *   job, and unknown iconIds with valid embeddings still paint.
 * - Clamps and knockouts are re-derived with the live-renderer formulas
 *   (clampTextScale/clampTextRadius, text hit-arc, 25*scale*sqrt2+4 icon
 *   and graphic knockouts, approved envelope/knockout helpers) — never
 *   stored, never invented, never a bare envelope constant.
 * - Approved v3 assets stay isolated Blob documents through the existing
 *   useApprovedAssetUrl helper (never inlined markup); v1/v2 render the
 *   controlled geometry tree through the shared ControlledGeometry.
 * - Texts keep the stored font/size/dy/spacing/sweep/baseline semantics
 *   (fontFamily, 35*scale, letterSpacing 2*scale, inverted dy, sweep
 *   flag, middle anchor at 50%).
 *
 * Fonts stay environment-dependent names (same documented limit as the
 * live renderer): nothing is outlined or rasterized here.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { VIROLA_INNER_RADIUS, VIROLA_OUTER_RADIUS } from "../export/geometry";
import { clampTextRadius, clampTextScale } from "./CurvedText";
import { artTransformForBounds } from "./UploadedGraphic";
import { ControlledGeometry } from "./ApprovedDesignElement";
import {
  approvedDisplaySize,
  approvedKnockoutRadius,
} from "../approved-designs/approvedDesign";
import { useApprovedAssetUrl } from "../approved-designs/assetUrl";
import type {
  JobApprovedSnapshot,
  JobCompositionSnapshot,
  JobGraphicSnapshot,
  JobIconSnapshot,
  JobTextSnapshot,
} from "../jobs/snapshot";

/** Explicit seam: ids stay document-unique per preview card. */
function safePrefix(instanceId: string): string {
  const cleaned = instanceId.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+/, "");
  return cleaned === "" ? "job" : cleaned;
}

const point = (angle: number, radius: number): [number, number] => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)];
};

const poseOf = (angle: number, radius: number): [number, number] => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)];
};

/** Live CurvedText geometry, read-only: same clamps, same measured arc. */
function TextPreview({
  text,
  prefix,
}: {
  text: JobTextSnapshot;
  prefix: string;
}) {
  const textRef = useRef<SVGTextElement>(null);
  const [length, setLength] = useState(150);
  const scale = clampTextScale(text.scale ?? 1);
  const radius = clampTextRadius(text.radius, scale);
  useLayoutEffect(() => {
    setLength(textRef.current?.getComputedTextLength() ?? 150);
  }, [text.text, text.fontFamily, scale]);
  const pathRadius = radius - 14 * scale;
  const sweep = text.inverted ? 0 : 1;
  const halfSpan = Math.min(
    135,
    Math.max(7, ((length / 2 + 14) / radius) * (180 / Math.PI)),
  );
  const start = point(-halfSpan, radius);
  const end = point(halfSpan, radius);
  const hitArc = `M${start.join(" ")} A${radius} ${radius} 0 ${halfSpan > 90 ? 1 : 0} 1 ${end.join(" ")}`;
  const pathId = `${prefix}-curve-${text.id}`;
  const knockoutId = `${prefix}-text-knockout-${text.id}`;
  return (
    <g transform={`rotate(${text.angle} 450 450)`}>
      <defs>
        <path
          id={pathId}
          d={`M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 - pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 + pathRadius}`}
        />
        <path
          id={knockoutId}
          d={hitArc}
          fill="none"
          stroke="#000"
          strokeWidth={35 * scale + 10}
          strokeLinecap="round"
        />
      </defs>
      <text
        ref={textRef}
        fill="#65513c"
        fontFamily={text.fontFamily}
        fontSize={35 * scale}
        fontWeight="600"
        letterSpacing={2 * scale}
        textAnchor="middle"
        dy={text.inverted ? 26 * scale : 0}
      >
        <textPath href={`#${pathId}`} startOffset="50%">
          {text.text}
        </textPath>
      </text>
    </g>
  );
}

/**
 * Live IconElement art, read-only, from the EMBEDDED definition only:
 * same translate/rotate/mirror/invert nesting and the same stored
 * frame/paint (fill/stroke + inner transform). No live-catalog lookup.
 */
function IconPreview({
  icon,
  prefix,
}: {
  icon: JobIconSnapshot;
  prefix: string;
}) {
  const [x, y] = poseOf(icon.angle, icon.radius);
  const paint = icon.definition.paint;
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <circle
          id={`${prefix}-icon-knockout-${icon.id}`}
          r={25 * icon.scale * Math.SQRT2 + 4}
          fill="#000"
        />
      </defs>
      <g
        transform={`rotate(${icon.rotation}) scale(${icon.scale * (icon.mirrored ? -1 : 1)} ${icon.scale * (icon.inverted ? -1 : 1)})`}
      >
        <g
          transform={paint.innerTransform}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={paint.strokeWidth}
          strokeLinecap={paint.linecap}
          strokeLinejoin={paint.linejoin}
        >
          {icon.definition.paths.map((d, index) => (
            <path key={index} d={d} />
          ))}
        </g>
      </g>
      <title>{icon.definition.name}</title>
    </g>
  );
}

/** Live UploadedGraphicElement art, read-only: same fit + knockout. */
function GraphicPreview({
  graphic,
  prefix,
}: {
  graphic: JobGraphicSnapshot;
  prefix: string;
}) {
  const [x, y] = poseOf(graphic.angle, graphic.radius);
  const fit = artTransformForBounds(graphic.artBounds);
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <circle
          id={`${prefix}-graphic-knockout-${graphic.id}`}
          r={25 * graphic.scale * Math.SQRT2 + 4}
          fill="#000"
        />
      </defs>
      <g
        transform={`rotate(${graphic.rotation}) scale(${graphic.scale * (graphic.mirrored ? -1 : 1)} ${graphic.scale * (graphic.inverted ? -1 : 1)})`}
      >
        <g
          transform={`translate(${fit.translateX} ${fit.translateY}) scale(${fit.scale})`}
          fill="#171717"
          fillRule="evenodd"
        >
          {graphic.paths.map((path, index) => (
            <path key={index} d={path.d} transform={path.transform} />
          ))}
        </g>
      </g>
    </g>
  );
}

/** Isolated v3 Blob-document image (existing helper, never inline markup). */
function ApprovedAssetImage({ entry }: { entry: JobApprovedSnapshot }) {
  const snapshot = entry.snapshot;
  if (snapshot.version !== 3) return null;
  const url = useApprovedAssetUrl(snapshot.svg);
  const size = approvedDisplaySize(snapshot);
  if (!url) return null;
  return (
    <image
      href={url}
      x={-size.width / 2}
      y={-size.height / 2}
      width={size.width}
      height={size.height}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

/** v1/v2 controlled geometry under the live center-to-origin/size-64 fit. */
function ApprovedStaticArt({ entry }: { entry: JobApprovedSnapshot }) {
  const snapshot = entry.snapshot;
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

/**
 * Live ApprovedDesignElement art, read-only: same envelope-derived
 * knockout (helpers reused, never invented) and same pose nesting.
 */
function ApprovedPreview({
  entry,
  prefix,
}: {
  entry: JobApprovedSnapshot;
  prefix: string;
}) {
  const [x, y] = poseOf(entry.angle, entry.radius);
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <circle
          id={`${prefix}-approved-knockout-${entry.id}`}
          r={approvedKnockoutRadius(entry.snapshot, entry.scale)}
          fill="#000"
        />
      </defs>
      <g
        transform={`rotate(${entry.rotation}) scale(${entry.scale * (entry.mirrored ? -1 : 1)} ${entry.scale * (entry.inverted ? -1 : 1)})`}
      >
        {entry.snapshot.version === 3 ? (
          <ApprovedAssetImage entry={entry} />
        ) : (
          <ApprovedStaticArt entry={entry} />
        )}
      </g>
      <title>{entry.snapshot.name ?? "diseño aprobado"}</title>
    </g>
  );
}

export default function JobSnapshotPreview({
  composition,
  instanceId,
  testId,
  label,
}: {
  composition: JobCompositionSnapshot;
  instanceId: string;
  testId?: string;
  label?: string;
}) {
  const prefix = safePrefix(instanceId);
  const rimId = `${prefix}-rim`;
  const brownId = `${prefix}-mate-brown`;
  const depthId = `${prefix}-inner-depth`;
  const curveId = `${prefix}-text-curve`;
  const maskId = `${prefix}-decorative-lines-knockout`;
  return (
    <svg
      viewBox="0 0 900 900"
      role="img"
      aria-label={label ?? "Vista previa del trabajo guardado"}
      className="mate job-snapshot"
      {...(testId ? { "data-testid": testId } : {})}
    >
      <defs>
        <radialGradient id={rimId} cx="50%" cy="51.5%" r="50%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="88%" stopColor="#fff" />
          <stop offset="94%" stopColor="#fdfdfd" />
          <stop offset="98%" stopColor="#f0f1f3" />
          <stop offset="100%" stopColor="#e7e8ea" />
        </radialGradient>
        <linearGradient id={brownId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#815936" />
          <stop offset="1" stopColor="#603d24" />
        </linearGradient>
        <radialGradient id={depthId} cx="50%" cy="53%" r="52%">
          <stop offset="83%" stopColor="#2e1c10" stopOpacity="0" />
          <stop offset="100%" stopColor="#2e1c10" stopOpacity=".35" />
        </radialGradient>
        <path id={curveId} d="M 90 450 A 360 360 0 0 1 810 450" />
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="900"
          height="900"
          style={{ maskType: "luminance" }}
        >
          <rect width="900" height="900" fill="#fff" />
          {composition.texts.map((text) => (
            <use
              key={text.id}
              href={`#${prefix}-text-knockout-${text.id}`}
              transform={`rotate(${text.angle} 450 450)`}
            />
          ))}
          {composition.icons.map((icon) => {
            const [x, y] = poseOf(icon.angle, icon.radius);
            return (
              <use
                key={icon.id}
                href={`#${prefix}-icon-knockout-${icon.id}`}
                transform={`translate(${x} ${y})`}
              />
            );
          })}
          {composition.graphics.map((graphic) => {
            const [x, y] = poseOf(graphic.angle, graphic.radius);
            return (
              <use
                key={graphic.id}
                href={`#${prefix}-graphic-knockout-${graphic.id}`}
                transform={`translate(${x} ${y})`}
              />
            );
          })}
          {composition.approved.map((entry) => {
            const [x, y] = poseOf(entry.angle, entry.radius);
            return (
              <use
                key={entry.id}
                href={`#${prefix}-approved-knockout-${entry.id}`}
                transform={`translate(${x} ${y})`}
              />
            );
          })}
        </mask>
      </defs>
      <circle
        cx="450"
        cy="450"
        r={VIROLA_OUTER_RADIUS}
        fill={`url(#${rimId})`}
        stroke="#e4e6eb"
        strokeWidth="3"
      />
      <circle
        cx="450"
        cy="450"
        r={VIROLA_INNER_RADIUS}
        fill={`url(#${brownId})`}
      />
      <circle
        cx="450"
        cy="450"
        r={VIROLA_INNER_RADIUS}
        fill={`url(#${depthId})`}
      />
      {composition.circularLines !== "none" && (
        <g
          fill="none"
          stroke="#65513c"
          strokeWidth="2"
          pointerEvents="none"
          mask={`url(#${maskId})`}
        >
          {composition.circularLines === "single" ? (
            <circle cx="450" cy="450" r="357" />
          ) : (
            <>
              <circle cx="450" cy="450" r="347" />
              <circle cx="450" cy="450" r="367" />
            </>
          )}
        </g>
      )}
      <g>
        {composition.texts.map((text) => (
          <TextPreview key={text.id} text={text} prefix={prefix} />
        ))}
      </g>
      <g>
        {composition.icons.map((icon) => (
          <IconPreview key={icon.id} icon={icon} prefix={prefix} />
        ))}
        {composition.graphics.map((graphic) => (
          <GraphicPreview key={graphic.id} graphic={graphic} prefix={prefix} />
        ))}
        {composition.approved.map((entry) => (
          <ApprovedPreview key={entry.id} entry={entry} prefix={prefix} />
        ))}
      </g>
    </svg>
  );
}
