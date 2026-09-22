import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { artTransformForBounds, artworkBounds, normalizeUploadedGraphic, parsePathBounds, parseSvgTransform, uploadedGraphicFromVectorized } from '../src/components/UploadedGraphic';
import { ICON_CENTER } from '../src/components/IconElement';
import type { VectorizedResult } from '../src/vectorization/vectorize/vectorizeMask';

const vectorized = (paths: Array<{ d: string; transform?: string }>, width = 40, height = 30): VectorizedResult => ({
  svgMarkup: '<svg></svg>',
  paths: paths.map(path => ({ ...path, fill: 'black', fillRule: 'evenodd' as const })),
  viewBox: `0 0 ${width} ${height}`,
  width,
  height,
  pathCount: paths.length,
  diagnostics: { pathCount: paths.length, totalPathDataLength: 10, commandCount: 4, svgSizeBytes: 60, elapsedMilliseconds: 3, warnings: [] },
});

test('uploaded graphic builder preserves vector paths and sets sane defaults', () => {
  const first = uploadedGraphicFromVectorized(vectorized([{ d: 'M0 0H10V10Z' }, { d: 'M2 2H8V8Z', transform: 'translate(1 1)' }]), 90);
  const second = uploadedGraphicFromVectorized(vectorized([{ d: 'M0 0H10V10Z' }]), 90);
  expect(first.id).not.toBe(second.id);
  expect(first.type).toBe('uploaded-graphic');
  expect(first.paths).toEqual([{ d: 'M0 0H10V10Z', transform: undefined }, { d: 'M2 2H8V8Z', transform: 'translate(1 1)' }]);
  expect(first.angle).toBe(90);
  expect(first.radius).toBe(ICON_CENTER);
  expect(first.scale).toBe(1);
  expect(first.rotation).toBe(0);
  expect(first.mirrored).toBe(false);
  expect(first.inverted).toBe(false);
  expect(first.sourceWidth).toBe(40);
  expect(first.sourceHeight).toBe(30);
});

test('uploaded graphic normalization clamps scale and radius like icons', () => {
  const base = uploadedGraphicFromVectorized(vectorized([{ d: 'M0 0H10V10Z' }]), 0);
  expect(normalizeUploadedGraphic({ ...base, scale: 99 }).scale).toBe(3);
  expect(normalizeUploadedGraphic({ ...base, scale: -2 }).scale).toBe(.25);
  expect(normalizeUploadedGraphic({ ...base, radius: 9999 }).radius).toBe(410);
  expect(normalizeUploadedGraphic({ ...base, radius: 0 }).radius).toBe(305);
  expect(normalizeUploadedGraphic({ ...base, scale: Number.NaN }).scale).toBe(1);
});

test('path bounds measure raw geometry including relative commands and controls', () => {
  expect(parsePathBounds('M0 0H10V10H0Z')).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  expect(parsePathBounds('m5 5l10 0l0 10z')).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  expect(parsePathBounds('M0 0C10 0 10 20 20 20')).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  expect(parsePathBounds('')).toBe(null);
});

