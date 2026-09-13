import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

type ElementState = { angle: number; radius: number; scale: number; rotation: number; svgScale: number };
type TouchPoint = { x: number; y: number; radiusX: number; radiusY: number; id: number };

async function startBlank(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Diseño' })).toHaveAttribute('aria-current', 'step');
}

async function addIcon(page: Page) {
  await page.locator('.add-icon').click();
  await page.locator('.icon-search').fill('guitarra');
  await page.locator('.icon-choice').click();
}

async function elementState(page: Page, selector: string): Promise<ElementState> {
  return page.locator(selector).evaluate(element => {
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!(element instanceof SVGGElement) || !matrix) throw new Error('Missing editable SVG element');
    return {
      angle: Number(element.dataset.angle),
      radius: Number(element.dataset.radius),
      scale: Number(element.dataset.scale ?? 1),
      rotation: Number(element.dataset.rotation ?? 0),
      svgScale: Math.hypot(matrix.a, matrix.b),
    };
  });
}

async function elementScreenPoint(page: Page, selector: string, id = 1): Promise<TouchPoint> {
  return page.locator(selector).evaluate((element, pointerId) => {
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!(element instanceof SVGGElement) || !matrix) throw new Error('Missing editable SVG element');
    const radians = (Number(element.dataset.angle) - 90) * Math.PI / 180;
    const radius = Number(element.dataset.radius);
    const point = new DOMPoint(450 + radius * Math.cos(radians), 450 + radius * Math.sin(radians)).matrixTransform(matrix);
    return { x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: pointerId };
  }, id);
}

async function screenPointAt(page: Page, selector: string, angle: number, radius: number) {
  return page.locator(selector).evaluate((element, polar) => {
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    const radians = (polar.angle - 90) * Math.PI / 180;
    const point = new DOMPoint(450 + polar.radius * Math.cos(radians), 450 + polar.radius * Math.sin(radians)).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  }, { angle, radius });
}

async function dispatchTouch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function dragElementTouch(page: Page, selector: string, angle: number, radius: number, id = 1) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const startState = await elementState(page, selector);
  const start = await elementScreenPoint(page, selector, id);
  const steps = await Promise.all(Array.from({ length: 16 }, (_, index) => {
    const progress = (index + 1) / 16;
    return screenPointAt(page, selector,
      startState.angle + (angle - startState.angle) * progress,
      startState.radius + (radius - startState.radius) * progress);
  }));
  await dispatchTouch(cdp, 'touchStart', [start]);
  for (const point of steps) await dispatchTouch(cdp, 'touchMove', [{ ...point, radiusX: 4, radiusY: 4, id }]);
  await dispatchTouch(cdp, 'touchEnd', []);
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
  const center = await page.locator('.mate').evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('Missing SVG matrix');
    const point = new DOMPoint(450, 450).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  const distance = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  const moved = { ...pointer, x: pointer.x + 5 * (pointer.x - center.x) / distance, y: pointer.y + 5 * (pointer.y - center.y) / distance };

  await dispatchTouch(cdp, 'touchStart', [pointer]);
  await expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
  const sidebarAfter = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  await dispatchTouch(cdp, 'touchMove', [moved]);
  await dispatchTouch(cdp, 'touchEnd', []);

  expect(Math.abs(sidebarAfter - sidebarBefore)).toBeLessThan(2);
  const after = await elementState(page, selector);
  expect(Math.abs(after.radius - before.radius) * before.svgScale).toBeGreaterThan(4);
  expect(Math.abs(after.radius - before.radius) * before.svgScale).toBeLessThan(6);
  return { before, after };
}

async function handlePath(page: Page, selector: string, handleSelector: string, factor: number, rotation: number, id: number) {
  return page.locator(selector).evaluate((element, parameters) => {
    const handle = element.querySelector(parameters.handleSelector);
    const matrix = element.ownerSVGElement?.getScreenCTM();
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
}

async function transformHandleTouch(page: Page, selector: string, handleSelector: string, factor: number, rotation: number, id: number) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const points = await handlePath(page, selector, handleSelector, factor, rotation, id);
  await dispatchTouch(cdp, 'touchStart', [points[0]]);
  for (const point of points.slice(1)) await dispatchTouch(cdp, 'touchMove', [point]);
  await dispatchTouch(cdp, 'touchEnd', []);
}

async function transformHandleMouse(page: Page, selector: string, handleSelector: string, factor: number, rotation: number) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const points = await handlePath(page, selector, handleSelector, factor, rotation, 1);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
}

