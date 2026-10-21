import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { designSummary } from "../src/components/ConfirmPanel";

test("design summary counts texts, icons and graphics", () => {
  expect(designSummary([], [], [])).toEqual([
    { key: "texts", label: "Textos", count: 0 },
    { key: "icons", label: "Íconos", count: 0 },
    { key: "graphics", label: "Imágenes", count: 0 },
  ]);
  const texts = [{ id: "t1" }, { id: "t2" }];
  const icons = [{ id: "i1" }];
  expect(
    designSummary(texts as never[], icons as never[], [] as never[]).map(
      (entry) => entry.count,
    ),
  ).toEqual([2, 1, 0]);
});

type ScreenPoint = { x: number; y: number };

async function elementScreenPoint(
  page: Page,
  selector: string,
): Promise<ScreenPoint> {
  return page.locator(selector).evaluate((element) => {
    if (!(element instanceof SVGGElement))
      throw new Error("Missing editable SVG element");
    const matrix = element.ownerSVGElement?.getScreenCTM();
    if (!matrix) throw new Error("Missing SVG matrix");
    const radians =
      ((Number((element as SVGGElement).dataset.angle) - 90) * Math.PI) / 180;
    const radius = Number((element as SVGGElement).dataset.radius);
    const target = new DOMPoint(
      450 + radius * Math.cos(radians),
      450 + radius * Math.sin(radians),
    ).matrixTransform(matrix);
    return { x: target.x, y: target.y };
  });
}

async function elementPose(page: Page, selector: string) {
  const element = page.locator(selector);
  return {
    angle: await element.getAttribute("data-angle"),
    radius: await element.getAttribute("data-radius"),
  };
}

// Mirrors the proven touch pattern from direct-manipulation.spec.ts: the target
// is scrolled into view BEFORE reading its screen point (sidebar-button clicks
// scroll the SVG out of the viewport and CDP drops touches outside it), and the
// gesture is delivered as several interpolated moves ending exactly at the
// destination. useDirectDrag derives the pose from the absolute pointer
// position, so the final pose is deterministic even if an early move is lost.
async function touchDrag(
  page: Page,
  selector: string,
  delta: ScreenPoint,
  id: number,
) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const from = await elementScreenPoint(page, selector);
  const to = { x: from.x + delta.x, y: from.y + delta.y };
  const point = (position: ScreenPoint) => ({
    ...position,
    radiusX: 4,
    radiusY: 4,
    id,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(from)],
  });
  const steps = 8;
  for (let index = 1; index <= steps; index++) {
    const progress = index / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point({
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        }),
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function addText(page: Page) {
  await page.locator(".add-text").click();
  await expect(page.locator("[data-text-id]")).toBeVisible();
}

async function addIcon(page: Page) {
  await page.locator(".add-icon").click();
  await page.locator(".icon-search").fill("guitarra");
  await page.locator(".icon-choice").click();
  await expect(page.locator("[data-icon-id]")).toBeVisible();
}

async function uploadGraphic(page: Page) {
  await page.locator(".add-image").click();
  await expect(
    page.getByRole("heading", { name: "Subir imagen" }),
  ).toBeVisible();
  await page
    .locator('.upload-dialog input[type="file"]')
    .evaluate(async (input) => {
      const canvas = document.createElement("canvas");
      canvas.width = 12;
      canvas.height = 8;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#111";
      context.fillRect(3, 2, 6, 4);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("PNG unavailable")),
          "image/png",
        ),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "logo.png", { type: "image/png" }));
      (input as HTMLInputElement).files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const dialog = page.locator(".upload-dialog");
  await expect(dialog.locator(".client-option").first()).toBeVisible({
    timeout: 30000,
  });
  await dialog.getByRole("button", { name: "Usar este resultado" }).click();
  await expect(page.locator("[data-graphic-id]")).toBeVisible({
    timeout: 30000,
  });
}

type GeometrySnapshot = {
  text: Record<string, string | null> | null;
  icon: Record<string, string | null> | null;
  graphic: Record<string, string | null> | null;
  lines: string | null;
};

