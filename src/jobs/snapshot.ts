/**
 * J1 — Immutable self-contained job snapshot (Stage 2, S1/S3/S6).
 *
 * A confirmed job carries a COMPLETE detached copy of the customer
 * composition: texts (with font families), icons (with their EMBEDDED
 * builtin definitions, never a bare iconId into the live catalog),
 * uploaded graphics (self-contained path geometry) and approved designs
 * (full v1/v2/v3 snapshots, never a catalog lookup on load), plus the
 * circular-lines mode and every pose/render field. View/selection state
 * is excluded, and no customer record is invented: optional customer
 * metadata travels only when explicitly provided, never required.
 *
 * Read-only reuse: v1/v2/v3 catalog records revalidate through the
 * existing `validateStoredDesign` (which itself re-sanitizes v3 assets),
 * and raw path data validates through the pure budgeted `tokenizePathData`.
 * This module never writes the catalog and never depends on it at read
 * time: `normalizeJobCompositionForPreview` renders from embedded data
 * only, so a deleted/disabled catalog entry cannot break a saved job.
 *
 * Fonts stay environment-dependent names (documented for the next stage
 * via `fontNote`); nothing is outlined or rasterized here.
 *
 * All validators are total on hostile input: bounded size/depth/count
 * work runs BEFORE any expensive walk or stringify, cycles, prototype
 * hazards, non-finite numbers and unknown versions are rejected, and an
 * invalid record is returned — never thrown, never hiding its neighbors.
 */
import { validateStoredDesign } from "../admin-lab/repository";
import { tokenizePathData } from "../admin-lab/geometry";
import type { ApprovedDesignInstance } from "../approved-designs/approvedDesign";
import type { DesignIcon } from "../components/IconElement";
import type { TextElement } from "../components/CurvedText";
import type { UploadedGraphicElement } from "../components/UploadedGraphic";

/** Snapshot envelope version. Unknown versions are isolated, never migrated. */
export const JOB_SNAPSHOT_VERSION = 1 as const;

export const JOB_SNAPSHOT_LIMITS = {
  MAX_TEXTS: 100,
  MAX_ICONS: 100,
  MAX_GRAPHICS: 30,
  MAX_APPROVED: 30,
  MAX_TEXT_CHARS: 1000,
  MAX_FONT_CHARS: 200,
  MAX_ID_CHARS: 200,
  MAX_NAME_CHARS: 200,
  MAX_ICON_PATHS: 64,
  MAX_PATHS_PER_GRAPHIC: 2000,
  MAX_D_CHARS: 1_000_000,
  MAX_TOTAL_D_CHARS: 2_000_000,
  MAX_WALK_NODES: 20_000,
  MAX_WALK_CHARS: 8_000_000,
  MAX_DEPTH: 64,
  /** Canonical payload ceiling: comparison stays bounded, never stringifies unbounded input. */
  MAX_RECORD_CHARS: 8_000_000,
} as const;

export type JobCircularLines = "none" | "single" | "double";

/** Builtin icon definition EMBEDDED in the job (frame + source paint semantics). */
export interface EmbeddedIconDefinition {
  id: string;
  name: string;
  category: string;
  paths: string[];
  /** Source 32x32 frame shared by every builtin icon. */
  frame: { width: 32; height: 32 };
  /** Source render semantics from IconElement (fill/stroke + inner transform). */
  paint: {
    fill: "none";
    stroke: "#171717";
    strokeWidth: 1.7;
    linecap: "round";
    linejoin: "round";
    innerTransform: "scale(1.4) translate(-16 -16)";
  };
}

export interface JobTextSnapshot {
  id: string;
  text: string;
  fontFamily: string;
  angle: number;
  radius: number;
  inverted: boolean;
  scale?: number;
}

export interface JobIconSnapshot {
  id: string;
  iconId: string;
  definition: EmbeddedIconDefinition;
  angle: number;
  radius: number;
  scale: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
}

export interface JobGraphicPathSnapshot {
  d: string;
  transform?: string;
}

export interface JobGraphicSnapshot {
  id: string;
  paths: JobGraphicPathSnapshot[];
  sourceWidth: number;
  sourceHeight: number;
  artBounds: { x: number; y: number; width: number; height: number };
  angle: number;
  radius: number;
  scale: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
}

