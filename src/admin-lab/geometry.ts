/**
 * Geometría aislada y acotada del /admin-lab (sin DOM, sin importador).
 *
 * Motivo: `src/svg-import/measure.ts` NO se puede editar (producción) pero
 * tiene dos límites conocidos para la biblioteca del dueño:
 *
 * - Su regex numérica general interpreta mal los flags de arco compactados
 *   legales (`A30 50 0 01162.55...`: los `0`/`1` pegados se fusionan con la
 *   coordenada siguiente y el path se deforma o se descarta en silencio).
 * - Sus bounds de arco por muestreo (24 pasos) pueden quedar por dentro de
 *   la curva real y recortar el preview.
 *
 * Este módulo NO reescribe ni aplana el `d` original (el arte se preserva
 * tal cual): solo valida con una gramática estricta y acotada, y calcula
 * bounds exactos (extremos analíticos de curvas y arcos, sin muestreo) para
 * que el preview nunca recorte.
 *
 * La admisión v1 sigue rechazando flags compactados por compatibilidad con
 * el importador base. La medición controlada v2 usa solo esta gramática
 * exacta y sí los admite, sin pasar por el importador base.
 *
 * Cotas de trabajo (S2): el costo estimado (arco=26, curva=18, recta=1) se
 * acumula DURANTE el tokenizado y aborta antes de reservar nada grande; la
 * estimación barata sobre el texto (`estimateSvgTextWork`) corre ANTES de
 * `DOMParser`/`parseSvgImport` para que un archivo hostil nunca bloquee la
 * pestaña. Los bounds exactos no reservan muestreos.
 */

import { parseTransformList } from "../svg-import/transforms";
import type { ArtBounds } from "./types";
import type { ControlledNode, ControlledPath } from "./importedGeometry";

/** Límites propios de la biblioteca (admission los reexporta). */
export const ADMIN_GEOMETRY_LIMITS = {
  /** Tope del archivo ANTES de leerlo. */
  MAX_FILE_BYTES: 2_000_000,
  /** Paths admitidos por diseño. */
  MAX_PATHS: 2_000,
  /** Suma de caracteres `d` por diseño. */
  MAX_TOTAL_D_CHARS: 2_000_000,
  /** Caracteres `d` por path individual. */
  MAX_D_CHARS: 1_000_000,
  /** Magnitud máxima de cualquier coordenada (local o transformada). */
  MAX_COORD: 1_000_000,
  /** Costo estimado total por diseño (cota de trabajo síncrono). */
  MAX_POINTS: 500_000,
  /** Comandos máximos por `d` (cota de reserva antes de expandir). */
  MAX_COMMANDS_PER_PATH: 200_000,
  /** Registros máximos a validar por lectura de almacenamiento. */
  MAX_RECORDS_SCAN: 5_000,
} as const;

/** Costo estimado por segmento (cota superior del trabajo real). */
const ARC_COST = 26;
const CURVE_COST = 18;
const LINE_COST = 1;

export type GeometryCode =
  "INVALID_D" | "COORD_OUT_OF_RANGE" | "DESIGN_TOO_LARGE" | "INVALID_TRANSFORM";

export type GeometryCheck =
  | { ok: true; bounds: ArtBounds; cost: number }
  | { ok: false; code: GeometryCode; reason: string };

type Vec = { x: number; y: number };

const SVG_NS = "http://www.w3.org/2000/svg";
export const ADMIN_SVG_NAMESPACE = SVG_NS;

const NUMBER_HEAD = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

function isCommandLetter(char: string): boolean {
  return /^[MmLlHhVvCcSsQqTtAaZz]$/.test(char);
}

function isNumberStart(char: string): boolean {
  return (
    char === "+" || char === "-" || char === "." || (char >= "0" && char <= "9")
  );
}

function skipSeparators(text: string, pos: number): number {
  while (
    pos < text.length &&
    (text[pos] === " " ||
      text[pos] === "\t" ||
      text[pos] === "\n" ||
      text[pos] === "\r" ||
      text[pos] === ",")
  ) {
    pos += 1;
  }
  return pos;
}

export interface TokenizedPath {
  /** Costo estimado (arco 26, curva 18, recta 1). */
  cost: number;
  /** `true` si algún arco usa flags compactados sin separador. */
  packedArcFlags: boolean;
  /** Comandos ya validados por aridad, listos para medir. */
  commands: Array<{ op: string; relative: boolean; numbers: number[] }>;
}

function failReason(
  code: GeometryCode,
  reason: string,
): { ok: false; code: GeometryCode; reason: string } {
  return { ok: false, code, reason };
}

/**
 * Tokeniza un `d` con gramática estricta. Consume TODO el texto: la basura
 * al final (`hello`, exponentes rotos como `1e`, comandos truncados) es
 * error, no silencio. Los flags de arco se parsean como la spec manda
 * (dígitos `0`/`1` individuales, pegados o separados).
 */
