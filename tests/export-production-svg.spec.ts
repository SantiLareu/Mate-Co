import { expect, test } from '@playwright/test';
import {
  arcPath,
  bandToCoveredInterval,
  disksToCoveredIntervals,
  uncoveredArcs,
  VIROLA_INNER_RADIUS,
  VIROLA_OUTER_RADIUS,
} from '../src/export/geometry';
import {
  buildProductionSvg,
  ENGRAVING_GROUP_ID,
  VIROLA_REFERENCE_GROUP_ID,
  VIROLA_REFERENCE_STROKE,
  VIROLA_REFERENCE_STROKE_WIDTH,
  type ProductionDesignState,
  type TraceTextFn,
} from '../src/export/productionSvg';
import type { DesignIcon } from '../src/components/IconElement';
import type { UploadedGraphicElement } from '../src/components/UploadedGraphic';
import type { TextElement } from '../src/components/CurvedText';

const icon = (overrides: Partial<DesignIcon> = {}): DesignIcon => ({
  id: 'i1', type: 'icon', iconId: 'heart', angle: 90, radius: 357.5,
  scale: 1, rotation: 0, mirrored: false, inverted: false, ...overrides,
});

const graphic = (overrides: Partial<UploadedGraphicElement> = {}): UploadedGraphicElement => ({
  id: 'g1',
  type: 'uploaded-graphic',
  paths: [{ d: 'M0 0H10V10H0Z', transform: 'translate(3 4)' }],
  sourceWidth: 10,
  sourceHeight: 10,
  artBounds: { x: 0, y: 0, width: 10, height: 10 },
  angle: 270,
  radius: 357.5,
  scale: 1,
  rotation: 0,
  mirrored: false,
  inverted: false,
  ...overrides,
});

const textElement = (overrides: Partial<TextElement> = {}): TextElement => ({
  id: 't1', text: 'SANTI', fontFamily: 'Poppins SemiBold', angle: 0, radius: 374, inverted: false, scale: 1, ...overrides,
});

const stubTrace = (paths: string[] = ['M0 0H5V5H0Z']): TraceTextFn => async () => ({
  paths: paths.map(d => ({ d })),
  cropX: 100,
  cropY: 100,
  pixelScale: 3,
  inkBox: { x: 110, y: 110, width: 20, height: 10 },
  arcLength: 40,
});

test('empty design exports only the virola reference, no engraving geometry', async () => {
  const svg = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'none' }, stubTrace());
  expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain(`id="${VIROLA_REFERENCE_GROUP_ID}"`);
  expect(svg).toContain(`id="${ENGRAVING_GROUP_ID}"`);
  const engraving = svg.slice(svg.indexOf(`id="${ENGRAVING_GROUP_ID}"`));
  expect(engraving).not.toContain('<path');
  expect(engraving).not.toContain('<circle');
  expect(engraving).not.toContain('#000000');
  expect(svg).not.toContain('<text');
});

test('icon exports real vector geometry with pose transforms', async () => {
  const svg = await buildProductionSvg(
    { texts: [], icons: [icon({ rotation: 30, mirrored: true })], graphics: [], circularLines: 'none' },
    stubTrace(),
  );
  expect(svg).toContain('M16 27 5 16C-3 5 10 0 16 9 22 0 35 5 27 16Z');
  expect(svg).toContain('rotate(30)');
  expect(svg).toContain('scale(-1 1)');
  expect(svg).toContain('stroke="#000000"');
  expect(svg).not.toContain('<text');
  expect(svg).not.toContain('<image');
});

test('uploaded graphic preserves paths, transforms and evenodd', async () => {
  const svg = await buildProductionSvg(
    { texts: [], icons: [], graphics: [graphic()], circularLines: 'none' },
    stubTrace(),
  );
  expect(svg).toContain('M0 0H10V10H0Z');
  expect(svg).toContain('transform="translate(3 4)"');
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).not.toContain('<image');
});

test('text exports paths without any text elements', async () => {
  const svg = await buildProductionSvg(
    { texts: [textElement()], icons: [], graphics: [], circularLines: 'none' },
    stubTrace(['M0 0H5V5H0Z']),
  );
  expect(svg).toContain('<path d="M0 0H5V5H0Z"');
  expect(svg).toContain('rotate(0 450 450)');
  expect(svg).not.toContain('<text');
  expect(svg).not.toContain('textPath');
});