export interface JobApprovedSnapshot {
  id: string;
  approvedDesignId: string;
  snapshot: ApprovedDesignInstance["snapshot"];
  angle: number;
  radius: number;
  scale: number;
  rotation: number;
  mirrored: boolean;
  inverted: boolean;
}

export interface JobCustomer {
  name?: string;
  note?: string;
}

export interface JobCompositionSnapshot {
  texts: JobTextSnapshot[];
  icons: JobIconSnapshot[];
  graphics: JobGraphicSnapshot[];
  approved: JobApprovedSnapshot[];
  circularLines: JobCircularLines;
  customer?: JobCustomer;
}

export interface IconResolution {
  id: string;
  name: string;
  category: string;
  paths: string[];
}

export interface CompositionInput {
  texts: TextElement[];
  icons: DesignIcon[];
  graphics: UploadedGraphicElement[];
  approved: ApprovedDesignInstance[];
  circularLines: JobCircularLines;
  resolveIcon: (iconId: string) => IconResolution | null | undefined;
  customer?: JobCustomer;
}

export type CaptureResult =
  | { ok: true; composition: JobCompositionSnapshot }
  | { ok: false; reason: string };

export type ValidateResult =
  | { ok: true; composition: JobCompositionSnapshot }
  | { ok: false; reason: string };

export type CanonicalResult =
  { ok: true; canonical: string } | { ok: false; reason: string };

const CIRCULAR_MODES: readonly string[] = ["none", "single", "double"];
const KNOWN_TOP_KEYS = new Set([
  "texts",
  "icons",
  "graphics",
  "approved",
  "circularLines",
  "customer",
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > JOB_SNAPSHOT_LIMITS.MAX_ID_CHARS)
    return null;
  return trimmed;
}

/**
 * Bounded hostile-input walk BEFORE any expensive validation or
 * stringify: counts nodes/chars/depth, rejects cycles (or shared
 * references — snapshots are trees), prototype hazards and over-budget
 * payloads. Total: never throws on hostile input.
 */
function walkBounds(
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  const seen = new Set<object>();
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 0 },
  ];
  let nodes = 0;
  let chars = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    if (depth > JOB_SNAPSHOT_LIMITS.MAX_DEPTH)
      return invalid("El trabajo excede la profundidad admitida.");
    nodes += 1;
    if (nodes > JOB_SNAPSHOT_LIMITS.MAX_WALK_NODES)
      return invalid("El trabajo excede la cantidad de datos admitida.");
    if (typeof node === "string") {
      chars += node.length;
      if (chars > JOB_SNAPSHOT_LIMITS.MAX_WALK_CHARS)
        return invalid("El trabajo excede el tamaño admitido.");
      continue;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) return invalid("El trabajo contiene datos cíclicos.");
      seen.add(node);
      for (let index = node.length - 1; index >= 0; index -= 1)
        stack.push({ node: node[index], depth: depth + 1 });
      continue;
    }
    if (isObject(node)) {
      if (seen.has(node)) return invalid("El trabajo contiene datos cíclicos.");
      seen.add(node);
      for (const key of Object.keys(node)) {
        if (FORBIDDEN_KEYS.has(key))
          return invalid("El trabajo contiene claves no admitidas.");
        stack.push({
          node: (node as Record<string, unknown>)[key],
          depth: depth + 1,
        });
      }
    }
  }
  return { ok: true };
}

/** Coordinate envelope for embedded artwork (mirrors ADMIN MAX_COORD). */
const MAX_SNAPSHOT_COORD = 1_000_000;

/** Strict budgeted path check: valid syntax AND every coordinate in range. */
function checkEmbeddedPath(d: string): boolean {
  const tokenized = tokenizePathData(d);
  if (!tokenized.ok) return false;
  for (const command of tokenized.path.commands) {
    for (const n of command.numbers) {
      if (!Number.isFinite(n) || Math.abs(n) > MAX_SNAPSHOT_COORD) return false;
    }
  }
  return true;
}

