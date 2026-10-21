import type { CircularLines } from '../App';
import { clampTextRadius, clampTextScale, type TextElement } from '../components/CurvedText';
import { normalizeIcon, type DesignIcon } from '../components/IconElement';
import { artTransformForBounds, normalizeUploadedGraphic, type UploadedGraphicElement } from '../components/UploadedGraphic';
import { iconById } from '../data/icons';
import {
  arcPath,
  bandToCoveredInterval,
  disksToCoveredIntervals,
  EXPORT_CENTER,
  lineRadiiForMode,
  mergeIntervals,
  polarPoint,
  rotateBox,
  uncoveredArcs,
  unionBoxes,
  VIROLA_INNER_RADIUS,
  VIROLA_OUTER_RADIUS,
  type AngularInterval,
  type Box,
  type KnockoutDisk,
  type TextKnockoutBand,
} from './geometry';
import { traceTextElement, type TextTrace } from './textOutlines';

export const EXPORT_FILENAME = 'mateandco-diseno.svg';
const VIEWBOX_PADDING = 12;

/**
 * Reference-only circles marking the virola limits. Pure blue, thin,
 * unfilled: never meant for the laser, deletable as one group.
 */
export const VIROLA_REFERENCE_STROKE = '#0000FF';
export const VIROLA_REFERENCE_STROKE_WIDTH = 1.5;
export const VIROLA_REFERENCE_GROUP_ID = 'virola-reference';
export const ENGRAVING_GROUP_ID = 'engraving-design';

function virolaReferenceGroup() {
  return `<g id="${VIROLA_REFERENCE_GROUP_ID}" fill="none" stroke="${VIROLA_REFERENCE_STROKE}" stroke-width="${VIROLA_REFERENCE_STROKE_WIDTH}">\n` +
    `    <circle cx="${EXPORT_CENTER}" cy="${EXPORT_CENTER}" r="${VIROLA_OUTER_RADIUS}"/>\n` +
    `    <circle cx="${EXPORT_CENTER}" cy="${EXPORT_CENTER}" r="${VIROLA_INNER_RADIUS}"/>\n` +
    `  </g>`;
}

export type ProductionDesignState = {
  texts: TextElement[];
  icons: DesignIcon[];
  graphics: UploadedGraphicElement[];
  circularLines: CircularLines;
};

export type TraceTextFn = (request: {
  text: string;
  fontFamily: string;
  scale: number;
  radius: number;
  inverted: boolean;
}) => Promise<TextTrace | null>;

