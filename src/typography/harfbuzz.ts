/**
 * Shaper tipográfico (HarfBuzz) — carga diferida.
 *
 * POR QUÉ HARFBUZZ: el motor anterior (opentype.js + lector GPOS propio) no
 * implementa GSUB, así que no reproducía las ligaduras y sustituciones
 * contextuales que sí aplica el navegador (en Lato, 12 secuencias; en Dancing
 * Script, el par "or"). HarfBuzz es el motor que usa Chromium, de modo que la
 * paridad es una consecuencia de la arquitectura y no una expectativa.
 *
 * CARGA DIFERIDA: el paquete inicializa su WASM con un top-level await, así
 * que se importa dinámicamente y con un especificador calculado en tiempo de
 * ejecución: el empaquetador no lo ve (queda fuera del bundle inicial) y el
 * escáner de dependencias de Vite tampoco (si lo viera, llevaría el paquete al
 * optimizador con el target por defecto y el build del producto fallaría).
 *
 * Los ficheros del paquete los sirve el plugin `harfbuzz-assets` de
 * `vite.config.ts`: en desarrollo como middleware y en build como assets.
 */
import type * as hbTypes from "harfbuzzjs";

export type HarfBuzzModule = typeof hbTypes;

/**
 * Tipos de INSTANCIA de las clases del paquete: `hbTypes["Font"]` es el
 * constructor (el tipo de la clase), no la instancia.
 */
type BlobInstance = InstanceType<HarfBuzzModule["Blob"]>;
type FaceInstance = InstanceType<HarfBuzzModule["Face"]>;
type FontInstance = InstanceType<HarfBuzzModule["Font"]>;

let module: HarfBuzzModule | null = null;