function checkPose(value: Record<string, unknown>, id: string): string | null {
  for (const key of ["angle", "radius", "scale", "rotation"] as const) {
    if (key in value && !finiteNumber(value[key]))
      return `Elemento "${id}": ${key} no es un número válido.`;
  }
  for (const key of ["mirrored", "inverted"] as const) {
    if (key in value && typeof value[key] !== "boolean")
      return `Elemento "${id}": ${key} no es válido.`;
  }
  return null;
}

function projectText(value: unknown): JobTextSnapshot | string {
  if (!isObject(value)) return "Texto ilegible: no es un objeto.";
  const id = cleanId(value.id);
  if (!id) return "Texto sin identificador válido.";
  if (
    typeof value.text !== "string" ||
    value.text.length > JOB_SNAPSHOT_LIMITS.MAX_TEXT_CHARS
  )
    return `Texto "${id}": contenido inválido.`;
  if (
    typeof value.fontFamily !== "string" ||
    value.fontFamily.trim() === "" ||
    value.fontFamily.length > JOB_SNAPSHOT_LIMITS.MAX_FONT_CHARS
  )
    return `Texto "${id}": tipografía inválida.`;
  if (!finiteNumber(value.angle) || !finiteNumber(value.radius))
    return `Texto "${id}": posición inválida.`;
  if (typeof value.inverted !== "boolean")
    return `Texto "${id}": orientación inválida.`;
  if (value.scale !== undefined && !finiteNumber(value.scale))
    return `Texto "${id}": tamaño inválido.`;
  const projected: JobTextSnapshot = {
    id,
    text: value.text,
    fontFamily: value.fontFamily,
    angle: value.angle,
    radius: value.radius,
    inverted: value.inverted,
  };
  if (value.scale !== undefined) projected.scale = value.scale;
  return projected;
}

function projectIcon(
  value: unknown,
  resolveIcon?: (iconId: string) => IconResolution | null | undefined,
): JobIconSnapshot | string {
  if (!isObject(value)) return "Ícono ilegible: no es un objeto.";
  const id = cleanId(value.id);
  if (!id) return "Ícono sin identificador válido.";
  if (typeof value.iconId !== "string" || value.iconId.trim() === "")
    return `Ícono "${id}": referencia de biblioteca inválida.`;
  const iconId = value.iconId.trim();
  // Embedded definition is MANDATORY: a bare iconId into the live catalog
  // is never enough to rebuild the job.
  const raw = value.definition;
  let definition: EmbeddedIconDefinition | null = null;
  // A stored definition must be COMPLETE (name/category/paths): partial
  // embeddings are rejected, never silently accepted.
  if (
    isObject(raw) &&
    typeof raw.name === "string" &&
    raw.name.trim() !== "" &&
    typeof raw.category === "string" &&
    raw.category.trim() !== "" &&
    Array.isArray(raw.paths)
  ) {
    definition = {
      id: typeof raw.id === "string" && raw.id.trim() !== "" ? raw.id : iconId,
      name: raw.name,
      category: raw.category,
      paths: raw.paths as string[],
      frame: { width: 32, height: 32 },
      paint: {
        fill: "none",
        stroke: "#171717",
        strokeWidth: 1.7,
        linecap: "round",
        linejoin: "round",
        innerTransform: "scale(1.4) translate(-16 -16)",
      },
    };
  } else if (resolveIcon) {
    const resolved = resolveIcon(iconId);
    if (!resolved)
      return `Ícono "${id}": "${iconId}" no existe en la biblioteca.`;
    definition = {
      id: resolved.id,
      name: resolved.name,
      category: resolved.category,
      paths: [...resolved.paths],
      frame: { width: 32, height: 32 },
      paint: {
        fill: "none",
        stroke: "#171717",
        strokeWidth: 1.7,
        linecap: "round",
        linejoin: "round",
        innerTransform: "scale(1.4) translate(-16 -16)",
      },
    };
  } else {
    return `Ícono "${id}": falta la definición incorporada y no hay catálogo para resolverla.`;
  }
  if (
    definition.name.trim() === "" ||
    definition.paths.length === 0 ||
    definition.paths.length > JOB_SNAPSHOT_LIMITS.MAX_ICON_PATHS
  )
    return `Ícono "${id}": definición incorporada inválida.`;
  let dChars = 0;
  for (const d of definition.paths) {
    if (
      typeof d !== "string" ||
      d.length === 0 ||
      d.length > JOB_SNAPSHOT_LIMITS.MAX_D_CHARS
    )
      return `Ícono "${id}": trazado incorporado inválido.`;
    dChars += d.length;
    if (dChars > JOB_SNAPSHOT_LIMITS.MAX_TOTAL_D_CHARS)
      return `Ícono "${id}": excede el volumen de geometría admitido.`;
    if (!checkEmbeddedPath(d))
      return `Ícono "${id}": un trazado incorporado tiene sintaxis inválida.`;
  }
  const poseError = checkPose(value, id);
  if (poseError) return poseError;
  if (
    !finiteNumber(value.angle) ||
    !finiteNumber(value.radius) ||
    !finiteNumber(value.scale)
  )
    return `Ícono "${id}": posición inválida.`;
  if (!finiteNumber(value.rotation)) return `Ícono "${id}": rotación inválida.`;
  return {
    id,
    iconId,
    definition: {
      ...definition,
      name: definition.name,
      category: definition.category,
      paths: [...definition.paths],
    },
    angle: value.angle as number,
    radius: value.radius as number,
    scale: value.scale as number,
    rotation: value.rotation as number,
    mirrored: value.mirrored === true,
    inverted: value.inverted === true,
  };
}

