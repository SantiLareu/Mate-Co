import { expect, test } from '@playwright/test';

type Shape = 'rectangle' | 'donut' | 'components';
type FixtureResult = {
  svgMarkup: string;
  pathCount: number;
  paths: Array<{ d: string; fill: string; fillRule: string }>;
  viewBox: string;
  width: number;
  height: number;
  diagnostics: { totalPathDataLength: number; commandCount: number; svgSizeBytes: number };
  parserErrors: number;
  inputUnchanged: boolean;
  samples: Record<string, boolean>;
};

async function vectorizeFixture(page: import('@playwright/test').Page, shape: Shape) {
  await page.goto('/vector-lab');
  const serialized = await page.evaluate(async selectedShape => {
    const width = 40;
    const height = 32;
    const data = new Uint8Array(width * height);
    const setPixel = (x: number, y: number) => { data[y * width + x] = 1; };

    if (selectedShape === 'rectangle') {
      for (let y = 8; y < 24; y += 1) for (let x = 10; x < 30; x += 1) setPixel(x, y);
    } else if (selectedShape === 'donut') {
      for (let y = 4; y < 28; y += 1) {
        for (let x = 8; x < 32; x += 1) {
          if (x < 15 || x >= 25 || y < 11 || y >= 21) setPixel(x, y);
        }
      }
    } else {
      for (let y = 7; y < 17; y += 1) for (let x = 4; x < 14; x += 1) setPixel(x, y);
      for (let y = 16; y < 27; y += 1) for (let x = 27; x < 37; x += 1) setPixel(x, y);
    }

    const inputBefore = Array.from(data);
    const { vectorizeMask } = await import('/src/vectorization/vectorize/vectorizeMask.ts');
    const result = await vectorizeMask({ width, height, data });
    const parsed = new DOMParser().parseFromString(result.svgMarkup, 'image/svg+xml');
    const parserErrors = parsed.querySelectorAll('parsererror').length;

    const renderSvg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    const displayScale = 8;
    renderSvg.setAttribute('width', String(width * displayScale));
    renderSvg.setAttribute('height', String(height * displayScale));
    Object.assign(renderSvg.style, { position: 'fixed', inset: '0 auto auto 0', zIndex: '2147483647' });
    document.body.append(renderSvg);
    const isFilled = (x: number, y: number) => document
      .elementsFromPoint((x + .5) * displayScale, (y + .5) * displayScale)
      .some(element => element.tagName.toLowerCase() === 'path' && renderSvg.contains(element));

    return JSON.stringify({
      svgMarkup: result.svgMarkup,
      pathCount: result.pathCount,
      paths: result.paths,
      viewBox: result.viewBox,
      width: result.width,
      height: result.height,
      diagnostics: result.diagnostics,
      parserErrors,
      inputUnchanged: inputBefore.every((value, index) => value === data[index]),
      samples: {
        background: isFilled(0, 0),
        rectangleCenter: isFilled(20, 16),
        donutRing: isFilled(10, 16),
        donutHole: isFilled(20, 16),
        componentOne: isFilled(9, 12),
        componentTwo: isFilled(32, 21),
        componentGap: isFilled(20, 14),
      },
    });
  }, shape);
  return JSON.parse(serialized) as FixtureResult;
}

test('a binary mask produces normalized real SVG paths without raster content or a white background', async ({ page }) => {
  const result = await vectorizeFixture(page, 'rectangle');
  expect(result.pathCount).toBeGreaterThan(0);
  expect(result.paths.every(path => path.d.length > 0 && path.fill === 'black' && path.fillRule === 'evenodd')).toBe(true);
  expect(result.svgMarkup).toContain('<path');
  expect(result.svgMarkup).not.toContain('<image');
  expect(result.svgMarkup).not.toContain('data:image');
  expect(result.svgMarkup).not.toContain('<rect');
  expect(result.svgMarkup).toContain('fill="black"');
  expect(result.svgMarkup).toContain('fill-rule="evenodd"');
  expect(result.viewBox).toBe('0 0 40 32');
  expect(result.width).toBe(40);
  expect(result.height).toBe(32);
  expect(result.parserErrors).toBe(0);
  expect(result.inputUnchanged).toBe(true);
  expect(result.samples.background).toBe(false);
  expect(result.samples.rectangleCenter).toBe(true);
  expect(result.diagnostics.totalPathDataLength).toBeGreaterThan(0);
  expect(result.diagnostics.commandCount).toBeGreaterThan(0);
  expect(result.diagnostics.svgSizeBytes).toBeGreaterThan(0);
});

test('a component with an internal hole remains transparent with evenodd fill', async ({ page }) => {
  const result = await vectorizeFixture(page, 'donut');
  expect(result.samples.donutRing).toBe(true);
  expect(result.samples.donutHole).toBe(false);
  expect(result.paths.every(path => path.fillRule === 'evenodd')).toBe(true);
  expect(result.paths.some(path => (path.d.match(/[Mm]/g) ?? []).length >= 2)).toBe(true);
});

test('two disconnected components remain visually separated', async ({ page }) => {
  const result = await vectorizeFixture(page, 'components');
  expect(result.pathCount).toBeGreaterThanOrEqual(2);
  expect(result.samples.componentOne).toBe(true);
  expect(result.samples.componentTwo).toBe(true);
  expect(result.samples.componentGap).toBe(false);
});
