/**
 * Stage 4 typography spike — curved layout for a HARFBUZZ-SHAPED run.
 *
 * Reuses the spike's own geometry (layoutCurveItems / baselinePoint /
 * outlineToPathData / serializeSpikeSvg): nothing of the curved layout or of
 * the SVG serialisation is re-implemented here. The only difference with the
 * opentype.js path is WHERE the glyphs come from:
 *
 *   opentype.js path : one item per CHARACTER, kerning applied before it.
 *   HarfBuzz path    : one item per CLUSTER (a ligature cluster covers
 *                       several characters), kerning already folded into the
 *                       cluster advance by the shaper.
 */
import {
  baselinePoint,
  layoutCurveItems,
  outlineToPathData,
  serializeSpikeSvg,
  type CurvedTextLayout,
  type CurvedTextRequest,
  type LaidOutGlyph,
  type SpikeSvgInput,
  type SpikeSvgResult,
} from "../curvedTextOutlines";
import type { ShapedRun } from "./harfbuzzShaper";

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Lays a shaped run on the baseline circle.
 *
 * Letter-spacing is applied per CLUSTER (a typographic character unit), which
 * is what the browser applies between clusters. Whether Chromium spaces
 * *inside* a ligature cluster is measured by the spike test, not assumed.
 */
export function layoutShapedRun(
  run: ShapedRun,
  req: CurvedTextRequest,
): CurvedTextLayout {
  const k = req.fontSizeMm / run.unitsPerEm;
  const items = run.clusters.map((c) => ({
    advanceMm: c.advanceUnits * k,
    kernBeforeMm: 0,
  }));
  const curve = layoutCurveItems(items, req);
  const glyphs: LaidOutGlyph[] = [];
  run.clusters.forEach((cluster, ci) => {
    const placement = curve.placements[ci];
    const rot = toRad(placement.rotationDegrees);
    let penMm = 0; // advance already used inside the cluster
    for (const g of cluster.glyphs) {
      const advanceMm = g.advanceUnits * k;
      // The glyph's own advance midpoint on the baseline circle. The
      // cluster advance is the one used by the layout (CurvePlacement does
      // not carry it: reading placement.advanceMm yields undefined -> NaN).
      const clusterAdvanceMm = cluster.advanceUnits * k;
      const sMid = placement.sMidMm + (penMm + advanceMm / 2) - clusterAdvanceMm / 2;
      const mid = baselinePoint(sMid, req);
      // Offset of the glyph inside the cluster (font units -> mm), applied
      // along the cluster's rotated x axis.
      const offX = penMm + g.xOffsetUnits * k;
      const offY = -g.yOffsetUnits * k;
      glyphs.push({
        char: cluster.text,
        glyphIndex: g.gid,
        advanceMm,
        kernMm: 0,
        sMidMm: sMid,
        mid,
        origin: {
          x: placement.origin.x + offX * Math.cos(rot) - offY * Math.sin(rot),
          y: placement.origin.y + offX * Math.sin(rot) + offY * Math.cos(rot),
        },
        rotationDegrees: placement.rotationDegrees,
      });
      penMm += advanceMm;
    }
  });
  return {
    ok: true,
    glyphs,
    totalAdvanceMm: curve.totalAdvanceMm,
    spanDegrees: curve.spanDegrees,
  };
}

/**
 * Serialises a shaped run with the spike's own SVG writer.
 *
 * `pathFor` resolves the outline of a laid-out glyph from the shaped run (the
 * same commands the shaper produced), so the SVG structure is identical to
 * the opentype.js path.
 */
export function buildShapedSvg(
  run: ShapedRun,
  input: SpikeSvgInput & { fontName: string },
): SpikeSvgResult {
  const layout = layoutShapedRun(run, input.request);
  const byGlyph = new Map<number, LaidOutGlyph["glyphIndex"]>();
  const commands = new Map<number, Parameters<typeof outlineToPathData>[0]>();
  run.clusters.forEach((c) =>
    c.glyphs.forEach((g) => {
      if (g.commands) commands.set(g.gid, g.commands);
    }),
  );
  void byGlyph;
  const k = input.request.fontSizeMm / run.unitsPerEm;
  return serializeSpikeSvg({
    ...input,
    layout,
    pathFor: (glyph) => {
      const cmds = commands.get(glyph.glyphIndex);
      if (!cmds) return "";
      return outlineToPathData(
        cmds,
        {
          advanceMm: glyph.advanceMm,
          mid: glyph.mid,
          rotationDegrees: glyph.rotationDegrees,
        },
        k,
        input.request.inverted ? input.request.invertedDyMm : 0,
      );
    },
  });
}
