/**
 * Repositorio local reemplazable de diseños aprobados (/admin-lab).
 *
 * Costura de persistencia: la interfaz a reemplazar es
 * `AdminDesignRepository` COMPLETA (fábrica `createAdminDesignStore`):
 * un futuro backend implementa esos métodos async (CRUD/listado/
 * suscripción), NO basta con intercambiar el `StorageBackend` get/set, que
 * es solo la costura de inyección del almacenamiento local para tests.
 *
 * Reglas de seguridad y confiabilidad:
 *
 * - v2 se proyecta con validateImportedGeometry antes de renderizar o
 *   guardar: pintura, árbol, matrices y bounds recomputados. v1 conserva
 *   su gramática histórica y se normaliza a geometría controlada solo en
 *   memoria. El sobre/clave v1 acepta registros mixtos sin migración forzada.
 *   Lo corrupto se aísla y se informa; nunca se borra automáticamente.
 * - v3 guarda el documento SVG sanitizado canónico y NUNCA lo confía como
 *   está: cada lectura revalida con sanitizeStoredSvgAsset (re-parse +
 *   re-sanitize hasta punto fijo + derivados consistentes, SIN exigir
 *   igualdad de bytes: la seguridad viene de la re-sanitización y lo que
 *   se devuelve rinde es el asset canónico re-sanitizado). La clave
 *   `svg` solo se admite en registros v3 y solo por esa vía; v1/v2 siguen
 *   rechazando toda clave cruda. Lo inválido se aísla como cualquier otro
 *   registro corrupto, sin reescribir ni borrar.
 * - Sobre corrupto o de versión desconocida = SOLO LECTURA: las mutaciones
 *   se bloquean con motivo accionable y el blob original se conserva
 *   intacto. No hay reseteo ni borrado automático; tampoco UI de reseteo:
 *   la recuperación es humana y explícita (limitación documentada en
 *   README). Los registros válidos de un sobre mixto se siguen mostrando.
 * - La lectura acota antes de validar (largo crudo, cantidad de registros,
 *   trabajo acumulado): un sobre gigante no cuelga la pestaña.
 * - Cada mutación relee el estado fresco antes de escribir (pestañas
 *   concurrentes: la última escritura parte de lo último guardado, sin
 *   caché rancia en memoria; garantía de última-escritura, NO atómica) y
 *   `subscribe` notifica en la misma pestaña al persistir + entre pestañas
 *   vía evento `storage` (sin duplicados: el evento no dispara en origen).
 * - Fallos de cuota o almacenamiento no disponible son visibles y nunca se
 *   afirma un guardado falso.
 * - Topes: cantidad de registros y caracteres totales de almacenamiento.
 */

import {
  ADMIN_GEOMETRY_LIMITS,
  boundsMatchClaim,
  checkDesignGeometry,
  tokenizePathData,
} from "./geometry";
import { parseTransformList } from "../svg-import/transforms";
import {
  DEFAULT_CONTROLLED_STYLE,
  TRUSTED_IMPORT_LIMITS,
  validateImportedGeometry,
  type ImportedGeometry,
} from "./importedGeometry";
import { sanitizeStoredSvgAsset, type SvgAsset } from "./svgAssetImport";
import type {
  ApprovedDesign,
  AssetApprovedDesign,
  LegacyApprovedDesign,
  RenderableDesign,
} from "./types";

export const ADMIN_LAB_STORAGE_KEY = "mateco.admin-lab.designs.v1";

export const DESIGN_MODEL_VERSION = 3 as const;
/** Nombre único para la versión asset: los registros v3 comparten la
 * versión del modelo vigente (misma constante, sin literales sueltos). */
export const MODEL_VERSION_ASSET = DESIGN_MODEL_VERSION;
// Envelope/key stay v1: mixed record versions are explicitly supported.
const ENVELOPE_VERSION = 1 as const;

export const ADMIN_LAB_LIMITS = {
  MAX_RECORDS: 200,
  MAX_STORAGE_CHARS: 4_000_000,
  MAX_NAME_CHARS: 120,
  MAX_CATEGORY_CHARS: 60,
  MAX_ID_CHARS: 200,
  MAX_DATE_CHARS: 64,
  MAX_MODEL_UNITS_SCAN: 100_000,
} as const;

/** Margen de lectura sobre el tope de escritura: más allá, ni se parsea. */
const MAX_RAW_READ_CHARS = ADMIN_LAB_LIMITS.MAX_STORAGE_CHARS + 1_000_000;

export interface SkippedRecord {
  id?: string;
  reason: string;
}

export interface EnvelopeParse {
  designs: RenderableDesign[];
  skipped: SkippedRecord[];
  corrupted: boolean;
  /** Daño genuino (registro ilegible, validación v3 fallida, payload
   * inseguro): bloquea TODA escritura y el blob se conserva intacto.
   * Los saltos de presupuesto/duplicado (overflow de MAX_RECORDS,
   * truncamiento de escaneo, ids duplicados) dejan `corrupted` en true
   * pero `damaged` en false: el borrado sigue permitido para volver
   * bajo presupuesto (el borrado reescribe sin los omitidos, acción
   * explícita del dueño), mientras altas/ediciones siguen bloqueadas
   * hasta el estado limpio. */
  damaged: boolean;
  unknownVersion: boolean;
}

