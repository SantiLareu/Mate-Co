/**
 * Conversión determinista de primitivas SVG a path data (`d`).
 *
 * Solo cubre las primitivas de la whitelist V1. Cada conversor devuelve el
 * `d` o `null` cuando la primitiva es degenerada (área nula: p. ej. radio 0
 * o rect de ancho 0). Esos casos se cuentan como "invisibles omitidos", no
 * como error: no aportan píxeles al render.
 */

function formatNumber(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return `${rounded === 0 ? 0 : rounded}`;
}

/** Lee un atributo numérico. Rechaza porcentajes (dependen del viewport y su
 *  semántica varía por atributo); el parser convierte ese rechazo en error
 *  claro en lugar de adivinar. */
export function readLength(value: string | null, fallback = 0): { ok: true; value: number } | { ok: false } {
  if (value == null || value.trim() === '') return { ok: true, value: fallback };
  const trimmed = value.trim();
  if (trimmed.includes('%')) return { ok: false };
  const parsed = Number(trimmed.replace(/px$/, ''));
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

export function circleToPath(cx: number, cy: number, r: number): string | null {
  if (!(r > 0)) return null;
  const f = formatNumber;
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

export function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string | null {
  if (!(rx > 0) || !(ry > 0)) return null;
  const f = formatNumber;
  return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
}

export function rectToPath(x: number, y: number, width: number, height: number, rx: number, ry: number): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const f = formatNumber;
  const radiusX = Math.min(Math.max(0, rx), width / 2);
  const radiusY = Math.min(Math.max(0, ry), height / 2);
  if (radiusX === 0 || radiusY === 0) {
    return `M${f(x)} ${f(y)}H${f(x + width)}V${f(y + height)}H${f(x)}Z`;
  }
  return (
    `M${f(x + radiusX)} ${f(y)}` +
    `H${f(x + width - radiusX)}` +
    `A${f(radiusX)} ${f(radiusY)} 0 0 1 ${f(x + width)} ${f(y + radiusY)}` +
    `V${f(y + height - radiusY)}` +
    `A${f(radiusX)} ${f(radiusY)} 0 0 1 ${f(x + width - radiusX)} ${f(y + height)}` +
    `H${f(x + radiusX)}` +
    `A${f(radiusX)} ${f(radiusY)} 0 0 1 ${f(x)} ${f(y + height - radiusY)}` +
    `V${f(y + radiusY)}` +
    `A${f(radiusX)} ${f(radiusY)} 0 0 1 ${f(x + radiusX)} ${f(y)}Z`
  );
}

export function lineToPath(x1: number, y1: number, x2: number, y2: number): string | null {
  // Una línea de largo cero no pinta nada (incluso con stroke); se omite.
  if (x1 === x2 && y1 === y2) return null;
  const f = formatNumber;
  return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
}

export function polylineToPath(points: string, close: boolean): string | null {
  const numbers = points.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  if (numbers.length < 4 || numbers.length % 2 !== 0 || numbers.some(value => !Number.isFinite(value))) {
    return null;
  }
  const f = formatNumber;
  let d = `M${f(numbers[0])} ${f(numbers[1])}`;
  for (let index = 2; index < numbers.length; index += 2) {
    d += `L${f(numbers[index])} ${f(numbers[index + 1])}`;
  }
  return close ? `${d}Z` : d;
}
