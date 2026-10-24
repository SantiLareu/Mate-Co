/**
 * Spike-local GPOS pair-kerning reader (Stage 4).
 *
 * WHY: opentype.js 2.0.0 does not parse GPOS lookup type 9 (Extension
 * Positioning): `parseLookup9` returns `{ error: "GPOS Lookup 9 not
 * supported" }` and `getKerningValue` then silently yields 0. Lato keeps ALL
 * of its kerning inside Extension lookups, so relying on opentype.js would
 * drop real kerning without any error. This reader parses the raw GPOS bytes
 * for exactly what the spike needs and FAILS CLOSED on everything else.
 *
 * Supported (anything else under the selected 'kern' feature -> unsupported):
 *  - lookup type 2 (PairPos) formats 1 and 2, directly or wrapped in type 9;
 *  - valueFormat1 with xAdvance (device-table bits are tolerated and ignored:
 *    they only adjust hinted ppem rendering, not outline geometry);
 *  - valueFormat2 == 0 (no adjustment of the second glyph);
 *  - lookupFlag ignore-bits only when the font has NO GDEF (nothing to skip).
 *
 * Semantics mirror HarfBuzz for adjacent glyphs of Latin text: script 'latn'
 * (fallback 'DFLT'), language system 'ESP ' if present else default; lookups
 * of the feature are applied in LookupList order and their xAdvance values
 * accumulate; inside one lookup the FIRST subtable whose coverage contains
 * the left glyph decides (format 2 applies even when the class value is 0).
 *
 * Pure and deterministic: input bytes -> table of numbers. No DOM, no I/O.
 */

export type KerningSource =
  | { kind: "gpos"; script: string; langSys: string; lookups: number[] }
  | { kind: "none"; reason: string };

export type KerningReader =
  | { ok: true; source: KerningSource; kern: (left: number, right: number) => number }
  | { ok: false; code: "KERNING_UNSUPPORTED"; reason: string };

type Pair =
  | {
      format: 1;
      coverage: Map<number, number>;
      pairSets: Map<number, number>[]; // per coverage index: second glyph -> xAdvance
    }
  | {
      format: 2;
      coverage: Map<number, number>;
      classDef1: Map<number, number>;
      classDef2: Map<number, number>;
      class2Count: number;
      values: Int16Array; // class1 * class2Count + class2 -> xAdvance
    };

class Reader {
  constructor(private view: DataView) {}
  u16(at: number): number {
    return this.view.getUint16(at, false);
  }
  i16(at: number): number {
    return this.view.getInt16(at, false);
  }
  u32(at: number): number {
    return this.view.getUint32(at, false);
  }
  tag(at: number): string {
    return String.fromCharCode(
      this.view.getUint8(at),
      this.view.getUint8(at + 1),
      this.view.getUint8(at + 2),
      this.view.getUint8(at + 3),
    );
  }
}

const unsupported = (reason: string): KerningReader => ({
  ok: false,
  code: "KERNING_UNSUPPORTED",
  reason,
});

function tableOffsets(r: Reader): Map<string, number> {
  const out = new Map<string, number>();
  const count = r.u16(4);
  for (let i = 0; i < count; i += 1) {
    const rec = 12 + i * 16;
    out.set(r.tag(rec), r.u32(rec + 8));
  }
  return out;
}

function readCoverage(r: Reader, at: number): Map<number, number> {
  const map = new Map<number, number>();
  const format = r.u16(at);
  if (format === 1) {
    const n = r.u16(at + 2);
    for (let i = 0; i < n; i += 1) map.set(r.u16(at + 4 + i * 2), i);
  } else if (format === 2) {
    const n = r.u16(at + 2);
    for (let i = 0; i < n; i += 1) {
      const rec = at + 4 + i * 6;
      const start = r.u16(rec);
      const end = r.u16(rec + 2);
      const startIndex = r.u16(rec + 4);
      for (let g = start; g <= end; g += 1) map.set(g, startIndex + g - start);
    }
  } else {
    throw new Error(`coverage format ${format}`);
  }
  return map;
}

