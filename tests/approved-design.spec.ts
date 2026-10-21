import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SVG_NS = "http://www.w3.org/2000/svg";
const MESSI_PATH = fileURLToPath(
  new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url),
);

const messiSource = () => readFileSync(MESSI_PATH, "utf8");
const messiHash = () =>
  createHash("sha256").update(readFileSync(MESSI_PATH)).digest("hex");

type SeedItem = {
  name: string;
  category: string;
  enabled: boolean;
  svg: string;
};

const gradientSvg = (paint: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 100 50" width="100" height="50">` +
  `<defs><linearGradient id="g1"><stop offset="0" stop-color="${paint}"/>` +
  `<stop offset="1" stop-color="#000000"/></linearGradient>` +
  `<clipPath id="c1"><rect x="0" y="0" width="100" height="50"/></clipPath></defs>` +
  `<rect x="5" y="5" width="90" height="40" fill="url(#g1)" clip-path="url(#c1)"/></svg>`;

const SEED_A: SeedItem = {
  name: "Guarda Clásica",
  category: "Guardas",
  enabled: true,
  svg: gradientSvg("#ff0000"),
};
const SEED_B: SeedItem = {
  name: "Messi Silueta",
  category: "Deportes",
  enabled: true,
  svg: gradientSvg("#00aa00"),
};
const SEED_OFF: SeedItem = {
  name: "Borrador Oculto",
  category: "Guardas",
  enabled: false,
  svg: `<svg xmlns="${SVG_NS}" viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="16"/></svg>`,
};

async function seedLibrary(page: Page, items: SeedItem[]) {
  await page.goto("/admin-lab");
  await page.evaluate(async (seed) => {
    const imp = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    for (const item of seed) {
      const admitted = imp.importSvgAsset(item.svg);
      if (!admitted.ok)
        throw new Error(`seed admit failed: ${admitted.reason}`);
      const saved = await store.saveNew({
        name: item.name,
        category: item.category,
        asset: admitted.asset,
      });
      if (!saved.ok)
        throw new Error(`seed save failed: ${saved.error.message}`);
      if (!item.enabled) await store.toggleDesign(saved.design.id);
    }
  }, items);
  await page.goto("/");
}

async function openDrawer(page: Page) {
  await page.goto("/");
  await expect(page.locator("svg.mate")).toBeVisible();
  await page.locator(".add-approved").click();
  await expect(page.locator(".approved-drawer")).toBeVisible();
}

async function chooseByName(page: Page, name: string) {
  const before = await page.locator("[data-approved-id]").count();
  await page.locator(".approved-drawer").getByRole("button", { name }).click();
  await expect(page.locator("[data-approved-id]")).toHaveCount(before + 1);
}

async function pose(page: Page, selector = "[data-approved-id]") {
  const el = page.locator(selector).first();
  return {
    angle: await el.getAttribute("data-angle"),
    radius: await el.getAttribute("data-radius"),
    scale: await el.getAttribute("data-scale"),
    rotation: await el.getAttribute("data-rotation"),
    mirrored: await el.getAttribute("data-mirrored"),
    inverted: await el.getAttribute("data-inverted"),
  };
}

async function polarPoint(page: Page, angle: number, radius: number) {
  return page
    .locator("[data-approved-id]")
    .first()
    .evaluate(
      (node, polar) => {
        const matrix = (node as SVGGElement).ownerSVGElement?.getScreenCTM();
        if (!matrix) throw new Error("missing matrix");
        const radians = ((polar.angle - 90) * Math.PI) / 180;
        const point = new DOMPoint(
          450 + polar.radius * Math.cos(radians),
          450 + polar.radius * Math.sin(radians),
        ).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      },
      { angle, radius },
    );
}

async function dragApprovedTo(page: Page, angle: number, radius: number) {
  const target = page.locator("[data-approved-id]").first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("missing instance box");
  const to = await polarPoint(page, angle, radius);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test("1. enabled filter: only active designs are listed", async ({ page }) => {
  await seedLibrary(page, [SEED_A, SEED_OFF]);
  await openDrawer(page);
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Guarda Clásica" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Borrador Oculto" }),
  ).toHaveCount(0);
});

test("2. inactive designs stay hidden from the customer picker", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_OFF]);
  await openDrawer(page);
  await expect(page.locator(".approved-choice")).toHaveCount(0);
  await expect(page.locator(".approved-drawer")).toContainText(
    "Todavía no hay diseños disponibles.",
  );
});

test("3. search filters by name", async ({ page }) => {
  await seedLibrary(page, [SEED_A, SEED_B]);
  await openDrawer(page);
  await page.locator("#approved-search").fill("messi");
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Messi Silueta" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Guarda Clásica" }),
  ).toHaveCount(0);
});

test("4. category filter groups free categories", async ({ page }) => {
  await seedLibrary(page, [SEED_A, SEED_B]);
  await openDrawer(page);
  await page.locator("#approved-category-filter").selectOption("Deportes");
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Messi Silueta" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Guarda Clásica" }),
  ).toHaveCount(0);
});

test("5. select adds an approved instance to the canvas", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await openDrawer(page);
  await chooseByName(page, "Guarda Clásica");
  const art = page.locator("[data-approved-id] .approved-art");
  await expect(art).toBeVisible();
});