export interface LoadResult extends EnvelopeParse {
  unavailable: boolean;
}

export interface StoreError {
  code:
    | "STORAGE_UNAVAILABLE"
    | "STORAGE_QUOTA"
    | "STORAGE_FULL"
    | "LIMIT_RECORDS"
    | "NOT_FOUND"
    | "INVALID_DATA";
  message: string;
}

export type SaveResult =
  | { ok: true; design: ApprovedDesign; skipped: SkippedRecord[] }
  | { ok: false; error: StoreError };

export type WriteResult =
  | { ok: true; design?: ApprovedDesign; skipped: SkippedRecord[] }
  | { ok: false; error: StoreError };

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Contrato de persistencia a reemplazar por un futuro backend: todos los
 * métodos son asíncronos aunque hoy vivan en localStorage. Para cambiar de
 * backend se implementa ESTA interfaz (no el `StorageBackend` interno).
 */
export interface AdminDesignRepository {
  load(): Promise<LoadResult>;
  saveNew(input: NewDesignInput): Promise<SaveResult>;
  updateDesign(
    id: string,
    patch: { name?: string; category?: string; enabled?: boolean },
  ): Promise<WriteResult>;
  /** Invierte el estado guardado leyendo el valor fresco (no el render). */
  toggleDesign(id: string): Promise<WriteResult>;
  removeDesign(id: string): Promise<WriteResult>;
  subscribe(listener: () => void): () => void;
}