test('curved text keeps one transform chain per glyph run', async () => {
  const svg = await buildProductionSvg(
    { texts: [textElement({ text: 'SANTIAGO' })], icons: [], graphics: [], circularLines: 'none' },
    stubTrace(['M0 0H1V1H0Z', 'M2 2H3V3H2Z', 'M4 4H5V5H4Z']),
  );
  expect(svg.match(/<path /g)?.length).toBe(3);
  expect(svg).toContain('scale(0.33');
});

test('inverted text produces different geometry through the tracer contract', async () => {
  const seen: boolean[] = [];
  const tracer: TraceTextFn = async request => {
    seen.push(request.inverted);
    return {
      ...(await stubTrace([request.inverted ? 'M9 9H8V8H9Z' : 'M0 0H5V5H0Z'])()),
      paths: [{ d: request.inverted ? 'M9 9H8V8H9Z' : 'M0 0H5V5H0Z' }],
    };
  };
  const normal = await buildProductionSvg(
    { texts: [textElement({ inverted: false })], icons: [], graphics: [], circularLines: 'none' }, tracer);
  const inverted = await buildProductionSvg(
    { texts: [textElement({ inverted: true })], icons: [], graphics: [], circularLines: 'none' }, tracer);
  expect(seen).toEqual([false, true]);
  expect(normal).not.toBe(inverted);
});

test('blank text is skipped without tracing ink', async () => {
  let calls = 0;
  const tracer: TraceTextFn = async () => { calls += 1; return null; };
  const svg = await buildProductionSvg(
    { texts: [textElement({ text: '   ' })], icons: [], graphics: [], circularLines: 'none' }, tracer);
  expect(svg).not.toContain('<path');
});

test('single/double/none render the corresponding engraving lines', async () => {
  const engravingOf = (svg: string) => svg.slice(svg.indexOf(`id="${ENGRAVING_GROUP_ID}"`));
  const single = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'single' }, stubTrace());
  expect(engravingOf(single)).toContain('<circle cx="450" cy="450" r="357"');
  expect(engravingOf(single)).not.toContain('r="347"');
  const double = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'double' }, stubTrace());
  expect(engravingOf(double)).toContain('r="347"');
  expect(engravingOf(double)).toContain('r="367"');
  const none = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'none' }, stubTrace());
  expect(engravingOf(none)).not.toContain('<circle');
  expect(engravingOf(none)).not.toContain('<path');
  // The virola reference is always present regardless of line mode.
  for (const svg of [single, double, none]) {
    expect(svg).toContain(`id="${VIROLA_REFERENCE_GROUP_ID}"`);
    expect(svg).toContain(`r="${VIROLA_OUTER_RADIUS}"`);
    expect(svg).toContain(`r="${VIROLA_INNER_RADIUS}"`);
  }
});

test('knockout cuts physical gaps instead of crossing content', async () => {
  // Icon straight below the center, sitting exactly on the single line.
  const withIcon = await buildProductionSvg(
    { texts: [], icons: [icon({ angle: 90, radius: 357 })], graphics: [], circularLines: 'single' },
    stubTrace(),
  );
  const engravingWithIcon = withIcon.slice(withIcon.indexOf(`id="${ENGRAVING_GROUP_ID}"`));
  expect(engravingWithIcon).not.toContain('<circle');
  expect(withIcon).toContain('A357 357');
  const bare = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'single' }, stubTrace());
  expect(bare.slice(bare.indexOf(`id="${ENGRAVING_GROUP_ID}"`))).toContain('<circle cx="450" cy="450" r="357"');
});

test('text knockout band sits at the top where the glyphs really are', () => {
  const band = bandToCoveredInterval(357, { radius: 360, halfWidth: 25, halfSpanDegrees: 20, angleOffsetDegrees: 0 });
  expect(band).toEqual([{ start: 250, end: 290 }]);
});

test('stub text band cuts the line it overlaps', async () => {
  const withText = await buildProductionSvg(
    { texts: [textElement({ angle: 0, radius: 360 })], icons: [], graphics: [], circularLines: 'single' },
    stubTrace(),
  );
  expect(withText.slice(withText.indexOf(`id="${ENGRAVING_GROUP_ID}"`))).not.toContain('<circle');
  expect(withText).toContain('A357 357');
});