test('artwork bounds union path geometry through per-path transforms', () => {
  // Mirrors real VTracer output: local path box positioned by translate.
  const box = artworkBounds([{ d: 'M0 0H220V100H0Z', transform: 'translate(40,30)' }]);
  expect(box).toEqual({ x: 40, y: 30, width: 220, height: 100 });
  const multi = artworkBounds([
    { d: 'M0 0H10V10H0Z' },
    { d: 'M0 0H10V10H0Z', transform: 'translate(100,50)' },
  ]);
  expect(multi).toEqual({ x: 0, y: 0, width: 110, height: 60 });
  expect(artworkBounds([])).toBe(null);
  expect(parseSvgTransform(undefined)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  expect(parseSvgTransform('translate(40,30)')).toMatchObject({ e: 40, f: 30 });
});

test('normalization gives every source the same visual size with aspect and center preserved', () => {
  const check = (box: { x: number; y: number; width: number; height: number }, longest: number, aspect: number) => {
    const transform = artTransformForBounds(box);
    expect(transform.scale).toBeCloseTo(64 / longest, 10);
    const mapped = (x: number, y: number) => ({ x: transform.scale * x + transform.translateX, y: transform.scale * y + transform.translateY });
    const center = mapped(box.x + box.width / 2, box.y + box.height / 2);
    expect(center.x).toBeCloseTo(0, 8);
    expect(center.y).toBeCloseTo(0, 8);
    const corner = mapped(box.x + box.width, box.y + box.height);
    const size = { width: Math.abs(corner.x - mapped(box.x, box.y).x), height: Math.abs(corner.y - mapped(box.x, box.y).y) };
    expect(Math.max(size.width, size.height)).toBeCloseTo(64, 8);
    expect(size.width / size.height).toBeCloseTo(aspect, 8);
    return size;
  };
  // A) square 500x500, B) wide 2000x300, C) tall 300x2000 (offset, like VTracer output)
  check({ x: 0, y: 0, width: 500, height: 500 }, 500, 1);
  check({ x: 0, y: 0, width: 2000, height: 300 }, 2000, 2000 / 300);
  check({ x: 40, y: 30, width: 300, height: 2000 }, 2000, 300 / 2000);
  // D) same geometry at two resolutions normalizes identically
  const small = check({ x: 0, y: 0, width: 100, height: 100 }, 100, 1);
  const large = check({ x: 0, y: 0, width: 800, height: 800 }, 800, 1);
  expect(small.width).toBeCloseTo(large.width, 8);
  expect(small.height).toBeCloseTo(large.height, 8);
});

test('builder measures true artwork bounds instead of the source frame', () => {
  const result = uploadedGraphicFromVectorized(vectorized([{ d: 'M0 0H220V100H0Z', transform: 'translate(40,30)' }], 300, 160), 90);
  expect(result.artBounds).toEqual({ x: 40, y: 30, width: 220, height: 100 });
  const empty = uploadedGraphicFromVectorized(vectorized([], 300, 160), 0);
  expect(empty.artBounds).toEqual({ x: 0, y: 0, width: 300, height: 160 });
});

async function openUploadDialog(page: Page) {
  await page.goto('/');
  await page.locator('.add-image').click();
  await expect(page.getByRole('heading', { name: 'Subir imagen' })).toBeVisible();
}

async function uploadCanvasPng(page: Page, width: number, height: number, draw: string, name: string, mimeType: string) {
  await page.locator('.upload-dialog input[type="file"]').evaluate(async (input, parameters) => {
    const canvas = document.createElement('canvas');
    canvas.width = parameters.width;
    canvas.height = parameters.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.clearRect(0, 0, canvas.width, canvas.height);
    const drawImage = new Function('context', 'canvas', parameters.draw) as (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void;
    drawImage(context, canvas);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG unavailable')), parameters.mimeType));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], parameters.name, { type: parameters.mimeType }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { width, height, draw, name, mimeType });
}

const darkRect = `context.fillStyle = '#111'; context.fillRect(3, 2, 6, 4);`;
const whitePixel = `context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1);`;

async function uploadDarkLogo(page: Page) {
  await openUploadDialog(page);
  await uploadCanvasPng(page, 12, 8, darkRect, 'logo.png', 'image/png');
  const dialog = page.locator('.upload-dialog');
  await expect(dialog.getByText('Preparando tu diseño…').or(dialog.locator('.client-option').first())).toBeVisible({ timeout: 30000 });
  await expect(dialog.locator('.client-option').first()).toBeVisible({ timeout: 30000 });
}

test('upload button is visible and the file selector accepts PNG, JPEG and WebP', async ({ page }) => {
  await openUploadDialog(page);
  await expect(page.locator('.upload-dialog input[type="file"]')).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
});

test('a valid upload offers one to three client results without technical names', async ({ page }) => {
  await uploadDarkLogo(page);
  const options = page.locator('.upload-dialog .client-option');
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  await expect(options.first()).toContainText('Recomendada');
  for (const technical of ['Alpha', 'Luminancia', 'Background-aware', 'Edge', 'Auto Graphic', 'Photo engraving', 'Stencil', 'Score']) {
    await expect(page.locator('.upload-dialog').getByText(technical, { exact: true })).toHaveCount(0);
  }
});

test('confirming a result vectorizes the selected mask and inserts a vector element', async ({ page }) => {
  await uploadDarkLogo(page);
  const options = page.locator('.upload-dialog .client-option');
  const count = await options.count();
  await options.nth(Math.min(1, count - 1)).click();
  await page.locator('.upload-dialog').getByRole('button', { name: 'Usar este resultado' }).click();
  const graphicPending = page.locator('[data-graphic-id]');
  await expect(page.locator('.upload-dialog').getByText('Preparando imagen para usar…').or(graphicPending)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.upload-dialog')).toBeHidden();
  const graphic = page.locator('[data-graphic-id]');
  await expect(graphic).toBeVisible();
  expect(await graphic.locator('path').count()).toBeGreaterThan(0);
  await expect(graphic.locator('rect')).toHaveCount(0);
  expect(await graphic.locator('.icon-art > g').first().getAttribute('fill-rule')).toBe('evenodd');
  expect(await graphic.getAttribute('data-scale')).toBe('1');
  // Artwork must be centered on its anchor at a usable size (regression: it used to render microscopic and off-center).
  // Measured on .icon-art so the symmetric handles cannot mask a displaced drawing.
  const box = await graphic.locator('.icon-art').boundingBox();
  expect(box).not.toBe(null);
  expect(box!.width).toBeGreaterThan(16);
  const anchor = await graphic.evaluate(element => {
    if (!(element instanceof SVGGElement)) throw new Error('Missing editable SVG element');
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    const radians = (Number(element.dataset.angle) - 90) * Math.PI / 180;
    const radius = Number(element.dataset.radius);
    const target = new DOMPoint(450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)).matrixTransform(matrix);
    return { x: target.x, y: target.y };
  });
  expect(Math.abs(box!.x + box!.width / 2 - anchor.x)).toBeLessThan(40);
  expect(Math.abs(box!.y + box!.height / 2 - anchor.y)).toBeLessThan(40);
});

test('results dialog shows full previews with primary CTA first and no horizontal overflow', async ({ page }) => {
  await uploadDarkLogo(page);
  const dialog = page.locator('.upload-dialog');
  await expect(dialog.getByText('Elegí el resultado que más te guste')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Usar este resultado' })).toBeVisible();
  await expect(dialog.locator('.upload-secondary')).toBeVisible();
  await expect(dialog.locator('.upload-file-button')).toHaveCount(0);
  const preview = dialog.locator('.upload-result-preview').first();
  expect(await preview.evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');
  expect(await preview.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an inserted graphic can be selected, moved, scaled, rotated, mirrored, inverted and deleted', async ({ page }) => {
  await uploadDarkLogo(page);
  await page.locator('.upload-dialog').getByRole('button', { name: 'Usar este resultado' }).click();
  const graphic = page.locator('[data-graphic-id]');
  await expect(graphic).toBeVisible();

  await graphic.click();
  await expect(graphic).toHaveAttribute('aria-pressed', 'true');
  const angleBefore = Number(await graphic.getAttribute('data-angle'));
  await graphic.focus();
  await page.keyboard.press('ArrowRight');
  expect(Number(await graphic.getAttribute('data-angle'))).toBe(angleBefore + 5);

  const scaleHandle = graphic.locator('.element-handle').nth(1);
  await scaleHandle.focus();
  await page.keyboard.press('ArrowUp');
  expect(Number(await graphic.getAttribute('data-scale'))).toBeCloseTo(1.05, 5);

  const rotateHandle = graphic.locator('.element-handle').nth(2);
  await rotateHandle.focus();
  await page.keyboard.press('ArrowRight');
  expect(Number(await graphic.getAttribute('data-rotation'))).toBe(5);
  await page.locator('.reset-icon-angle').click();
  expect(Number(await graphic.getAttribute('data-rotation'))).toBe(0);

  await page.locator('.mirror-icon').click();
  await expect(graphic).toHaveAttribute('data-mirrored', 'true');
  await page.locator('.invert-icon').click();
  await expect(graphic).toHaveAttribute('data-inverted', 'true');

  await graphic.focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-graphic-id]')).toHaveCount(0);
});

test('switching selection does not remove the inserted graphic', async ({ page }) => {
  await uploadDarkLogo(page);
  await page.locator('.upload-dialog').getByRole('button', { name: 'Usar este resultado' }).click();
  await expect(page.locator('[data-graphic-id]')).toBeVisible();
  await page.locator('.add-text').click();
  await expect(page.locator('[data-graphic-id]')).toHaveCount(1);
  await page.locator('[data-graphic-id]').click();
  await expect(page.locator('[data-graphic-id]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mirror-icon')).toBeEnabled();
});

test('touch selection on a graphic keeps the panel layout stable', async ({ page }) => {
  await uploadDarkLogo(page);
  await page.locator('.upload-dialog').getByRole('button', { name: 'Usar este resultado' }).click();
  const graphic = page.locator('[data-graphic-id]');
  await expect(graphic).toBeVisible();
  const sidebarBefore = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  const cdp = await page.context().newCDPSession(page);
  const point = await graphic.evaluate(element => {
    if (!(element instanceof SVGGElement)) throw new Error('Missing editable SVG element');
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    const radians = (Number(element.dataset.angle) - 90) * Math.PI / 180;
    const radius = Number(element.dataset.radius);
    const target = new DOMPoint(450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)).matrixTransform(matrix);
    return { x: target.x, y: target.y, radiusX: 4, radiusY: 4, id: 7 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(graphic).toHaveAttribute('aria-pressed', 'true');
  const sidebarAfter = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(sidebarAfter - sidebarBefore)).toBeLessThan(2);
});

test('an unsupported file shows a friendly preparation error', async ({ page }) => {
  await openUploadDialog(page);
  await page.locator('.upload-dialog input[type="file"]').evaluate(input => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['hola'], 'nota.txt', { type: 'text/plain' }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('.upload-dialog').getByRole('alert')).toContainText('No pudimos preparar esta imagen. Probá con otra.');
  await expect(page.locator('[data-graphic-id]')).toHaveCount(0);
});

test('an image without any viable candidate shows a friendly preparation error', async ({ page }) => {
  await openUploadDialog(page);
  await uploadCanvasPng(page, 1, 1, whitePixel, 'blanco.png', 'image/png');
  await expect(page.locator('.upload-dialog').getByRole('alert')).toContainText('No pudimos preparar esta imagen. Probá con otra.');
  await expect(page.locator('[data-graphic-id]')).toHaveCount(0);
});

test('a vectorization failure shows a friendly error and keeps the dialog usable', async ({ page }) => {
  await page.route('**/*wasm*', route => route.abort());
  await uploadDarkLogo(page);
  await page.locator('.upload-dialog').getByRole('button', { name: 'Usar este resultado' }).click();
  await expect(page.locator('.upload-dialog').getByRole('alert')).toContainText('No pudimos vectorizar el resultado.');
  await expect(page.locator('.upload-dialog .client-option').first()).toBeVisible();
  await expect(page.locator('[data-graphic-id]')).toHaveCount(0);
});