test("6. approved asset renders isolated (blob image, no markup/CSS leak)", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const href = await page
    .locator("[data-approved-id] image.approved-art")
    .getAttribute("href");
  expect(href).toMatch(/^blob:/);
  const leak = await page.evaluate(() => ({
    g1: document.querySelectorAll("#g1").length,
    styles: Array.from(document.querySelectorAll("svg.mate style")).length,
    rawRefs: Array.from(
      document.querySelectorAll("svg.mate [fill^='#'], svg.mate [clip-path]"),
    )
      .map((el) => el.outerHTML.slice(0, 120))
      .filter((html) => html.includes("url(#g1)")).length,
  }));
  expect(leak.g1).toBe(0);
  expect(leak.styles).toBe(0);
  expect(leak.rawRefs).toBe(0);
  const loaded = await page.evaluate(() => {
    const img = document.querySelector(
      "[data-approved-id] image.approved-art",
    ) as SVGImageElement | null;
    if (!img) return { w: 0, h: 0 };
    const hrefAttr =
      img.getAttribute("href") ??
      img.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
      "";
    return {
      blob: hrefAttr.startsWith("blob:"),
      w: img.width.baseVal.value,
      h: img.height.baseVal.value,
    };
  });
  expect(loaded.blob).toBe(true);
  expect(loaded.w).toBeGreaterThan(0);
  expect(loaded.h).toBeGreaterThan(0);
});

test("7. aspect ratio follows the source viewBox", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const ratio = await page.evaluate(() => {
    const img = document.querySelector(
      "[data-approved-id] image.approved-art",
    ) as unknown as {
      width: { baseVal: { value: number } };
      height: { baseVal: { value: number } };
    };
    return img.width.baseVal.value / img.height.baseVal.value;
  });
  expect(ratio).toBeCloseTo(2, 1);
});

test("8. drag moves the instance (angular + radial)", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const before = await pose(page);
  const el = page.locator("[data-approved-id]");
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error("missing instance box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 40,
    { steps: 8 },
  );
  await page.mouse.up();
  const after = await pose(page);
  expect(after.angle !== before.angle || after.radius !== before.radius).toBe(
    true,
  );
});

test("9. approved drag snaps angularly and radially through the shared engine", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  // Free position first: outside every tolerance the pose follows exactly.
  await dragApprovedTo(page, 52, 385);
  const free = await pose(page);
  expect(Number(free.angle)).toBeCloseTo(52, 0);
  expect(Number(free.radius)).toBeCloseTo(385, 0);
  // Entering a guide pulls in: a 47°/363 drag must snap to 45°/360.
  const el = page.locator("[data-approved-id]").first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error("missing instance box");
  const to = await polarPoint(page, 47, 363);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // A panel/layout reflow mid-drag must not break the captured matrix.
  await page.locator(".design-panel").evaluate((node) => node.scrollBy(0, 8));
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const snapped = await pose(page);
  expect(Number(snapped.angle)).toBeCloseTo(45, 5);
  expect(Number(snapped.radius)).toBe(360);
  // Direction evidence: this drag moved toward decreasing angle.
  expect(Number(snapped.angle)).toBeLessThan(Number(free.angle));
  // Hysteresis: 50° still holds the 45° guide...
  await dragApprovedTo(page, 50, 366);
  expect(Number((await pose(page)).angle)).toBeCloseTo(45, 5);
  // ...while 58° escapes it.
  await dragApprovedTo(page, 58, 385);
  expect(Number((await pose(page)).angle)).toBeCloseTo(58, 0);
});

test("10. scale handle grows the instance", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const before = await pose(page);
  await page.locator("[data-approved-id] .scale-handle").first().focus();
  await page.keyboard.press("ArrowUp");
  const after = await pose(page);
  expect(Number(after.scale)).toBeGreaterThan(Number(before.scale));
});

test("11. rotate handle turns the instance", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator("[data-approved-id] .rotate-handle").first().focus();
  await page.keyboard.press("ArrowRight");
  const after = await pose(page);
  expect(Number(after.rotation)).not.toBe(0);
});

test("12. toolbar mirror/invert bind the selected approved instance", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator(".mirror-icon").click();
  await expect(page.locator("[data-approved-id]")).toHaveAttribute(
    "data-mirrored",
    "true",
  );
  await page.locator(".invert-icon").click();
  await expect(page.locator("[data-approved-id]")).toHaveAttribute(
    "data-inverted",
    "true",
  );
  await page.locator(".reset-icon-angle").click();
  await expect(page.locator("[data-approved-id]")).toHaveAttribute(
    "data-rotation",
    "0",
  );
});

test("13. multiple instances stay independent", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator(".approved-drawer").count();
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await expect(page.locator("[data-approved-id]")).toHaveCount(2);
  await page.locator("[data-approved-id]").nth(1).click();
  await page.locator(".mirror-icon").click();
  expect(
    await page
      .locator("[data-approved-id]")
      .nth(1)
      .getAttribute("data-mirrored"),
  ).toBe("true");
  expect(
    await page
      .locator("[data-approved-id]")
      .nth(0)
      .getAttribute("data-mirrored"),
  ).toBe("false");
});

test("14. duplicate internal ids stay isolated across documents", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A, SEED_B]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Messi Silueta");
  await expect(page.locator("[data-approved-id]")).toHaveCount(2);
  const result = await page.evaluate(() => {
    const hostIds = document.querySelectorAll("#g1").length;
    const arts = Array.from(
      document.querySelectorAll("[data-approved-id] image.approved-art"),
    );
    const hrefs = arts.map((el) => el.getAttribute("href"));
    const sizes = arts.map((el) => {
      const box = (el as SVGGraphicsElement).getBoundingClientRect();
      return box.width + box.height;
    });
    return { hostIds, distinct: new Set(hrefs).size, sizes };
  });
  expect(result.hostIds).toBe(0);
  expect(result.distinct).toBe(2);
  expect(result.sizes.every((size) => size > 0)).toBe(true);
});