test('starts directly in an empty Design step without Templates', async ({ page }) => {
  await startBlank(page);
  await expect(page.getByRole('navigation', { name: 'Pasos del personalizador' })).not.toContainText('Plantillas');
  await expect(page.locator('.curved-text')).toHaveCount(0);
  await expect(page.locator('.design-icon')).toHaveCount(0);
});

test('creates text and icon from an empty design', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await expect(page.locator('.curved-text')).toHaveCount(1);
  await addIcon(page);
  await expect(page.locator('.design-icon')).toHaveCount(1);
});

test('text and icon have permissive radial limits independent from scale', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await dragElementTouch(page, '.curved-text', 0, 290, 10);
  expect((await elementState(page, '.curved-text')).radius).toBeCloseTo(305, 0);
  await transformHandleTouch(page, '.curved-text', '.transform-handle', 12, 0, 11);
  let text = await elementState(page, '.curved-text');
  expect(text.scale).toBeCloseTo(3, 2);
  expect(text.radius).toBeCloseTo(305, 0);
  await dragElementTouch(page, '.curved-text', 0, 430, 12);
  expect((await elementState(page, '.curved-text')).radius).toBeCloseTo(410, 0);

  await addIcon(page);
  await dragElementTouch(page, '.design-icon', 90, 290, 13);
  expect((await elementState(page, '.design-icon')).radius).toBeCloseTo(305, 0);
  await transformHandleTouch(page, '.design-icon', '.scale-handle', 4, 0, 14);
  const icon = await elementState(page, '.design-icon');
  expect(icon.scale).toBeCloseTo(3, 2);
  expect(icon.radius).toBeCloseTo(305, 0);
  await dragElementTouch(page, '.design-icon', 90, 430, 15);
  expect((await elementState(page, '.design-icon')).radius).toBeCloseTo(410, 0);
});

test('angular snap enters at 3 degrees, holds to 6, then releases', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await dragElementTouch(page, '.curved-text', 47, 370, 20);
  expect((await elementState(page, '.curved-text')).angle).toBeCloseTo(45, 5);
  await dragElementTouch(page, '.curved-text', 50, 370, 21);
  expect((await elementState(page, '.curved-text')).angle).toBeCloseTo(45, 5);
  await dragElementTouch(page, '.curved-text', 52, 370, 22);
  expect((await elementState(page, '.curved-text')).angle).toBeCloseTo(52, 1);
});

test('angle stays free outside the snap tolerance', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await dragElementTouch(page, '.curved-text', 35, 370, 23);
  expect((await elementState(page, '.curved-text')).angle).toBeCloseTo(35, 1);
});

test('text can snap radially and angularly at the same guide intersection', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await dragElementTouch(page, '.curved-text', 47, 363, 24);
  const snapped = await elementState(page, '.curved-text');
  expect(snapped.angle).toBeCloseTo(45, 5);
  expect(snapped.radius).toBe(360);
});

test('icon snaps to the dotted circular guide', async ({ page }) => {
  await startBlank(page);
  await addIcon(page);
  await dragElementTouch(page, '.design-icon', 90, 365, 25);
  expect((await elementState(page, '.design-icon')).radius).toBe(360);
});

test('radial snap stays stable inside its release band and returns to free movement outside it', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await dragElementTouch(page, '.curved-text', 20, 340, 26);
  expect((await elementState(page, '.curved-text')).radius).toBeCloseTo(340, 1);
  await dragElementTouch(page, '.curved-text', 20, 364, 27);
  expect((await elementState(page, '.curved-text')).radius).toBe(360);
  await dragElementTouch(page, '.curved-text', 20, 370, 28);
  expect((await elementState(page, '.curved-text')).radius).toBe(360);
  await dragElementTouch(page, '.curved-text', 20, 385, 29);
  expect((await elementState(page, '.curved-text')).radius).toBeCloseTo(385, 1);
});