test('knockout interval math keeps lines whole when content is far away', () => {
  const far = disksToCoveredIntervals(357, [{ angleDegrees: 0, distance: 305, radius: 10 }]);
  expect(uncoveredArcs(far)).toEqual([{ start: 0, end: 360 }]);
  const band = bandToCoveredInterval(357, { radius: 410, halfWidth: 20, halfSpanDegrees: 30, angleOffsetDegrees: 0 });
  expect(band).toEqual([]);
  expect(arcPath(357, 0, 90)).toContain('A357 357');
});

test('export is portable: no raster, text, masks or external references', async () => {
  const state: ProductionDesignState = {
    texts: [textElement()],
    icons: [icon()],
    graphics: [graphic()],
    circularLines: 'double',
  };
  const svg = await buildProductionSvg(state, stubTrace());
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
  for (const forbidden of ['<text', 'textPath', '<image', '<mask', '<use', 'href', 'http', 'base64', 'url(', '.png', '.jpg']) {
    expect(withoutNamespace).not.toContain(forbidden);
  }
  expect(svg).toContain('<path');
  expect(svg).toContain('fill="#000000"');
});

test('export does not mutate design state', async () => {
  const state: ProductionDesignState = {
    texts: [textElement()],
    icons: [icon({ rotation: 12 })],
    graphics: [graphic()],
    circularLines: 'double',
  };
  const before = JSON.stringify(state);
  await buildProductionSvg(state, stubTrace());
  expect(JSON.stringify(state)).toBe(before);
});

test('viewBox frames the virola reference and the artwork without absurd empty space', async () => {
  const svg = await buildProductionSvg(
    { texts: [], icons: [icon({ angle: 90, radius: 357.5 })], graphics: [], circularLines: 'none' },
    stubTrace(),
  );
  const match = svg.match(/viewBox="([^"]+)"/);
  expect(match).not.toBe(null);
  const [x, y, width, height] = match![1].split(' ').map(Number);
  expect([x, y, width, height].every(Number.isFinite)).toBe(true);
  // Icon sits at (807.5, 450): the frame must contain it and stay tight.
  expect(x).toBeLessThan(807.5);
  expect(x + width).toBeGreaterThan(807.5);
  // Both virola circles must fit in full, outer stroke included.
  const outer = VIROLA_OUTER_RADIUS + VIROLA_REFERENCE_STROKE_WIDTH / 2;
  expect(x).toBeLessThanOrEqual(450 - outer);
  expect(x + width).toBeGreaterThanOrEqual(450 + outer);
  expect(y).toBeLessThanOrEqual(450 - outer);
  expect(y + height).toBeGreaterThanOrEqual(450 + outer);
  // Tight: virola diameter plus stroke plus a small padding only.
  expect(width).toBeLessThan(900);
  expect(height).toBeLessThan(900);
});

test('virola reference holds exactly two unfilled blue circles with the preview radii', async () => {
  const svg = await buildProductionSvg(
    {
      texts: [textElement()],
      icons: [icon()],
      graphics: [graphic()],
      circularLines: 'double',
    },
    stubTrace(),
  );
  const reference = svg.slice(svg.indexOf(`id="${VIROLA_REFERENCE_GROUP_ID}"`), svg.indexOf(`id="${ENGRAVING_GROUP_ID}"`));
  const circles = reference.match(/<circle[^>]*>/g) ?? [];
  expect(circles).toHaveLength(2);
  expect(reference).toContain(`stroke="${VIROLA_REFERENCE_STROKE}"`);
  expect(reference).toContain('fill="none"');
  for (const circle of circles) {
    expect(circle).not.toContain('fill=');
    expect(circle).not.toContain('stroke=');
  }
  expect(circles[0]).toContain(`r="${VIROLA_OUTER_RADIUS}"`);
  expect(circles[1]).toContain(`r="${VIROLA_INNER_RADIUS}"`);
  expect(VIROLA_REFERENCE_STROKE).toBe('#0000FF');
  // Reference only: no engraving black, no masks, no fills.
  expect(reference).not.toContain('#000000');
  expect(reference).not.toContain('<mask');
  expect(reference).not.toContain('fill="#');
  expect(reference).not.toContain('fill="url');
});