test("15. Confirmar roundtrip preserves exact pose and reference", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator("[data-approved-id]").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(".mirror-icon").click();
  const before = await pose(page);
  const beforeId = await page
    .locator("[data-approved-id]")
    .getAttribute("data-design-id");
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  await expect(page.locator(".confirm-summary")).toContainText(/Diseños: 1/);
  const confirmPose = await pose(page);
  expect(confirmPose).toEqual(before);
  await page.locator(".back-to-edit").click();
  await expect(page.locator(".add-approved")).toBeVisible();
  expect(await pose(page)).toEqual(before);
  expect(
    await page.locator("[data-approved-id]").getAttribute("data-design-id"),
  ).toBe(beforeId);
});

test("16. empty library shows the exact empty message", async ({ page }) => {
  await page.goto("/admin-lab");
  await page.evaluate(async () => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    const loaded = await store.load();
    for (const design of loaded.designs) await store.removeDesign(design.id);
  });
  await openDrawer(page);
  await expect(page.locator(".approved-drawer")).toContainText(
    "Todavía no hay diseños disponibles.",
  );
});

test("17. mobile touch drag moves without layout jump", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator("[data-approved-id]").scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const panelTop = await page
    .locator(".design-panel")
    .evaluate((el) => el.getBoundingClientRect().top);
  const before = await pose(page);
  const cdp = await page.context().newCDPSession(page);
  const from = await page.locator("[data-approved-id]").evaluate((el) => {
    const svg = (el as SVGGElement).ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error("missing matrix");
    const radians =
      (Number((el as SVGGElement).dataset.angle) - 90) * (Math.PI / 180);
    const radius = Number((el as SVGGElement).dataset.radius);
    const target = new DOMPoint(
      450 + radius * Math.cos(radians),
      450 + radius * Math.sin(radians),
    ).matrixTransform(matrix);
    return { x: target.x, y: target.y };
  });
  const point = (position: { x: number; y: number }) => ({
    ...position,
    radiusX: 4,
    radiusY: 4,
    id: 7,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(from)],
  });
  for (let index = 1; index <= 8; index += 1) {
    const progress = index / 8;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point({ x: from.x + 40 * progress, y: from.y + 30 * progress }),
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const after = await pose(page);
  expect(after.angle !== before.angle || after.radius !== before.radius).toBe(
    true,
  );
  const panelTopAfter = await page
    .locator(".design-panel")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(panelTopAfter - panelTop)).toBeLessThan(4);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("18. real Messi fixture: admin upload to Confirmar and back", async ({
  page,
}) => {
  const hashBefore = messiHash();
  await page.goto("/admin-lab");
  await page.getByRole("button", { name: "+ Agregar diseño" }).click();
  await page.locator("#admin-lab-name").fill("Messi E2E");
  await page.locator("#admin-lab-category").fill("Deportes");
  await page.getByTestId("admin-lab-file").setInputFiles({
    name: "MESSI-SILHOUETTE.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(messiSource(), "utf8"),
  });
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible({
    timeout: 30000,
  });
  await page.getByTestId("admin-lab-save").click();
  await expect(page.getByTestId("admin-lab-form")).toHaveCount(0);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await expect(
    page.locator(".approved-drawer").getByRole("button", { name: "Messi E2E" }),
  ).toBeVisible();
  await chooseByName(page, "Messi E2E");
  const el = page.locator("[data-approved-id]");
  await el.focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("[data-approved-id] .scale-handle").first().focus();
  await page.keyboard.press("ArrowUp");
  await page.locator("[data-approved-id] .rotate-handle").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("[data-approved-id]").click();
  await page.locator(".mirror-icon").click();
  await page.locator(".invert-icon").click();
  const before = await pose(page);
  const href = await page
    .locator("[data-approved-id] image.approved-art")
    .getAttribute("href");
  expect(href).toMatch(/^blob:/);
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
  expect(await pose(page)).toEqual(before);
  await page.locator(".back-to-edit").click();
  expect(await pose(page)).toEqual(before);
  expect(messiHash()).toBe(hashBefore);
});

test("19. placed art survives admin delete/update; catalog subscription updates", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A, SEED_B]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const artBefore = await page
    .locator("[data-approved-id] image.approved-art")
    .getAttribute("href");
  const poseBefore = await pose(page);
  // Reopen the picker so it stays mounted and subscribed while a REAL
  // second page performs the public admin mutations: no synthetic
  // StorageEvent stands in for the cross-tab event here.
  await page.locator(".add-approved").click();
  await expect(page.locator(".approved-drawer")).toBeVisible();
  const admin = await page.context().newPage();
  await admin.goto("/admin-lab");
  const ids = await admin.evaluate(async () => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    const loaded = await store.load();
    const find = (name: string) => {
      const found = loaded.designs.find((d) => d.name === name);
      if (!found) throw new Error(`seeded design missing: ${name}`);
      return found.id;
    };
    return { target: find("Guarda Clásica"), other: find("Messi Silueta") };
  });
  await admin
    .locator(`[data-testid="admin-lab-item-${ids.target}"]`)
    .getByRole("button", { name: "Editar" })
    .click();
  await admin.locator("#admin-lab-name").fill("Guarda Renombrada");
  await admin.getByTestId("admin-lab-save").click();
  await admin
    .locator(`[data-testid="admin-lab-item-${ids.other}"]`)
    .getByRole("button", { name: "Eliminar" })
    .click();
  await admin.getByTestId("admin-lab-confirm-yes").click();
  // The drawer is still open and subscribed: the catalog reflects the
  // rename/removal live, while the placed snapshot stays untouched.
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Guarda Renombrada" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: "Messi Silueta" }),
  ).toHaveCount(0);
  await expect.poll(async () => pose(page)).toEqual(poseBefore);
  expect(
    await page
      .locator("[data-approved-id] image.approved-art")
      .getAttribute("href"),
  ).toBe(artBefore);
  await admin.close();
});