export function tokenizePathData(
  d: string,
):
  | { ok: true; path: TokenizedPath }
  | { ok: false; reason: string; packed?: boolean } {
  if (typeof d !== "string" || d.trim() === "") {
    return { ok: false, reason: "path vacío" };
  }
  if (d.length > ADMIN_GEOMETRY_LIMITS.MAX_D_CHARS) {
    return { ok: false, reason: "path demasiado largo" };
  }
  const commands: TokenizedPath["commands"] = [];
  let packedArcFlags = false;
  let cost = 0;
  let pos = skipSeparators(d, 0);
  let current: string | null = null;
  let first = true;

  const parseNumber = (): number | null => {
    pos = skipSeparators(d, pos);
    const rest = d.slice(pos);
    const match = NUMBER_HEAD.exec(rest);
    if (!match) return null;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return null;
    pos += match[0].length;
    return value;
  };

  while (pos < d.length) {
    const char = d[pos];
    if (isCommandLetter(char)) {
      current = char;
      pos += 1;
    } else if (isNumberStart(char) && current !== null) {
      // Repetición implícita: M pasa a L implícito, el resto repite.
      // Z no admite repetición implícita: un número tras Z es error.
      if (current === "Z" || current === "z") {
        return { ok: false, reason: `número inesperado tras "${current}"` };
      }
      if (current === "M") current = "L";
      else if (current === "m") current = "l";
    } else {
      return { ok: false, reason: `carácter inesperado "${char}"` };
    }
    const op = current.toUpperCase();
    const relative = current >= "a" && current <= "z";
    if (first && op !== "M") {
      return { ok: false, reason: "el path debe empezar con M" };
    }
    first = false;

    if (op === "Z") {
      commands.push({ op, relative: false, numbers: [] });
      cost += LINE_COST;
      pos = skipSeparators(d, pos);
    } else if (op === "H" || op === "V") {
      const numbers: number[] = [];
      for (;;) {
        const next = skipSeparators(d, pos);
        if (next >= d.length || !isNumberStart(d[next])) break;
        pos = next;
        const value = parseNumber();
        if (value === null) return { ok: false, reason: "número inválido" };
        numbers.push(value);
        cost += LINE_COST;
        if (cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
          return { ok: false, reason: "diseño demasiado grande" };
        }
      }
      if (numbers.length === 0) {
        return { ok: false, reason: `comando ${current} sin coordenadas` };
      }
      commands.push({ op, relative, numbers });
    } else if (op === "A") {
      // Arcos de a 7: rx ry rot flag1 flag2 x y (los flags son 0/1 sueltos).
      const groups: number[] = [];
      for (;;) {
        const checkpoint = pos;
        pos = skipSeparators(d, pos);
        const rx = parseNumber();
        if (rx === null) {
          pos = checkpoint;
          break;
        }
        const ry = parseNumber();
        if (ry === null) return { ok: false, reason: "arco incompleto" };
        const rot = parseNumber();
        if (rot === null) return { ok: false, reason: "arco incompleto" };
        // Flags: separador opcional, dígito 0/1 obligatorio.
        const sep0 = pos;
        pos = skipSeparators(d, pos);
        const packed0 = pos === sep0 && /[01]/.test(d[pos] ?? "");
        const flag1 = d[pos] ?? "";
        if (flag1 !== "0" && flag1 !== "1") {
          return { ok: false, reason: "flags de arco inválidos" };
        }
        pos += 1;
        const sep1 = pos;
        pos = skipSeparators(d, pos);
        const packed1 = pos === sep1 && /[01]/.test(d[pos] ?? "");
        const flag2 = d[pos] ?? "";
        if (flag2 !== "0" && flag2 !== "1") {
          return { ok: false, reason: "flags de arco inválidos" };
        }
        pos += 1;
        const sep2 = pos;
        pos = skipSeparators(d, pos);
        const packed2 = pos === sep2;
        if (packed0 || packed1 || packed2) packedArcFlags = true;
        const x = parseNumber();
        if (x === null) return { ok: false, reason: "arco incompleto" };
        const y = parseNumber();
        if (y === null) return { ok: false, reason: "arco incompleto" };
        groups.push(rx, ry, rot, Number(flag1), Number(flag2), x, y);
        cost += ARC_COST;
        if (cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
          return { ok: false, reason: "diseño demasiado grande" };
        }
        void checkpoint;
      }
      if (groups.length === 0) {
        return { ok: false, reason: `comando ${current} sin parámetros` };
      }
      commands.push({ op, relative, numbers: groups });
    } else {
      const arity =
        op === "C" ? 6 : op === "S" || op === "Q" ? 4 : op === "T" ? 2 : 2;
      const numbers: number[] = [];
      for (;;) {
        const checkpoint = pos;
        const group: number[] = [];
        for (let index = 0; index < arity; index += 1) {
          const value = parseNumber();
          if (value === null) break;
          group.push(value);
        }
        if (group.length === 0) {
          pos = checkpoint;
          break;
        }
        if (group.length !== arity) {
          return {
            ok: false,
            reason: `comando ${current} con parámetros incompletos`,
          };
        }
        numbers.push(...group);
        cost += op === "C" || op === "S" || op === "Q" ? CURVE_COST : LINE_COST;
        if (cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
          return { ok: false, reason: "diseño demasiado grande" };
        }
      }
      if (numbers.length === 0) {
        return { ok: false, reason: `comando ${current} sin coordenadas` };
      }
      commands.push({ op, relative, numbers });
    }
    if (commands.length > ADMIN_GEOMETRY_LIMITS.MAX_COMMANDS_PER_PATH) {
      return { ok: false, reason: "diseño demasiado grande" };
    }
    pos = skipSeparators(d, pos);
  }
  if (commands.length === 0) {
    return { ok: false, reason: "path sin comandos" };
  }
  return { ok: true, path: { cost, packedArcFlags, commands } };
}