test('virola radii match the visual limits drawn by the editor preview', async () => {
  expect(VIROLA_OUTER_RADIUS).toBe(423);
  expect(VIROLA_INNER_RADIUS).toBe(292);
  const { readFile } = await import('node:fs/promises');
  const preview = await readFile('src/components/MatePreview.tsx', 'utf8');
  expect(preview).toContain('VIROLA_OUTER_RADIUS');
  expect(preview).toContain('VIROLA_INNER_RADIUS');
  expect(preview).not.toContain('r="423"');
  expect(preview).not.toContain('r="292"');
});

test('reference group stays distinguishable from the black engraving group', async () => {
  const svg = await buildProductionSvg(
    {
      texts: [textElement()],
      icons: [icon()],
      graphics: [graphic()],
      circularLines: 'double',
    },
    stubTrace(),
  );
  expect(svg.indexOf(`id="${VIROLA_REFERENCE_GROUP_ID}"`)).toBeGreaterThanOrEqual(0);
  expect(svg.indexOf(`id="${ENGRAVING_GROUP_ID}"`)).toBeGreaterThan(svg.indexOf(`id="${VIROLA_REFERENCE_GROUP_ID}"`));
  const engraving = svg.slice(svg.indexOf(`id="${ENGRAVING_GROUP_ID}"`));
  expect(engraving).toContain('#000000');
  expect(engraving).not.toContain(VIROLA_REFERENCE_STROKE);
  const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
  for (const forbidden of ['<text', 'textPath', '<image', '<mask', '<use', 'href', 'http', 'base64', 'url(', '.png', '.jpg']) {
    expect(withoutNamespace).not.toContain(forbidden);
  }
});

test('empty design viewBox hugs the virola reference with a small margin', async () => {
  const svg = await buildProductionSvg({ texts: [], icons: [], graphics: [], circularLines: 'none' }, stubTrace());
  const match = svg.match(/viewBox="([^"]+)"/);
  expect(match).not.toBe(null);
  const [x, y, width, height] = match![1].split(' ').map(Number);
  const outer = VIROLA_OUTER_RADIUS + VIROLA_REFERENCE_STROKE_WIDTH / 2;
  expect(x).toBeLessThanOrEqual(450 - outer);
  expect(x + width).toBeGreaterThanOrEqual(450 + outer);
  expect(y).toBeLessThanOrEqual(450 - outer);
  expect(y + height).toBeGreaterThanOrEqual(450 + outer);
  expect(width).toBeLessThanOrEqual((outer + 12) * 2 + 1);
  expect(height).toBeLessThanOrEqual((outer + 12) * 2 + 1);
});

test('repeated exports with the reference are byte-identical', async () => {
  const state: ProductionDesignState = {
    texts: [textElement()],
    icons: [icon()],
    graphics: [graphic()],
    circularLines: 'double',
  };
  const first = await buildProductionSvg(state, stubTrace());
  const second = await buildProductionSvg(state, stubTrace());
  expect(second).toBe(first);
  expect(first).toContain(`id="${VIROLA_REFERENCE_GROUP_ID}"`);
});

test('real curved text traces to paths in the browser', async ({ page }) => {
  await page.goto('/vector-lab');
  const result = await page.evaluate(async () => {
    const { buildProductionSvg } = await import('/src/export/productionSvg.ts');
    const svg = await buildProductionSvg({
      texts: [{ id: 't1', text: 'SANTI', fontFamily: 'Poppins SemiBold', angle: 0, radius: 374, inverted: false, scale: 1 }],
      icons: [],
      graphics: [],
      circularLines: 'none',
    });
    return {
      svg,
      paths: (svg.match(/<path /g) ?? []).length,
      hasText: svg.includes('<text') || svg.includes('textPath'),
    };
  });
  expect(result.hasText).toBe(false);
  expect(result.paths).toBeGreaterThan(2);
  expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test('real inverted text traces to different browser geometry', async ({ page }) => {
  await page.goto('/vector-lab');
  const result = await page.evaluate(async () => {
    const { buildProductionSvg } = await import('/src/export/productionSvg.ts');
    const base = { id: 't1', text: 'SANTI', fontFamily: 'Poppins SemiBold', angle: 0, radius: 374, scale: 1 } as const;
    const normal = await buildProductionSvg({ texts: [{ ...base, inverted: false }], icons: [], graphics: [], circularLines: 'none' });
    const inverted = await buildProductionSvg({ texts: [{ ...base, inverted: true }], icons: [], graphics: [], circularLines: 'none' });
    return { normal, inverted };
  });
  expect(result.normal).not.toBe(result.inverted);
  expect(result.inverted).not.toContain('<text');
});