test("20. export blocks only while approved instances exist", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-icon").click();
  await page.locator(".icon-search").fill("guitarra");
  await page.locator(".icon-choice").first().click();
  await expect(page.locator("[data-icon-id]")).toBeVisible();
  await page.locator(".design-confirm").click();
  await expect(page.locator(".export-svg:not([disabled])")).toBeVisible();
  await page.locator(".back-to-edit").click();
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator(".design-confirm").click();
  const exportButton = page.locator(".export-svg");
  await expect(exportButton).toBeDisabled();
  await expect(page.locator(".confirm-panel")).toContainText(/bloquead/i);
});

test("21. customer flow offers no arbitrary SVG upload", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await openDrawer(page);
  await expect(page.locator('.approved-drawer input[type="file"]')).toHaveCount(
    0,
  );
  await expect(
    page
      .locator(".approved-drawer")
      .getByRole("button", { name: /editar|eliminar|activar/i }),
  ).toHaveCount(0);
  await expect(page.locator('.design-panel input[type="file"]')).toHaveCount(0);
  // The raster uploader stays raster-only: PNG/JPEG/WebP, never SVG.
  await page
    .locator(".approved-drawer")
    .getByRole("button", { name: "Cerrar biblioteca de diseños" })
    .click();
  await expect(page.locator(".approved-drawer")).toBeHidden();
  await page.locator(".add-image").click();
  await expect(
    page.getByRole("heading", { name: "Subir imagen" }),
  ).toBeVisible();
  const accept = await page
    .locator('.upload-dialog input[type="file"]')
    .first()
    .getAttribute("accept");
  expect(accept ?? "").toContain("image/png");
  expect(accept ?? "").toContain("image/jpeg");
  expect(accept ?? "").toContain("image/webp");
  expect((accept ?? "").toLowerCase()).not.toContain("svg");
});

test("22. pointer drags on scale and rotate handles reshape the instance", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const target = page.locator("[data-approved-id]").first();
  await target.click();
  const before = await pose(page);
  const frame = await target.evaluate((node) => {
    const centerOf = (element: Element | null) => {
      const m = (
        element as unknown as SVGGraphicsElement | null
      )?.getScreenCTM?.();
      if (!m) throw new Error("missing handle matrix");
      const p = new DOMPoint(0, 0).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    const svg = (node as SVGGElement).ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error("missing matrix");
    const radians =
      (Number((node as SVGGElement).dataset.angle) - 90) * (Math.PI / 180);
    const radius = Number((node as SVGGElement).dataset.radius);
    const center = new DOMPoint(
      450 + radius * Math.cos(radians),
      450 + radius * Math.sin(radians),
    ).matrixTransform(matrix);
    return {
      center: { x: center.x, y: center.y },
      scale: centerOf(node.querySelector(".scale-handle")),
      rotate: centerOf(node.querySelector(".rotate-handle")),
    };
  });
  // Pull the scale handle outward along its arm: the instance must grow.
  const arm = {
    x: frame.scale.x - frame.center.x,
    y: frame.scale.y - frame.center.y,
  };
  const armLen = Math.hypot(arm.x, arm.y);
  const unit = { x: arm.x / armLen, y: arm.y / armLen };
  await page.mouse.move(frame.scale.x, frame.scale.y);
  await page.mouse.down();
  await page.mouse.move(
    frame.scale.x + unit.x * 40,
    frame.scale.y + unit.y * 40,
    {
      steps: 10,
    },
  );
  await page.mouse.up();
  const grown = await pose(page);
  expect(Number(grown.scale)).toBeGreaterThan(Number(before.scale));
  // Swing the rotate handle 20° around the center: rotation follows,
  // scale and position stay independent.
  const frame2 = await target.evaluate((node) => {
    const centerOf = (element: Element | null) => {
      const m = (
        element as unknown as SVGGraphicsElement | null
      )?.getScreenCTM?.();
      if (!m) throw new Error("missing handle matrix");
      const p = new DOMPoint(0, 0).matrixTransform(m);
      return { x: p.x, y: p.y };
    };
    const svg = (node as SVGGElement).ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error("missing matrix");
    const radians =
      (Number((node as SVGGElement).dataset.angle) - 90) * (Math.PI / 180);
    const radius = Number((node as SVGGElement).dataset.radius);
    const center = new DOMPoint(
      450 + radius * Math.cos(radians),
      450 + radius * Math.sin(radians),
    ).matrixTransform(matrix);
    return {
      center: { x: center.x, y: center.y },
      rotate: centerOf(node.querySelector(".rotate-handle")),
    };
  });
  const turn = (20 * Math.PI) / 180;
  const dx = frame2.rotate.x - frame2.center.x;
  const dy = frame2.rotate.y - frame2.center.y;
  const end = {
    x: frame2.center.x + dx * Math.cos(turn) - dy * Math.sin(turn),
    y: frame2.center.y + dx * Math.sin(turn) + dy * Math.cos(turn),
  };
  await page.mouse.move(frame2.rotate.x, frame2.rotate.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  const turned = await pose(page);
  expect(Math.abs(Number(turned.rotation))).toBeGreaterThan(10);
  expect(Math.abs(Number(turned.rotation))).toBeLessThan(30);
  expect(Number(turned.scale)).toBeCloseTo(Number(grown.scale), 1);
  expect(turned.angle).toBe(grown.angle);
  expect(turned.radius).toBe(grown.radius);
});

test("23. exclusive selection across kinds and approved delete", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  await page.locator(".add-text").click();
  await expect(page.locator("[data-text-id]")).toBeVisible();
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  const approved = page.locator("[data-approved-id]").first();
  const text = page.locator("[data-text-id]").first();
  await approved.click();
  await expect(approved).toHaveAttribute("aria-pressed", "true");
  await expect(text).toHaveAttribute("aria-pressed", "false");
  await page.locator(".mirror-icon").click();
  await expect(approved).toHaveAttribute("data-mirrored", "true");
  await approved.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-approved-id]")).toHaveCount(0);
  await expect(text).toBeVisible();
});