/** Estimación barata sobre el texto crudo, ANTES de DOMParser/importador. */
export function estimateSvgTextWork(svgText: string): {
  paths: number;
  dChars: number;
  cost: number;
} {
  const pathTags = svgText.match(/<path[\s/>]/gi) ?? [];
  let dChars = 0;
  let cost = 0;
  const attrPattern = /\sd\s*=\s*("[^"]*"|'[^']*')/g;
  let match = attrPattern.exec(svgText);
  let guard = 0;
  while (match && guard < 100_000) {
    guard += 1;
    const quoted = match[1];
    const body = quoted.slice(1, -1);
    dChars += body.length;
    for (let index = 0; index < body.length; index += 1) {
      const letter = body[index].toUpperCase();
      if (letter === "A") cost += ARC_COST;
      else if (
        letter === "C" ||
        letter === "S" ||
        letter === "Q" ||
        letter === "T"
      ) {
        cost += CURVE_COST;
      } else if (
        letter === "M" ||
        letter === "L" ||
        letter === "H" ||
        letter === "V" ||
        letter === "Z"
      ) {
        cost += LINE_COST;
      }
    }
    if (
      dChars > ADMIN_GEOMETRY_LIMITS.MAX_TOTAL_D_CHARS ||
      cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS
    ) {
      break;
    }
    match = attrPattern.exec(svgText);
  }
  return { paths: pathTags.length, dChars, cost };
}

// ---- Bounds exactos (analíticos, sin muestreo) ----

function finiteBox(box: ArtBounds): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
  );
}

function unionInto(
  acc: { x0: number; y0: number; x1: number; y1: number; empty: boolean },
  x: number,
  y: number,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (acc.empty) {
    acc.x0 = x;
    acc.y0 = y;
    acc.x1 = x;
    acc.y1 = y;
    acc.empty = false;
    return true;
  }
  if (x < acc.x0) acc.x0 = x;
  if (y < acc.y0) acc.y0 = y;
  if (x > acc.x1) acc.x1 = x;
  if (y > acc.y1) acc.y1 = y;
  return true;
}

function cubicRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  // Extremos de B(t): A t² + B t + C = 0 (derivada / 3).
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = -p0 + p1;
  if (a === 0) {
    if (b === 0) return [];
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) {
    const t = -b / (2 * a);
    return t > 0 && t < 1 ? [t] : [];
  }
  const root = Math.sqrt(disc);
  return [-b + root, -b - root]
    .map((num) => num / (2 * a))
    .filter((t) => t > 0 && t < 1);
}

function cubicAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

function quadraticRoot(p0: number, p1: number, p2: number): number[] {
  const denom = p0 - 2 * p1 + p2;
  if (denom === 0) return [];
  const t = (p0 - p1) / denom;
  return t > 0 && t < 1 ? [t] : [];
}

