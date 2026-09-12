import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';

export function usePreventManipulationScroll(ref: { current: SVGGElement | null }, enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const preventScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', preventScroll, { passive: false });
    return () => element.removeEventListener('touchmove', preventScroll);
  }, [enabled, ref]);
}

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
  const drag = useRef<{
    id: number;
    angleOffset: number;
    radiusOffset: number;
    angle: number;
    clientX: number;
    clientY: number;
    pointerX: number;
    pointerY: number;
    inverseA: number;
    inverseB: number;
    inverseC: number;
    inverseD: number;
    moved: boolean;
  } | null>(null);
  return {
    onPointerDown(event: PointerEvent<SVGGElement>) {
      if (event.button !== 0 || drag.current) return;
      const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM();
      if (!matrix) return;
      const inverse = matrix.inverse();
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
      event.stopPropagation();
      drag.current = {
        id: event.pointerId,
        angleOffset: angle - (Math.atan2(p.y - 450, p.x - 450) * 180 / Math.PI + 90),
        radiusOffset: radius - Math.hypot(p.x - 450, p.y - 450),
        angle,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerX: p.x,
        pointerY: p.y,
        inverseA: inverse.a,
        inverseB: inverse.b,
        inverseC: inverse.c,
        inverseD: inverse.d,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<SVGGElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const deltaX = event.clientX - current.clientX;
      const deltaY = event.clientY - current.clientY;
      if (!current.moved && Math.hypot(deltaX, deltaY) < 3) return;
      current.moved = true;
      // Convert only the pointer's real screen-space displacement with the
      // matrix captured at pointerdown. A responsive reflow can translate the
      // SVG during selection without becoming part of the gesture.
      const p = {
        x: current.pointerX + current.inverseA * deltaX + current.inverseC * deltaY,
        y: current.pointerY + current.inverseB * deltaX + current.inverseD * deltaY,
      };
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
