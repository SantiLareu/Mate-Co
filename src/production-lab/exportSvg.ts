/**
 * E1 pure physical vector export core (Stage 3 S1–S6). Sync, deterministic,
 * DOM-free: no Date/random/Blob/DOM. Reads the SAME PhysicalReport the
 * PhysicalComposition preview renders; no divergent calculations.
 *
 * Physical-mm contract:
 * - Radii in the report are ALREADY mm; diameters = 2R. Root declares
 *   xmlns only, width/height in mm ("{2h}mm") and viewBox "0 0 {2h} {2h}"
 *   (mm = 1 user unit). h = max extent over rings, line radii and placed
 *   center+envelope extents (same extent family as PhysicalComposition,
 *   MINUS display-only padding/labels: the 10% screen pad, diameter labels,
 *   envelope dashes, pending markers and knockout defs never enter the
 *   file, so a rings-only composition exports exactly 2h = outer diameter).
 *   The scene is drawn around physical (0,0) and shifted by (h,h) so every
 *   coordinate is non-negative inside the mm viewBox.
 * - Ring group id="lab-ring-reference": two circles r = outer/inner radius,
 *   fill none, stroke #0000FF 1.5 (product virola-reference convention).
 *   These are MEASUREMENT REFERENCES, not engraving paths. The group is a
 *   SIBLING of the engraving group id="lab-engraving", never nested in it.
 * - Engraving content mirrors the preview pose math exactly: icons use the
 *   PhysicalIcon wrapper (translate + rotate/scale + scale(1.4)
 *   translate(-16 -16) paint, stroke #171717 1.7 round); v1/v2 approved use
 *   the PhysicalApproved wrapper (translate + rotate/scale + fit
 *   translate/scale from artTransformForBounds) with
 *   ControlledGeometry-equivalent path serialization (d + matrix + full
 *   style, stable attr order). Envelope dashes and data-* attrs are
 *   display-only and excluded.
 * - Decorative lines are explicit interrupted arcs from exportKnockouts
 *   (uncoveredArcs at center 0); a surviving full circle stays a <circle>,
 *   a fully covered ring emits nothing. Round-cap delta documented in
 *   exportKnockouts (analytic butt-end boundaries, never silently fixed).
 *
 * Fail-closed gates (codes are machine-stable, reasons carry evidence):
 * 0. Null/missing report or frame, or any non-finite number the
 *    serializer reads -> INVALID_MEASURES (defensive). This gate runs
 *    FIRST so a null report can never throw on report.texts (E3).
 * 1. report.texts non-empty -> FONT_OUTLINES_UNAVAILABLE (fonts-block-gate
 *    L2; see exportTextOutlines evidence). Any text present blocks: no
 *    outlines, no substitution, no fake equivalence.
 * 2. input.graphicsCount > 0 -> GRAPHICS_NOT_EXPORTED (E3, J3 scope): the
 *    engine covers texts/icons/approved only; traced job graphics would
 *    otherwise be omitted from the file with no code while the status
 *    claims the composition is exportable. Never silent.
 * 3. assetFlags (caller-computed, E2 wires the real DOM scan; string scans
 *    are NOT reliable so the core never sniffs bytes):
 *    hasRaster -> RASTER_ASSET_BLOCKED, hasUnsupportedFeature ->
 *    UNSUPPORTED_ASSET_FEATURE (filter/fe* only; gradients, clipPath, mask,
 *    pattern, marker and use travel namespaced via E2 approvedEmbeds),
 *    hasText -> FONT_OUTLINES_UNAVAILABLE.
 * 4. text-band knockout with no texts -> TEXT_SPAN_UNMEASURED (defensive;
 *    unreachable once texts block, kept so an inconsistent report can
 *    never invent a span).
 * 5. v3 approved snapshot without an E2 inline payload ->
 *    UNSUPPORTED_ASSET_FEATURE (inline embedding with DOM ID namespacing
 *    arrives via input.approvedEmbeds; a missing entry still blocks).
 *    defs, or an unserializable v1/v2 tree -> UNSUPPORTED_ASSET_FEATURE.
 *
 * Export half-extent granularity (E3): h ceils to 0.01 mm (10 µm). Exact
 * multiples stay exact (rings-only 80 -> 80); spilled art rounds UP so it
 * can never clip against the viewBox edge.
 *
 * Empty composition decision: VALID, rings only. The reference rings alone
 * are a well-defined measurement file; no EMPTY_COMPOSITION code exists.
 *
 * Determinism: same input -> byte-identical output. Attribute order is
 * fixed; numbers serialize via num() = String() with a canonical zero-snap
 * (|v| < 1e-9 -> 0, three orders below 0.001 mm machine relevance), which
 * also absorbs trig float noise (cos(-pi/2) = 6.1e-17 would otherwise print
 * as scientific notation) and normalizes -0. No timestamps.
 */