const FORBIDDEN_RAW_KEYS = new Set([
  "svg",
  "markup",
  "rawSvg",
  "raw",
  "xml",
  "html",
  "href",
  "src",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lectura de campos propios solamente (F5): un prototipo o una clave
 * heredada nunca satisface versión, asset ni claves crudas. */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Versión propia del registro, si la declara como campo propio. */
function ownVersion(value: Record<string, unknown>): unknown {
  return hasOwn(value, "version") ? value.version : undefined;
}

/** Cheap shape/length gates and bounded tokenization before analytic measurement.
 * Scan accounts for invalid records too. One failing tokenization is charged by
 * text length (worst-case command weight), so repeated malformed art is bounded.
 */
function inspectRecordWork(
  value: unknown,
  work = { chars: 0, cost: 0, units: 0, exceeded: false },
): typeof work {
  if (!isRecord(value)) return work;
  const version = ownVersion(value);
  // v3 no proyecta geometría, pero su documento sí cuesta trabajo
  // acotado (A4): se cobra por largo para que una biblioteca con muchos
  // assets vea el tope agregado igual que la geometría v1/v2.
  if (version === MODEL_VERSION_ASSET) {
    const svg =
      hasOwn(value, "svg") && typeof value.svg === "string" ? value.svg : null;
    if (svg !== null) {
      work.chars += svg.length;
      if (work.chars > ADMIN_GEOMETRY_LIMITS.MAX_TOTAL_D_CHARS) {
        work.exceeded = true;
        return work;
      }
      work.cost += Math.ceil(svg.length / 4);
      if (work.cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
        work.exceeded = true;
        return work;
      }
    }
    return work;
  }
  const model = version === 2 ? value.geometry : value;
  if (!isRecord(model)) return work;
  const paths = model.paths;
  const nodes = version === 2 ? model.nodes : undefined;
  if (Array.isArray(nodes)) {
    work.units += nodes.length;
    if (work.units > ADMIN_LAB_LIMITS.MAX_MODEL_UNITS_SCAN) {
      work.exceeded = true;
      return work;
    }
    // Per-record violations stay isolated; only an aggregate budget stops the scan.
    if (nodes.length > TRUSTED_IMPORT_LIMITS.MAX_NODES) return work;
    for (const node of nodes) {
      if (isRecord(node) && Array.isArray(node.children))
        work.units += node.children.length;
      if (work.units > ADMIN_LAB_LIMITS.MAX_MODEL_UNITS_SCAN) {
        work.exceeded = true;
        return work;
      }
    }
  }
  if (!Array.isArray(paths)) return work;
  work.units += paths.length;
  if (work.units > ADMIN_LAB_LIMITS.MAX_MODEL_UNITS_SCAN) {
    work.exceeded = true;
    return work;
  }
  if (paths.length > ADMIN_GEOMETRY_LIMITS.MAX_PATHS) return work;
  for (const path of paths) {
    if (!isRecord(path)) continue;
    const style = path.style;
    if (isRecord(style) && Array.isArray(style.dasharray)) {
      work.units += style.dasharray.length;
      if (work.units > ADMIN_LAB_LIMITS.MAX_MODEL_UNITS_SCAN) {
        work.exceeded = true;
        return work;
      }
      if (style.dasharray.length > TRUSTED_IMPORT_LIMITS.MAX_DASH_VALUES)
        return work;
    }
    if (work.units > ADMIN_LAB_LIMITS.MAX_MODEL_UNITS_SCAN)
      work.exceeded = true;
    if (typeof path.d !== "string" || work.exceeded) continue;
    work.chars += path.d.length;
    if (work.chars > ADMIN_GEOMETRY_LIMITS.MAX_TOTAL_D_CHARS) {
      work.exceeded = true;
      return work;
    }
    if (path.d.length > ADMIN_GEOMETRY_LIMITS.MAX_D_CHARS) return work;
    const tokenized = tokenizePathData(path.d);
    work.cost += tokenized.ok
      ? tokenized.path.cost
      : Math.min(path.d.length * 26, ADMIN_GEOMETRY_LIMITS.MAX_POINTS);
    if (work.cost > ADMIN_GEOMETRY_LIMITS.MAX_POINTS) {
      work.exceeded = true;
      return work;
    }
  }
  return work;
}

function geometryReasonForRecord(id: string, reason: string): string {
  if (reason.includes("volumen") || reason.includes("máximo")) {
    return `Registro "${id}": el diseño supera el volumen de geometría admitido y no se renderiza.`;
  }
  if (reason.includes("transform") || reason.includes("desborda")) {
    return `Registro "${id}": transform no soportado y no se renderiza.`;
  }
  if (
    reason.includes("coordenadas") ||
    reason.includes("rango") ||
    reason.includes("área")
  ) {
    return `Registro "${id}": ${reason[0].toLowerCase()}${reason.slice(1)}`;
  }
  return `Registro "${id}": un path tiene sintaxis inválida y no se renderiza.`;
}

/** Validación defensiva de un registro guardado, antes de confiar o renderizar. */
export function validateStoredDesign(
  value: unknown,
):
  | { ok: true; design: RenderableDesign; cost: number }
  | { ok: false; reason: string } {
  if (!isRecord(value))
    return { ok: false, reason: "Registro ilegible: no es un objeto." };
  // Alcance por versión: v1/v2 rechazan toda clave cruda como siempre. Un
  // v3 puede traer `svg` SOLO para pasar por sanitizeStoredSvgAsset; el
  // resto de claves crudas sigue vetado y un v3 inválido cae al manejo de
  // corruptos (un payload hostil con version:3 no gana nada). Solo cuentan
  // los campos propios (F5): nada heredado satisface versión ni claves.
  const version = ownVersion(value);
  for (const key of FORBIDDEN_RAW_KEYS) {
    if (
      hasOwn(value, key) &&
      !(version === MODEL_VERSION_ASSET && key === "svg")
    ) {
      return {
        ok: false,
        reason:
          "Registro con SVG original sin procesar: solo se admite geometría validada.",
      };
    }
  }
  // v1 y v2 históricos se aceptan tal cual; MODEL_VERSION_ASSET es el
  // modelo vigente. Cualquier otra versión queda aislada en solo lectura.
  if (version !== 1 && version !== 2 && version !== MODEL_VERSION_ASSET) {
    return {
      ok: false,
      reason: `Versión de registro desconocida (${String(version)}).`,
    };
  }
  if (
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    value.id.length > ADMIN_LAB_LIMITS.MAX_ID_CHARS
  ) {
    return { ok: false, reason: "Registro sin identificador válido." };
  }
  const id = value.id.trim();
  if (
    typeof value.name !== "string" ||
    value.name.trim() === "" ||
    value.name.trim().length > ADMIN_LAB_LIMITS.MAX_NAME_CHARS
  ) {
    return {
      ok: false,
      reason: `Registro "${id}": nombre inválido o vacío.`,
    };
  }
  if (
    typeof value.category !== "string" ||
    value.category.trim() === "" ||
    value.category.trim().length > ADMIN_LAB_LIMITS.MAX_CATEGORY_CHARS
  ) {
    return {
      ok: false,
      reason: `Registro "${id}": categoría inválida o vacía.`,
    };
  }
  if (typeof value.enabled !== "boolean") {
    return { ok: false, reason: `Registro "${id}": estado inválido.` };
  }
  if (
    typeof value.createdAt !== "string" ||
    value.createdAt.length > ADMIN_LAB_LIMITS.MAX_DATE_CHARS ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    return { ok: false, reason: `Registro "${id}": fecha inválida.` };
  }
  const work = inspectRecordWork(value);
  if (work.exceeded)
    return {
      ok: false,
      reason: `Registro "${id}": supera el volumen de geometría admitido.`,
    };
  const metadata = {
    id,
    name: value.name.trim(),
    category: value.category.trim(),
    enabled: value.enabled,
    createdAt: value.createdAt,
  };
  if (version === MODEL_VERSION_ASSET) {
    // El svg guardado nunca se confía: re-parse + re-sanitize hasta punto
    // fijo + derivados consistentes (sin igualdad de bytes: lo que rinde
    // es el asset canónico re-sanitizado). Si falla, es un corrupto más.
    // Los campos del asset deben ser propios (F5): nada heredado vale.
    if (
      !hasOwn(value, "svg") ||
      !hasOwn(value, "width") ||
      !hasOwn(value, "height") ||
      !hasOwn(value, "viewBox")
    ) {
      return {
        ok: false,
        reason: `Registro "${id}": el SVG almacenado no pasó la revalidación de seguridad y no se renderiza.`,
      };
    }
    const asset = sanitizeStoredSvgAsset({
      svg: value.svg,
      width: value.width,
      height: value.height,
      viewBox: value.viewBox,
    });
    if (!asset) {
      return {
        ok: false,
        reason: `Registro "${id}": el SVG almacenado no pasó la revalidación de seguridad y no se renderiza.`,
      };
    }
    const design: AssetApprovedDesign = {
      ...metadata,
      version: MODEL_VERSION_ASSET,
      svg: asset.svg,
      width: asset.width,
      height: asset.height,
      viewBox: asset.viewBox,
    };
    // Interino: v3 no proyecta geometría controlada (el preview de T4
    // discriminará por versión); el objeto en runtime trae exactamente
    // metadatos + asset, sin clave geometry.
    return { ok: true, design: design as RenderableDesign, cost: work.cost };
  }
  if (version === 2) {
    const checked = validateImportedGeometry(value.geometry);
    return checked.ok
      ? {
          ok: true,
          design: { ...metadata, version: 2, geometry: checked.geometry },
          cost: work.cost,
        }
      : {
          ok: false,
          reason: `Registro "${id}": geometría controlada inválida (pintura, árbol, matriz o caja).`,
        };
  }
  if (value.fillRule !== "nonzero" && value.fillRule !== "evenodd") {
    return {
      ok: false,
      reason: `Registro "${id}": regla de relleno inválida.`,
    };
  }
  if (
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.length > ADMIN_GEOMETRY_LIMITS.MAX_PATHS
  ) {
    return {
      ok: false,
      reason: `Registro "${id}": cantidad de paths inválida.`,
    };
  }
  // Geometría EXACTA compartida con la admisión: sintaxis estricta,
  // presupuestos, matriz finita, coordenadas transformadas en rango.
  const geometry = checkDesignGeometry(
    value.paths as Array<{ d: string; transform?: string }>,
  );
  if (!geometry.ok) {
    return { ok: false, reason: geometryReasonForRecord(id, geometry.reason) };
  }
  const geometryCost = geometry.cost;
  // La caja declarada debe coincidir con la derivada: una caja falsa
  // (p. ej. 1x1 con matriz gigante) es dato dañado, no se confía.
  if (!boundsMatchClaim(geometry.bounds, value.artBounds)) {
    return {
      ok: false,
      reason: `Registro "${id}": la caja declarada no coincide con su geometría (posible dato dañado).`,
    };
  }
  const paths: LegacyApprovedDesign["paths"] = (
    value.paths as Array<{ d: string; transform?: string }>
  ).map((entry) =>
    entry.transform !== undefined
      ? { d: entry.d, transform: entry.transform }
      : { d: entry.d },
  );
  const controlledPaths = paths.map((path) => {
    const parsed = parseTransformList(path.transform);
    if (!parsed.ok)
      throw new Error("Validated legacy transform became invalid");
    return {
      d: path.d,
      matrix: parsed.matrix,
      style: {
        ...DEFAULT_CONTROLLED_STYLE,
        dasharray: [],
        fillRule: value.fillRule as LegacyApprovedDesign["fillRule"],
      },
    };
  });
  const normalized = validateImportedGeometry({
    version: 2,
    root: 0,
    paths: controlledPaths,
    nodes: [
      { kind: "group", opacity: 1, children: paths.map((_, i) => i + 1) },
      ...paths.map((_, i) => ({ kind: "path", opacity: 1, path: i })),
    ],
    centerlineBounds: geometry.bounds,
    artBounds: geometry.bounds,
  });
  if (!normalized.ok)
    return {
      ok: false,
      reason: `Registro "${id}": geometría legada inválida.`,
    };
  return {
    ok: true,
    design: {
      ...metadata,
      version: 1,
      paths,
      artBounds: { ...geometry.bounds },
      fillRule: value.fillRule,
      geometry: normalized.geometry,
    },
    cost: geometryCost,
  };
}

function recordIdOf(entry: unknown): string | undefined {
  return typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { id?: unknown }).id === "string"
    ? (entry as { id: string }).id
    : undefined;
}

/** Lee el sobre con cotas ANTES de validar: nada gigante itera geometría. */
export function parseEnvelope(raw: string | null): EnvelopeParse {
  if (raw == null || raw.trim() === "") {
    return {
      designs: [],
      skipped: [],
      corrupted: false,
      damaged: false,
      unknownVersion: false,
    };
  }
  if (raw.length > MAX_RAW_READ_CHARS) {
    return {
      designs: [],
      skipped: [
        {
          reason:
            "El almacenamiento guardado supera el tamaño máximo y no se leyó: se conserva intacto.",
        },
      ],
      corrupted: true,
      damaged: true,
      unknownVersion: false,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      designs: [],
      skipped: [
        {
          reason:
            "El almacenamiento guardado no es JSON válido y no se pudo leer: se conserva intacto.",
        },
      ],
      corrupted: true,
      damaged: true,
      unknownVersion: false,
    };
  }
  if (!isRecord(parsed) || typeof parsed.version !== "number") {
    return {
      designs: [],
      skipped: [
        {
          reason:
            "El almacenamiento guardado no tiene formato reconocido y no se pudo leer: se conserva intacto.",
        },
      ],
      corrupted: true,
      damaged: true,
      unknownVersion: false,
    };
  }
  if (parsed.version !== ENVELOPE_VERSION) {
    return {
      designs: [],
      skipped: [
        {
          reason: `Versión de almacenamiento desconocida (v${parsed.version}): se conserva intacta sin migrar.`,
        },
      ],
      corrupted: true,
      damaged: false,
      unknownVersion: true,
    };
  }
  if (!Array.isArray(parsed.records)) {
    return {
      designs: [],
      skipped: [
        {
          reason:
            "El almacenamiento guardado no trae lista de diseños: se conserva intacto.",
        },
      ],
      corrupted: true,
      damaged: true,
      unknownVersion: false,
    };
  }
  const designs: RenderableDesign[] = [];
  const skipped: SkippedRecord[] = [];
  // R3: solo el daño genuino bloquea el borrado; los saltos de
  // presupuesto/duplicado permiten borrar para volver bajo el tope.
  let damaged = false;
  const seen = new Set<string>();
  const records = parsed.records;
  if (records.length > ADMIN_GEOMETRY_LIMITS.MAX_RECORDS_SCAN) {
    skipped.push({
      reason: `El almacenamiento trae ${records.length} registros y solo se revisaron los primeros ${ADMIN_GEOMETRY_LIMITS.MAX_RECORDS_SCAN}: se conserva intacto.`,
    });
  }
  // Cota de trabajo agregado del sobre: cada registro ya viene acotado
  // por la validación; aquí se frena el acumulado para que un sobre con
  // miles de registros válidos no cuelgue la pestaña.
  const scanWork = { chars: 0, cost: 0, units: 0, exceeded: false };
  const scanLimit = Math.min(
    records.length,
    ADMIN_GEOMETRY_LIMITS.MAX_RECORDS_SCAN,
  );
  for (let index = 0; index < scanLimit; index += 1) {
    const entry = records[index];
    // Charge work BEFORE analytic validation, including corrupt/duplicate/overflow neighbors.
    inspectRecordWork(entry, scanWork);
    if (scanWork.exceeded) {
      skipped.push({
        id: recordIdOf(entry),
        reason:
          "El almacenamiento excede el trabajo acumulado admitido: lo revisado se muestra y todo se conserva intacto.",
      });
      break;
    }
    // Aislamiento por registro: un corrupto nunca rompe el sobre ni
    // oculta a sus vecinos. Solo se aísla ESTE registro; el resto se
    // sigue validando (no hay catch global que esconda todo lo bueno).
    // Un registro que no valida es daño genuino (damaged), no un salto
    // de presupuesto: el borrado sigue bloqueado para no perderlo.
    let checked: ReturnType<typeof validateStoredDesign>;
    try {
      checked = validateStoredDesign(entry);
    } catch {
      damaged = true;
      skipped.push({
        id: recordIdOf(entry),
        reason:
          "Registro ilegible: su geometría no se pudo revisar y no se renderiza.",
      });
      continue;
    }
    if (!checked.ok) {
      damaged = true;
      skipped.push({ id: recordIdOf(entry), reason: checked.reason });
      continue;
    }
    if (seen.has(checked.design.id)) {
      // Duplicado: salto de presupuesto/conservación, no daño. El borrado
      // por ese id elimina el conservado y suelta al gemelo omitido.
      skipped.push({
        id: checked.design.id,
        reason: `Registro duplicado ("${checked.design.id}"): se conserva el primero.`,
      });
      continue;
    }
    seen.add(checked.design.id);
    if (designs.length >= ADMIN_LAB_LIMITS.MAX_RECORDS) {
      // Overflow de tope: el dueño puede borrar para volver a entrar.
      skipped.push({
        id: checked.design.id,
        reason: `Registro "${checked.design.id}": supera el máximo de ${ADMIN_LAB_LIMITS.MAX_RECORDS} diseños y quedó fuera de la lista.`,
      });
      continue;
    }
    designs.push(checked.design);
  }
  return {
    designs,
    skipped,
    corrupted: skipped.length > 0,
    damaged,
    unknownVersion: false,
  };
}

function readBackend(): StorageBackend | null {
  try {
    if (typeof window === "undefined" || window.localStorage == null)
      return null;
    // Tocar el almacenamiento puede lanzar (modo privado, bloqueado).
    window.localStorage.length;
    return window.localStorage;
  } catch {
    return null;
  }
}

const unavailable = (action: string): StoreError => ({
  code: "STORAGE_UNAVAILABLE",
  message: `No se pudo ${action}: el almacenamiento del navegador no está disponible. Revisá el modo privado o los permisos del sitio.`,
});

function describeWriteError(error: unknown, action: string): StoreError {
  const name =
    error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : "";
  if (
    name === "QuotaExceededError" ||
    (error as { code?: number } | null)?.code === 22
  ) {
    return {
      code: "STORAGE_QUOTA",
      message: `No se pudo ${action}: se agotó la cuota de almacenamiento del navegador. Liberá espacio o borrá diseños en desuso. Nada se guardó.`,
    };
  }
  return {
    code: "STORAGE_UNAVAILABLE",
    message: `No se pudo ${action}: falló el almacenamiento del navegador. Nada se guardó.`,
  };
}

/** Sobre no interpretable: solo lectura, blob intacto, motivo accionable. */
function blockedByUnresolvedStorage(
  current: EnvelopeParse,
  action: string,
  tail: string,
): StoreError | null {
  if (current.unknownVersion) {
    return {
      code: "INVALID_DATA",
      message: `No se pudo ${action}: el almacenamiento guardado tiene una versión desconocida y se conserva intacta. ${tail}`,
    };
  }
  if (current.corrupted) {
    const detail = current.skipped
      .slice(0, 2)
      .map((entry) => entry.reason)
      .join(" ");
    return {
      code: "INVALID_DATA",
      message: `No se pudo ${action}: el almacenamiento guardado tiene datos dañados y se conserva intacto. ${detail} Pedí ayuda para recuperarlos. ${tail}`,
    };
  }
  return null;
}

/** Borrado con daño genuino o versión desconocida: bloqueado, blob
 * intacto. Con saltos SOLO de presupuesto/duplicado el borrado sigue
 * permitido: es la vía del dueño para volver bajo el tope (la escritura
 * resultante suelta los omitidos, acción explícita y visible). */
function blockedRemoveByUnresolvedStorage(
  current: EnvelopeParse,
  action: string,
  tail: string,
): StoreError | null {
  if (current.unknownVersion) {
    return {
      code: "INVALID_DATA",
      message: `No se pudo ${action}: el almacenamiento guardado tiene una versión desconocida y se conserva intacta. ${tail}`,
    };
  }
  if (current.damaged) {
    const detail = current.skipped
      .slice(0, 2)
      .map((entry) => entry.reason)
      .join(" ");
    return {
      code: "INVALID_DATA",
      message: `No se pudo ${action}: el almacenamiento guardado tiene datos dañados y se conserva intacto. ${detail} Pedí ayuda para recuperarlos. ${tail}`,
    };
  }
  return null;
}

function makeId(excluded: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `dsn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!excluded.has(candidate)) return candidate;
  }
  let counter = 0;
  for (;;) {
    const candidate = `dsn-${Date.now().toString(36)}-r${counter}`;
    if (!excluded.has(candidate)) return candidate;
    counter += 1;
  }
}

export type NewDesignInput = { name: string; category: string } & (
  | { asset: SvgAsset }
  | { geometry: ImportedGeometry }
  | Pick<LegacyApprovedDesign, "paths" | "artBounds" | "fillRule">
);

/** Runtime normalization never silently migrates/replaces a persisted legacy record. */
function persistedDesign(design: ApprovedDesign): ApprovedDesign {
  const metadata = {
    id: design.id,
    name: design.name,
    category: design.category,
    enabled: design.enabled,
    createdAt: design.createdAt,
  };
  if (design.version === MODEL_VERSION_ASSET)
    return {
      ...metadata,
      version: MODEL_VERSION_ASSET,
      svg: design.svg,
      width: design.width,
      height: design.height,
      viewBox: design.viewBox ? { ...design.viewBox } : null,
    };
  return design.version === 2
    ? { ...metadata, version: 2, geometry: design.geometry }
    : {
        ...metadata,
        version: 1,
        paths: design.paths,
        artBounds: design.artBounds,
        fillRule: design.fillRule,
      };
}

export function createAdminDesignStore(
  explicitBackend?: StorageBackend | null,
): AdminDesignRepository {
  const listeners = new Set<() => void>();
  let windowAttached = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const backend = (
    name: string,
  ): { backend: StorageBackend } | { error: StoreError } => {
    const resolved =
      explicitBackend === undefined ? readBackend() : explicitBackend;
    if (!resolved) return { error: unavailable(name) };
    return { backend: resolved };
  };

  const readCurrent = (
    storage: StorageBackend,
    action: string,
  ): { current: EnvelopeParse } | { error: StoreError } => {
    let current: EnvelopeParse;
    try {
      current = parseEnvelope(storage.getItem(ADMIN_LAB_STORAGE_KEY));
    } catch {
      return { error: unavailable(action) };
    }
    return { current };
  };

  const load = async (): Promise<LoadResult> => {
    const resolved = backend("leer la biblioteca");
    if ("error" in resolved) {
      return {
        designs: [],
        skipped: [],
        corrupted: false,
        damaged: false,
        unknownVersion: false,
        unavailable: true,
      };
    }
    let raw: string | null;
    try {
      raw = resolved.backend.getItem(ADMIN_LAB_STORAGE_KEY);
    } catch {
      return {
        designs: [],
        skipped: [],
        corrupted: false,
        damaged: false,
        unknownVersion: false,
        unavailable: true,
      };
    }
    // Un sobre nunca rechaza el load: lo corrupto se informa como
    // omitido y el blob se conserva intacto para recuperación humana.
    // El aislamiento por registro vive en parseEnvelope; este catch es
    // última red ante un fallo inesperado del parseo global.
    try {
      return { ...parseEnvelope(raw), unavailable: false };
    } catch {
      return {
        designs: [],
        skipped: [
          {
            reason:
              "El almacenamiento guardado no se pudo leer y se conserva intacto: pedí ayuda para recuperarlo.",
          },
        ],
        corrupted: true,
        damaged: true,
        unknownVersion: false,
        unavailable: false,
      };
    }
  };

  /** Escribe el sobre tal cual (los registros ya vienen validados). */
  const persist = (
    storage: StorageBackend,
    designs: ApprovedDesign[],
    action: string,
  ): { ok: true } | { ok: false; error: StoreError } => {
    // Never write a collection which its own bounded loader cannot read back.
    const work = { chars: 0, cost: 0, units: 0, exceeded: false };
    for (const design of designs) {
      inspectRecordWork(design, work);
      if (work.exceeded)
        return {
          ok: false,
          error: {
            code: "STORAGE_FULL",
            message: `No se pudo ${action}: la biblioteca excede el volumen de geometría admitido. Nada se guardó.`,
          },
        };
    }
    const serialized = JSON.stringify({
      version: ENVELOPE_VERSION,
      records: designs.map(persistedDesign),
    });
    if (serialized.length > ADMIN_LAB_LIMITS.MAX_STORAGE_CHARS) {
      return {
        ok: false,
        error: {
          code: "STORAGE_FULL",
          message: `No se pudo ${action}: la biblioteca alcanzó su tamaño máximo. Borrá diseños en desuso. Nada se guardó.`,
        },
      };
    }
    try {
      storage.setItem(ADMIN_LAB_STORAGE_KEY, serialized);
    } catch (error) {
      return { ok: false, error: describeWriteError(error, action) };
    }
    // Misma pestaña: aviso directo (el evento `storage` no dispara en
    // origen, así que no hay duplicados).
    notify();
    return { ok: true };
  };

  const saveNew = async (input: NewDesignInput): Promise<SaveResult> => {
    const resolved = backend("guardar el diseño");
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const name = input.name.trim();
    const category = input.category.trim();
    if (name === "" || name.length > ADMIN_LAB_LIMITS.MAX_NAME_CHARS) {
      return {
        ok: false,
        error: {
          code: "INVALID_DATA",
          message: "Poné un nombre de hasta 120 caracteres.",
        },
      };
    }
    if (
      category === "" ||
      category.length > ADMIN_LAB_LIMITS.MAX_CATEGORY_CHARS
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_DATA",
          message: "Poné una categoría de hasta 60 caracteres.",
        },
      };
    }
    // Releer fresco: si otra pestaña guardó mientras tanto, no se pierde.
    const read = readCurrent(resolved.backend, "guardar el diseño");
    if ("error" in read) return { ok: false, error: read.error };
    const blocked = blockedByUnresolvedStorage(
      read.current,
      "guardar el diseño",
      "Nada se guardó.",
    );
    if (blocked) return { ok: false, error: blocked };
    if (read.current.designs.length >= ADMIN_LAB_LIMITS.MAX_RECORDS) {
      return {
        ok: false,
        error: {
          code: "LIMIT_RECORDS",
          message: `La biblioteca admite hasta ${ADMIN_LAB_LIMITS.MAX_RECORDS} diseños. Borrá alguno en desuso. Nada se guardó.`,
        },
      };
    }
    const existingIds = new Set(
      read.current.designs.map((design) => design.id),
    );
    const metadata = {
      id: makeId(existingIds),
      name,
      category,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const candidate =
      "asset" in input
        ? {
            ...metadata,
            version: DESIGN_MODEL_VERSION,
            // El asset de entrada se revalida en validateStoredDesign
            // (punto único): basura runtime queda en INVALID_DATA, sin throw.
            svg: input.asset?.svg,
            width: input.asset?.width,
            height: input.asset?.height,
            viewBox: input.asset?.viewBox,
          }
        : "geometry" in input
          ? { ...metadata, version: 2, geometry: input.geometry }
          : {
              ...metadata,
              version: 1,
              paths: input.paths,
              artBounds: input.artBounds,
              fillRule: input.fillRule,
            };
    const checked = validateStoredDesign(candidate);
    if (!checked.ok) {
      return {
        ok: false,
        error: { code: "INVALID_DATA", message: checked.reason },
      };
    }
    const written = persist(
      resolved.backend,
      [...read.current.designs, checked.design],
      "guardar el diseño",
    );
    if (!written.ok) return written;
    return { ok: true, design: checked.design, skipped: read.current.skipped };
  };

  const updateDesign = async (
    id: string,
    patch: { name?: string; category?: string; enabled?: boolean },
  ): Promise<WriteResult> => {
    const resolved = backend("actualizar el diseño");
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const read = readCurrent(resolved.backend, "actualizar el diseño");
    if ("error" in read) return { ok: false, error: read.error };
    const blocked = blockedByUnresolvedStorage(
      read.current,
      "actualizar el diseño",
      "Nada se guardó.",
    );
    if (blocked) return { ok: false, error: blocked };
    const index = read.current.designs.findIndex((design) => design.id === id);
    if (index < 0) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Ese diseño ya no existe en la biblioteca.",
        },
      };
    }
    const merged: ApprovedDesign = {
      ...read.current.designs[index],
      name:
        patch.name !== undefined
          ? patch.name.trim()
          : read.current.designs[index].name,
      category:
        patch.category !== undefined
          ? patch.category.trim()
          : read.current.designs[index].category,
      enabled:
        patch.enabled !== undefined
          ? patch.enabled
          : read.current.designs[index].enabled,
    };
    const checked = validateStoredDesign(merged);
    if (!checked.ok) {
      return {
        ok: false,
        error: { code: "INVALID_DATA", message: checked.reason },
      };
    }
    const next = [...read.current.designs];
    next[index] = checked.design;
    const written = persist(resolved.backend, next, "actualizar el diseño");
    if (!written.ok) return written;
    return { ok: true, design: checked.design, skipped: read.current.skipped };
  };

  const toggleDesign = async (id: string): Promise<WriteResult> => {
    const resolved = backend("actualizar el diseño");
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const read = readCurrent(resolved.backend, "actualizar el diseño");
    if ("error" in read) return { ok: false, error: read.error };
    const blocked = blockedByUnresolvedStorage(
      read.current,
      "actualizar el diseño",
      "Nada se guardó.",
    );
    if (blocked) return { ok: false, error: blocked };
    const index = read.current.designs.findIndex((design) => design.id === id);
    if (index < 0) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Ese diseño ya no existe en la biblioteca.",
        },
      };
    }
    // Se invierte el valor GUARDADO fresco, no el del render (que puede
    // estar rancio). Entre pestañas rige última-escritura, no atomicidad.
    const merged: ApprovedDesign = {
      ...read.current.designs[index],
      enabled: !read.current.designs[index].enabled,
    };
    const checked = validateStoredDesign(merged);
    if (!checked.ok) {
      return {
        ok: false,
        error: { code: "INVALID_DATA", message: checked.reason },
      };
    }
    const next = [...read.current.designs];
    next[index] = checked.design;
    const written = persist(resolved.backend, next, "actualizar el diseño");
    if (!written.ok) return written;
    return { ok: true, design: checked.design, skipped: read.current.skipped };
  };

  const removeDesign = async (id: string): Promise<WriteResult> => {
    const resolved = backend("eliminar el diseño");
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const read = readCurrent(resolved.backend, "eliminar el diseño");
    if ("error" in read) return { ok: false, error: read.error };
    const blocked = blockedRemoveByUnresolvedStorage(
      read.current,
      "eliminar el diseño",
      "No se eliminó nada.",
    );
    if (blocked) return { ok: false, error: blocked };
    if (!read.current.designs.some((design) => design.id === id)) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Ese diseño ya no existe en la biblioteca.",
        },
      };
    }
    const written = persist(
      resolved.backend,
      read.current.designs.filter((design) => design.id !== id),
      "eliminar el diseño",
    );
    if (!written.ok) return written;
    return { ok: true, skipped: read.current.skipped };
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (typeof window !== "undefined" && !windowAttached) {
      windowAttached = true;
      window.addEventListener("storage", (event: StorageEvent) => {
        // `key: null` = clear(): también pudo borrar nuestra clave.
        if (event.key === ADMIN_LAB_STORAGE_KEY || event.key === null) {
          notify();
        }
      });
    }
    return () => {
      listeners.delete(listener);
    };
  };

  return { load, saveNew, updateDesign, toggleDesign, removeDesign, subscribe };
}

export type AdminDesignStore = AdminDesignRepository;