function readClassDef(r: Reader, at: number): Map<number, number> {
  const map = new Map<number, number>();
  const format = r.u16(at);
  if (format === 1) {
    const start = r.u16(at + 2);
    const n = r.u16(at + 4);
    for (let i = 0; i < n; i += 1) {
      const value = r.u16(at + 6 + i * 2);
      if (value !== 0) map.set(start + i, value);
    }
  } else if (format === 2) {
    const n = r.u16(at + 2);
    for (let i = 0; i < n; i += 1) {
      const rec = at + 4 + i * 6;
      const start = r.u16(rec);
      const end = r.u16(rec + 2);
      const value = r.u16(rec + 4);
      if (value !== 0) for (let g = start; g <= end; g += 1) map.set(g, value);
    }
  } else {
    throw new Error(`classDef format ${format}`);
  }
  return map;
}

const popcount = (v: number) => {
  let c = 0;
  for (let x = v; x; x >>= 1) c += x & 1;
  return c;
};

/** Byte offset of xAdvance inside a value record, or -1 when absent. */
const xAdvanceOffset = (format: number) =>
  format & 0x4 ? popcount(format & 0x3) * 2 : -1;

function readPairPos(r: Reader, at: number): Pair | string {
  const format = r.u16(at);
  const coverage = readCoverage(r, at + r.u16(at + 2));
  const vf1 = r.u16(at + 4);
  const vf2 = r.u16(at + 6);
  if (vf2 !== 0) return `valueFormat2=${vf2} (ajuste del segundo glifo) no soportado`;
  if (vf1 & 0x0b)
    return `valueFormat1=${vf1} con xPlacement/yPlacement/yAdvance no soportado`;
  const size1 = popcount(vf1) * 2;
  const xa = xAdvanceOffset(vf1);
  if (format === 1) {
    const setCount = r.u16(at + 8);
    const pairSets: Map<number, number>[] = [];
    for (let i = 0; i < setCount; i += 1) {
      const setAt = at + r.u16(at + 10 + i * 2);
      const n = r.u16(setAt);
      const map = new Map<number, number>();
      for (let k = 0; k < n; k += 1) {
        const rec = setAt + 2 + k * (2 + size1);
        map.set(r.u16(rec), xa < 0 ? 0 : r.i16(rec + 2 + xa));
      }
      pairSets.push(map);
    }
    return { format: 1, coverage, pairSets };
  }
  if (format === 2) {
    const classDef1 = readClassDef(r, at + r.u16(at + 8));
    const classDef2 = readClassDef(r, at + r.u16(at + 10));
    const class1Count = r.u16(at + 12);
    const class2Count = r.u16(at + 14);
    const values = new Int16Array(class1Count * class2Count);
    for (let c1 = 0; c1 < class1Count; c1 += 1) {
      for (let c2 = 0; c2 < class2Count; c2 += 1) {
        const rec = at + 16 + (c1 * class2Count + c2) * size1;
        values[c1 * class2Count + c2] = xa < 0 ? 0 : r.i16(rec + xa);
      }
    }
    return { format: 2, coverage, classDef1, classDef2, class2Count, values };
  }
  return `PairPos format ${format} no soportado`;
}

function pairValue(p: Pair, left: number, right: number): number | null {
  const cov = p.coverage.get(left);
  if (cov === undefined) return null; // subtable does not apply
  if (p.format === 1) {
    const v = p.pairSets[cov]?.get(right);
    return v === undefined ? null : v;
  }
  const c1 = p.classDef1.get(left) ?? 0;
  const c2 = p.classDef2.get(right) ?? 0;
  if (c2 >= p.class2Count) return null;
  return p.values[c1 * p.class2Count + c2] ?? 0;
}