test("24. customer CTA restores '+ Agregar diseño'", async ({ page }) => {
  await seedLibrary(page, [SEED_A]);
  await page.goto("/");
  const cta = page.getByRole("button", {
    name: "+ Agregar diseño",
    exact: true,
  });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveClass(/add-approved/);
  await cta.click();
  await expect(page.locator(".approved-drawer")).toBeVisible();
});

test("25. approved knockout covers the fitted art corners and grows with scale", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]); // 100x50 source -> 64x32 display
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.getByRole("button", { name: "Doble", exact: true }).click();
  const halo = page.locator('[id^="approved-knockout-"]');
  const size = await page.evaluate(() => {
    const img = document.querySelector(
      "[data-approved-id] image.approved-art",
    ) as unknown as {
      width: { baseVal: { value: number } };
      height: { baseVal: { value: number } };
    };
    return { w: img.width.baseVal.value, h: img.height.baseVal.value };
  });
  const corner = Math.hypot(size.w, size.h) / 2;
  const scaleOf = async () =>
    Number(
      await page
        .locator("[data-approved-id]")
        .first()
        .getAttribute("data-scale"),
    );
  // Circumscribed envelope plus conservative padding: the old
  // 25*scale*sqrt2+4 constant undersized this exact asset.
  expect(Number(await halo.getAttribute("r"))).toBeGreaterThanOrEqual(
    corner * (await scaleOf()) + 4 - 1e-6,
  );
  expect(await page.locator("#decorative-lines-knockout use").count()).toBe(1);
  await page.locator("[data-approved-id] .scale-handle").first().focus();
  await page.keyboard.press("ArrowUp");
  const grown = Number(await halo.getAttribute("r"));
  expect(grown).toBeGreaterThan(corner + 4 - 1e-6);
  // Mirror/rotate preserve the circumscribed radius: corners stay covered.
  await page.locator(".mirror-icon").click();
  await page.locator("[data-approved-id] .rotate-handle").first().focus();
  await page.keyboard.press("ArrowRight");
  expect(Number(await halo.getAttribute("r"))).toBeGreaterThanOrEqual(
    corner * (await scaleOf()) + 4 - 1e-6,
  );
});