test('icon mirror, vertical invert and initial angle affect only their own properties', async ({ page }) => {
  await startBlank(page);
  await addIcon(page);
  await page.locator('.mirror-icon').click();
  await page.locator('.invert-icon').click();
  await expect(page.locator('.design-icon')).toHaveAttribute('data-mirrored', 'true');
  await expect(page.locator('.design-icon')).toHaveAttribute('data-inverted', 'true');

  await dragElementTouch(page, '.design-icon', 30, 395, 30);
  await transformHandleTouch(page, '.design-icon', '.scale-handle', 1.35, 0, 31);
  await transformHandleTouch(page, '.design-icon', '.rotate-handle', 1, 24, 32);
  const before = await elementState(page, '.design-icon');
  expect(before.rotation).toBeCloseTo(24, 0);
  await page.locator('.reset-icon-angle').click();
  const after = await elementState(page, '.design-icon');
  expect(after.rotation).toBe(0);
  expect(after.angle).toBeCloseTo(before.angle, 5);
  expect(after.radius).toBeCloseTo(before.radius, 5);
  expect(after.scale).toBeCloseTo(before.scale, 5);
});

test('panel keeps a stable structure and decorative lines remain separate from guides', async ({ page }) => {
  await startBlank(page);
  const before = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  await expect(page.locator('#text-content')).toBeDisabled();
  await expect(page.locator('.mirror-icon')).toBeDisabled();
  await page.locator('.add-text').click();
  await expect(page.locator('#text-content')).toBeEnabled();
  const selected = await page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(selected - before)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Simple', exact: true }).click();
  await expect(page.locator('.decorative-lines circle')).toHaveCount(1);
  await expect(page.locator('.guides')).toHaveCount(1);
  await page.getByRole('button', { name: 'Doble', exact: true }).click();
  await expect(page.locator('.decorative-lines circle')).toHaveCount(2);
});

test('decorative lines are knocked out behind text and scaled or rotated icons', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await page.getByRole('button', { name: 'Simple', exact: true }).click();
  await expect(page.locator('.decorative-lines')).toHaveAttribute('mask', 'url(#decorative-lines-knockout)');
  await page.getByRole('button', { name: 'Doble', exact: true }).click();
  await expect(page.locator('#decorative-lines-knockout use')).toHaveCount(1);
  const textHalo = page.locator(`[id^="text-knockout-"]`);
  expect(Number(await textHalo.getAttribute('stroke-width'))).toBeGreaterThan(40);
  await deselect(page);
  await expect(page.locator('#decorative-lines-knockout use')).toHaveCount(1);

  await addIcon(page);
  await expect(page.locator('#decorative-lines-knockout use')).toHaveCount(2);
  const iconHalo = page.locator(`[id^="icon-knockout-"]`);
  const initialRadius = Number(await iconHalo.getAttribute('r'));
  await deselect(page);
  await expect(page.locator('#decorative-lines-knockout use')).toHaveCount(2);
  await page.locator('.design-icon').click();
  await transformHandleTouch(page, '.design-icon', '.scale-handle', 1.5, 0, 70);
  await transformHandleTouch(page, '.design-icon', '.rotate-handle', 1, 30, 71);
  expect(Number(await iconHalo.getAttribute('r'))).toBeGreaterThan(initialRadius);
  await expect(page.locator('.design-icon')).toHaveAttribute('data-rotation', /2[89]|30|31/);
});

test('unselected mobile text selects without a layout jump and follows a 5px touch', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await deselect(page);
  const { after } = await smallSelectionDrag(page, '.curved-text');
  expect(after.radius).toBeLessThanOrEqual(410);
});

test('unselected mobile icon selects without a layout jump and follows a 5px touch', async ({ page }) => {
  await startBlank(page);
  await addIcon(page);
  await dragElementTouch(page, '.design-icon', 110, 385, 39);
  await deselect(page);
  const { before, after } = await smallSelectionDrag(page, '.design-icon');
  expect(Math.abs(after.angle - before.angle)).toBeLessThan(1);
});