type BuiltText = {
  markup: string;
  band: TextKnockoutBand;
  box: Box;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function textGroup(element: TextElement, trace: TextTrace) {
  const inner = trace.paths
    .map(path => `      <path d="${path.d}"${path.transform ? ` transform="${path.transform}"` : ''}/>`)
    .join('\n');
  return `<g transform="rotate(${round2(element.angle)} ${EXPORT_CENTER} ${EXPORT_CENTER})">\n` +
    `    <g transform="translate(${round2(trace.cropX)} ${round2(trace.cropY)}) scale(${round2(1 / trace.pixelScale)})" fill="#000000" fill-rule="evenodd">\n${inner}\n    </g>\n  </g>`;
}

function iconGroup(element: DesignIcon) {
  const icon = normalizeIcon({ ...element });
  const definition = iconById[icon.iconId];
  if (!definition) return null;
  const position = polarPoint(icon.angle, icon.radius);
  const scaleX = icon.scale * (icon.mirrored ? -1 : 1);
  const scaleY = icon.scale * (icon.inverted ? -1 : 1);
  const paths = definition.paths.map(d => `        <path d="${d}"/>`).join('\n');
  const markup = `<g transform="translate(${round2(position.x)} ${round2(position.y)})">\n` +
    `    <g transform="rotate(${round2(icon.rotation)}) scale(${round2(scaleX)} ${round2(scaleY)})">\n` +
    `      <g transform="scale(1.4) translate(-16 -16)" fill="none" stroke="#000000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n      </g>\n    </g>\n  </g>`;
  const knockoutRadius = 25 * icon.scale * Math.SQRT2 + 4;
  const disk: KnockoutDisk = { angleDegrees: icon.angle - 90, distance: icon.radius, radius: knockoutRadius };
  const box: Box = { x: position.x - knockoutRadius, y: position.y - knockoutRadius, width: knockoutRadius * 2, height: knockoutRadius * 2 };
  return { markup, disk, box };
}

function graphicGroup(element: UploadedGraphicElement) {
  const graphic = normalizeUploadedGraphic({ ...element });
  const position = polarPoint(graphic.angle, graphic.radius);
  const scaleX = graphic.scale * (graphic.mirrored ? -1 : 1);
  const scaleY = graphic.scale * (graphic.inverted ? -1 : 1);
  const fit = artTransformForBounds(graphic.artBounds);
  const paths = graphic.paths
    .map(path => `        <path d="${path.d}"${path.transform ? ` transform="${path.transform}"` : ''}/>`)
    .join('\n');
  const markup = `<g transform="translate(${round2(position.x)} ${round2(position.y)})">\n` +
    `    <g transform="rotate(${round2(graphic.rotation)}) scale(${round2(scaleX)} ${round2(scaleY)})">\n` +
    `      <g transform="translate(${round2(fit.translateX)} ${round2(fit.translateY)}) scale(${round2(fit.scale)})" fill="#000000" fill-rule="evenodd">\n${paths}\n      </g>\n    </g>\n  </g>`;
  const knockoutRadius = 25 * graphic.scale * Math.SQRT2 + 4;
  const disk: KnockoutDisk = { angleDegrees: graphic.angle - 90, distance: graphic.radius, radius: knockoutRadius };
  const box: Box = { x: position.x - knockoutRadius, y: position.y - knockoutRadius, width: knockoutRadius * 2, height: knockoutRadius * 2 };
  return { markup, disk, box };
}

function linesGroup(radii: number[], disks: KnockoutDisk[], bands: TextKnockoutBand[]) {
  return radii.map(radius => {
    const covered: AngularInterval[] = mergeIntervals([
      ...disksToCoveredIntervals(radius, disks),
      ...bands.flatMap(band => bandToCoveredInterval(radius, band)),
    ]);
    const open = uncoveredArcs(covered);
    if (!open.length) return '';
    if (open.length === 1 && open[0].start <= 0 && open[0].end >= 360) {
      return `    <circle cx="${EXPORT_CENTER}" cy="${EXPORT_CENTER}" r="${radius}"/>`;
    }
    return open.map(span => `    <path d="${arcPath(radius, span.start, span.end)}"/>`).join('\n');
  }).filter(Boolean).join('\n');
}

/**
 * Builds a standalone production SVG from design state. Reads the same state
 * objects MatePreview renders; never touches the DOM. Text is traced to real
 * outlines by the injected tracer (defaults to the offscreen render +
 * VTracer pipeline); icons/graphics reuse their stored vector geometry.
 */
export async function buildProductionSvg(
  state: ProductionDesignState,
  traceText: TraceTextFn = traceTextElement,
): Promise<string> {
  const builtTexts: BuiltText[] = [];
  for (const element of state.texts) {
    if (!element.text) continue;
    const scale = clampTextScale(element.scale ?? 1);
    const radius = clampTextRadius(element.radius, scale);
    const trace = await traceText({ text: element.text, fontFamily: element.fontFamily, scale, radius, inverted: element.inverted });
    if (!trace) continue;
    const halfSpan = Math.min(135, Math.max(7, (trace.arcLength / 2 + 14) / radius * 180 / Math.PI));
    builtTexts.push({
      markup: textGroup(element, trace),
      band: {
        radius,
        halfWidth: (35 * scale + 10) / 2 + 1,
        halfSpanDegrees: halfSpan,
        angleOffsetDegrees: element.angle,
      },
      box: rotateBox(trace.inkBox, element.angle),
    });
  }

  const builtIcons = state.icons.map(iconGroup).filter((built): built is NonNullable<typeof built> => built !== null);
  const builtGraphics = state.graphics.map(graphicGroup);

  const disks = [...builtIcons.map(built => built.disk), ...builtGraphics.map(built => built.disk)];
  const bands = builtTexts.map(built => built.band);
  const radii = lineRadiiForMode(state.circularLines);
  const lines = linesGroup(radii, disks, bands);

  const boxes: Box[] = [];
  // The virola reference is always exported, so the frame always contains it
  // in full, outer stroke included.
  const virolaHalf = VIROLA_OUTER_RADIUS + VIROLA_REFERENCE_STROKE_WIDTH / 2;
  boxes.push({ x: EXPORT_CENTER - virolaHalf, y: EXPORT_CENTER - virolaHalf, width: virolaHalf * 2, height: virolaHalf * 2 });
  for (const radius of radii) boxes.push({ x: EXPORT_CENTER - radius, y: EXPORT_CENTER - radius, width: radius * 2, height: radius * 2 });
  for (const built of builtTexts) boxes.push(built.box);
  for (const built of [...builtIcons, ...builtGraphics]) boxes.push(built.box);
  const union = unionBoxes(boxes);
  const viewBox = union
    ? `${round2(union.x - VIEWBOX_PADDING)} ${round2(union.y - VIEWBOX_PADDING)} ${round2(union.width + VIEWBOX_PADDING * 2)} ${round2(union.height + VIEWBOX_PADDING * 2)}`
    : '0 0 100 100';
  const [, , viewWidth, viewHeight] = viewBox.split(' ').map(Number);

  const engraving: string[] = [];
  if (lines) engraving.push(`    <g fill="none" stroke="#000000" stroke-width="2">\n${lines}\n    </g>`);
  for (const built of builtTexts) engraving.push(`    ${built.markup}`);
  for (const built of builtIcons) engraving.push(`    ${built.markup}`);
  for (const built of builtGraphics) engraving.push(`    ${built.markup}`);

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${round2(viewWidth)}" height="${round2(viewHeight)}" preserveAspectRatio="xMidYMid meet">\n` +
    `  ${virolaReferenceGroup()}\n` +
    `  <g id="${ENGRAVING_GROUP_ID}">\n${engraving.join('\n')}\n  </g>\n</svg>\n`;
}

export function downloadProductionSvg(svg: string, filename = EXPORT_FILENAME) {
  if (typeof document === 'undefined') throw new Error('La descarga requiere un navegador.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
