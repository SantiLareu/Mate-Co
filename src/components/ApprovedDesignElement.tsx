import { useRef } from "react";
import type { ReactNode } from "react";
import type { ImportedGeometry } from "../admin-lab/importedGeometry";
import { useApprovedAssetUrl } from "../approved-designs/assetUrl";
import {
  approvedDisplayAspect,
  approvedDisplaySize,
  approvedEnvelopeRadius,
  approvedKnockoutRadius,
  type ApprovedDesignInstance,
  type ApprovedDesignSnapshot,
} from "../approved-designs/approvedDesign";
import { artTransformForBounds } from "./UploadedGraphic";
import ElementHandle, { useSvgPixelSize } from "./ElementHandle";
import {
  matePointer,
  useDirectDrag,
  usePreventManipulationScroll,
} from "./directManipulation";
import { clampIconScaleAtRadius } from "./IconElement";

/**
 * Customer canvas instance of an approved design.
 *
 * Reuses the icon interaction engine (useDirectDrag with captured matrix,
 * angular/radial snapping, ElementHandle scale/rotate/delete, exclusive
 * selection via App): no new interaction math. The validated asset renders
 * as an isolated Blob-document `<image>` (v3) or controlled geometry paths
 * with explicit serialization only (v1/v2) — the source is never mutated
 * and only the outer wrapper carries move/angle/radius/scale/rotate/
 * mirror/invert. Knockout is a transparent circle matching the footprint,
 * never an inverted paint copy.
 */

export function ControlledGeometry({
  geometry,
}: {
  geometry: ImportedGeometry;
}) {
  const renderNode = (index: number): ReactNode => {
    const node = geometry.nodes[index];
    if (node.kind === "group") {
      return (
        <g key={index} opacity={node.opacity}>
          {node.children.map(renderNode)}
        </g>
      );
    }
    const { d, matrix: m, style: s } = geometry.paths[node.path];
    return (
      <path
        key={index}
        d={d}
        transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}
        opacity={node.opacity}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeLinecap={s.linecap}
        strokeLinejoin={s.linejoin}
        strokeMiterlimit={s.miterlimit}
        strokeDasharray={s.dasharray.length ? s.dasharray.join(" ") : "none"}
        strokeDashoffset={s.dashoffset}
        fillOpacity={s.fillOpacity}
        strokeOpacity={s.strokeOpacity}
        fillRule={s.fillRule}
      />
    );
  };
  return <>{renderNode(geometry.root)}</>;
}

/**
 * Shared v1/v2 drawer thumbnail: the same safe controlled tree the canvas
 * renders (explicit matrix + paint serialization, never markup), painted in
 * raw art coordinates under a matching raw art-bounds viewBox (like
 * AdminLab) so the picker previews real art, not a glyph. No normalization
 * fit here: the canvas ApprovedArt below keeps its own center-to-origin /
 * size-64 fit, which belongs to positioned local-0 coordinates.
 */
export function ApprovedSnapshotThumb({
  snapshot,
}: {
  snapshot: ApprovedDesignSnapshot;
}) {
  if (snapshot.version === 3) return null;
  const bounds = snapshot.geometry.artBounds;
  return (
    <svg
      className="approved-thumb approved-thumb-geometry-art"
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      style={{ aspectRatio: approvedDisplayAspect(snapshot) }}
      aria-hidden="true"
    >
      <ControlledGeometry geometry={snapshot.geometry} />
    </svg>
  );
}
function ApprovedArt({ element }: { element: ApprovedDesignInstance }) {
  const snapshot = element.snapshot;
  if (snapshot.version === 3) {
    return <AssetImage element={element} svg={snapshot.svg} />;
  }
  const fit = artTransformForBounds(snapshot.geometry.artBounds);
  return (
    <g
      className="approved-art"
      transform={`translate(${fit.translateX} ${fit.translateY}) scale(${fit.scale})`}
    >
      <ControlledGeometry geometry={snapshot.geometry} />
    </g>
  );
}

