import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

type ElementState = { angle: number; radius: number; svgScale: number };
type TouchPoint = { x: number; y: number; radiusX: number; radiusY: number; id: number };

const pointAt = (angle: number, radius: number) => {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 450 + radius * Math.cos(radians), y: 450 + radius * Math.sin(radians) };
};

async function startBlank(page: Page) {
  await page.goto('/');
  await page.locator('.start-over').click();
}

async function elementState(page: Page, selector: string): Promise<ElementState> {
  return page.locator(selector).evaluate(element => {
    const svg = element.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!(element instanceof SVGGElement) || !matrix) throw new Error('Missing editable SVG element');
    return {
      angle: Number(element.dataset.angle),
      radius: Number(element.dataset.radius),
      svgScale: Math.hypot(matrix.a, matrix.b),
    };
  });
}

async function elementScreenPoint(page: Page, selector: string): Promise<TouchPoint> {
  return page.locator(selector).evaluate(element => {
    const svg = element.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!(element instanceof SVGGElement) || !matrix) throw new Error('Missing editable SVG element');
    const angle = (Number(element.dataset.angle) - 90) * Math.PI / 180;
    const radius = Number(element.dataset.radius);
    const point = new DOMPoint(450 + radius * Math.cos(angle), 450 + radius * Math.sin(angle)).matrixTransform(matrix);
    return { x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: 1 };
  });
}

async function dispatchTouch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function deselect(page: Page) {
  await page.locator('.mate').click({ position: { x: 12, y: 12 } });
}

async function smallSelectionDrag(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const before = await elementState(page, selector);
  const sidebarBefore = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  const pointer = await elementScreenPoint(page, selector);

  await dispatchTouch(cdp, 'touchStart', [pointer]);
  await expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
  const sidebarAfter = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);

  await dispatchTouch(cdp, 'touchMove', [{ ...pointer, x: pointer.x - 5 }]);
  await dispatchTouch(cdp, 'touchEnd', []);
  expect(Math.abs(sidebarAfter - sidebarBefore)).toBeGreaterThan(20);
  const after = await elementState(page, selector);

  const beforePoint = pointAt(before.angle, before.radius);
  const afterPoint = pointAt(after.angle, after.radius);
  const screenEquivalent = Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y) * before.svgScale;
  expect(screenEquivalent).toBeGreaterThan(4);
  expect(screenEquivalent).toBeLessThan(6);
  return { before, after };
}

async function addIcon(page: Page) {
  await page.locator('.add-icon').click();
  await page.locator('.icon-search').fill('guitarra');
  await page.locator('.icon-choice').click();
}

async function transformHandleDrag(page: Page, selector: string, handleSelector: string, factor: number, rotation: number, id: number) {
  const cdp = await page.context().newCDPSession(page);
  const points = await page.locator(selector).evaluate((element, parameters) => {
    const handle = element.querySelector(parameters.handleSelector);
    const svg = element.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    const handleMatrix = (handle as SVGGElement | null)?.getScreenCTM();
    if (!(element instanceof SVGGElement) || !matrix || !handleMatrix) throw new Error('Missing transform handle');
    const angle = (Number(element.dataset.angle) - 90) * Math.PI / 180;
    const radius = Number(element.dataset.radius);
    const center = new DOMPoint(450 + radius * Math.cos(angle), 450 + radius * Math.sin(angle)).matrixTransform(matrix);
    const start = new DOMPoint(0, 0).matrixTransform(handleMatrix);
    const deltaX = start.x - center.x;
    const deltaY = start.y - center.y;
    return Array.from({ length: 20 }, (_, index) => {
      const progress = index / 19;
      const scale = 1 + (parameters.factor - 1) * progress;
      const radians = parameters.rotation * Math.PI / 180 * progress;
      return {
        x: center.x + scale * (deltaX * Math.cos(radians) - deltaY * Math.sin(radians)),
        y: center.y + scale * (deltaX * Math.sin(radians) + deltaY * Math.cos(radians)),
        radiusX: 4,
        radiusY: 4,
        id: parameters.id,
      };
    });
  }, { handleSelector, factor, rotation, id });

  await dispatchTouch(cdp, 'touchStart', [points[0]]);
  for (const point of points.slice(1)) await dispatchTouch(cdp, 'touchMove', [point]);
  await dispatchTouch(cdp, 'touchEnd', []);
}

test('unselected mobile text keeps a stable drag reference while selection changes layout', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await deselect(page);

  const { after } = await smallSelectionDrag(page, '.curved-text');
  expect(after.radius).toBeLessThan(389);
});

test('unselected mobile icon keeps a stable drag reference while selection changes layout', async ({ page }) => {
  await startBlank(page);
  await addIcon(page);
  await deselect(page);

  const { before, after } = await smallSelectionDrag(page, '.design-icon');
  expect(Math.abs(after.angle - before.angle)).toBeLessThan(5);
});