function checkBoundsBox(
  value: unknown,
): value is { x: number; y: number; width: number; height: number } {
  if (!isObject(value)) return false;
  return (
    finiteNumber(value.x) &&
    finiteNumber(value.y) &&
    finiteNumber(value.width) &&
    finiteNumber(value.height) &&
    (value.width as number) >= 0 &&
    (value.height as number) >= 0
  );
}

function projectGraphic(value: unknown): JobGraphicSnapshot | string {
  if (!isObject(value)) return "Imagen ilegible: no es un objeto.";
  const id = cleanId(value.id);
  if (!id) return "Imagen sin identificador válido.";
  if (
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > JOB_SNAPSHOT_LIMITS.MAX_PATHS_PER_GRAPHIC
  )
    return `Imagen "${id}": cantidad de trazados inválida.`;
  const paths: JobGraphicPathSnapshot[] = [];
  let chars = 0;
  for (const entry of value.paths) {
    if (!isObject(entry) || typeof entry.d !== "string")
      return `Imagen "${id}": trazado ilegible.`;
    if (
      entry.d.length === 0 ||
      entry.d.length > JOB_SNAPSHOT_LIMITS.MAX_D_CHARS
    )
      return `Imagen "${id}": trazado inválido.`;
    chars += entry.d.length;
    if (chars > JOB_SNAPSHOT_LIMITS.MAX_TOTAL_D_CHARS)
      return `Imagen "${id}": excede el volumen de geometría admitido.`;
    if (!checkEmbeddedPath(entry.d))
      return `Imagen "${id}": un trazado tiene sintaxis inválida.`;
    if (entry.transform !== undefined && typeof entry.transform !== "string")
      return `Imagen "${id}": transformación inválida.`;
    paths.push(
      entry.transform !== undefined
        ? { d: entry.d, transform: entry.transform }
        : { d: entry.d },
    );
  }
  if (!finiteNumber(value.sourceWidth) || (value.sourceWidth as number) <= 0)
    return `Imagen "${id}": ancho de origen inválido.`;
  if (!finiteNumber(value.sourceHeight) || (value.sourceHeight as number) <= 0)
    return `Imagen "${id}": alto de origen inválido.`;
  if (!checkBoundsBox(value.artBounds))
    return `Imagen "${id}": caja de arte inválida.`;
  const poseError = checkPose(value, id);
  if (poseError) return poseError;
  if (
    !finiteNumber(value.angle) ||
    !finiteNumber(value.radius) ||
    !finiteNumber(value.scale)
  )
    return `Imagen "${id}": posición inválida.`;
  if (!finiteNumber(value.rotation))
    return `Imagen "${id}": rotación inválida.`;
  const box = value.artBounds as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  return {
    id,
    paths,
    sourceWidth: value.sourceWidth as number,
    sourceHeight: value.sourceHeight as number,
    artBounds: { x: box.x, y: box.y, width: box.width, height: box.height },
    angle: value.angle as number,
    radius: value.radius as number,
    scale: value.scale as number,
    rotation: value.rotation as number,
    mirrored: value.mirrored === true,
    inverted: value.inverted === true,
  };
}