import { artTransformForBounds } from "../components/UploadedGraphic";
import type { ImportedGeometry } from "../admin-lab/importedGeometry";
import type {
  BuildLabPhysicalSvgInput,
  LabExportCode,
  LabExportResult,
  PhysicalReport,
  PlacedApproved,
  PlacedCircularLine,
  PlacedIcon,
} from "./types";
import { checkLabTextsBlocked } from "./exportTextOutlines";
import { lineEngravingSegments, splitLineKnockouts } from "./exportKnockouts";
import type { KnockoutDisk, TextKnockoutBand } from "../export/geometry";

export const LAB_RING_GROUP_ID = "lab-ring-reference";
export const LAB_ENGRAVING_GROUP_ID = "lab-engraving";
/** Measurement-reference paint, product virola-reference convention. */
export const LAB_RING_STROKE = "#0000FF";
export const LAB_RING_STROKE_WIDTH = 1.5;
/** Engraving paint: machine-path black, explicit per-element widths. */
export const LAB_ENGRAVING_STROKE = "#000000";
/** Icon paint model, PhysicalIcon-exact. */
export const LAB_ICON_STROKE = "#171717";
export const LAB_ICON_STROKE_WIDTH = 1.7;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const fail = (code: LabExportCode, reason: string): LabExportResult => ({
  ok: false,
  code,
  reason,
});

const num = (value: number): string =>
  String(Math.abs(value) < 1e-9 ? 0 : value);

const escapeXmlAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * ControlledGeometry-equivalent serialization (v1/v2): ordered tree walk
 * with node opacity; matrices apply ONLY to paths (never re-applied to
 * groups), full style serialized in stable order. Returns null when the
 * tree references are invalid (caller fails closed).
 */
function controlledGeometryMarkup(geometry: ImportedGeometry): string | null {
  const renderNode = (index: number): string | null => {
    const node = geometry.nodes[index];
    if (!node) return null;
    if (node.kind === "group") {
      const children: string[] = [];
      for (const child of node.children) {
        const rendered = renderNode(child);
        if (rendered === null) return null;
        children.push(rendered);
      }
      return `<g opacity="${num(node.opacity)}">${children.join("")}</g>`;
    }
    const path = geometry.paths[node.path];
    if (!path) return null;
    const m = path.matrix;
    const s = path.style;
    for (const value of [
      m.a,
      m.b,
      m.c,
      m.d,
      m.e,
      m.f,
      node.opacity,
      s.strokeWidth,
      s.miterlimit,
      s.dashoffset,
      s.fillOpacity,
      s.strokeOpacity,
    ]) {
      if (!isFiniteNumber(value)) return null;
    }
    const dasharray =
      s.dasharray.length > 0
        ? s.dasharray.map((value) => String(value)).join(" ")
        : "none";
    return (
      `<path d="${escapeXmlAttr(path.d)}"` +
      ` transform="matrix(${num(m.a)} ${num(m.b)} ${num(m.c)} ${num(m.d)} ${num(m.e)} ${num(m.f)})"` +
      ` opacity="${num(node.opacity)}"` +
      ` fill="${escapeXmlAttr(s.fill)}"` +
      ` stroke="${escapeXmlAttr(s.stroke)}"` +
      ` stroke-width="${num(s.strokeWidth)}"` +
      ` stroke-linecap="${escapeXmlAttr(s.linecap)}"` +
      ` stroke-linejoin="${escapeXmlAttr(s.linejoin)}"` +
      ` stroke-miterlimit="${num(s.miterlimit)}"` +
      ` stroke-dasharray="${escapeXmlAttr(dasharray)}"` +
      ` stroke-dashoffset="${num(s.dashoffset)}"` +
      ` fill-opacity="${num(s.fillOpacity)}"` +
      ` stroke-opacity="${num(s.strokeOpacity)}"` +
      ` fill-rule="${escapeXmlAttr(s.fillRule)}"/>`
    );
  };
  return renderNode(geometry.root);
}