test("26. asset URL lifecycle never serves a revoked URL across source swaps", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A]);
  await openDrawer(page);
  const swap = await page.evaluate(async (blue: string) => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const t0 = performance.now();
    const revoked: Array<{ url: string; t: number }> = [];
    const created: string[] = [];
    const rawCreate = URL.createObjectURL.bind(URL) as (blob: Blob) => string;
    const rawRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = rawCreate(blob as Blob);
      created.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoked.push({ url, t: performance.now() - t0 });
      rawRevoke(url);
    }) as typeof URL.revokeObjectURL;
    (
      window as unknown as { __approvedRevokes: typeof revoked }
    ).__approvedRevokes = revoked;
    const admitted = assets.importSvgAsset(blue);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.reason}`);
    const thumb = () =>
      document.querySelector(
        ".approved-drawer img.approved-thumb",
      ) as HTMLImageElement | null;
    const first = thumb();
    if (!first) throw new Error("thumb missing");
    const firstNode = first;
    const firstSrc = first.currentSrc || first.src;
    const sampler = new Promise<Array<{ src: string; t: number }>>(
      (resolve) => {
        const frames: Array<{ src: string; t: number }> = [];
        const step = () => {
          const img = thumb();
          if (img)
            frames.push({
              src: img.currentSrc || img.src,
              t: performance.now() - t0,
            });
          if (performance.now() - t0 > 2500) resolve(frames);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
    );
    await new Promise((r) => setTimeout(r, 120));
    // Same-instance source change: identical id, brand-new bytes, exactly
    // how an admin asset edit reaches the open picker (storage + event).
    const raw = localStorage.getItem(repo.ADMIN_LAB_STORAGE_KEY);
    if (!raw) throw new Error("storage missing");
    const envelope = JSON.parse(raw) as {
      records: Array<Record<string, unknown>>;
    };
    const store = repo.createAdminDesignStore();
    const before = await store.load();
    const target = before.designs.find((d) => d.name === "Guarda Clásica");
    if (!target) throw new Error("seeded design missing");
    const record = envelope.records.find((r) => r["id"] === target.id);
    if (!record) throw new Error("record missing");
    record["svg"] = admitted.asset.svg;
    record["width"] = admitted.asset.width;
    record["height"] = admitted.asset.height;
    record["viewBox"] = admitted.asset.viewBox;
    localStorage.setItem(repo.ADMIN_LAB_STORAGE_KEY, JSON.stringify(envelope));
    window.dispatchEvent(
      new StorageEvent("storage", { key: repo.ADMIN_LAB_STORAGE_KEY }),
    );
    const frames = await sampler;
    const after = thumb();
    return {
      firstSrc,
      sameNode: after === firstNode,
      current: after ? after.currentSrc || after.src : null,
      frames,
      created,
      revoked,
    };
  }, gradientSvg("#0000ff"));
  // The swap must unmount the stale <img> (null while the fresh URL lands),
  // never keep one node pointed at a revoked URL.
  expect(swap.sameNode).toBe(false);
  expect(swap.current).not.toBeNull();
  expect(swap.current).not.toBe(swap.firstSrc);
  expect(swap.created).toContain(swap.current);
  // No observed frame may show a URL after its revocation.
  const revokedAt = new Map(swap.revoked.map((r) => [r.url, r.t] as const));
  for (const frame of swap.frames) {
    const at = revokedAt.get(frame.src);
    expect(at === undefined || frame.t <= at + 50).toBe(true);
  }
  // The old URL is released and the new one REALLY decodes (Image natural
  // dimensions, never width/height attributes alone).
  expect(swap.revoked.map((r) => r.url)).toContain(swap.firstSrc);
  const decoded = await page.evaluate(async (src) => {
    const probe = new Image();
    await new Promise<void>((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error("blob did not decode"));
      probe.src = src as string;
    });
    return { w: probe.naturalWidth, h: probe.naturalHeight };
  }, swap.current);
  expect(decoded.w).toBeGreaterThan(0);
  expect(decoded.h).toBeGreaterThan(0);
  // Delete releases the live URL and the drawer shows the exact message.
  // (Same-tab removal needs the storage event Redispatched manually: the
  // real cross-tab delivery itself is proven by test 19's second page.)
  await page.evaluate(async () => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    const loaded = await store.load();
    for (const design of loaded.designs) await store.removeDesign(design.id);
    window.dispatchEvent(
      new StorageEvent("storage", { key: repo.ADMIN_LAB_STORAGE_KEY }),
    );
  });
  await expect(page.locator(".approved-drawer")).toContainText(
    "Todavía no hay diseños disponibles.",
  );
  const released = await page.evaluate(
    () =>
      (window as unknown as { __approvedRevokes: Array<{ url: string }> })
        .__approvedRevokes ?? [],
  );
  expect(released.map((r) => r.url)).toContain(swap.current);
});

test("27. red vs blue assets with identical internal ids render distinctly", async ({
  page,
}) => {
  const BLUE: SeedItem = {
    name: "Azul Profundo",
    category: "Guardas",
    enabled: true,
    svg: gradientSvg("#0000ff"),
  };
  await seedLibrary(page, [SEED_A, BLUE]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Guarda Clásica");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Azul Profundo");
  await expect(page.locator("[data-approved-id]")).toHaveCount(2);
  // Both blob documents decode with real intrinsic dimensions...
  const samples = await page.evaluate(async () => {
    const hrefs = Array.from(
      document.querySelectorAll("[data-approved-id] image.approved-art"),
    ).map((el) => el.getAttribute("href") ?? "");
    const out: Array<{ w: number; h: number; r: number; b: number }> = [];
    for (const href of hrefs) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("blob did not decode"));
        img.src = href;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d unavailable");
      ctx.drawImage(img, 0, 0, 32, 16);
      const data = ctx.getImageData(0, 0, 32, 16).data;
      let r = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        b += data[i + 2];
        n += 1;
      }
      out.push({
        w: img.naturalWidth,
        h: img.naturalHeight,
        r: r / n,
        b: b / n,
      });
    }
    return out;
  });
  expect(samples).toHaveLength(2);
  expect(samples[0].w).toBeGreaterThan(0);
  expect(samples[1].w).toBeGreaterThan(0);
  // ...and the rendered appearance follows the bytes, not the shared id.
  expect(samples[0].r).toBeGreaterThan(samples[0].b);
  expect(samples[1].b).toBeGreaterThan(samples[1].r);
  // Both instances also paint non-trivial pixels on the canvas itself
  // (a blank/failed render compresses to ~a hundred bytes).
  const red = await page.locator("[data-approved-id]").nth(0).screenshot();
  const blue = await page.locator("[data-approved-id]").nth(1).screenshot();
  expect(red.length).toBeGreaterThan(300);
  expect(blue.length).toBeGreaterThan(300);
});

test("28. real Messi source keeps its 4:3 ratio through blob load", async ({
  page,
}) => {
  const hashBefore = messiHash();
  await seedLibrary(page, [
    {
      name: "Messi Real",
      category: "Deportes",
      enabled: true,
      svg: messiSource(),
    },
  ]);
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Messi Real");
  const editor = await page.evaluate(() => {
    const img = document.querySelector(
      "[data-approved-id] image.approved-art",
    ) as unknown as {
      width: { baseVal: { value: number } };
      height: { baseVal: { value: number } };
    };
    return { w: img.width.baseVal.value, h: img.height.baseVal.value };
  });
  expect(editor.w / editor.h).toBeCloseTo(4 / 3, 2);
  const natural = await page.evaluate(async () => {
    const href =
      document
        .querySelector("[data-approved-id] image.approved-art")
        ?.getAttribute("href") ?? "";
    const probe = new Image();
    await new Promise<void>((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error("blob did not decode"));
      probe.src = href;
    });
    return { w: probe.naturalWidth, h: probe.naturalHeight };
  });
  expect(natural.w).toBeGreaterThan(0);
  expect(natural.w / natural.h).toBeCloseTo(4 / 3, 2);
  expect(messiHash()).toBe(hashBefore);
});

test("30. filtered-no-match explains itself and offers to clear", async ({
  page,
}) => {
  await seedLibrary(page, [SEED_A, SEED_B]);
  await openDrawer(page);
  await page.locator("#approved-search").fill("zzz-sin-coincidencias");
  await expect(page.locator(".approved-no-match")).toContainText(
    "No encontramos diseños con esos filtros.",
  );
  await expect(page.locator(".approved-drawer")).not.toContainText(
    "Todavía no hay diseños disponibles.",
  );
  await page
    .locator(".approved-drawer")
    .getByRole("button", { name: "Limpiar filtros", exact: true })
    .click();
  await expect(page.locator(".approved-choice")).toHaveCount(2);
  // Category-scoped reset path: the clear action restores the category too.
  await page.locator("#approved-category-filter").selectOption("Deportes");
  await page.locator("#approved-search").fill("guarda");
  await expect(page.locator(".approved-no-match")).toBeVisible();
  await page
    .locator(".approved-drawer")
    .getByRole("button", { name: "Limpiar filtros", exact: true })
    .click();
  await expect(page.locator("#approved-category-filter")).toHaveValue("Todas");
  await expect(page.locator(".approved-choice")).toHaveCount(2);
});

test("31. v1/v2 designs get real geometry thumbnails and canvas art", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const seeded = await page.evaluate(async () => {
    const trusted = await import(
      /* @vite-ignore */ "/src/admin-lab/svgGeometryImport.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    const rect = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g transform="translate(5 5)"><rect x="0" y="0" width="30" height="30" fill="#ff0000"/></g></svg>`;
    const parsed = trusted.importTrustedSvg(rect);
    if (!parsed.ok) throw new Error(`trusted import failed: ${parsed.code}`);
    const savedV2 = await store.saveNew({
      name: "Geo V2",
      category: "Prueba",
      geometry: parsed.geometry,
    });
    if (!savedV2.ok)
      throw new Error(`v2 save failed: ${savedV2.error.message}`);
    const savedV1 = await store.saveNew({
      name: "Geo V1",
      category: "Prueba",
      paths: [{ d: "M0 0H30V30H0Z", transform: "translate(5 5)" }],
      artBounds: { x: 5, y: 5, width: 30, height: 30 },
      fillRule: "nonzero",
    });
    if (!savedV1.ok)
      throw new Error(`v1 save failed: ${savedV1.error.message}`);
    return true;
  });
  expect(seeded).toBe(true);
  await openDrawer(page);
  await expect(page.locator(".approved-choice")).toHaveCount(2);
  // Real controlled-tree thumbnails: no placeholder glyph anywhere.
  await expect(
    page.locator(".approved-drawer svg.approved-thumb-geometry-art"),
  ).toHaveCount(2);
  await expect(
    page.locator(".approved-drawer .approved-thumb-geometry"),
  ).toHaveCount(0);
  // Thumb framing: raw art-bounds viewBox with no normalization wrapper,
  // so the 30x30 art painted at 5,5 fills the thumbnail 1:1. A fitted
  // wrapper (center-to-origin/size-64) would paint ~2.13x too large here.
  for (const name of ["Geo V2", "Geo V1"]) {
    const thumb = page
      .locator(".approved-drawer")
      .getByRole("button", { name })
      .locator("svg.approved-thumb-geometry-art");
    await expect(thumb).toBeVisible();
    const framing = await thumb.evaluate((svg) => {
      const boxOf = (el: Element) => {
        const r = (el as SVGGraphicsElement).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const fit = svg.querySelector(":scope > g[transform]");
      const firstPath = svg.querySelector("path");
      return {
        viewBox: svg.getAttribute("viewBox"),
        hasFitWrapper: !!fit,
        fitTransform: fit?.getAttribute("transform") ?? null,
        d: firstPath?.getAttribute("d") ?? null,
        matrix: firstPath?.getAttribute("transform") ?? null,
        fill: firstPath?.getAttribute("fill") ?? null,
        stroke: firstPath?.getAttribute("stroke") ?? null,
        thumb: boxOf(svg),
        path: firstPath ? boxOf(firstPath) : null,
      };
    });
    expect(framing.viewBox).toBe("5 5 30 30");
    expect(framing.hasFitWrapper).toBe(false);
    expect(framing.d).toBeTruthy();
    // Internal composed translate(5 5) survives as an explicit matrix.
    expect(framing.matrix ?? "").toContain("5");
    expect(framing.stroke).toBe("none");
    if (name === "Geo V2")
      expect(framing.fill?.toLowerCase()).toContain("ff0000");
    expect(framing.thumb.w).toBeGreaterThan(0);
    expect(framing.path?.w ?? 0).toBeGreaterThan(0);
    const ratioW = (framing.path?.w ?? 0) / framing.thumb.w;
    const ratioH = (framing.path?.h ?? 0) / framing.thumb.h;
    expect(ratioW).toBeGreaterThan(0.85);
    expect(ratioW).toBeLessThan(1.15);
    expect(ratioH).toBeGreaterThan(0.85);
    expect(ratioH).toBeLessThan(1.15);
    const dx = Math.abs(
      framing.path!.x +
        framing.path!.w / 2 -
        (framing.thumb.x + framing.thumb.w / 2),
    );
    const dy = Math.abs(
      framing.path!.y +
        framing.path!.h / 2 -
        (framing.thumb.y + framing.thumb.h / 2),
    );
    expect(dx).toBeLessThan(framing.thumb.w * 0.15 + 1);
    expect(dy).toBeLessThan(framing.thumb.h * 0.15 + 1);
  }
  // Canvas branch: controlled paths, never a blob <image>.
  await chooseByName(page, "Geo V2");
  const art = page.locator("[data-approved-id] .approved-art").last();
  await expect(art.locator("path")).not.toHaveCount(0);
  await expect(
    page.locator("[data-approved-id] image.approved-art"),
  ).toHaveCount(0);
  const painted = await art.evaluate((el) => {
    const box = (el as SVGGraphicsElement).getBoundingClientRect();
    return box.width + box.height;
  });
  expect(painted).toBeGreaterThan(0);
});