/**
 * Detached frozen copy of an approved snapshot. v3 assets are multi-KB
 * strings and strings are already immutable, so the copy holds the SAME
 * svg reference (never a byte rewrite); only the mutable v1/v2 trees are
 * copied element-wise. Mirrors the catalog copy policy without depending
 * on the catalog at read time.
 */
function detachApprovedSnapshot(
  snapshot: ApprovedDesignInstance["snapshot"],
): ApprovedDesignInstance["snapshot"] {
  const design = snapshot as unknown as Record<string, unknown>;
  if (design.version === 3) {
    const viewBox = isObject(design.viewBox)
      ? { ...(design.viewBox as object) }
      : design.viewBox;
    return Object.freeze({
      ...(design as object),
      viewBox,
    }) as ApprovedDesignInstance["snapshot"];
  }
  const geometry = design.geometry as {
    paths: Array<{ matrix: object; style: { dasharray: unknown[] } }>;
    nodes: Array<{ kind: string; children?: unknown[] }>;
    centerlineBounds: object;
    artBounds: object;
  };
  const geometryCopy = {
    ...(geometry as object),
    paths: geometry.paths.map((path) => ({
      ...path,
      matrix: { ...path.matrix },
      style: { ...path.style, dasharray: [...path.style.dasharray] },
    })),
    nodes: geometry.nodes.map((node) =>
      node.kind === "group"
        ? { ...node, children: [...(node.children ?? [])] }
        : { ...node },
    ),
    centerlineBounds: { ...geometry.centerlineBounds },
    artBounds: { ...geometry.artBounds },
  };
  if (design.version === 2) {
    return Object.freeze({
      ...(design as object),
      geometry: geometryCopy,
    }) as ApprovedDesignInstance["snapshot"];
  }
  const legacy = design as {
    paths: Array<{ d: string; transform?: string }>;
    artBounds: object;
  };
  return Object.freeze({
    ...(design as object),
    paths: legacy.paths.map((path) => ({ ...path })),
    artBounds: { ...legacy.artBounds },
    geometry: geometryCopy,
  }) as ApprovedDesignInstance["snapshot"];
}

function projectApproved(value: unknown): JobApprovedSnapshot | string {
  if (!isObject(value)) return "Diseño ilegible: no es un objeto.";
  const id = cleanId(value.id);
  if (!id) return "Diseño sin identificador válido.";
  if (
    typeof value.approvedDesignId !== "string" ||
    value.approvedDesignId.trim() === ""
  )
    return `Diseño "${id}": referencia inválida.`;
  if (!isObject(value.snapshot)) return `Diseño "${id}": copia inválida.`;
  // The stored asset is already approved: it goes through the SAME
  // repository validator (re-parse + re-sanitize for v3, controlled
  // geometry for v1/v2). No new sanitizer exceptions exist here.
  let checked: ReturnType<typeof validateStoredDesign>;
  try {
    checked = validateStoredDesign(value.snapshot);
  } catch {
    return `Diseño "${id}": su copia no se pudo revisar.`;
  }
  if (!checked.ok) return `Diseño "${id}": su copia no es válida.`;
  const poseError = checkPose(value, id);
  if (poseError) return poseError;
  if (
    !finiteNumber(value.angle) ||
    !finiteNumber(value.radius) ||
    !finiteNumber(value.scale)
  )
    return `Diseño "${id}": posición inválida.`;
  if (!finiteNumber(value.rotation))
    return `Diseño "${id}": rotación inválida.`;
  return {
    id,
    approvedDesignId: (value.approvedDesignId as string).trim(),
    snapshot: detachApprovedSnapshot(
      checked.design as unknown as ApprovedDesignInstance["snapshot"],
    ),
    angle: value.angle as number,
    radius: value.radius as number,
    scale: value.scale as number,
    rotation: value.rotation as number,
    mirrored: value.mirrored === true,
    inverted: value.inverted === true,
  };
}