async function captureGeometry(page: Page): Promise<GeometrySnapshot> {
  return page.evaluate(() => {
    const pick = (selector: string, names: string[]) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const record: Record<string, string | null> = {};
      for (const name of names) record[name] = element.getAttribute(name);
      const art = element.querySelector(".icon-art, .text-art");
      if (art) record["art-transform"] = art.getAttribute("transform");
      const artInner = element.querySelector(".icon-art > g");
      if (artInner)
        record["art-inner-transform"] = artInner.getAttribute("transform");
      if (art) {
        const artPaths = Array.from(art.querySelectorAll("path")).map((path) =>
          [path.getAttribute("d"), path.getAttribute("transform")].join("|"),
        );
        if (artPaths.length) record["art-paths"] = artPaths.join(" ");
      }
      // textContent must reflect persistent artwork only. ElementHandle nodes
      // (with their accessible <title> labels) exist solely while editing, so
      // they are stripped from a clone before reading; the clone keeps user
      // text and every persistent attribute untouched.
      const clone = element.cloneNode(true) as Element;
      clone
        .querySelectorAll(".element-handle")
        .forEach((node) => node.remove());
      if (clone.textContent) record["text-content"] = clone.textContent;
      return record;
    };
    const lines = document.querySelector(".decorative-lines");
    return {
      text: pick("[data-text-id]", [
        "transform",
        "data-angle",
        "data-radius",
        "data-scale",
        "data-inverted",
      ]),
      icon: pick("[data-icon-id]", [
        "transform",
        "data-angle",
        "data-radius",
        "data-scale",
        "data-rotation",
        "data-mirrored",
        "data-inverted",
      ]),
      graphic: pick("[data-graphic-id]", [
        "transform",
        "data-angle",
        "data-radius",
        "data-scale",
        "data-rotation",
        "data-mirrored",
        "data-inverted",
      ]),
      lines: lines ? lines.outerHTML : null,
    };
  });
}

async function buildDesign(page: Page) {
  await page.goto("/");
  await addText(page);
  const text = page.locator("[data-text-id]");
  await text.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Invertir texto" }).click();
  // A diagonal drag may move the pose mostly tangentially (angle) or radially
  // (radius) depending on geometry and angular snapping, so the setup check
  // accepts a change in either coordinate. The strict no-drift checks below
  // still compare the full resulting pose exactly across views.
  const textPoseBefore = await elementPose(page, "[data-text-id]");
  await touchDrag(page, "[data-text-id]", { x: 34, y: 30 }, 31);
  const textPoseAfter = await elementPose(page, "[data-text-id]");
  expect(
    textPoseAfter.angle !== textPoseBefore.angle ||
      textPoseAfter.radius !== textPoseBefore.radius,
  ).toBe(true);

  await addIcon(page);
  const icon = page.locator("[data-icon-id]");
  await icon.focus();
  await page.keyboard.press("ArrowRight");
  const iconPoseBefore = await elementPose(page, "[data-icon-id]");
  await touchDrag(page, "[data-icon-id]", { x: -30, y: 26 }, 32);
  const iconPoseAfter = await elementPose(page, "[data-icon-id]");
  expect(
    iconPoseAfter.angle !== iconPoseBefore.angle ||
      iconPoseAfter.radius !== iconPoseBefore.radius,
  ).toBe(true);
  await icon.locator(".element-handle").nth(1).focus();
  await page.keyboard.press("ArrowUp");
  await icon.locator(".element-handle").nth(2).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(".mirror-icon").click();

  await uploadGraphic(page);
  const graphic = page.locator("[data-graphic-id]");
  await graphic.focus();
  await page.keyboard.press("ArrowRight");
  await graphic.locator(".element-handle").nth(1).focus();
  await page.keyboard.press("ArrowUp");

  await page.getByRole("button", { name: "Doble", exact: true }).click();
}

