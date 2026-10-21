/** Private admin v2 geometry contract. No DOM, markup, CSS props or resource references.
 * Matrices are already composed in source coordinates. Render the ordered tree
 * with node opacity, but apply matrices ONLY to paths (never again to groups).
 */
import {
  ADMIN_GEOMETRY_LIMITS,
  boundsMatchClaim,
  measureControlledPaths,
} from "./geometry";
import type { ArtBounds } from "./types";
import type { SvgMatrix } from "../svg-import/transforms";

export const TRUSTED_IMPORT_LIMITS = {
  ...ADMIN_GEOMETRY_LIMITS,
  MAX_NODES: 10_000,
  MAX_DEPTH: 64,
  MAX_DASH_VALUES: 256,
} as const;

export interface ControlledStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  linecap: "butt" | "round" | "square";
  linejoin: "miter" | "round" | "bevel";
  miterlimit: number;
  dasharray: number[];
  dashoffset: number;
  fillRule: "nonzero" | "evenodd";
  fillOpacity: number;
  strokeOpacity: number;
}
export interface ControlledPath {
  d: string;
  matrix: SvgMatrix;
  style: ControlledStyle;
}
export type ControlledNode =
  | { kind: "group"; opacity: number; children: number[] }
  | { kind: "path"; opacity: number; path: number };
export interface ImportedGeometry {
  version: 2;
  root: 0;
  paths: ControlledPath[];
  /** Preorder indices: every node and every path referenced exactly once. */
  nodes: ControlledNode[];
  centerlineBounds: ArtBounds;
  /** Potential paint envelope includes affine stroke caps/joins; if all paint
   * is invisible, a positive centerline-based viewBox fallback is used. */
  artBounds: ArtBounds;
}
export type TrustedImportCode =
  | "SECURITY"
  | "UNSUPPORTED"
  | "LIVE_TEXT"
  | "RASTER"
  | "LIMIT"
  | "MALFORMED"
  | "INVALID_GEOMETRY"
  | "INVALID_MODEL";
export type TrustedImportOutcome =
  | { ok: true; geometry: ImportedGeometry }
  | { ok: false; code: TrustedImportCode; reason: string };

export const DEFAULT_CONTROLLED_STYLE: ControlledStyle = {
  fill: "black",
  stroke: "none",
  strokeWidth: 1,
  linecap: "butt",
  linejoin: "miter",
  miterlimit: 4,
  dasharray: [],
  dashoffset: 0,
  fillRule: "nonzero",
  fillOpacity: 1,
  strokeOpacity: 1,
};