function iconMarkup(
  placed: PlacedIcon,
  paths: readonly string[],
  half: number,
): string {
  const scaleX = placed.localScale * (placed.mirrored ? -1 : 1);
  const scaleY = placed.localScale * (placed.inverted ? -1 : 1);
  const art = paths.map((d) => `<path d="${escapeXmlAttr(d)}"/>`).join("");
  return (
    `<g transform="translate(${num(placed.center.x + half)} ${num(placed.center.y + half)})">` +
    `<g transform="rotate(${num(placed.rotation)}) scale(${num(scaleX)} ${num(scaleY)})">` +
    `<g transform="scale(1.4) translate(-16 -16)" fill="none" stroke="${LAB_ICON_STROKE}" stroke-width="${String(LAB_ICON_STROKE_WIDTH)}" stroke-linecap="round" stroke-linejoin="round">` +
    art +
    `</g></g></g>`
  );
}

function approvedMarkup(
  placed: PlacedApproved,
  half: number,
  embeds: Record<string, string> | undefined,
): string | null {
  const snapshot = placed.snapshot;
  if (snapshot.version === 3) {
    // E2 inline path: the caller-supplied namespaced nested <svg> (already
    // centered on its fit-64 display box) nests under the SAME pose wrapper
    // the PhysicalApproved/image box uses: translate + rotate/scale with
    // mirror/invert, so v3 sizing stays single-sourced (display box source
    // units x localScale). A missing entry keeps the E1 fail-closed block.
    const embed = embeds?.[placed.id];
    if (typeof embed !== "string" || embed === "") return null;
    const scaleX = placed.localScale * (placed.mirrored ? -1 : 1);
    const scaleY = placed.localScale * (placed.inverted ? -1 : 1);
    return (
      `<g transform="translate(${num(placed.center.x + half)} ${num(placed.center.y + half)})">` +
      `<g transform="rotate(${num(placed.rotation)}) scale(${num(scaleX)} ${num(scaleY)})">` +
      embed +
      `</g></g>`
    );
  }
  if (!("geometry" in snapshot)) return null;
  const art = controlledGeometryMarkup(snapshot.geometry);
  if (art === null) return null;
  const fit = artTransformForBounds(snapshot.geometry.artBounds);
  if (
    !isFiniteNumber(fit.scale) ||
    !isFiniteNumber(fit.translateX) ||
    !isFiniteNumber(fit.translateY)
  ) {
    return null;
  }
  const scaleX = placed.localScale * (placed.mirrored ? -1 : 1);
  const scaleY = placed.localScale * (placed.inverted ? -1 : 1);
  return (
    `<g transform="translate(${num(placed.center.x + half)} ${num(placed.center.y + half)})">` +
    `<g transform="rotate(${num(placed.rotation)}) scale(${num(scaleX)} ${num(scaleY)})">` +
    `<g transform="translate(${num(fit.translateX)} ${num(fit.translateY)}) scale(${num(fit.scale)})" fill="${LAB_ENGRAVING_STROKE}" fill-rule="evenodd">` +
    art +
    `</g></g></g>`
  );
}