function AssetImage({
  element,
  svg,
}: {
  element: ApprovedDesignInstance;
  svg: string;
}) {
  const url = useApprovedAssetUrl(svg);
  const size = approvedDisplaySize(element.snapshot);
  if (!url) return null;
  return (
    <image
      className="approved-art"
      href={url}
      x={-size.width / 2}
      y={-size.height / 2}
      width={size.width}
      height={size.height}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

type Props = {
  element: ApprovedDesignInstance;
  editing: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, changes: Partial<ApprovedDesignInstance>) => void;
  onDelete: (id: string) => void;
};

export default function ApprovedDesignElement({
  element,
  editing,
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: Props) {
  const groupRef = useRef<SVGGElement>(null);
  usePreventManipulationScroll(groupRef, editing);
  const unit = useSvgPixelSize(groupRef);
  const resize = useRef<{
    x: number;
    y: number;
    distance: number;
    scale: number;
  } | null>(null);
  const rotate = useRef<{
    x: number;
    y: number;
    bearing: number;
    rotation: number;
  } | null>(null);
  const directDrag = useDirectDrag(element.angle, element.radius, (position) =>
    onUpdate(element.id, position),
  );
  const radians = ((element.angle - 90) * Math.PI) / 180;
  const x = 450 + element.radius * Math.cos(radians);
  const y = 450 + element.radius * Math.sin(radians);
  // Circumscribed envelope of the fitted art at scale: knockout, hit area,
  // selection ring and handles all clear the true corners (rotation, mirror
  // and invert never change the envelope).
  const envelope = approvedEnvelopeRadius(element.snapshot) * element.scale;
  const controlDistance = envelope + 22 * unit;
  const controlPoint = (offset: number) => {
    const bearing = ((element.rotation + offset) * Math.PI) / 180;
    return {
      x: controlDistance * Math.cos(bearing),
      y: controlDistance * Math.sin(bearing),
    };
  };
  const rotatePosition = controlPoint(225);
  const deletePosition = controlPoint(315);
  const scalePosition = controlPoint(135);
  const name = element.snapshot.name ?? "diseño aprobado";
  return (
    <g
      ref={groupRef}
      className={`design-icon approved-design${editing ? " editable" : ""}`}
      transform={`translate(${x} ${y})`}
      data-approved-id={element.id}
      data-design-id={element.approvedDesignId}
      data-angle={element.angle}
      data-radius={element.radius}
      data-scale={element.scale}
      data-rotation={element.rotation}
      data-mirrored={element.mirrored}
      data-inverted={element.inverted}
      role={editing ? "button" : undefined}
      tabIndex={editing ? 0 : undefined}
      aria-label={`Editar diseño aprobado: ${name}`}
      aria-pressed={editing ? selected : undefined}
      onClick={(event) => {
        if (editing) {
          event.stopPropagation();
          onSelect(element.id);
        }
      }}
      onKeyDown={(event) => {
        if (!editing) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(element.id);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onSelect(element.id);
          onUpdate(element.id, {
            angle: element.angle + (event.key === "ArrowRight" ? 5 : -5),
          });
        }
        if (event.key === "Delete") {
          event.preventDefault();
          onDelete(element.id);
        }
      }}
      {...(editing ? directDrag : {})}
      onPointerDown={(event) => {
        if (editing && event.button === 0) {
          directDrag.onPointerDown(event);
          onSelect(element.id);
        }
      }}
    >
      <defs>
        <circle
          id={`approved-knockout-${element.id}`}
          r={approvedKnockoutRadius(element.snapshot, element.scale)}
          fill="#000"
        />
      </defs>
      <circle r={Math.max(26, envelope)} fill="transparent" />
      {editing && selected && (
        <circle
          r={envelope + 3}
          fill="none"
          stroke="#8b906e"
          strokeWidth="1.2"
          strokeDasharray="3 5"
          pointerEvents="none"
        />
      )}
      <g
        className="icon-art"
        transform={`rotate(${element.rotation}) scale(${element.scale * (element.mirrored ? -1 : 1)} ${element.scale * (element.inverted ? -1 : 1)})`}
        pointerEvents="none"
      >
        <ApprovedArt element={element} />
      </g>
      {editing && selected && (
        <g id={`approved-controls-${element.id}`}>
          <ElementHandle
            x={deletePosition.x}
            y={deletePosition.y}
            unit={unit}
            kind="delete"
            label="Eliminar diseño aprobado sobre la virola"
            onActivate={() => onDelete(element.id)}
          />
          <ElementHandle
            x={scalePosition.x}
            y={scalePosition.y}
            unit={unit}
            kind="scale"
            label="Cambiar tamaño del diseño aprobado"
            onStart={(event) => {
              const p = matePointer(event);
              if (!p) return;
              resize.current = {
                x,
                y,
                distance: Math.max(1, Math.hypot(p.x - x, p.y - y)),
                scale: element.scale,
              };
            }}
            onMove={(event) => {
              const p = matePointer(event);
              const current = resize.current;
              if (!p || !current) return;
              const distance = Math.hypot(p.x - current.x, p.y - current.y);
              onUpdate(element.id, {
                scale: clampIconScaleAtRadius(
                  (current.scale * distance) / current.distance,
                  element.radius,
                ),
              });
            }}
            onEnd={() => {
              resize.current = null;
            }}
            onKey={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                onUpdate(element.id, {
                  scale: clampIconScaleAtRadius(
                    element.scale + (event.key === "ArrowUp" ? 0.05 : -0.05),
                    element.radius,
                  ),
                });
              }
            }}
          />
          <ElementHandle
            x={rotatePosition.x}
            y={rotatePosition.y}
            unit={unit}
            kind="rotate"
            label="Rotar diseño aprobado"
            onStart={(event) => {
              const p = matePointer(event);
              if (!p) return;
              rotate.current = {
                x,
                y,
                bearing: Math.atan2(p.y - y, p.x - x),
                rotation: element.rotation,
              };
            }}
            onMove={(event) => {
              const p = matePointer(event);
              const current = rotate.current;
              if (!p || !current) return;
              const rotation =
                current.rotation +
                ((Math.atan2(p.y - current.y, p.x - current.x) -
                  current.bearing) *
                  180) /
                  Math.PI;
              onUpdate(element.id, {
                rotation: ((((rotation + 180) % 360) + 360) % 360) - 180,
              });
            }}
            onEnd={() => {
              rotate.current = null;
            }}
            onKey={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                onUpdate(element.id, {
                  rotation:
                    element.rotation + (event.key === "ArrowRight" ? 5 : -5),
                });
              }
            }}
          />
        </g>
      )}
    </g>
  );
}
