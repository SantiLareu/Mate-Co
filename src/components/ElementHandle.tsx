import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

// Keep the visible control small while preserving a 44px mouse/touch target.
export function useSvgPixelSize(ref: { current: SVGGElement | null }) {
  const [unit, setUnit] = useState(1);
  useLayoutEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (matrix) setUnit(1 / Math.hypot(matrix.a, matrix.b));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [ref]);
  return unit;
}

type Props = {
  x: number; y: number; unit: number; counterRotation?: number;
  kind: 'delete' | 'transform' | 'scale' | 'rotate'; label: string;
  onActivate?: () => void;
  onStart?: (event: PointerEvent<SVGGElement>) => void;
  onMove?: (event: PointerEvent<SVGGElement>) => void;
  onEnd?: () => void;
  onKey?: (event: KeyboardEvent<SVGGElement>) => void;
};

export default function ElementHandle({ x, y, unit, counterRotation = 0, kind, label, onActivate, onStart, onMove, onEnd, onKey }: Props) {
  const active = useRef<number | null>(null);
  const end = (event: PointerEvent<SVGGElement>) => {
    event.stopPropagation(); active.current = null; onEnd?.();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <g className={`element-handle ${kind}-handle`} transform={`translate(${x} ${y}) rotate(${counterRotation}) scale(${unit})`}
    role="button" tabIndex={0} aria-label={label}
    onClick={event => { event.stopPropagation(); onActivate?.(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate?.(); } onKey?.(event); }}
    onPointerDown={event => {
      event.stopPropagation(); if (event.button !== 0 || active.current !== null) return;
      event.preventDefault(); active.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId); onStart?.(event);
    }}
    onPointerMove={event => { event.stopPropagation(); if (active.current === event.pointerId) onMove?.(event); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={event => { event.stopPropagation(); active.current = null; onEnd?.(); }}>
    <title>{label}</title>
    <circle className="handle-target" r="22" fill="transparent" />
    <circle className="handle-face" r="12" fill="#fffdf8" stroke="#8b906e" strokeWidth="1.2" />
    <path d={kind === 'delete'
      ? 'M-4-4 4 4M4-4-4 4'
      : kind === 'rotate'
        ? 'M-5 1A6 6 0 1 1 0 6M-5 1V6H0'
        : 'M-5 1v4h4M5-1v-4H1M-5 5 5-5'}
      fill="none" stroke="#60683e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
  </g>;
}
