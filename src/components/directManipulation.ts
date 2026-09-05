import { useRef } from 'react';
import type { PointerEvent } from 'react';

export function matePointer(event: PointerEvent<SVGGElement>) {
  const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
}
export const polarPoint = (angle: number, radius: number) => {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 450 + radius * Math.cos(radians), y: 450 + radius * Math.sin(radians) };
};

// Preserve the point where the user grabbed the element; selecting never snaps it.
export function useDirectDrag(angle: number, radius: number, update: (position: { angle: number; radius: number }) => void) {
  const drag = useRef<{ id: number; angleOffset: number; radiusOffset: number; angle: number; x: number; y: number; moved: boolean } | null>(null);
  return {
    onPointerDown(event: PointerEvent<SVGGElement>) {
      if (event.button !== 0 || drag.current) return;
      const p = matePointer(event); if (!p) return;
      event.stopPropagation();
      drag.current = { id: event.pointerId, angleOffset: angle - (Math.atan2(p.y - 450, p.x - 450) * 180 / Math.PI + 90), radiusOffset: radius - Math.hypot(p.x - 450, p.y - 450), angle, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<SVGGElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId || (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3)) return;
      current.moved = true;
      const p = matePointer(event); if (!p) return;
      const distance = Math.hypot(p.x - 450, p.y - 450);
      if (distance >= 12) current.angle = ((Math.atan2(p.y - 450, p.x - 450) * 180 / Math.PI + 90 + current.angleOffset) % 360 + 360) % 360;
      update({ angle: current.angle, radius: distance + current.radiusOffset });
    },
    onPointerUp(event: PointerEvent<SVGGElement>) {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(event: PointerEvent<SVGGElement>) {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture() { drag.current = null; },
  };
}