test("32. width/height viewport wins over viewBox and matches browser decode", async ({
  page,
}) => {
  const MISMATCH =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="100" height="100">` +
    `<rect x="0" y="0" width="200" height="100" fill="#00aa00"/></svg>`;
  await seedLibrary(page, [
    {
      name: "Viewport Cuadrado",
      category: "Prueba",
      enabled: true,
      svg: MISMATCH,
    },
  ]);
  const stored = await page.evaluate(async () => {
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const store = repo.createAdminDesignStore();
    const loaded = await store.load();
    const found = loaded.designs.find((d) => d.name === "Viewport Cuadrado");
    if (!found || found.version !== 3) throw new Error("stored v3 missing");
    return { width: found.width, height: found.height, viewBox: found.viewBox };
  });
  await page.goto("/");
  await page.locator(".add-approved").click();
  await chooseByName(page, "Viewport Cuadrado");
  const editor = await page.evaluate(() => {
    const img = document.querySelector(
      "[data-approved-id] image.approved-art",
    ) as unknown as {
      width: { baseVal: { value: number } };
      height: { baseVal: { value: number } };
    };
    return { w: img.width.baseVal.value, h: img.height.baseVal.value };
  });
  // The editor preserves the stored viewport proportion...
  expect(editor.w / editor.h).toBeCloseTo(
    (stored.width ?? 0) / (stored.height ?? 1),
    2,
  );
  // ...and the browser decodes the identical intrinsic size.
  const natural = await page.evaluate(async () => {
    const href =
      document
        .querySelector("[data-approved-id] image.approved-art")
        ?.getAttribute("href") ?? "";
    const probe = new Image();
    await new Promise<void>((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error("blob did not decode"));
      probe.src = href;
    });
    return { w: probe.naturalWidth, h: probe.naturalHeight };
  });
  expect(natural.w).toBeGreaterThan(0);
  expect(natural.w / natural.h).toBeCloseTo(editor.w / editor.h, 2);
});

test("33. v3 snapshot detaches and freezes viewBox; source untouched by pose", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const model = await import(
      /* @vite-ignore */ "/src/approved-designs/approvedDesign.ts"
    );
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><rect x="0" y="0" width="100" height="50"/></svg>`;
    const source = {
      id: "src-viewbox",
      name: "Vista",
      category: "Prueba",
      enabled: true,
      version: 3,
      svg,
      width: 100,
      height: 50,
      viewBox: { x: 0, y: 0, width: 100, height: 50 },
    } as const;
    const mutable = JSON.parse(JSON.stringify(source)) as typeof source & {
      viewBox: { x: number; y: number; width: number; height: number };
    };
    const beforeJson = JSON.stringify(mutable);
    const instance = model.approvedDesignFromCatalog(mutable as never, 45);
    const afterCreateJson = JSON.stringify({
      svg: mutable.svg,
      width: mutable.width,
      height: mutable.height,
      viewBox: mutable.viewBox,
    });
    const snapshot = instance.snapshot;
    if (snapshot.version !== 3) throw new Error("snapshot is not v3");
    const sameRef = snapshot.viewBox === mutable.viewBox;
    const frozen = Object.isFrozen(snapshot);
    const viewBoxFrozen = snapshot.viewBox
      ? Object.isFrozen(snapshot.viewBox)
      : false;
    // Later catalog reuse must not leak into the placed snapshot.
    mutable.viewBox.x = 999;
    mutable.viewBox.width = 1;
    const heldAfterSourceMut = snapshot.viewBox
      ? { x: snapshot.viewBox.x, width: snapshot.viewBox.width }
      : null;
    // A direct write at a frozen snapshot cannot succeed: strict-mode
    // modules throw, sloppy contexts silently ignore — either way the
    // stored value must hold, so the throw itself is never the assertion.
    try {
      (snapshot.viewBox as unknown as Record<string, number>).x = 888;
    } catch {
      // Intentionally ignored: the value check below is the proof.
    }
    const heldAfterDirectWrite = snapshot.viewBox?.x ?? null;
    // Instance pose moves the wrapper only: the exact source bytes stay.
    instance.angle = 120;
    instance.scale = 2;
    return {
      creationKeptSource:
        afterCreateJson ===
        JSON.stringify({
          svg,
          width: 100,
          height: 50,
          viewBox: { x: 0, y: 0, width: 100, height: 50 },
        }),
      beforeJson,
      sameRef,
      frozen,
      viewBoxFrozen,
      heldAfterSourceMut,
      heldAfterDirectWrite,
      sourceSvgIntact: mutable.svg === svg,
    };
  });
  expect(result.creationKeptSource).toBe(true);
  expect(result.sameRef).toBe(false);
  expect(result.frozen).toBe(true);
  expect(result.viewBoxFrozen).toBe(true);
  expect(result.heldAfterSourceMut).toEqual({ x: 0, width: 100 });
  expect(result.heldAfterDirectWrite).toBe(0);
  expect(result.sourceSvgIntact).toBe(true);
});

test.describe("desktop lane", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
  });

  test("29. desktop mouse drag moves approved without page scroll", async ({
    page,
  }) => {
    await seedLibrary(page, [SEED_A]);
    await page.goto("/");
    await page.locator(".add-approved").click();
    await chooseByName(page, "Guarda Clásica");
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const before = await pose(page);
    await dragApprovedTo(page, 100, 380);
    const after = await pose(page);
    expect(after.angle !== before.angle || after.radius !== before.radius).toBe(
      true,
    );
    expect(Number(after.angle)).toBeCloseTo(100, 0);
    expect(Number(after.radius)).toBeCloseTo(380, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
});
