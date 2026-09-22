import { useRef } from 'react';
import ElementHandle, { useSvgPixelSize } from './ElementHandle';
import { matePointer, useDirectDrag, usePreventManipulationScroll } from './directManipulation';
import { clampIconScaleAtRadius } from './IconElement';
import { artTransformForBounds, type UploadedGraphicElement } from './UploadedGraphic';

type Props = { element: UploadedGraphicElement; editing: boolean; selected: boolean; onSelect: (id: string) => void; onUpdate: (id: string, changes: Partial<UploadedGraphicElement>) => void; onDelete: (id: string) => void };

export default function UploadedGraphicElement({ element, editing, selected, onSelect, onUpdate, onDelete }: Props) {
  const groupRef = useRef<SVGGElement>(null);
  usePreventManipulationScroll(groupRef, editing);
  const unit = useSvgPixelSize(groupRef);
  const resize = useRef<{ x: number; y: number; distance: number; scale: number } | null>(null);
  const rotate = useRef<{ x: number; y: number; bearing: number; rotation: number } | null>(null);
  const directDrag = useDirectDrag(element.angle, element.radius, position => onUpdate(element.id, position));
  const radians = (element.angle - 90) * Math.PI / 180;
  const x = 450 + element.radius * Math.cos(radians), y = 450 + element.radius * Math.sin(radians);
  const controlDistance = 25 * element.scale * Math.SQRT2 + 22 * unit;
  const controlPoint = (offset: number) => {
    const bearing = (element.rotation + offset) * Math.PI / 180;
    return { x: controlDistance * Math.cos(bearing), y: controlDistance * Math.sin(bearing) };
  };
  const rotatePosition = controlPoint(225);
  const deletePosition = controlPoint(315);
  const scalePosition = controlPoint(135);
  const fit = artTransformForBounds(element.artBounds);
  const graphic = <g ref={groupRef} className={`design-icon uploaded-graphic${editing ? ' editable' : ''}`} transform={`translate(${x} ${y})`}
    data-graphic-id={element.id} data-angle={element.angle} data-radius={element.radius} data-scale={element.scale}
    data-rotation={element.rotation} data-mirrored={element.mirrored} data-inverted={element.inverted}
    role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined} aria-label="Editar gráfico subido" aria-pressed={editing ? selected : undefined}
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
      <circle id={`graphic-knockout-${element.id}`} r={25 * element.scale * Math.SQRT2 + 4} fill="#000" />
    </defs>
    <circle r={Math.max(26, 25 * element.scale * Math.SQRT2)} fill="transparent" />
    {editing && selected && <circle r={25 * element.scale * Math.SQRT2 + 3} fill="none" stroke="#8b906e" strokeWidth="1.2" strokeDasharray="3 5" pointerEvents="none" />}
    <g className="icon-art" transform={`rotate(${element.rotation}) scale(${element.scale * (element.mirrored ? -1 : 1)} ${element.scale * (element.inverted ? -1 : 1)})`} pointerEvents="none">
      <g transform={`translate(${fit.translateX} ${fit.translateY}) scale(${fit.scale})`} fill="#171717" fillRule="evenodd">
        {element.paths.map((path, index) => <path key={index} d={path.d} transform={path.transform} />)}
      </g>
    </g>
    {editing && selected && <g id={`graphic-controls-${element.id}`}>
      <ElementHandle x={deletePosition.x} y={deletePosition.y} unit={unit} kind="delete" label="Eliminar gráfico sobre la virola" onActivate={() => onDelete(element.id)} />
      <ElementHandle x={scalePosition.x} y={scalePosition.y} unit={unit} kind="scale" label="Cambiar tamaño del gráfico" onStart={event => {
        const p = matePointer(event); if (!p) return;
        resize.current = { x, y, distance: Math.max(1, Math.hypot(p.x - x, p.y - y)), scale: element.scale };
      }} onMove={event => {
        const p = matePointer(event), current = resize.current; if (!p || !current) return;
        const distance = Math.hypot(p.x - current.x, p.y - current.y);
        onUpdate(element.id, { scale: clampIconScaleAtRadius(current.scale * distance / current.distance, element.radius) });
      }} onEnd={() => { resize.current = null; }} onKey={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          onUpdate(element.id, { scale: clampIconScaleAtRadius(element.scale + (event.key === 'ArrowUp' ? .05 : -.05), element.radius) });
        }
      }} />
      <ElementHandle x={rotatePosition.x} y={rotatePosition.y} unit={unit} kind="rotate" label="Rotar gráfico" onStart={event => {
        const p = matePointer(event); if (!p) return;
        rotate.current = { x, y, bearing: Math.atan2(p.y - y, p.x - x), rotation: element.rotation };
      }} onMove={event => {
        const p = matePointer(event), current = rotate.current; if (!p || !current) return;
        const rotation = current.rotation + (Math.atan2(p.y - current.y, p.x - current.x) - current.bearing) * 180 / Math.PI;
        onUpdate(element.id, { rotation: ((rotation + 180) % 360 + 360) % 360 - 180 });
      }} onEnd={() => { rotate.current = null; }} onKey={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onUpdate(element.id, { rotation: element.rotation + (event.key === 'ArrowRight' ? 5 : -5) }); }
      }} />
    </g>}
  </g>;
  return graphic;
}