/** Ruta base donde el plugin sirve los ficheros de harfbuzzjs. */
function harfBuzzBase(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/$/, "")}/assets/harfbuzz`;
}

/** Carga (una sola vez) el módulo WASM de HarfBuzz. */
export async function loadHarfBuzz(): Promise<HarfBuzzModule> {
  if (module) return module;
  const base = harfBuzzBase();
  module = (await import(
    /* @vite-ignore */ `${base}/index.mjs`
  )) as HarfBuzzModule;
  return module;
}

/** Versión de HarfBuzz en ejecución (se registra en el resultado). */
export function shaperVersion(): string {
  return module ? module.versionString() : "(not loaded)";
}

export type ShapedGlyph = {
  /** Glifo resultante (id en la fuente). */
  gid: number;
  /** Avance del glifo, en unidades de fuente. */
  advanceUnits: number;
  /** Desplazamiento del glifo respecto al origen del cluster, en unidades. */
  xOffsetUnits: number;
  yOffsetUnits: number;
  /** Contorno en unidades de fuente (null si el glifo no tiene contornos). */
  commands: OutlineCommand[] | null;
};

export type ShapedCluster = {
  /** Índice del primer carácter del cluster en el texto original. */
  clusterKey: number;
  /** Caracteres que cubre el cluster. */
  text: string;
  /** Avance total del cluster, en unidades de fuente (kerning incluido). */
  advanceUnits: number;
  glyphs: ShapedGlyph[];
};

export type ShapedRun = {
  unitsPerEm: number;
  clusters: ShapedCluster[];
  /** Suma de los avances de los clusters (sin letter-spacing). */
  totalAdvanceUnits: number;
};

export type ShapeOptions = {
  /** Etiqueta de script OpenType. Por defecto "latn". */
  script?: string;
  /** Etiqueta de idioma BCP-47. Por defecto "es". */
  language?: string;
  /** Ejes de fuente variable, p. ej. [{ tag: "wght", value: 600 }]. */
  variations?: { tag: string; value: number }[];
  /** Features de HarfBuzz adicionales (p. ej. desactivar "liga"). */
  features?: { tag: string; value: number; start?: number; end?: number }[];
  /**
   * Clave de caché del Face/Font. Sin ella cada llamada crearía un Face+Font
   * nuevo en el heap del WASM.
   */
  cacheKey?: string;
};

export type ShapeErrorCode =
  | "FONT_INVALID"
  | "GLYPH_MISSING"
  | "TEXT_NOT_NFC"
  | "SHAPER_UNAVAILABLE";

export type ShapeResult =
  | { ok: true; run: ShapedRun }
  | { ok: false; code: ShapeErrorCode; reason: string };

/** Contornos en unidades de fuente (misma forma que expone opentype.js). */
export type OutlineCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

type PreparedFont = {
  /**
   * El Blob debe seguir siendo alcanzable: harfbuzzjs lo registra en un
   * FinalizationRegistry que llama a hb_blob_destroy al recogerlo, y la Face
   * apunta a esa memoria (si se libera: "memory access out of bounds").
   */
  blob: BlobInstance;
  face: FaceInstance;
  font: FontInstance;
  unitsPerEm: number;
};

const fontCache = new Map<string, PreparedFont>();

async function getFont(
  cacheKey: string | undefined,
  fontBytes: ArrayBuffer,
): Promise<PreparedFont> {
  if (cacheKey) {
    const cached = fontCache.get(cacheKey);
    if (cached) return cached;
  }
  const hb = await loadHarfBuzz();
  const blob = new hb.Blob(fontBytes);
  const face = new hb.Face(blob, 0);
  const font = new hb.Font(face);
  const prepared = { blob, face, font, unitsPerEm: face.upem };
  if (cacheKey) fontCache.set(cacheKey, prepared);
  return prepared;
}

/** Contorno de un glifo en unidades de fuente. */
function outlineOf(
  font: FontInstance,
  gid: number,
): OutlineCommand[] | null {
  const json = font.glyphToJson(gid);
  if (!json || json.length === 0) return null;
  const commands: OutlineCommand[] = [];
  for (const c of json) {
    const v = c.values;
    if (c.type === "M") commands.push({ type: "M", x: v[0], y: v[1] });
    else if (c.type === "L") commands.push({ type: "L", x: v[0], y: v[1] });
    else if (c.type === "Q")
      commands.push({ type: "Q", x1: v[0], y1: v[1], x: v[2], y: v[3] });
    else if (c.type === "C")
      commands.push({
        type: "C",
        x1: v[0],
        y1: v[1],
        x2: v[2],
        y2: v[3],
        x: v[4],
        y: v[5],
      });
    else commands.push({ type: "Z" });
  }
  return commands.length > 0 ? commands : null;
}

/**
 * Compone (shape) un texto con HarfBuzz.
 *
 * Nunca sustituye un glifo ausente: si la fuente no lo tiene, la run falla
 * cerrada con GLYPH_MISSING. Un texto que no está en NFC también se rechaza
 * (no hay soporte de marcas combinantes).
 */
export async function shapeText(
  fontBytes: ArrayBuffer,
  text: string,
  options: ShapeOptions = {},
): Promise<ShapeResult> {
  if (text.normalize("NFC") !== text) {
    return {
      ok: false,
      code: "TEXT_NOT_NFC",
      reason:
        "El texto no está en forma NFC; no se normaliza en silencio (sin posicionamiento de marcas combinantes).",
    };
  }
  let font: FontInstance;
  let unitsPerEm: number;
  try {
    const prepared = await getFont(options.cacheKey, fontBytes);
    font = prepared.font;
    unitsPerEm = prepared.unitsPerEm;
  } catch (error) {
    return {
      ok: false,
      code: "FONT_INVALID",
      reason: `La fuente no se pudo abrir: ${(error as Error).message}`,
    };
  }
  // Escala 1:1 en unidades de fuente: los avances y los contornos salen en
  // unidades de fuente y el paso a milímetros lo hace el layout curvo.
  font.setScale(unitsPerEm, unitsPerEm);
  if (options.variations && options.variations.length > 0) {
    const hb = await loadHarfBuzz();
    font.setVariations(
      options.variations.map((v) => new hb.Variation(v.tag, v.value)),
    );
  }

  // Fallo cerrado ante glifos ausentes, antes de componer.
  const missing = Array.from(text).filter(
    (c) => c !== " " && font.nominalGlyph(c.codePointAt(0)!) === undefined,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: "GLYPH_MISSING",
      reason: `La fuente no tiene glifo para: ${Array.from(new Set(missing)).join(" ")} (sin sustitución).`,
    };
  }

  const hb = await loadHarfBuzz();
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.setDirection(hb.Direction.LTR);
  buffer.setScript(options.script ?? "latn");
  buffer.setLanguage(options.language ?? "es");
  const features = options.features?.map(
    (f) => new hb.Feature(f.tag, f.value, f.start, f.end),
  );
  hb.shape(font, buffer, features);

  const shaped = buffer.getGlyphInfosAndPositions();
  const clusters: ShapedCluster[] = [];
  let totalAdvanceUnits = 0;
  for (const g of shaped) {
    const clusterKey = g.cluster ?? 0;
    let cluster = clusters[clusters.length - 1];
    if (!cluster || cluster.clusterKey !== clusterKey) {
      cluster = { clusterKey, text: "", advanceUnits: 0, glyphs: [] };
      clusters.push(cluster);
    }
    const advance = g.xAdvance ?? 0;
    cluster.glyphs.push({
      gid: g.codepoint,
      advanceUnits: advance,
      xOffsetUnits: g.xOffset ?? 0,
      yOffsetUnits: g.yOffset ?? 0,
      commands: outlineOf(font, g.codepoint),
    });
    cluster.advanceUnits += advance;
    totalAdvanceUnits += advance;
  }
  clusters.forEach((cluster, i) => {
    const next = clusters[i + 1]?.clusterKey ?? text.length;
    cluster.text = text.slice(cluster.clusterKey, next);
  });

  return { ok: true, run: { unitsPerEm, clusters, totalAdvanceUnits } };
}