test("design to confirm and back preserves exact geometry without drift", async ({
  page,
}) => {
  await buildDesign(page);
  const before = await captureGeometry(page);
  expect(before.text).not.toBe(null);
  expect(before.icon).not.toBe(null);
  expect(before.graphic).not.toBe(null);

  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  const preview = await captureGeometry(page);
  expect(preview).toEqual(before);
  await expect(page.locator("svg.mate")).toHaveAttribute("role", "img");
  await expect(page.locator(".element-handle")).toHaveCount(0);
  await expect(page.locator(".guides")).toHaveCount(0);
  await expect(page.locator(".selection-controls-layer")).toHaveCount(0);
  await expect(page.locator('svg.mate [role="button"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirmar", exact: true }),
  ).toHaveAttribute("aria-current", "step");

  await page.locator(".back-to-edit").click();
  await expect(page.locator(".add-text")).toBeVisible();
  await expect(page.locator("svg.mate")).toHaveAttribute("role", "group");
  await expect(page.locator(".guides")).toHaveCount(1);
  const editing = await captureGeometry(page);
  expect(editing).toEqual(before);

  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  expect(await captureGeometry(page)).toEqual(before);
  await expect(page.locator(".element-handle")).toHaveCount(0);
});

test("confirm panel summarizes content and confirms locally", async ({
  page,
}) => {
  await buildDesign(page);
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  await expect(page.locator(".confirm-summary")).toContainText("Textos: 1");
  await expect(page.locator(".confirm-summary")).toContainText("Íconos: 1");
  await expect(page.locator(".confirm-summary")).toContainText("Imágenes: 1");
  await page.locator(".confirm-design").click();
  await expect(page.getByRole("status")).toContainText("¡Diseño confirmado!");
  await page.locator(".back-to-edit").click();
  await expect(page.locator("[data-text-id]")).toBeVisible();
  await expect(page.locator("[data-icon-id]")).toBeVisible();
  await expect(page.locator("[data-graphic-id]")).toBeVisible();
});

test("confirm with an empty design shows guidance without a misleading CTA", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("svg.mate")).toBeVisible();
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  await expect(page.getByText("Todavía no agregaste elementos.")).toBeVisible();
  await expect(page.locator(".confirm-design")).toHaveCount(0);
  await page.locator(".back-to-edit").click();
  await expect(page.locator(".add-text")).toBeVisible();
});

// Each line variant runs as its own test from a fresh page load, so every
// variant starts in an explicit deterministic Diseño state instead of
// inheriting the navigation state left by the previous variant. Splitting the
// former loop also gives each variant its own 30s budget instead of sharing
// one across three Diseño → Confirmar → Diseño round trips.
const lineVariants = [
  { name: "Simple", expected: 1 },
  { name: "Doble", expected: 2 },
  { name: "No", expected: 0 },
] as const;

for (const { name, expected } of lineVariants) {
  test(`circular lines (${name}) render identically in both views`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Diseño", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.locator(".add-text")).toBeVisible();
    // Minimal content so the confirm flow is available in every variant: line
    // style and content existence are separate concepts, and `No` means "no
    // line elements", never "empty design".
    await addText(page);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator(".decorative-lines circle")).toHaveCount(
      expected,
    );
    // Never evaluate an element that may not exist: locator.evaluate waits
    // for a match and would burn the whole test budget when lines are `No`.
    const linesPresent = await page.locator(".decorative-lines").count();
    const designMarkup =
      linesPresent > 0
        ? await page
            .locator(".decorative-lines")
            .evaluate((element) => element.outerHTML)
        : null;
    const confirm = page.locator(".design-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Tu diseño" }),
    ).toBeVisible();
    await expect(page.locator(".decorative-lines circle")).toHaveCount(
      expected,
    );
    if (designMarkup) {
      expect(
        await page
          .locator(".decorative-lines")
          .evaluate((element) => element.outerHTML),
      ).toBe(designMarkup);
    } else {
      await expect(page.locator(".decorative-lines")).toHaveCount(0);
    }
    await page.locator(".back-to-edit").click();
    await expect(page.locator(".add-text")).toBeVisible();
    await expect(page.locator(".decorative-lines circle")).toHaveCount(
      expected,
    );
    if (designMarkup) {
      expect(
        await page
          .locator(".decorative-lines")
          .evaluate((element) => element.outerHTML),
      ).toBe(designMarkup);
    }
  });
}

test("confirm view stays usable on a wide viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await buildDesign(page);
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  await expect(page.locator("svg.mate")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