function quadraticAt(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

const TAU = Math.PI * 2;

function angleOnArc(
  candidate: number,
  start: number,
  sweepAngle: number,
  sweepFlag: number,
): boolean {
  const eps = 1e-9;
  let delta = (candidate - start) % TAU;
  if (delta < 0) delta += TAU;
  if (sweepFlag === 1) {
    return delta <= sweepAngle + eps;
  }
  const travel = TAU - delta;
  return travel <= -sweepAngle + eps;
}

interface ArcCenter {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  startAngle: number;
  sweepAngle: number;
}

/** Parametrización centro→ángulo (spec SVG F.6.5), sin muestrear. */
function arcCenter(
  from: Vec,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: number,
  sweep: number,
  to: Vec,
): ArcCenter | { line: true } | null {
  // SVG: extremos coincidentes omiten el arco (no dibujan una elipse).
  if (from.x === to.x && from.y === to.y) return { line: true };
  let rX = Math.abs(rx);
  let rY = Math.abs(ry);
  if (!Number.isFinite(rX) || !Number.isFinite(rY)) return null;
  if (rX === 0 || rY === 0) return { line: true };
  const phi = (rotationDegrees * Math.PI) / 180;
  if (!Number.isFinite(phi)) return null;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rX * rX) + (y1 * y1) / (rY * rY);
  if (!Number.isFinite(lambda)) return null;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rX *= scale;
    rY *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rX * rX * rY * rY - rX * rX * y1 * y1 - rY * rY * x1 * x1;
  const denominator = rX * rX * y1 * y1 + rY * rY * x1 * x1;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }
  if (denominator === 0) return null;
  const factor = sign * Math.sqrt(Math.max(0, numerator / denominator));
  if (!Number.isFinite(factor)) return null;
  const cx1 = (factor * rX * y1) / rY;
  const cy1 = (-factor * rY * x1) / rX;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const angleBetween = (
    ux: number,
    uy: number,
    vx: number,
    vy: number,
  ): number => {
    const dot = ux * vx + uy * vy;
    const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (!Number.isFinite(lengths)) return NaN;
    const clamped = Math.max(
      -1,
      Math.min(1, lengths === 0 ? 1 : dot / lengths),
    );
    const angle = Math.acos(clamped);
    return ux * vy - uy * vx < 0 ? -angle : angle;
  };
  const startAngle = angleBetween(1, 0, (x1 - cx1) / rX, (y1 - cy1) / rY);
  let sweepAngle = angleBetween(
    (x1 - cx1) / rX,
    (y1 - cy1) / rY,
    (-x1 - cx1) / rX,
    (-y1 - cy1) / rY,
  );
  if (!Number.isFinite(startAngle) || !Number.isFinite(sweepAngle)) {
    return null;
  }
  if (sweep === 0 && sweepAngle > 0) sweepAngle -= TAU;
  if (sweep === 1 && sweepAngle < 0) sweepAngle += TAU;
  return { cx, cy, rx: rX, ry: rY, startAngle, sweepAngle };
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function applyMatrix(m: Matrix, x: number, y: number): Vec {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/**
 * Bounds exactos de un path tokenizado bajo una matriz afín ya validada.
 * Curvas: extremos analíticos sobre los controles transformados (exacto).
 * Arcos: la elipse transformada sigue siendo elipse paramétrica
 * (C' + cos·U' + sin·V'); sus extremos por dimensión salen de tan θ y se
 * filtran por pertenencia al barrido. Nunca muestrea: no recorta.
 */
function tokenizedBounds(
  commands: TokenizedPath["commands"],
  m: Matrix,
  acc: { x0: number; y0: number; x1: number; y1: number; empty: boolean },
): boolean {
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevCubic: Vec | null = null;
  let prevQuadratic: Vec | null = null;

  const dot = (px: number, py: number): boolean => {
    const t = applyMatrix(m, px, py);
    return unionInto(acc, t.x, t.y);
  };

  for (const { op, relative, numbers } of commands) {
    const offX = (nx: number): number => (relative ? nx + x : nx);
    const offY = (ny: number): number => (relative ? ny + y : ny);
    if (op === "Z") {
      x = startX;
      y = startY;
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (op === "M") {
      for (let index = 0; index < numbers.length; index += 2) {
        const nx = offX(numbers[index]);
        const ny = offY(numbers[index + 1]);
        x = nx;
        y = ny;
        if (index === 0) {
          startX = nx;
          startY = ny;
        }
        if (!dot(nx, ny)) return false;
      }
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (op === "L") {
      for (let index = 0; index < numbers.length; index += 2) {
        x = offX(numbers[index]);
        y = offY(numbers[index + 1]);
        if (!dot(x, y)) return false;
      }
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (op === "H") {
      for (const value of numbers) {
        x = relative ? x + value : value;
        if (!dot(x, y)) return false;
      }
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (op === "V") {
      for (const value of numbers) {
        y = relative ? y + value : value;
        if (!dot(x, y)) return false;
      }
      prevCubic = null;
      prevQuadratic = null;
      continue;
    }
    if (op === "C" || op === "S" || op === "Q" || op === "T") {
      const arity = op === "C" ? 6 : op === "S" || op === "Q" ? 4 : 2;
      for (let index = 0; index < numbers.length; index += arity) {
        const group = numbers.slice(index, index + arity);
        if (op === "C" || op === "S") {
          const p0 = { x, y };
          const p1 =
            op === "C"
              ? { x: offX(group[0]), y: offY(group[1]) }
              : prevCubic
                ? { x: 2 * x - prevCubic.x, y: 2 * y - prevCubic.y }
                : { x, y };
          const shift = op === "C" ? 0 : -2;
          const p2 = { x: offX(group[2 + shift]), y: offY(group[3 + shift]) };
          const p3 = { x: offX(group[4 + shift]), y: offY(group[5 + shift]) };
          // Controles transformados → extremos analíticos (exacto).
          const q0 = applyMatrix(m, p0.x, p0.y);
          const q1 = applyMatrix(m, p1.x, p1.y);
          const q2 = applyMatrix(m, p2.x, p2.y);
          const q3 = applyMatrix(m, p3.x, p3.y);
          const ts = new Set<number>([
            ...cubicRoots(q0.x, q1.x, q2.x, q3.x),
            ...cubicRoots(q0.y, q1.y, q2.y, q3.y),
          ]);
          if (!unionInto(acc, q0.x, q0.y)) return false;
          for (const t of ts) {
            if (
              !unionInto(
                acc,
                cubicAt(q0.x, q1.x, q2.x, q3.x, t),
                cubicAt(q0.y, q1.y, q2.y, q3.y, t),
              )
            ) {
              return false;
            }
          }
          if (!unionInto(acc, q3.x, q3.y)) return false;
          prevCubic = p2;
          prevQuadratic = null;
          x = p3.x;
          y = p3.y;
        } else {
          const p0 = { x, y };
          const p1: Vec =
            op === "Q"
              ? { x: offX(group[0]), y: offY(group[1]) }
              : prevQuadratic
                ? { x: 2 * x - prevQuadratic.x, y: 2 * y - prevQuadratic.y }
                : { x, y };
          const endpoint = op === "Q" ? 2 : 0;
          const p2 = { x: offX(group[endpoint]), y: offY(group[endpoint + 1]) };
          const q0 = applyMatrix(m, p0.x, p0.y);
          const q1 = applyMatrix(m, p1.x, p1.y);
          const q2 = applyMatrix(m, p2.x, p2.y);
          const ts = new Set<number>([
            ...quadraticRoot(q0.x, q1.x, q2.x),
            ...quadraticRoot(q0.y, q1.y, q2.y),
          ]);
          if (!unionInto(acc, q0.x, q0.y)) return false;
          for (const t of ts) {
            if (
              !unionInto(
                acc,
                quadraticAt(q0.x, q1.x, q2.x, t),
                quadraticAt(q0.y, q1.y, q2.y, t),
              )
            ) {
              return false;
            }
          }
          if (!unionInto(acc, q2.x, q2.y)) return false;
          prevCubic = null;
          prevQuadratic = p1;
          x = p2.x;
          y = p2.y;
        }
      }
      continue;
    }
    if (op === "A") {
      for (let index = 0; index < numbers.length; index += 7) {
        const group = numbers.slice(index, index + 7);
        const from = { x, y };
        const to = { x: offX(group[5]), y: offY(group[6]) };
        const center = arcCenter(
          from,
          group[0],
          group[1],
          group[2],
          group[3],
          group[4],
          to,
        );
        if (center === null) return false;
        if (!dot(from.x, from.y) || !dot(to.x, to.y)) return false;
        if (!("line" in center)) {
          // Elipse bajo M: P(θ) = C' + cosθ·U' + sinθ·V'.
          const phi = (group[2] * Math.PI) / 180;
          const ux = Math.cos(phi) * center.rx;
          const uy = Math.sin(phi) * center.rx;
          const vx = -Math.sin(phi) * center.ry;
          const vy = Math.cos(phi) * center.ry;
          const cc = applyMatrix(m, center.cx, center.cy);
          const ux2 = m.a * ux + m.c * uy;
          const vx2 = m.a * vx + m.c * vy;
          const uy2 = m.b * ux + m.d * uy;
          const vy2 = m.b * vx + m.d * vy;
          const candidates = [
            Math.atan2(vx2, ux2),
            Math.atan2(vx2, ux2) + Math.PI,
            Math.atan2(vy2, uy2),
            Math.atan2(vy2, uy2) + Math.PI,
          ];
          for (const angle of candidates) {
            if (
              !angleOnArc(angle, center.startAngle, center.sweepAngle, group[4])
            ) {
              continue;
            }
            const px = cc.x + ux2 * Math.cos(angle) + vx2 * Math.sin(angle);
            const py = cc.y + uy2 * Math.cos(angle) + vy2 * Math.sin(angle);
            if (!unionInto(acc, px, py)) return false;
          }
        }
        prevCubic = null;
        prevQuadratic = null;
        x = to.x;
        y = to.y;
      }
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Validación compartida admisión ⇄ almacenamiento (S1/M4): gramática
 * estricta, presupuestos, matriz compuesta finita, coordenadas transformadas
 * en rango y bounds exactos derivados (nunca confiados).
 */
export function checkDesignGeometry(
  paths: ReadonlyArray<{ d: string; transform?: string }>,
): GeometryCheck {
  if (!Array.isArray(paths) || paths.length === 0) {
    return failReason("INVALID_D", "El diseño no trae geometría.");
  }
  if (paths.length > ADMIN_GEOMETRY_LIMITS.MAX_PATHS) {
    return failReason(
      "DESIGN_TOO_LARGE",
      `El diseño supera el máximo de ${ADMIN_GEOMETRY_LIMITS.MAX_PATHS} paths.`,
    );
  }
  let totalChars = 0;
  let totalCost = 0;
  const acc = {
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    empty: true,
  };
  for (const entry of paths) {
    // Defensa runtime: el almacenamiento es JSON no confiable y puede
    // traer nulls, strings, números o arreglos como "path". Nunca se
    // toca `entry.d` sin comprobar la forma primero (antes lanzaba
    // TypeError y rompía todo el sobre en vez de aislar el registro).
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return failReason("INVALID_D", "Un path no tiene geometría válida.");
    }
    const d: unknown = (entry as { d?: unknown }).d;
    if (
      typeof d !== "string" ||
      d === "" ||
      d.length > ADMIN_GEOMETRY_LIMITS.MAX_D_CHARS
    ) {
      return failReason(
        typeof d === "string" && d.length > ADMIN_GEOMETRY_LIMITS.MAX_D_CHARS
          ? "DESIGN_TOO_LARGE"
          : "INVALID_D",
        "Un path no tiene geometría válida.",
      );
    }
    totalChars += d.length;
    if (totalChars > ADMIN_GEOMETRY_LIMITS.MAX_TOTAL_D_CHARS) {
      return failReason(
        "DESIGN_TOO_LARGE",
        "El diseño supera el volumen de geometría admitido.",
      );
    }
    const tokenized = tokenizePathData(d);
    if (!tokenized.ok) {
      if (tokenized.reason === "diseño demasiado grande") {
        return failReason(
          "DESIGN_TOO_LARGE",
          "El diseño supera el volumen de geometría admitido.",
        );
      }
      if (tokenized.packed) {
        return failReason(
          "INVALID_D",
          "Un path usa flags de arco compactados sin separadores: agregá espacios entre los 0/1 y las coordenadas.",
        );
      }
      return failReason(
        "INVALID_D",
        `Un path tiene sintaxis inválida (${tokenized.reason}).`,
      );
    }
    if (tokenized.path.packedArcFlags) {
      return failReason(
        "INVALID_D",
        "Un path usa flags de arco compactados sin separadores (p. ej. 01162): agregá espacios entre los 0/1 y las coordenadas para que el diseño no se deforme.",
      );
    }
    totalCost += tokenized.path.cost;
    if (totalCost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
      return failReason(
        "DESIGN_TOO_LARGE",
        "El diseño supera el volumen de geometría admitido.",
      );
    }
    const rawTransform: unknown = (entry as { transform?: unknown }).transform;
    let matrix: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (rawTransform !== undefined) {
      if (typeof rawTransform !== "string" || rawTransform === "") {
        return failReason("INVALID_TRANSFORM", "Un transform no es válido.");
      }
      if (rawTransform.length > 2_000) {
        return failReason(
          "INVALID_TRANSFORM",
          "Un transform es demasiado largo.",
        );
      }
      const parsed = parseTransformList(rawTransform);
      if (!parsed.ok) {
        return failReason(
          "INVALID_TRANSFORM",
          `Un transform no es válido: ${parsed.error.message}`,
        );
      }
      const entries = [
        parsed.matrix.a,
        parsed.matrix.b,
        parsed.matrix.c,
        parsed.matrix.d,
        parsed.matrix.e,
        parsed.matrix.f,
      ];
      // Composición desbordada (p. ej. scale(1e200) dos veces): la matriz
      // por partes es finita pero el producto es infinito.
      if (!entries.every(Number.isFinite)) {
        return failReason(
          "INVALID_TRANSFORM",
          "Un transform compuesto se desborda (valores no finitos).",
        );
      }
      matrix = parsed.matrix;
    }
    if (!tokenizedBounds(tokenized.path.commands, matrix, acc)) {
      // Distingue matriz desbordada (ya filtrada arriba: aquí solo puede
      // venir de coordenadas no finitas o desborde al transformar).
      return failReason(
        "COORD_OUT_OF_RANGE",
        "El archivo usa coordenadas fuera del rango admitido.",
      );
    }
  }
  if (acc.empty) {
    return failReason("INVALID_D", "El diseño no tiene área medible.");
  }
  const bounds: ArtBounds = {
    x: acc.x0,
    y: acc.y0,
    width: acc.x1 - acc.x0,
    height: acc.y1 - acc.y0,
  };
  if (!finiteBox(bounds)) {
    return failReason(
      "COORD_OUT_OF_RANGE",
      "El archivo usa coordenadas fuera del rango admitido.",
    );
  }
  if (!(bounds.width > 0) || !(bounds.height > 0)) {
    return failReason("INVALID_D", "El diseño no tiene área visible.");
  }
  for (const value of [bounds.x, bounds.y, bounds.width, bounds.height]) {
    if (Math.abs(value) > ADMIN_GEOMETRY_LIMITS.MAX_COORD) {
      return failReason(
        "COORD_OUT_OF_RANGE",
        "El archivo usa coordenadas fuera del rango admitido.",
      );
    }
  }
  return { ok: true, bounds, cost: totalCost };
}

/** Only definite transparent cases in already validated concrete paints.
 * Unknown/nonzero alpha remains potentially painted; no general color engine.
 */
function paintCanRender(paint: string): boolean {
  const text = paint.trim().toLowerCase();
  if (text === "none" || text === "transparent") return false;
  if (/^#[\da-f]{4}$/.test(text)) return text[4] !== "0";
  if (/^#[\da-f]{8}$/.test(text)) return text.slice(-2) !== "00";
  const fn = /^(?:rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (!fn) return true;
  const alpha = fn[1].includes(",") ? fn[1].split(",")[3] : fn[1].split("/")[1];
  // CSS clamps negative alpha to zero. Finite numeric syntax was gated upstream.
  return alpha === undefined || !(Number(alpha.trim().replace(/%$/, "")) <= 0);
}

/** Bounds-only visibility from a trusted/validated ordered tree. Never modify
 * node opacity or style: group compositing must remain intact when rendered.
 * Propagate zero/nonzero, not products (tiny positive opacities can underflow).
 */
function potentiallyPaintedPaths(
  paths: ReadonlyArray<ControlledPath>,
  nodes?: ReadonlyArray<ControlledNode>,
): boolean[] {
  if (!nodes) return paths.map(() => true);
  const painted = paths.map(() => false);
  const visit = (index: number, ancestorPainted: boolean): void => {
    const node = nodes[index];
    const active = ancestorPainted && node.opacity > 0;
    if (node.kind === "path") painted[node.path] = active;
    else for (const child of node.children) visit(child, active);
  };
  visit(0, true);
  return painted;
}

/** New v2 measurement: preflight ALL tokenization/work before analytic bounds.
 * Packed flags are safe here: neither the shared parser nor sampler is used.
 * A local radius envelope transformed by row norms conservatively covers
 * round/bevel joins, square caps and miter joins under ANY affine matrix.
 * Optional nodes must have already passed the bounded, strict tree validation.
 */
export function measureControlledPaths(
  paths: ReadonlyArray<ControlledPath>,
  nodes?: ReadonlyArray<ControlledNode>,
):
  | {
      ok: true;
      centerlineBounds: ArtBounds;
      artBounds: ArtBounds;
      /** Exact former v2 envelope, only for bounded legacy-claim compatibility. */
      unfilteredArtBounds: ArtBounds;
      cost: number;
    }
  | { ok: false; code: GeometryCode; reason: string } {
  if (!paths.length || paths.length > ADMIN_GEOMETRY_LIMITS.MAX_PATHS) {
    return failReason(
      "DESIGN_TOO_LARGE",
      "El diseño excede el límite de paths.",
    );
  }
  const prepared: TokenizedPath[] = [];
  let chars = 0;
  let cost = 0;
  for (const path of paths) {
    chars += path.d.length;
    if (chars > ADMIN_GEOMETRY_LIMITS.MAX_TOTAL_D_CHARS) {
      return failReason(
        "DESIGN_TOO_LARGE",
        "El diseño excede el volumen de geometría admitido.",
      );
    }
    // Commas separate numbers, never commands, repeated commas or the end.
    if (/(?:^|[a-z])\s*,|,\s*(?:,|[a-z]|$)/i.test(path.d)) {
      return failReason("INVALID_D", "Un path tiene separadores inválidos.");
    }
    const parsed = tokenizePathData(path.d);
    if (!parsed.ok) {
      return failReason(
        parsed.reason === "diseño demasiado grande" ||
          path.d.length > ADMIN_GEOMETRY_LIMITS.MAX_D_CHARS
          ? "DESIGN_TOO_LARGE"
          : "INVALID_D",
        parsed.reason,
      );
    }
    // The legacy tokenizer prices T like a line. v2 must bound its actual
    // quadratic-extrema work too, including implicit repeated segments.
    cost +=
      parsed.path.cost +
      parsed.path.commands.reduce(
        (extra, command) =>
          extra +
          (command.op === "T"
            ? (command.numbers.length / 2) * (CURVE_COST - LINE_COST)
            : 0),
        0,
      );
    if (cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
      return failReason(
        "DESIGN_TOO_LARGE",
        "El diseño excede el trabajo de geometría admitido.",
      );
    }
    if (
      !Object.values(path.matrix).every(
        (v) =>
          Number.isFinite(v) && Math.abs(v) <= ADMIN_GEOMETRY_LIMITS.MAX_COORD,
      ) ||
      parsed.path.commands.some(
        (command) =>
          command.numbers.some(
            (v) => Math.abs(v) > ADMIN_GEOMETRY_LIMITS.MAX_COORD,
          ) ||
          (command.op === "A" &&
            command.numbers.some(
              (v, i) => (i % 7 === 0 || i % 7 === 1) && v < 0,
            )),
      )
    ) {
      return failReason(
        "COORD_OUT_OF_RANGE",
        "El archivo usa coordenadas fuera del rango admitido.",
      );
    }
    prepared.push(parsed.path);
  }
  const accumulator = () => ({ x0: 0, y0: 0, x1: 0, y1: 0, empty: true });
  const center = accumulator();
  const painted = accumulator();
  const unfiltered = accumulator();
  const active = potentiallyPaintedPaths(paths, nodes);
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    const local = accumulator();
    if (
      !tokenizedBounds(prepared[index].commands, path.matrix, local) ||
      local.empty
    ) {
      return failReason("INVALID_D", "El diseño no tiene geometría medible.");
    }
    unionInto(center, local.x0, local.y0);
    unionInto(center, local.x1, local.y1);
    const radius =
      path.style.stroke === "none" ? 0 : path.style.strokeWidth / 2;
    const factor = Math.max(
      path.style.linecap === "square" ? Math.SQRT2 : 1,
      path.style.linejoin === "miter" ? path.style.miterlimit : 1,
    );
    const dx = radius * factor * Math.hypot(path.matrix.a, path.matrix.c);
    const dy = radius * factor * Math.hypot(path.matrix.b, path.matrix.d);
    // Keep the former envelope/range checks even for inactive paths. Geometry,
    // work budgets and coordinates never bypass validation due to visibility.
    if (
      !unionInto(unfiltered, local.x0 - dx, local.y0 - dy) ||
      !unionInto(unfiltered, local.x1 + dx, local.y1 + dy)
    ) {
      return failReason(
        "COORD_OUT_OF_RANGE",
        "Los trazos exceden el rango admitido.",
      );
    }
    const fill = path.style.fillOpacity > 0 && paintCanRender(path.style.fill);
    const stroke =
      path.style.strokeOpacity > 0 &&
      path.style.strokeWidth > 0 &&
      paintCanRender(path.style.stroke);
    if (active[index] && (fill || stroke)) {
      unionInto(
        painted,
        local.x0 - (stroke ? dx : 0),
        local.y0 - (stroke ? dy : 0),
      );
      unionInto(
        painted,
        local.x1 + (stroke ? dx : 0),
        local.y1 + (stroke ? dy : 0),
      );
    }
  }
  const box = (acc: ReturnType<typeof accumulator>): ArtBounds => ({
    x: acc.x0,
    y: acc.y0,
    width: acc.x1 - acc.x0,
    height: acc.y1 - acc.y0,
  });
  const centerlineBounds = box(center);
  const unfilteredArtBounds = box(unfiltered);
  // Preserve the existing geometric degeneracy gate, including legitimate
  // stroked lines/points. An invisible but valid design is not engraving-invalid.
  if (!(unfilteredArtBounds.width > 0) || !(unfilteredArtBounds.height > 0)) {
    return failReason("INVALID_D", "El diseño no tiene área medible.");
  }
  const fallbackAxis = (origin: number, size: number) =>
    size > 0
      ? { origin, size }
      : {
          origin: Math.max(
            -ADMIN_GEOMETRY_LIMITS.MAX_COORD,
            Math.min(ADMIN_GEOMETRY_LIMITS.MAX_COORD - 1, origin - 0.5),
          ),
          size: 1,
        };
  const fx = fallbackAxis(centerlineBounds.x, centerlineBounds.width);
  const fy = fallbackAxis(centerlineBounds.y, centerlineBounds.height);
  const artBounds = painted.empty
    ? { x: fx.origin, y: fy.origin, width: fx.size, height: fy.size }
    : box(painted);
  if (
    ![centerlineBounds, unfilteredArtBounds, artBounds].every(
      (bounds) =>
        finiteBox(bounds) &&
        [
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          bounds.x + bounds.width,
          bounds.y + bounds.height,
        ].every((v) => Math.abs(v) <= ADMIN_GEOMETRY_LIMITS.MAX_COORD),
    )
  ) {
    return failReason(
      "COORD_OUT_OF_RANGE",
      "El diseño excede el rango de coordenadas admitido.",
    );
  }
  if (!(artBounds.width > 0) || !(artBounds.height > 0)) {
    return failReason("INVALID_D", "El diseño no tiene área medible.");
  }
  return { ok: true, centerlineBounds, artBounds, unfilteredArtBounds, cost };
}

/** La caja declarada debe coincidir con la derivada (caja falsa = rechazo). */
export function boundsMatchClaim(actual: ArtBounds, claimed: unknown): boolean {
  if (
    typeof claimed !== "object" ||
    claimed === null ||
    Array.isArray(claimed)
  ) {
    return false;
  }
  const box = claimed as Record<string, unknown>;
  const values = [box.x, box.y, box.width, box.height];
  if (
    !values.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return false;
  }
  const close = (a: number, b: number): boolean => {
    const tolerance = 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= tolerance;
  };
  return (
    close(actual.x, box.x as number) &&
    close(actual.y, box.y as number) &&
    close(actual.width, box.width as number) &&
    close(actual.height, box.height as number)
  );
}