function projectCustomer(value: unknown): JobCustomer | string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return "Datos del cliente inválidos.";
  const out: JobCustomer = {};
  if (value.name !== undefined) {
    if (
      typeof value.name !== "string" ||
      value.name.length > JOB_SNAPSHOT_LIMITS.MAX_NAME_CHARS
    )
      return "Datos del cliente inválidos.";
    if (value.name.trim() !== "") out.name = value.name.trim();
  }
  if (value.note !== undefined) {
    if (
      typeof value.note !== "string" ||
      value.note.length > JOB_SNAPSHOT_LIMITS.MAX_NAME_CHARS
    )
      return "Datos del cliente inválidos.";
    if (value.note.trim() !== "") out.note = value.note.trim();
  }
  return out;
}

function projectCompositionBody(
  body: Record<string, unknown>,
  resolveIcon?: (iconId: string) => IconResolution | null | undefined,
): JobCompositionSnapshot | string {
  for (const key of Object.keys(body)) {
    if (!KNOWN_TOP_KEYS.has(key)) return `Campo no admitido: "${key}".`;
  }
  const { texts, icons, graphics, approved, circularLines } = body;
  if (
    !Array.isArray(texts) ||
    texts.length > JOB_SNAPSHOT_LIMITS.MAX_TEXTS ||
    !Array.isArray(icons) ||
    icons.length > JOB_SNAPSHOT_LIMITS.MAX_ICONS ||
    !Array.isArray(graphics) ||
    graphics.length > JOB_SNAPSHOT_LIMITS.MAX_GRAPHICS ||
    !Array.isArray(approved) ||
    approved.length > JOB_SNAPSHOT_LIMITS.MAX_APPROVED
  )
    return "El trabajo excede la cantidad de elementos admitida.";
  if (
    typeof circularLines !== "string" ||
    !CIRCULAR_MODES.includes(circularLines)
  )
    return "Modo de líneas inválido.";
  const outTexts: JobTextSnapshot[] = [];
  for (const entry of texts) {
    const projected = projectText(entry);
    if (typeof projected === "string") return projected;
    outTexts.push(projected);
  }
  const outIcons: JobIconSnapshot[] = [];
  for (const entry of icons) {
    const projected = projectIcon(entry, resolveIcon);
    if (typeof projected === "string") return projected;
    outIcons.push(projected);
  }
  const outGraphics: JobGraphicSnapshot[] = [];
  for (const entry of graphics) {
    const projected = projectGraphic(entry);
    if (typeof projected === "string") return projected;
    outGraphics.push(projected);
  }
  const outApproved: JobApprovedSnapshot[] = [];
  for (const entry of approved) {
    const projected = projectApproved(entry);
    if (typeof projected === "string") return projected;
    outApproved.push(projected);
  }
  const customer = projectCustomer(body.customer);
  if (typeof customer === "string") return customer;
  const composition: JobCompositionSnapshot = {
    texts: outTexts,
    icons: outIcons,
    graphics: outGraphics,
    approved: outApproved,
    circularLines: circularLines as JobCircularLines,
  };
  // No invented customer records: the key exists only with explicit data.
  if (customer && (customer.name !== undefined || customer.note !== undefined))
    composition.customer = customer;
  return composition;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
    return Object.freeze(value);
  }
  if (isObject(value)) {
    // Approved snapshots are already frozen detached copies; freezing
    // again is a no-op, but never recurse into the v3 svg string char by
    // char (strings are primitives — nothing to do).
    for (const key of Object.keys(value))
      deepFreeze((value as Record<string, unknown>)[key]);
    return Object.freeze(value);
  }
  return value;
}

/**
 * Capture the CURRENT composition into a detached immutable snapshot.
 * Synchronous and side-effect free: the ONLY place that reads the live
 * catalog (via `resolveIcon`) to embed definitions. Everything downstream
 * works from the embedded copy.
 */
export function captureComposition(input: CompositionInput): CaptureResult {
  try {
    const bounds = walkBounds(input);
    if (!bounds.ok) return bounds;
    if (!isObject(input as unknown)) return invalid("Composición inválida.");
    const { resolveIcon, ...rest } = input as CompositionInput &
      Record<string, unknown>;
    const body: Record<string, unknown> = {
      texts: rest.texts,
      icons: rest.icons,
      graphics: rest.graphics,
      approved: rest.approved,
      circularLines: rest.circularLines,
    };
    if (rest.customer !== undefined) body.customer = rest.customer;
    const projected = projectCompositionBody(body, resolveIcon);
    if (typeof projected === "string") return invalid(projected);
    return { ok: true, composition: deepFreeze(projected) };
  } catch {
    return invalid("La composición no se pudo revisar.");
  }
}