test('an already selected element keeps combined angle and radius touch movement', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await page.locator('.curved-text').scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await dragElementTouch(page, '.curved-text', 125, 380, 40);
  const after = await elementState(page, '.curved-text');
  expect(after.angle).toBeCloseTo(125, 1);
  expect(after.radius).toBeCloseTo(380, 1);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0);
});

test('touch scaling uses the expanded safety range and icon rotation stays independent', async ({ page }) => {
  await startBlank(page);
  await page.locator('.add-text').click();
  await transformHandleTouch(page, '.curved-text', '.transform-handle', .1, 0, 50);
  expect((await elementState(page, '.curved-text')).scale).toBeCloseTo(.3, 2);
  await transformHandleTouch(page, '.curved-text', '.transform-handle', 20, 0, 51);
  expect((await elementState(page, '.curved-text')).scale).toBeCloseTo(3, 2);

  await addIcon(page);
  const position = await elementState(page, '.design-icon');
  await transformHandleTouch(page, '.design-icon', '.scale-handle', .05, 0, 52);
  expect((await elementState(page, '.design-icon')).scale).toBeCloseTo(.25, 2);
  await transformHandleTouch(page, '.design-icon', '.scale-handle', 20, 0, 53);
  const scaled = await elementState(page, '.design-icon');
  expect(scaled.scale).toBeCloseTo(3, 2);
  expect(scaled.rotation).toBe(0);
  await transformHandleTouch(page, '.design-icon', '.rotate-handle', 1, 20, 54);
  const rotated = await elementState(page, '.design-icon');
  expect(rotated.scale).toBeCloseTo(scaled.scale, 5);
  expect(rotated.rotation).toBeCloseTo(20, 0);
  expect(rotated.angle).toBeCloseTo(position.angle, 5);
  expect(rotated.radius).toBeCloseTo(position.radius, 5);
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
    return { x: point.x, y: point.y, radiusX: 4, radiusY: 4, id: 60 };
  });
  const cdp = await page.context().newCDPSession(page);
  await dispatchTouch(cdp, 'touchStart', [center]);
  for (let index = 1; index <= 8; index += 1) await dispatchTouch(cdp, 'touchMove', [{ ...center, y: center.y + index * 10 }]);
  await dispatchTouch(cdp, 'touchEnd', []);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before - 10);
});

test.describe('desktop regression', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('selection, no initial jump, direct drag, scale and icon rotation work with mouse', async ({ page }) => {
    await startBlank(page);
    await page.locator('.add-text').click();
    await deselect(page);
    const textPoint = await elementScreenPoint(page, '.curved-text');
    const before = await elementState(page, '.curved-text');
    await page.mouse.move(textPoint.x, textPoint.y);
    await page.mouse.down();
    await page.mouse.up();
    const afterClick = await elementState(page, '.curved-text');
    expect(afterClick.angle).toBeCloseTo(before.angle, 5);
    expect(afterClick.radius).toBeCloseTo(before.radius, 5);
    await expect(page.locator('.curved-text')).toHaveAttribute('aria-pressed', 'true');

    const target = await screenPointAt(page, '.curved-text', 32, 392);
    await page.mouse.move(textPoint.x, textPoint.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 16 });
    await page.mouse.up();
    const dragged = await elementState(page, '.curved-text');
    expect(dragged.angle).toBeCloseTo(32, 1);
    expect(dragged.radius).toBeCloseTo(392, 1);
    await transformHandleMouse(page, '.curved-text', '.transform-handle', 1.5, 0);
    expect((await elementState(page, '.curved-text')).scale).toBeGreaterThan(1.4);

    await addIcon(page);
    await transformHandleMouse(page, '.design-icon', '.scale-handle', 1.4, 0);
    const scaled = await elementState(page, '.design-icon');
    await transformHandleMouse(page, '.design-icon', '.rotate-handle', 1, 18);
    const rotated = await elementState(page, '.design-icon');
    expect(rotated.scale).toBeCloseTo(scaled.scale, 5);
    expect(rotated.rotation).toBeCloseTo(18, 0);
  });
});
