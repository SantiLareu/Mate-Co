import { useRef } from 'react';
import { iconById } from '../data/icons';
import ElementHandle, { useSvgPixelSize } from './ElementHandle';
import { matePointer, useDirectDrag } from './directManipulation';

export type DesignIcon = { id: string; type: 'icon'; iconId: string; angle: number; radius: number; scale: number; rotation: number; mirrored: boolean };
export const ICON_CENTER = 357.5;
export const iconRadiusBounds = (scale: number) => {
  // A circumscribed circle includes every corner and stroke at any rotation.
  const extent = 25 * scale * Math.SQRT2;
  return { min: 300 + extent, max: 415 - extent };
};
export const normalizeIcon = (icon: DesignIcon): DesignIcon => {
  const scale = Math.max(.6, Math.min(1.4, icon.scale));
  const bounds = iconRadiusBounds(scale);
  return { ...icon, scale, radius: Math.max(bounds.min, Math.min(bounds.max, icon.radius)) };
};
export const templateIcons = (count: 1 | 2 | 3): DesignIcon[] => (count === 1 ? [180] : count === 2 ? [270, 90] : [270, 90, 180])
  .map((angle, index) => ({ id: `template-icon-${index}`, type: 'icon', iconId: 'spark', angle, radius: 360, scale: 1, rotation: 0, mirrored: false }));

type Props = { element: DesignIcon; editing: boolean; selected: boolean; onSelect: (id: string) => void; onUpdate: (id: string, changes: Partial<DesignIcon>) => void; onDelete: (id: string) => void };
export default function IconElement({ element, editing, selected, onSelect, onUpdate, onDelete }: Props) {
  const groupRef = useRef<SVGGElement>(null);
  const unit = useSvgPixelSize(groupRef);
  const transform = useRef<{ x: number; y: number; distance: number; bearing: number; scale: number; rotation: number } | null>(null);
  const directDrag = useDirectDrag(element.angle, element.radius, position => onUpdate(element.id, position));
  const radians = (element.angle - 90) * Math.PI / 180;
  const x = 450 + element.radius * Math.cos(radians), y = 450 + element.radius * Math.sin(radians);
  const controlDistance = 25 * element.scale * Math.SQRT2 + 22 * unit;
  const controlBearing = (element.rotation + 45) * Math.PI / 180;
  const definition = iconById[element.iconId];
  return <g ref={groupRef} className={`design-icon${editing ? ' editable' : ''}`} transform={`translate(${x} ${y})`}
    data-icon-id={element.id} data-angle={element.angle} data-radius={element.radius}
    role={editing ? 'button' : undefined} tabIndex={editing ? 0 : undefined} aria-label={`Editar ícono: ${definition.name}`} aria-pressed={editing ? selected : undefined}
    onClick={event => { if (editing) { event.stopPropagation(); onSelect(element.id); } }}
    onKeyDown={event => {
      if (!editing) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(element.id); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onSelect(element.id); onUpdate(element.id, { angle: element.angle + (event.key === 'ArrowRight' ? 5 : -5) }); }
      if (event.key === 'Delete') { event.preventDefault(); onDelete(element.id); }
    }}
    {...(editing ? directDrag : {})}
    onPointerDown={event => { if (editing && event.button === 0) { onSelect(element.id); directDrag.onPointerDown(event); } }}>
    <circle r={Math.max(26, 25 * element.scale * Math.SQRT2)} fill="transparent" />
    {editing && selected && <circle r={25 * element.scale * Math.SQRT2 + 3} fill="none" stroke="#8b906e" strokeWidth="1.2" strokeDasharray="3 5" pointerEvents="none" />}
    <g className="icon-art" transform={`rotate(${element.rotation}) scale(${element.scale * (element.mirrored ? -1 : 1)} ${element.scale})`} pointerEvents="none">
      <g transform="scale(1.4) translate(-16 -16)" fill="none" stroke="#171717" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {definition.paths.map((path, index) => <path key={index} d={path} />)}
      </g>
    </g>
    {editing && selected && <>
      <ElementHandle x={-controlDistance * Math.cos(controlBearing)} y={-controlDistance * Math.sin(controlBearing)} unit={unit} kind="delete" label="Eliminar ícono sobre la virola" onActivate={() => onDelete(element.id)} />
      <ElementHandle x={controlDistance * Math.cos(controlBearing)} y={controlDistance * Math.sin(controlBearing)} unit={unit} kind="transform" label="Cambiar tamaño y rotación del ícono" onStart={event => {
        const p = matePointer(event); if (!p) return;
        transform.current = { x, y, distance: Math.max(1, Math.hypot(p.x - x, p.y - y)), bearing: Math.atan2(p.y - y, p.x - x), scale: element.scale, rotation: element.rotation };
      }} onMove={event => {
        const p = matePointer(event), current = transform.current; if (!p || !current) return;
        const distance = Math.hypot(p.x - current.x, p.y - current.y);
        const rotation = distance < 4 ? element.rotation : current.rotation + (Math.atan2(p.y - current.y, p.x - current.x) - current.bearing) * 180 / Math.PI;
        onUpdate(element.id, { scale: current.scale * distance / current.distance, rotation: ((rotation + 180) % 360 + 360) % 360 - 180 });
      }} onEnd={() => { transform.current = null; }} onKey={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onUpdate(element.id, { scale: element.scale + (event.key === 'ArrowUp' ? .05 : -.05) }); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onUpdate(element.id, { rotation: element.rotation + (event.key === 'ArrowRight' ? 5 : -5) }); }
      }} />
    </>}
  </g>;
}