test('an already selected element keeps combined angle and radius touch movement', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await page.locator('.curved-text').scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const before = await elementState(page, '.curved-text');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const points = await page.locator('.curved-text').evaluate((element, state) => {
    const svg = element.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    return Array.from({ length: 20 }, (_, index) => {
      const progress = index / 19;
      const angle = state.angle + (125 - state.angle) * progress;
      const radius = state.radius + (365 - state.radius) * progress;
      const radians = (angle - 90) * Math.PI / 180;
      const point = new DOMPoint(450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)).matrixTransform(matrix);
      return { x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: 2 };
    });
  }, before);

  await dispatchTouch(cdp, 'touchStart', [points[0]]);
  for (const point of points.slice(1)) await dispatchTouch(cdp, 'touchMove', [point]);
  await dispatchTouch(cdp, 'touchEnd', []);

  const after = await elementState(page, '.curved-text');
  expect(after.angle).toBeCloseTo(125, 0);
  expect(after.radius).toBeCloseTo(365, 0);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
});

test('touch handles keep text scale and independent icon scale and rotation', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await page.locator('.curved-text').scrollIntoViewIfNeeded();
  await transformHandleDrag(page, '.curved-text', '.transform-handle', 1.2, 0, 4);
  expect(await page.locator('.curved-text').getAttribute('data-scale').then(Number)).toBeGreaterThan(1.15);

  await deselect(page);
  await addIcon(page);
  await page.locator('.design-icon').scrollIntoViewIfNeeded();
  const initialPosition = await elementState(page, '.design-icon');
  await transformHandleDrag(page, '.design-icon', '.scale-handle', 1.2, 0, 5);
  const scaledPosition = await elementState(page, '.design-icon');
  const scaledTransform = await page.locator('.icon-art').getAttribute('transform');
  const scaledSize = Number(scaledTransform?.match(/scale\(([^ ]+)/)?.[1]);
  const scaledRotation = Number(scaledTransform?.match(/rotate\(([^)]+)/)?.[1]);
  expect(scaledSize).toBeGreaterThan(1.15);
  expect(scaledRotation).toBeCloseTo(0, 5);
  expect(scaledPosition.angle).toBeCloseTo(initialPosition.angle, 5);
  expect(scaledPosition.radius).toBeCloseTo(initialPosition.radius, 5);

  await transformHandleDrag(page, '.design-icon', '.rotate-handle', 1, 20, 6);
  const rotatedPosition = await elementState(page, '.design-icon');
  const rotatedTransform = await page.locator('.icon-art').getAttribute('transform');
  const rotatedSize = Number(rotatedTransform?.match(/scale\(([^ ]+)/)?.[1]);
  const rotation = Number(rotatedTransform?.match(/rotate\(([^)]+)/)?.[1]);
  expect(rotatedSize).toBeCloseTo(scaledSize, 5);
  expect(rotation).toBeCloseTo(20, 0);
  expect(rotatedPosition.angle).toBeCloseTo(initialPosition.angle, 5);
  expect(rotatedPosition.radius).toBeCloseTo(initialPosition.radius, 5);
});

test('selection visuals and panel expose only direct or property controls', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await expect(page.locator('.curved-text .text-selection')).toHaveCount(0);
  await expect(page.locator('.curved-text .transform-handle')).toHaveCount(1);
  await expect(page.locator('.curved-text .delete-handle')).toHaveCount(1);
  await expect(page.locator('.design-panel #text-content')).toBeVisible();
  await expect(page.locator('.design-panel #text-font')).toBeVisible();
  await expect(page.locator('.design-panel').getByRole('button', { name: 'Invertir texto' })).toBeVisible();
  await expect(page.locator('.design-panel').getByRole('button', { name: /Eliminar|Listo|Centrar/ })).toHaveCount(0);

  await deselect(page);
  await addIcon(page);
  await expect(page.locator('.design-icon .scale-handle')).toHaveCount(1);
  await expect(page.locator('.design-icon .rotate-handle')).toHaveCount(1);
  await expect(page.locator('.design-icon .delete-handle')).toHaveCount(1);
  await expect(page.locator('.design-panel').getByRole('button', { name: 'Espejar' })).toBeVisible();
  await expect(page.locator('.design-panel').getByRole('button', { name: /Eliminar|Listo|Centrar|Rotar|tamaño/ })).toHaveCount(0);

  const target = await page.locator('.design-icon .scale-handle .handle-target').boundingBox();
  expect(target?.width).toBeCloseTo(44, 0);
  expect(target?.height).toBeCloseTo(44, 0);
});

test('touching an empty part of the editable rim preserves native page scroll', async ({ page }) => {
  await startBlank(page);
  await page.locator('.mate').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(20);
  const center = await page.locator('.mate').evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    const point = new DOMPoint(450, 450).matrixTransform(matrix);
    return { x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: 3 };
  });
  const cdp = await page.context().newCDPSession(page);

  await dispatchTouch(cdp, 'touchStart', [center]);
  for (let index = 1; index <= 8; index += 1) {
    await dispatchTouch(cdp, 'touchMove', [{ ...center, y: center.y + index * 10 }]);
  }
  await dispatchTouch(cdp, 'touchEnd', []);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 10);
});