function lineMarkup(
  line: PlacedCircularLine,
  disks: KnockoutDisk[],
  bands: TextKnockoutBand[],
  half: number,
): string {
  const engraving = lineEngravingSegments(line, disks, bands);
  const paint = `fill="none" stroke="${LAB_ENGRAVING_STROKE}" stroke-width="${num(line.strokeWidthMm)}"`;
  if (engraving.full) {
    return `<circle cx="${num(half)}" cy="${num(half)}" r="${num(line.radiusMm)}" ${paint}/>`;
  }
  return engraving.paths
    .map(
      (d) =>
        `<path d="${escapeXmlAttr(d)}" ${paint} transform="translate(${num(half)} ${num(half)})"/>`,
    )
    .join("");
}

/** Defensive finite check over every number the serializer reads. */
function reportNumbersFinite(report: PhysicalReport): boolean {
  const frame = report.frame;
  const values: number[] = [
    frame.outerDiameter,
    frame.innerDiameter,
    frame.outerRadius,
    frame.innerRadius,
    frame.positionSlope,
    frame.sizeFactor,
    ...report.icons.flatMap((icon) => [
      icon.center.x,
      icon.center.y,
      icon.centerRadiusMm,
      icon.localScale,
      icon.localScaleX,
      icon.localScaleY,
      icon.rotation,
      icon.envelopeMm,
    ]),
    ...report.approved.flatMap((item) => [
      item.center.x,
      item.center.y,
      item.centerRadiusMm,
      item.localScale,
      item.localScaleX,
      item.localScaleY,
      item.rotation,
      item.envelopeMm,
      item.displaySizeMm.width,
      item.displaySizeMm.height,
    ]),
    ...report.lines.flatMap((line) => [line.radiusMm, line.strokeWidthMm]),
    ...report.lineKnockouts.flatMap((knockout) =>
      knockout.kind === "text-band"
        ? [
            knockout.anchorRadiusMm,
            knockout.halfSpanDegrees,
            knockout.strokeWidthMm,
            knockout.angle,
          ]
        : [knockout.center.x, knockout.center.y, knockout.radiusMm],
    ),
  ];
  return values.every(isFiniteNumber);
}