// Concrete CSS named colors only; system/current/context colors are deliberately absent.
const COLOR_NAMES = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue
cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgrey darkgreen darkkhaki
 darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
 darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
 firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green
 greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen
 lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgrey lightgreen
 lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue
 lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
 mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
 midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered
 orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
 powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
 seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
 thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent none`.split(
    /\s+/,
  ),
);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Shared lexical gate for import and persisted records; independent of browser CSS parsers. */
export function isSafePaint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  const text = value.trim().toLowerCase();
  if (COLOR_NAMES.has(text)) return true;
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(text))
    return true;
  const fn = /^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/.exec(text);
  if (!fn) return false;
  const comma = fn[2].includes(",");
  if (comma && fn[2].includes("/")) return false;
  const chunks = comma
    ? fn[2].split(",").map((x) => x.trim())
    : fn[2].trim().split(/\s*\/\s*/);
  if (!comma && chunks.length > 2) return false;
  const channels = comma ? chunks.slice(0, 3) : chunks[0].split(/\s+/);
  const alpha = comma ? chunks[3] : chunks[1];
  if (
    channels.length !== 3 ||
    (comma && (chunks.length < 3 || chunks.length > 4))
  )
    return false;
  const numeric = (part: string, percent: boolean): boolean => {
    const raw = percent && part.endsWith("%") ? part.slice(0, -1) : part;
    return (
      NUMBER.test(raw) &&
      Number.isFinite(Number(raw)) &&
      Math.abs(Number(raw)) <= 1_000_000
    );
  };
  if (fn[1].startsWith("hsl")) {
    if (
      !numeric(channels[0].replace(/(?:deg|grad|rad|turn)$/, ""), false) ||
      !channels.slice(1).every((x) => x.endsWith("%") && numeric(x, true))
    )
      return false;
  } else if (
    !channels.every((x) => numeric(x, true)) ||
    (comma &&
      channels.some((x) => x.endsWith("%")) &&
      !channels.every((x) => x.endsWith("%")))
  )
    return false;
  return alpha === undefined || numeric(alpha, true);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function bounded(
  value: unknown,
  min: number = -TRUSTED_IMPORT_LIMITS.MAX_COORD,
  max: number = TRUSTED_IMPORT_LIMITS.MAX_COORD,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
export function isUnitOpacity(value: unknown): value is number {
  return bounded(value, 0, 1);
}

function cleanStyle(value: unknown): ControlledStyle | null {
  if (
    !record(value) ||
    !isSafePaint(value.fill) ||
    !isSafePaint(value.stroke) ||
    !bounded(value.strokeWidth, 0) ||
    !bounded(value.miterlimit, 1) ||
    !bounded(value.dashoffset) ||
    !isUnitOpacity(value.fillOpacity) ||
    !isUnitOpacity(value.strokeOpacity) ||
    typeof value.linecap !== "string" ||
    !["butt", "round", "square"].includes(value.linecap) ||
    typeof value.linejoin !== "string" ||
    !["miter", "round", "bevel"].includes(value.linejoin) ||
    typeof value.fillRule !== "string" ||
    !["nonzero", "evenodd"].includes(value.fillRule) ||
    !Array.isArray(value.dasharray) ||
    value.dasharray.length > TRUSTED_IMPORT_LIMITS.MAX_DASH_VALUES ||
    !value.dasharray.every((x) => bounded(x, 0))
  )
    return null;
  return {
    fill: value.fill.trim().toLowerCase(),
    stroke: value.stroke.trim().toLowerCase(),
    strokeWidth: value.strokeWidth,
    linecap: value.linecap as ControlledStyle["linecap"],
    linejoin: value.linejoin as ControlledStyle["linejoin"],
    miterlimit: value.miterlimit,
    dasharray: value.dasharray.slice(),
    dashoffset: value.dashoffset,
    fillRule: value.fillRule as ControlledStyle["fillRule"],
    fillOpacity: value.fillOpacity,
    strokeOpacity: value.strokeOpacity,
  };
}

/** Validate hostile JSON records and return a fresh, explicitly projected model.
 * Never trust declared bounds, arrays, indices, style objects or extra props.
 * v1 compatibility stays in the existing repository; this validates v2 geometry only.
 */
export function validateImportedGeometry(value: unknown): TrustedImportOutcome {
  const invalid = (): TrustedImportOutcome => ({
    ok: false,
    code: "INVALID_MODEL",
    reason: "La geometría guardada no es válida.",
  });
  if (
    !record(value) ||
    value.version !== 2 ||
    value.root !== 0 ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > TRUSTED_IMPORT_LIMITS.MAX_PATHS ||
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > TRUSTED_IMPORT_LIMITS.MAX_NODES
  )
    return invalid();
  const paths: ControlledPath[] = [];
  let chars = 0;
  for (const path of value.paths) {
    if (
      !record(path) ||
      typeof path.d !== "string" ||
      path.d.length > TRUSTED_IMPORT_LIMITS.MAX_D_CHARS ||
      !record(path.matrix)
    )
      return invalid();
    chars += path.d.length;
    if (chars > TRUSTED_IMPORT_LIMITS.MAX_TOTAL_D_CHARS) return invalid();
    const { a, b, c, d, e, f } = path.matrix;
    if (![a, b, c, d, e, f].every((x) => bounded(x))) return invalid();
    const style = cleanStyle(path.style);
    if (!style) return invalid();
    paths.push({ d: path.d, matrix: { a, b, c, d, e, f } as SvgMatrix, style });
  }
  const nodes: ControlledNode[] = [];
  const rawNodes: unknown[] = value.nodes;
  // DFS must consume strict preorder. This simultaneously forbids cycles,
  // repeated/unused refs, out-of-order nodes and duplicate/out-of-order paths.
  let nextNode = 0;
  let nextPath = 0;
  let refs = 0;
  const visit = (index: number, depth: number): boolean => {
    if (
      depth > TRUSTED_IMPORT_LIMITS.MAX_DEPTH ||
      index !== nextNode ||
      index >= rawNodes.length
    )
      return false;
    const node = rawNodes[index];
    if (!record(node) || !isUnitOpacity(node.opacity)) return false;
    nextNode++;
    if (node.kind === "path") {
      if (node.path !== nextPath || nextPath >= paths.length) return false;
      nextPath++;
      nodes.push({
        kind: "path",
        opacity: node.opacity,
        path: node.path as number,
      });
      return true;
    }
    if (node.kind !== "group" || !Array.isArray(node.children)) return false;
    refs += node.children.length;
    if (refs >= TRUSTED_IMPORT_LIMITS.MAX_NODES) return false;
    const children: number[] = [];
    nodes.push({ kind: "group", opacity: node.opacity, children });
    for (const child of node.children) {
      if (!Number.isInteger(child) || !visit(child, depth + 1)) return false;
      children.push(child);
    }
    return true;
  };
  if (
    value.nodes[0]?.kind !== "group" ||
    !visit(0, 0) ||
    nextNode !== value.nodes.length ||
    nextPath !== paths.length
  )
    return invalid();
  const measured = measureControlledPaths(paths, nodes);
  if (
    !measured.ok ||
    // Prior v2 generators included every centerline/stroke even when invisible.
    // Accept only that EXACT independently derived old envelope (not arbitrary
    // enclosing boxes), and always return the current sanitized painted bounds.
    (!boundsMatchClaim(measured.artBounds, value.artBounds) &&
      !boundsMatchClaim(measured.unfilteredArtBounds, value.artBounds)) ||
    !boundsMatchClaim(measured.centerlineBounds, value.centerlineBounds)
  )
    return invalid();
  return {
    ok: true,
    geometry: {
      version: 2,
      root: 0,
      paths,
      nodes,
      artBounds: measured.artBounds,
      centerlineBounds: measured.centerlineBounds,
    },
  };
}