export function readGposKerning(buffer: ArrayBuffer): KerningReader {
  const r = new Reader(new DataView(buffer));
  const tables = tableOffsets(r);
  const gpos = tables.get("GPOS");
  if (gpos === undefined) {
    if (tables.has("kern"))
      return unsupported(
        "La fuente solo trae tabla 'kern' heredada; el spike no la implementa (sin sustitución silenciosa).",
      );
    return {
      ok: true,
      source: { kind: "none", reason: "sin GPOS ni 'kern'" },
      kern: () => 0,
    };
  }
  const hasGdef = tables.has("GDEF");
  const scriptList = gpos + r.u16(gpos + 4);
  const featureList = gpos + r.u16(gpos + 6);
  const lookupList = gpos + r.u16(gpos + 8);

  // Script 'latn' (fallback DFLT), language 'ESP ' else default.
  const scripts = new Map<string, number>();
  for (let i = 0; i < r.u16(scriptList); i += 1) {
    const rec = scriptList + 2 + i * 6;
    scripts.set(r.tag(rec), scriptList + r.u16(rec + 4));
  }
  const scriptTag = scripts.has("latn") ? "latn" : scripts.has("DFLT") ? "DFLT" : null;
  if (scriptTag === null)
    return { ok: true, source: { kind: "none", reason: "GPOS sin latn/DFLT" }, kern: () => 0 };
  const script = scripts.get(scriptTag)!;
  let langSys = r.u16(script) ? script + r.u16(script) : 0;
  let langTag = "dflt";
  for (let i = 0; i < r.u16(script + 2); i += 1) {
    const rec = script + 4 + i * 6;
    if (r.tag(rec) === "ESP ") {
      langSys = script + r.u16(rec + 4);
      langTag = "ESP ";
    }
  }
  if (!langSys)
    return { ok: true, source: { kind: "none", reason: "sin LangSys por defecto" }, kern: () => 0 };

  const featureIndexes: number[] = [];
  const required = r.u16(langSys + 2);
  if (required !== 0xffff) featureIndexes.push(required);
  for (let i = 0; i < r.u16(langSys + 4); i += 1) featureIndexes.push(r.u16(langSys + 6 + i * 2));

  const lookupIndexes = new Set<number>();
  for (const fi of featureIndexes) {
    const rec = featureList + 2 + fi * 6;
    if (r.tag(rec) !== "kern") continue;
    const feature = featureList + r.u16(rec + 4);
    for (let i = 0; i < r.u16(feature + 2); i += 1) lookupIndexes.add(r.u16(feature + 4 + i * 2));
  }
  if (lookupIndexes.size === 0)
    return {
      ok: true,
      source: { kind: "none", reason: `GPOS sin feature 'kern' para ${scriptTag}/${langTag}` },
      kern: () => 0,
    };

  const ordered = Array.from(lookupIndexes).sort((a, b) => a - b);
  const lookups: Pair[][] = [];
  try {
    for (const li of ordered) {
      const lookup = lookupList + r.u16(lookupList + 2 + li * 2);
      const type = r.u16(lookup);
      const flag = r.u16(lookup + 2);
      if (flag & 0x0e && hasGdef)
        return unsupported(`lookup ${li}: lookupFlag ${flag} con GDEF (omisión de glifos) no soportado`);
      if (flag & 0xff00 || flag & 0x10)
        return unsupported(`lookup ${li}: lookupFlag ${flag} (mark filtering) no soportado`);
      const subs: Pair[] = [];
      for (let s = 0; s < r.u16(lookup + 4); s += 1) {
        let at = lookup + r.u16(lookup + 6 + s * 2);
        let subType = type;
        if (type === 9) {
          if (r.u16(at) !== 1) return unsupported(`lookup ${li}: Extension format no soportado`);
          subType = r.u16(at + 2);
          at = at + r.u32(at + 4);
        }
        if (subType !== 2)
          return unsupported(`lookup ${li}: tipo ${subType} bajo 'kern' no soportado`);
        const pair = readPairPos(r, at);
        if (typeof pair === "string") return unsupported(`lookup ${li}: ${pair}`);
        subs.push(pair);
      }
      lookups.push(subs);
    }
  } catch (error) {
    return unsupported(`GPOS ilegible: ${(error as Error).message}`);
  }

  const cache = new Map<number, number>();
  return {
    ok: true,
    source: { kind: "gpos", script: scriptTag, langSys: langTag, lookups: ordered },
    kern: (left, right) => {
      const key = left * 65536 + right;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let total = 0;
      for (const subs of lookups) {
        for (const sub of subs) {
          const v = pairValue(sub, left, right);
          if (v !== null) {
            total += v;
            break;
          }
        }
      }
      cache.set(key, total);
      return total;
    },
  };
}