/**
 * Validate an untrusted stored composition (or a `{version, composition}`
 * envelope). Total function: invalid records are returned, never thrown,
 * and one bad record never hides its neighbors (callers isolate per job).
 */
export function validateComposition(value: unknown): ValidateResult {
  try {
    const bounds = walkBounds(value);
    if (!bounds.ok) return bounds;
    if (!isObject(value)) return invalid("Registro ilegible: no es un objeto.");
    let body: unknown = value;
    if (Object.prototype.hasOwnProperty.call(value, "version")) {
      if (value.version !== JOB_SNAPSHOT_VERSION)
        return invalid(
          `Versión de trabajo desconocida (${String(value.version)}).`,
        );
      body = value.composition;
      if (!isObject(body))
        return invalid("Registro ilegible: sin composición.");
    }
    if (!isObject(body)) return invalid("Registro ilegible: no es un objeto.");
    // No live catalog on read: stored icons MUST carry their embedded
    // definition; `resolveIcon` is never consulted here.
    const projected = projectCompositionBody(body);
    if (typeof projected === "string") return invalid(projected);
    return { ok: true, composition: deepFreeze(projected) };
  } catch {
    return invalid("El registro no se pudo revisar.");
  }
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("cyclic");
    seen.add(value);
    const out = `[${value.map((entry) => canonicalize(entry, seen)).join(",")}]`;
    seen.delete(value);
    return out;
  }
  if (isObject(value)) {
    if (seen.has(value)) throw new Error("cyclic");
    seen.add(value);
    const out = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], seen)}`)
      .join(",")}}`;
    seen.delete(value);
    return out;
  }
  throw new Error("unserializable");
}

/**
 * Collision-resistant payload identity WITHOUT weak global fingerprints:
 * the bounded exact canonical form. Different attempt keys may hold
 * identical compositions (no content dedup); the same key with a different
 * canonical payload is an explicit conflict.
 */
export function canonicalCompositionPayload(
  composition: JobCompositionSnapshot,
  customer?: JobCustomer,
): CanonicalResult {
  try {
    const bounds = walkBounds(composition);
    if (!bounds.ok) return bounds;
    const canonical = canonicalize(
      customer === undefined ? composition : { composition, customer },
      new Set(),
    );
    if (canonical.length > JOB_SNAPSHOT_LIMITS.MAX_RECORD_CHARS)
      return invalid("El trabajo excede el tamaño admitido.");
    return { ok: true, canonical };
  } catch {
    return invalid("El trabajo no se pudo comparar.");
  }
}

export interface JobPreview {
  texts: JobTextSnapshot[];
  icons: Array<JobIconSnapshot & { title: string }>;
  graphics: JobGraphicSnapshot[];
  approved: JobApprovedSnapshot[];
  circularLines: JobCircularLines;
  /** Fonts are environment-dependent names, never outlined/rasterized. */
  fontNote: string;
}

/**
 * Normalized adapter for future preview/lab consumers. Reads ONLY the
 * embedded snapshot — never the live catalog or `iconById`.
 */
export function normalizeJobCompositionForPreview(
  composition: JobCompositionSnapshot,
): JobPreview {
  return {
    texts: composition.texts.map((entry) => ({ ...entry })),
    icons: composition.icons.map((entry) => ({
      ...entry,
      definition: {
        ...entry.definition,
        paths: [...entry.definition.paths],
        frame: { ...entry.definition.frame },
        paint: { ...entry.definition.paint },
      },
      title: entry.definition.name,
    })),
    graphics: composition.graphics.map((entry) => ({
      ...entry,
      paths: entry.paths.map((path) => ({ ...path })),
      artBounds: { ...entry.artBounds },
    })),
    approved: composition.approved.map((entry) => ({ ...entry })),
    circularLines: composition.circularLines,
    fontNote:
      "Las tipografías dependen del entorno donde se abra el trabajo: se conservan como nombres de familia y no se convierten a trazados.",
  };
}