export function buildLabPhysicalSvg(
  input: BuildLabPhysicalSvgInput,
): LabExportResult {
  const { report, iconPaths, assetFlags } = input;

  // Gate 0: null/frame/finite check FIRST (E3: report.texts below must
  // never be dereferenced on a null report).
  if (!report || !report.frame || !reportNumbersFinite(report)) {
    return fail(
      "INVALID_MEASURES",
      "El reporte físico contiene medidas no finitas o faltantes: exportación bloqueada (defensivo).",
    );
  }

  // Gate 1: fonts-block-gate (any text present blocks).
  const textGate = checkLabTextsBlocked(report.texts);
  if (!textGate.ok) return textGate;

  // Gate 2: job-graphics scope gate (E3, J3 disclosure).
  if (typeof input.graphicsCount === "number" && input.graphicsCount > 0) {
    return fail(
      "GRAPHICS_NOT_EXPORTED",
      `La composición trae ${String(input.graphicsCount)} ${input.graphicsCount === 1 ? "imagen trazada" : "imágenes trazadas"} (vectores del editor): el motor físico cubre textos, íconos y diseños aprobados; las imágenes quedan fuera del alcance y se omitirían del archivo en silencio, así que la exportación se bloquea con código explícito.`,
    );
  }

  // Gate 3: caller-computed asset flags (E2 DOM scan contract).
  if (assetFlags?.hasRaster) {
    return fail(
      "RASTER_ASSET_BLOCKED",
      "El activo aprobado contiene datos raster (data:image): la exportación vectorial nunca convierte aprobados a PNG/JPEG/canvas; exportación bloqueada.",
    );
  }
  if (assetFlags?.hasUnsupportedFeature) {
    return fail(
      "UNSUPPORTED_ASSET_FEATURE",
      "El activo aprobado contiene una característica no transferible con fidelidad (filter/fe*): exportación bloqueada en vez de producir un archivo incorrecto. (Gradientes, clipPath, mask, pattern, marker y use viajan con namespacing por instancia vía E2; ver exportApprovedAsset.)",
    );
  }
  if (assetFlags?.hasText) {
    return fail(
      "FONT_OUTLINES_UNAVAILABLE",
      "El activo aprobado contiene <text>/<font-family>: rige el mismo bloqueo de fuentes (decisión L2), sin sustitución silenciosa.",
    );
  }

  // Gate 4: orphan text-band knockout (defensive, unreachable via gate 1).
  // While texts block, no band may exist; a future outline stage feeds real
  // bands through splitLineKnockouts without touching this gate.
  const { disks, bands } = splitLineKnockouts(
    report.lineKnockouts,
    report.frame.sizeFactor,
  );
  if (bands.length > 0) {
    return fail(
      "TEXT_SPAN_UNMEASURED",
      "Knockout de banda de texto sin texto exportable en el reporte: no se inventa ningún span; exportación bloqueada (defensivo).",
    );
  }

  const frame = report.frame;
  // Export half-extent: same extent family as the preview fit (rings, line
  // radii, placed center+envelope) WITHOUT display-only padding/labels, so
  // rings-only compositions export exactly 2h = outer diameter.
  const extents: number[] = [
    frame.outerRadius,
    frame.innerRadius,
    ...report.lines.map((line) => line.radiusMm),
    ...report.icons.map((icon) => icon.centerRadiusMm + icon.envelopeMm),
    ...report.approved.map((item) => item.centerRadiusMm + item.envelopeMm),
  ];
  const half = Math.ceil(Math.max(...extents) * 100 - 1e-9) / 100;
  // E3 10 µm granularity: exact multiples survive the ceil unchanged
  // (rings-only 80 -> 80) while spilled art rounds UP, never clipping.
  // The 1e-9 epsilon absorbs float dust just above an exact hundredth.
  if (!isFiniteNumber(half)) {
    return fail(
      "INVALID_MEASURES",
      "La extensión de exportación no es finita: exportación bloqueada (defensivo).",
    );
  }
  const size = half * 2;

  const ring =
    `<g id="${LAB_RING_GROUP_ID}" fill="none" stroke="${LAB_RING_STROKE}" stroke-width="${String(LAB_RING_STROKE_WIDTH)}">` +
    `<circle cx="${num(half)}" cy="${num(half)}" r="${num(frame.outerRadius)}"/>` +
    `<circle cx="${num(half)}" cy="${num(half)}" r="${num(frame.innerRadius)}"/>` +
    `</g>`;

  const engraved: string[] = [];
  for (const line of report.lines) {
    const markup = lineMarkup(line, disks, bands, half);
    if (markup) engraved.push(markup);
  }
  for (const placed of report.icons) {
    const paths = iconPaths[placed.id];
    if (!paths) {
      return fail(
        "UNSUPPORTED_ASSET_FEATURE",
        `Ícono «${placed.id}» sin geometría embebida suministrada: exportación bloqueada (el núcleo no resuelve el catálogo; E2 debe proveer iconPaths).`,
      );
    }
    engraved.push(iconMarkup(placed, paths, half));
  }
  for (const placed of report.approved) {
    const markup = approvedMarkup(placed, half, input.approvedEmbeds);
    if (markup === null) {
      return fail(
        "UNSUPPORTED_ASSET_FEATURE",
        `Diseño aprobado «${placed.id}» (versión ${String(placed.snapshot.version)}) no serializable: v3 requiere su inline con namespacing DOM (E2 approvedEmbeds) y falta la entrada; exportación bloqueada.`,
      );
    }
    engraved.push(markup);
  }

  const fileName =
    input.fileName ??
    `lab-fisico-${String(frame.outerDiameter)}x${String(frame.innerDiameter)}-${frame.strategy}.svg`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(size)}mm" height="${num(size)}mm" viewBox="0 0 ${num(size)} ${num(size)}" data-strategy="${frame.strategy}" data-size-factor="${num(frame.sizeFactor)}">` +
    ring +
    `<g id="${LAB_ENGRAVING_GROUP_ID}">${engraved.join("")}</g>` +
    `</svg>`;
  return {
    ok: true,
    svg,
    meta: {
      outerDiameterMm: frame.outerDiameter,
      innerDiameterMm: frame.innerDiameter,
      strategy: frame.strategy,
      sizeFactor: frame.sizeFactor,
      fileName,
    },
  };
}
