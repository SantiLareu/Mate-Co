/**
 * Minimal ambient types for opentype.js 2.0.0 (the package ships none).
 * Spike-local: only the members the spike actually uses.
 */
declare module "opentype.js" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };
  export interface Glyph {
    index: number;
    name: string;
    advanceWidth?: number;
    path: { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, Record<string, string>>;
    tables: { os2?: { sCapHeight?: number; sxHeight?: number } };
    charToGlyphIndex(char: string): number;
    glyphs: { get(index: number): Glyph };
    getKerningValue(left: Glyph | number, right: Glyph | number): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
