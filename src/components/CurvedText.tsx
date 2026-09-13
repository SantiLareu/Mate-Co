import { useLayoutEffect, useRef, useState } from 'react';
import ElementHandle, { useSvgPixelSize } from './ElementHandle';
import { matePointer, polarPoint, useDirectDrag, usePreventManipulationScroll } from './directManipulation';

// Position and size deliberately have independent safety limits. The center of
// an element may approach either edge of the rim, as in the reference editor.
export const TEXT_RADIUS = { min: 305, max: 410, center: 357.5, initial: 374 } as const;
export const TEXT_SCALE = { min: .3, max: 3 } as const;
export const clampTextScale = (scale: number) => Number.isFinite(scale) ? Math.max(TEXT_SCALE.min, Math.min(TEXT_SCALE.max, scale)) : 1;
export const clampTextRadius = (radius: number, _scale = 1) => Number.isFinite(radius)
  ? Math.min(TEXT_RADIUS.max, Math.max(TEXT_RADIUS.min, radius)) : TEXT_RADIUS.center;

export type TextElement = { id: string; text: string; fontFamily: string; angle: number; radius: number; inverted: boolean; scale?: number };
type Props = {
  element: TextElement;
  editing: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, changes: Partial<Omit<TextElement, 'id'>>) => void;
  onDelete: (id: string) => void;
};

const point = (angle: number, radius: number) => {
  const radians = (angle - 90) * Math.PI / 180;
  return [450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)];
};

export default function CurvedText({ element, editing, selected, onSelect, onUpdate, onDelete }: Props) {
  const textRef = useRef<SVGTextElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  usePreventManipulationScroll(groupRef, editing);
  const unit = useSvgPixelSize(groupRef);
  const resize = useRef<{ x: number; y: number; distance: number; scale: number } | null>(null);
  const scale = clampTextScale(element.scale ?? 1);
  const directDrag = useDirectDrag(element.angle, element.radius, position => onUpdate(element.id, position));
  const [length, setLength] = useState(150);
  const pathId = `curve-${element.id}`;
  useLayoutEffect(() => {
    setLength(textRef.current?.getComputedTextLength() ?? 150);
  }, [element.text, element.fontFamily, scale]);
  const radius = clampTextRadius(element.radius, scale);
  const pathRadius = radius - 14 * scale;
  const sweep = element.inverted ? 0 : 1;
  const halfSpan = Math.min(135, Math.max(7, (length / 2 + 14) / radius * 180 / Math.PI));
  const start = point(-halfSpan, radius);
  const end = point(halfSpan, radius);
  const hitArc = `M${start.join(' ')} A${radius} ${radius} 0 ${halfSpan > 90 ? 1 : 0} 1 ${end.join(' ')}`;
  const controlSpan = Math.min(165, halfSpan + 24 * unit / radius * 180 / Math.PI);
  const deletePosition = point(-controlSpan, radius);
  const resizePosition = point(controlSpan, radius);

  return <>
    <g ref={groupRef} transform={`rotate(${element.angle} 450 450)`} className={`curved-text${editing ? ' editable' : ''}`}
      data-text-id={element.id} data-angle={element.angle} data-radius={radius} data-scale={scale} role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined}
      aria-label={editing ? `Editar texto: ${element.text || 'Texto vacío'}` : undefined} aria-pressed={editing ? selected : undefined}
      onClick={event => { if (editing) { event.stopPropagation(); onSelect(element.id); } }}
      onKeyDown={event => {
        if (!editing) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onSelect(element.id); onUpdate(element.id, { angle: element.angle + (event.key === 'ArrowRight' ? 5 : -5) }); }
        if (event.key === 'Delete') { event.preventDefault(); onDelete(element.id); }
      }}
      {...(editing ? directDrag : {})}
      onPointerDown={event => { if (editing && event.button === 0) { directDrag.onPointerDown(event); onSelect(element.id); } }}>
      <defs>
        <path id={pathId} d={`M450 ${450 + pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 - pathRadius} A${pathRadius} ${pathRadius} 0 0 ${sweep} 450 ${450 + pathRadius}`} />
        <path id={`text-knockout-${element.id}`} d={hitArc} fill="none" stroke="#000" strokeWidth={35 * scale + 10} strokeLinecap="round" />
      </defs>
      {editing && <path d={hitArc} fill="none" stroke="transparent" strokeWidth="52" className="text-hit-area" />}
      <text key={element.fontFamily} ref={textRef} fill="#65513c" stroke={editing && selected ? '#8b906e' : 'none'}
        strokeWidth={editing && selected ? .75 * unit : 0} paintOrder="stroke" fontFamily={element.fontFamily}
        fontSize={35 * scale} fontWeight="600" letterSpacing={2 * scale} textAnchor="middle" dy={element.inverted ? 26 * scale : 0}>
        <textPath href={`#${pathId}`} startOffset="50%">{element.text}</textPath>
      </text>
      {editing && selected && <g id={`text-controls-${element.id}`}>
        <ElementHandle x={deletePosition[0]} y={deletePosition[1]} unit={unit} counterRotation={-element.angle} kind="delete" label="Eliminar texto sobre la virola" onActivate={() => onDelete(element.id)} />
        <ElementHandle x={resizePosition[0]} y={resizePosition[1]} unit={unit} counterRotation={-element.angle} kind="transform" label="Cambiar tamaño del texto" onStart={event => {
          const p = matePointer(event); if (!p) return;
          const center = polarPoint(element.angle, radius);
          resize.current = { ...center, distance: Math.max(1, Math.hypot(p.x - center.x, p.y - center.y)), scale };
        }} onMove={event => {
          const p = matePointer(event), current = resize.current; if (!p || !current) return;
          onUpdate(element.id, { scale: clampTextScale(current.scale * Math.hypot(p.x - current.x, p.y - current.y) / current.distance) });
        }} onEnd={() => { resize.current = null; }} onKey={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onUpdate(element.id, { scale: clampTextScale(scale + (event.key === 'ArrowUp' ? .05 : -.05)) }); }
        }} />
      </g>}
    </g>
  </>;
}
