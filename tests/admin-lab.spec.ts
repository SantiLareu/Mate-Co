/**
 * Panel del dueño /admin-lab en navegador con modelo v3 (asset SVG
 * sanitizado): alta con preview <img> por Blob URL, mensajes simples,
 * CRUD, búsqueda, categorías, recarga, errores y aislamiento.
 *
 * Español exacto del panel: Biblioteca de diseños, + Agregar diseño, Nombre,
 * Categoría, Archivo SVG, Preview, Activo/Inactivo, Guardar/Cancelar.
 * Sin diseños precargados: la biblioteca empieza vacía.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_LAB_STORAGE_KEY } from "../src/admin-lab/repository";

const scratchDir = mkdtempSync(join(tmpdir(), "admin-lab-ui-"));

test.describe("entrada administrativa /admin", () => {
  test("/admin carga el panel (implementación única)", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-lab-panel")).toBeVisible();
    await expect(page.getByTestId("admin-lab-title")).toBeVisible();
  });

  test("/admin-lab sigue funcionando como alias de desarrollo", async ({
    page,
  }) => {
    await page.goto("/admin-lab");
    await expect(page.getByTestId("admin-lab-panel")).toBeVisible();
  });

  test("sin autenticación falsa de cliente y rutas públicas intactas", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("admin-lab-panel")).toBeVisible();
    const fakeAuthKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      return keys.filter((key) =>
        /^(isadmin|auth|token|logged|session|jwt)/i.test(key),
      );
    });
    expect(fakeAuthKeys).toEqual([]);

    await page.goto("/");
    await expect(page.locator("#root")).not.toBeEmpty();
  });
});

let tempCounter = 0;
function tempSvg(content: string): string {
  tempCounter += 1;
  const path = join(scratchDir, `ui-${tempCounter}.svg`);
  writeFileSync(path, content);
  return path;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const wrap = (inner: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="${SVG_NS}" ${attrs}>${inner}</svg>`;

const SQUARE = wrap('<path d="M10 10H90V90H10Z" fill="#000000"/>');
const TALL = wrap(
  '<path d="M10 5H190V45H10Z" fill="black"/>',
  'viewBox="0 0 200 50"',
);
const SECURITY_MSG =
  "No pudimos importar este SVG porque contiene contenido no permitido.";
const TECHNICAL_MSG =
  "Este SVG usa una característica que todavía no podemos preservar correctamente.";
/** Prólogo con entidad: el único rechazo SECURITY del importador de assets
 * (el <script> inline se purga y el archivo se admite, ver aislamiento). */
const SECURITY_SVG = '<!DOCTYPE svg [<!ENTITY x "y">]>' + SQUARE;
const MALFORMED_SVG = wrap(SQUARE).slice(0, -6);
const NOSIZE_SVG = `<svg xmlns="${SVG_NS}"><path d="M10 10H90V90H10Z"/></svg>`;
const REALISTIC =
  `<svg version="1.0" width="1920pt" height="1080pt" viewBox="0 0 1920 1080" ` +
  `preserveAspectRatio="xMidYMid meet" xmlns="${SVG_NS}">` +
  `<title>Arte de usuario</title><metadata>Editor externo</metadata>` +
  `<g transform="translate(10 20) scale(2)">` +
  `<path d="M0 0H40V40H0Z" fill="#123456"/>` +
  `<path d="M0 20L60 20" fill="none" stroke="red" stroke-width="4"/>` +
  `</g></svg>`;

async function gotoLab(page: Page): Promise<void> {
  await page.goto("/admin-lab");
  await expect(page.getByTestId("admin-lab-title")).toContainText(
    "Biblioteca de diseños",
  );
}

async function createDesign(
  page: Page,
  name: string,
  category: string,
  file: string,
): Promise<void> {
  await page.getByTestId("admin-lab-add").click();
  await expect(page.getByTestId("admin-lab-form")).toBeVisible();
  await page.getByTestId("admin-lab-name").fill(name);
  await page.getByTestId("admin-lab-category").fill(category);
  await page.getByTestId("admin-lab-file").setInputFiles(file);
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.getByTestId("admin-lab-save").click();
}

async function uploadBuffer(
  page: Page,
  name: string,
  category: string,
  svg: string,
): Promise<void> {
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill(name);
  await page.getByTestId("admin-lab-category").fill(category);
  await page.getByTestId("admin-lab-file").setInputFiles({
    name: "test.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
}

async function expectRejection(page: Page, message: string): Promise<void> {
  await expect(page.getByTestId("admin-lab-error")).toHaveText(message);
  await expect(page.getByTestId("admin-lab-preview-svg")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-success")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
}

/** Siembra un v2 real pasando por el importador de geometría confiable. */
async function seedV2(page: Page): Promise<void> {
  await page.evaluate(async (key: string) => {
    const geom = await import(
      /* @vite-ignore */ "/src/admin-lab/svgGeometryImport.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const imported = geom.importTrustedSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="M10 10H90V90H10Z" fill="#000000"/></svg>`,
    );
    if (!imported.ok) throw new Error(`seed import: ${imported.code}`);
    const store = repo.createAdminDesignStore();
    const saved = await store.saveNew({
      name: "Moderno",
      category: "Arte",
      geometry: imported.geometry,
    });
    if (!saved.ok) throw new Error("seed save");
  }, ADMIN_LAB_STORAGE_KEY);
}

test("v3: alta con preview de imagen, mensaje de éxito y persistencia tras recargar", async ({
  page,
}) => {
  await gotoLab(page);
  await uploadBuffer(page, "Arte fiel", "Arte", REALISTIC);
  await expect(page.getByTestId("admin-lab-success")).toHaveText(
    "Diseño cargado correctamente",
  );
  const preview = page.getByTestId("admin-lab-preview-svg");
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((el) => el.tagName.toLowerCase())).toBe("img");
  const previewSrc = await preview.getAttribute("src");
  expect(previewSrc).toMatch(/^blob:/);
  await expect(preview).toHaveAttribute("alt", "Arte fiel");
  await page.getByTestId("admin-lab-save").click();
  await expect(page.getByTestId("admin-lab-form")).toBeHidden();
  await expect(page.getByTestId("admin-lab-list")).toContainText("Arte fiel");
  await expect(page.getByTestId("admin-lab-list")).toContainText("Activo");

  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(stored.version).toBe(1);
  expect(stored.records).toHaveLength(1);
  expect(stored.records[0].version).toBe(3);
  expect(stored.records[0].width).toBe(2560);
  expect(stored.records[0].height).toBe(1440);
  expect(stored.records[0].viewBox).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  expect(stored.records[0].svg).toContain("translate(10 20) scale(2)");
  expect(stored.records[0].svg).not.toContain("<metadata");
  expect(stored.records[0].svg).not.toContain("<script");

  await page.reload();
  const thumb = page.getByTestId(/^admin-lab-thumb-/);
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((el) => el.tagName.toLowerCase())).toBe("img");
  expect(await thumb.getAttribute("src")).toMatch(/^blob:/);
  await expect(thumb).toHaveAttribute("alt", "Arte fiel");
});

test("rechazo de seguridad: mensaje simple y guardado bloqueado", async ({
  page,
}) => {
  await gotoLab(page);
  await uploadBuffer(page, "Hostil", "Varias", SECURITY_SVG);
  await expectRejection(page, SECURITY_MSG);
});

test("característica no preservable: mensaje técnico y guardado bloqueado", async ({
  page,
}) => {
  for (const svg of [MALFORMED_SVG, NOSIZE_SVG]) {
    await gotoLab(page);
    await uploadBuffer(page, "Raro", "Varias", svg);
    await expectRejection(page, TECHNICAL_MSG);
  }
});

test("biblioteca mixta v1+v2+v3 lista y renderiza las tres", async ({
  page,
}) => {
  await gotoLab(page);
  const legacy = {
    version: 1,
    id: "legacy",
    name: "Legado",
    category: "Guardas",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    paths: [{ d: "M0 0H10V10H0Z", transform: "translate(10 20) scale(2)" }],
    artBounds: { x: 10, y: 20, width: 20, height: 20 },
    fillRule: "evenodd",
  };
  await page.evaluate(
    ({ key, legacy }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, records: [legacy] }),
      ),
    { key: ADMIN_LAB_STORAGE_KEY, legacy },
  );
  await seedV2(page);
  await page.reload();
  await createDesign(page, "Nuevo asset", "Arte", tempSvg(SQUARE));
  await expect(page.getByTestId("admin-lab-list")).toContainText("Legado");
  await expect(page.getByTestId("admin-lab-list")).toContainText("Moderno");
  await expect(page.getByTestId("admin-lab-list")).toContainText("Nuevo asset");
  // v1 y v2 dibujan geometría (svg), v3 muestra el asset (img).
  await expect(
    page.locator('svg[data-testid^="admin-lab-thumb-"]'),
  ).toHaveCount(2);
  const assetThumb = page.locator('img[data-testid^="admin-lab-thumb-"]');
  await expect(assetThumb).toHaveCount(1);
  expect(await assetThumb.getAttribute("src")).toMatch(/^blob:/);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(
    stored.records.map((r: { version: number }) => r.version).sort(),
  ).toEqual([1, 2, 3]);
});

test("CRUD en v3: activar/inactivar, renombrar y eliminar", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  const svgBefore = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).records[0].svg,
    ADMIN_LAB_STORAGE_KEY,
  );

  const toggle = page.getByRole("button", { name: /Activo|Inactivo/ }).first();
  await expect(toggle).toContainText("Activo");
  await toggle.click();
  await expect(toggle).toContainText("Inactivo");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Activo|Inactivo/ }).first(),
  ).toContainText("Inactivo");

  await page
    .getByRole("button", { name: /Editar/ })
    .first()
    .click();
  await expect(page.getByTestId("admin-lab-form")).toBeVisible();
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.getByTestId("admin-lab-name").fill("Guarda renovada");
  await page.getByTestId("admin-lab-category").fill("Guardas finas");
  await page.getByTestId("admin-lab-save").click();
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Guarda renovada",
  );
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Guardas finas",
  );
  const thumb = page.getByTestId(/^admin-lab-thumb-/).first();
  expect(await thumb.evaluate((el) => el.tagName.toLowerCase())).toBe("img");
  expect(await thumb.getAttribute("src")).toMatch(/^blob:/);
  const svgAfter = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).records[0].svg,
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(svgAfter).toBe(svgBefore);

  await page
    .getByRole("button", { name: /Eliminar/ })
    .first()
    .click();
  await expect(page.getByTestId("admin-lab-confirm-delete")).toBeVisible();
  await page.getByTestId("admin-lab-confirm-no").click();
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Guarda renovada",
  );
  await page
    .getByRole("button", { name: /Eliminar/ })
    .first()
    .click();
  await page.getByTestId("admin-lab-confirm-yes").click();
  await expect(page.getByTestId("admin-lab-empty")).toBeVisible();
});

test("v3 corrupto en almacenamiento queda aislado en solo lectura", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Vecino válido", "Arte", tempSvg(SQUARE));
  const raw = await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key)!);
    const tampered = structuredClone(data.records[0]);
    tampered.id = "roto";
    // Desincroniza un derivado: el revalidado de lectura lo rechaza.
    tampered.width = 99999;
    data.records.push(tampered);
    const next = JSON.stringify(data);
    localStorage.setItem(key, next);
    return next;
  }, ADMIN_LAB_STORAGE_KEY);
  await page.reload();
  await expect(page.getByTestId(/^admin-lab-thumb-/)).toHaveCount(1);
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Vecino válido",
  );
  await expect(page.getByTestId("admin-lab-list")).not.toContainText("roto");
  await expect(page.getByTestId("admin-lab-storage-notice")).toContainText(
    "1 registro",
  );
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      ADMIN_LAB_STORAGE_KEY,
    ),
  ).toBe(raw);
  await page.getByRole("button", { name: "Activo", exact: true }).click();
  await expect(page.getByTestId("admin-lab-storage-notice")).toContainText(
    "intacto",
  );
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      ADMIN_LAB_STORAGE_KEY,
    ),
  ).toBe(raw);
});

test("v1 legado y v2 sembrado se renderizan con geometría", async ({
  page,
}) => {
  await gotoLab(page);
  const legacy = {
    version: 1,
    id: "legacy",
    name: "Legado",
    category: "Guardas",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    paths: [{ d: "M0 0H10V10H0Z", transform: "translate(10 20) scale(2)" }],
    artBounds: { x: 10, y: 20, width: 20, height: 20 },
    fillRule: "evenodd",
  };
  await page.evaluate(
    ({ key, legacy }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, records: [legacy] }),
      ),
    { key: ADMIN_LAB_STORAGE_KEY, legacy },
  );
  await seedV2(page);
  await page.reload();
  const thumb = page.getByTestId("admin-lab-thumb-legacy");
  await expect(thumb).toHaveAttribute("viewBox", "10 20 20 20");
  await expect(thumb.locator("path")).toHaveAttribute(
    "transform",
    "matrix(2 0 0 2 10 20)",
  );
  await expect(thumb.locator("path")).toHaveAttribute("fill", "black");
  await expect(thumb.locator("path")).toHaveAttribute("fill-rule", "evenodd");
  await expect(
    page.locator('svg[data-testid^="admin-lab-thumb-"]'),
  ).toHaveCount(2);
  await page.getByTestId("admin-lab-toggle-legacy").click();
  await page.reload();
  await expect(page.getByTestId("admin-lab-list")).toContainText("Moderno");
  await expect(page.getByTestId("admin-lab-toggle-legacy")).toContainText(
    "Inactivo",
  );
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(stored.records[0]).toEqual({ ...legacy, enabled: false });
  expect(
    stored.records.map((r: { version: number }) => r.version).sort(),
  ).toEqual([1, 2]);
});

test("File.text fallido es visible; una lectura vieja lenta no pisa la última selección", async ({
  page,
}) => {
  await gotoLab(page);
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === "broken.svg") throw new Error("interrupted");
      if (this.name === "slow.svg")
        await new Promise((r) => setTimeout(r, 700));
      return read.call(this);
    };
  });
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("Carrera");
  await page.getByTestId("admin-lab-category").fill("Arte");
  const input = page.getByTestId("admin-lab-file");
  await input.setInputFiles({
    name: "broken.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(SQUARE),
  });
  await expect(page.getByTestId("admin-lab-error")).toHaveText(
    "No pudimos importar este SVG. No se pudo leer el archivo. Probá de nuevo o elegí otro SVG.",
  );
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
  await input.setInputFiles({
    name: "slow.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(SECURITY_SVG),
  });
  await input.setInputFiles({
    name: "latest.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(TALL),
  });
  await expect(page.getByTestId("admin-lab-success")).toBeVisible();
  await page.waitForTimeout(800);
  const previewSrc = await page
    .getByTestId("admin-lab-preview-svg")
    .getAttribute("src");
  expect(previewSrc).toMatch(/^blob:/);
  await expect(page.getByTestId("admin-lab-error")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-save")).toBeEnabled();
  // Clearing the selection also wins over an in-flight previous read.
  await input.setInputFiles({
    name: "slow.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(SQUARE),
  });
  await input.setInputFiles([]);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("admin-lab-preview-svg")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-success")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
});

test("empieza vacía, sin diseños inventados", async ({ page }) => {
  await gotoLab(page);
  await expect(page.getByTestId("admin-lab-empty")).toBeVisible();
  await expect(page.getByTestId("admin-lab-list")).toBeHidden();
});

test("Cancelar cierra sin guardar", async ({ page }) => {
  await gotoLab(page);
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("Borrador");
  await page.getByTestId("admin-lab-cancel").click();
  await expect(page.getByTestId("admin-lab-form")).toBeHidden();
  await expect(page.getByTestId("admin-lab-empty")).toBeVisible();
});

test("validación del formulario: exige nombre, categoría y archivo válido", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("admin-lab-add").click();
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
  await page.getByTestId("admin-lab-name").fill("Sin archivo");
  await page.getByTestId("admin-lab-category").fill("Varias");
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
  await page
    .getByTestId("admin-lab-file")
    .setInputFiles(tempSvg(MALFORMED_SVG));
  await expect(page.getByTestId("admin-lab-error")).toHaveText(TECHNICAL_MSG);
  await expect(page.getByTestId("admin-lab-save")).toBeDisabled();
});

test("preview del asset respeta sus proporciones declaradas", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Alta", "Guardas", tempSvg(TALL));
  const ratio = await page
    .getByTestId(/^admin-lab-thumb-/)
    .first()
    .evaluate((el) => (el as HTMLElement).style.aspectRatio);
  // Asset apaisado real (200 x 50): la proporción la mandan los campos
  // width/height/viewBox del asset, no el tamaño intrínseco del SVG.
  expect(ratio).toBe("200 / 50");
});

test("búsqueda, filtro por categoría y categorías libres con sugerencias", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  await createDesign(page, "Flor patio", "Flores", tempSvg(TALL));

  await page.getByTestId("admin-lab-search").fill("flor");
  await expect(page.getByTestId("admin-lab-list")).toContainText("Flor patio");
  await expect(page.getByTestId("admin-lab-list")).not.toContainText(
    "Guarda clásica",
  );
  await page.getByTestId("admin-lab-search").fill("");

  await page.getByTestId("admin-lab-category-filter").selectOption("Guardas");
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Guarda clásica",
  );
  await expect(page.getByTestId("admin-lab-list")).not.toContainText(
    "Flor patio",
  );

  // Categoría nueva y libre al dar de alta: las sugerencias no restringen.
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("Sol libre");
  await page.getByTestId("admin-lab-category").fill("Soles");
  await page.getByTestId("admin-lab-file").setInputFiles(tempSvg(SQUARE));
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.getByTestId("admin-lab-save").click();
  await page.getByTestId("admin-lab-category-filter").selectOption("Soles");
  await expect(page.getByTestId("admin-lab-list")).toContainText("Sol libre");
});

test("reemplazo rápido de archivo: gana la última selección", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("Carrera");
  await page.getByTestId("admin-lab-category").fill("Varias");
  const input = page.getByTestId("admin-lab-file");
  await input.setInputFiles(tempSvg(SQUARE));
  await input.setInputFiles(tempSvg(TALL));
  const previewRatio = await page
    .getByTestId("admin-lab-preview-svg")
    .evaluate((el) => (el as HTMLElement).style.aspectRatio);
  expect(previewRatio).toBe("200 / 50");
  await page.getByTestId("admin-lab-save").click();
  const thumbRatio = await page
    .getByTestId(/^admin-lab-thumb-/)
    .first()
    .evaluate((el) => (el as HTMLElement).style.aspectRatio);
  expect(thumbRatio).toBe("200 / 50");
});

test("almacenamiento corrupto: preserva lo válido y avisa sin romper", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key) ?? "{}";
    const data = JSON.parse(raw) as { records: unknown[] };
    data.records.push({ id: "roto", name: "", paths: [{ d: "M0 0 L" }] });
    data.records.push("basura");
    window.localStorage.setItem(key, JSON.stringify(data));
  }, ADMIN_LAB_STORAGE_KEY);
  await page.reload();
  await expect(page.getByTestId("admin-lab-list")).toContainText(
    "Guarda clásica",
  );
  await expect(page.getByTestId("admin-lab-storage-notice")).toBeVisible();
});

test("cuota agotada: error visible y nunca afirma un guardado falso", async ({
  page,
}) => {
  await gotoLab(page);
  await page.evaluate(() => {
    const original = window.localStorage.setItem.bind(window.localStorage);
    (
      window.localStorage as Storage & { __originalSetItem?: typeof original }
    ).__originalSetItem = original;
    window.localStorage.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("No cabe");
  await page.getByTestId("admin-lab-category").fill("Varias");
  await page.getByTestId("admin-lab-file").setInputFiles(tempSvg(SQUARE));
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.getByTestId("admin-lab-save").click();
  await expect(page.getByTestId("admin-lab-storage-notice")).toContainText(
    /cuota|espacio|almacenar/i,
  );
  await expect(page.getByTestId("admin-lab-empty")).toBeVisible();
});

test("almacenamiento no disponible: el panel sigue en pie y avisa", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("sin almacenamiento");
      },
    });
  });
  await gotoLab(page);
  await expect(page.getByTestId("admin-lab-storage-notice")).toBeVisible();
  await expect(page.getByTestId("admin-lab-title")).toContainText(
    "Biblioteca de diseños",
  );
});

test("aislamiento v3: el contenido hostil se purga y el preview nunca inyecta markup", async ({
  page,
}) => {
  await gotoLab(page);
  await uploadBuffer(
    page,
    "Guarda clásica",
    "Guardas",
    wrap(
      `<script>alert(1)</script><g onclick="alert(2)">${'<path d="M10 10H90V90H10Z"/>'}</g>`,
    ),
  );
  // Purgado pero admitido: el archivo se guarda sin su contenido activo.
  await expect(page.getByTestId("admin-lab-success")).toHaveText(
    "Diseño cargado correctamente",
  );
  await page.getByTestId("admin-lab-save").click();
  const audit = await page.evaluate(() => {
    const panel =
      document.querySelector('[data-testid="admin-lab-panel"]') ??
      document.body;
    return {
      scripts: panel.querySelectorAll("script").length,
      handlers: panel.querySelectorAll("[onclick],[onload]").length,
      thumbTag: (
        panel.querySelector('[data-testid^="admin-lab-thumb-"]')?.tagName ?? ""
      ).toLowerCase(),
      thumbSrc:
        panel
          .querySelector('[data-testid^="admin-lab-thumb-"]')
          ?.getAttribute("src") ?? "",
    };
  });
  expect(audit.scripts).toBe(0);
  expect(audit.handlers).toBe(0);
  expect(audit.thumbTag).toBe("img");
  expect(audit.thumbSrc).toMatch(/^blob:/);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).records[0],
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(stored.version).toBe(3);
  expect(stored.svg).not.toContain("<script");
  expect(stored.svg).not.toContain("onclick");
  expect(stored.svg).not.toContain("alert");
  // Solo la clave propia del admin-lab aparece en localStorage.
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(keys).toEqual([ADMIN_LAB_STORAGE_KEY]);
});

test("M3: sobre corrupto bloquea el guardado y conserva el blob intacto", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key) ?? "{}";
    const data = JSON.parse(raw) as { records: unknown[] };
    data.records.push({ id: "roto", name: "", paths: [{ d: "M0 0 L" }] });
    window.localStorage.setItem(key, JSON.stringify(data));
  }, ADMIN_LAB_STORAGE_KEY);
  await page.reload();
  await expect(page.getByTestId("admin-lab-storage-notice")).toBeVisible();
  const before = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    ADMIN_LAB_STORAGE_KEY,
  );
  // Intentar guardar con el sobre dañado: se bloquea con motivo honesto.
  await page.getByTestId("admin-lab-add").click();
  await page.getByTestId("admin-lab-name").fill("Nueva");
  await page.getByTestId("admin-lab-category").fill("Varias");
  await page.getByTestId("admin-lab-file").setInputFiles(tempSvg(SQUARE));
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.getByTestId("admin-lab-save").click();
  await expect(page.getByTestId("admin-lab-form")).toBeVisible();
  await expect(page.getByTestId("admin-lab-storage-notice")).toContainText(
    /dañados|intacto/i,
  );
  const after = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    ADMIN_LAB_STORAGE_KEY,
  );
  expect(after).toBe(before);
});

test("M6/L9: cambios en otra pestaña refrescan sin duplicar", async ({
  page,
  context,
}) => {
  await gotoLab(page);
  const other = await context.newPage();
  await other.goto("/admin-lab");
  await expect(other.getByTestId("admin-lab-title")).toContainText(
    "Biblioteca de diseños",
  );
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  await expect(other.getByTestId("admin-lab-list")).toContainText(
    "Guarda clásica",
  );
  await other.close();
});

test("L10: Escape cierra el diálogo y devuelve el foco; editar sin checklist", async ({
  page,
}) => {
  await gotoLab(page);
  await createDesign(page, "Guarda clásica", "Guardas", tempSvg(SQUARE));
  await page.getByTestId("admin-lab-add").click();
  await expect(page.getByTestId("admin-lab-form")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-lab-form")).toBeHidden();
  await expect(page.getByTestId("admin-lab-add")).toBeFocused();
  // En edición sin archivo nuevo no hay checklist vacía.
  await page
    .getByRole("button", { name: /Editar/ })
    .first()
    .click();
  await expect(page.getByTestId("admin-lab-form")).toBeVisible();
  await expect(page.getByTestId("admin-lab-checklist")).toHaveCount(0);
  await expect(page.getByTestId("admin-lab-preview-svg")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-lab-form")).toBeHidden();
});

test("R6/M6: un asset v3 en otra pestaña refresca la lista sin duplicar", async ({
  page,
  context,
}) => {
  await gotoLab(page);
  const other = await context.newPage();
  await other.goto("/admin-lab");
  await expect(other.getByTestId("admin-lab-title")).toContainText(
    "Biblioteca de diseños",
  );
  await createDesign(page, "Afiche cruzado", "Arte", tempSvg(SQUARE));
  await expect(other.getByTestId("admin-lab-list")).toContainText(
    "Afiche cruzado",
  );
  const thumb = other.getByTestId(/^admin-lab-thumb-/).first();
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((el) => el.tagName.toLowerCase())).toBe("img");
  expect(await thumb.getAttribute("src")).toMatch(/^blob:/);
  await other.close();
});

test("A4: la admisión asset nunca produce un fallo OK", async ({ page }) => {
  await gotoLab(page);
  const result = await page.evaluate(async () => {
    const mod = await import(/* @vite-ignore */ "/src/admin-lab/admission.ts");
    const SVG = "http://www.w3.org/2000/svg";
    const path = '<path d="M0 0H10V10Z"/>';
    const cases = [
      `<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="${SVG}" viewBox="0 0 100 100">${path}</svg>`,
      `<svg xmlns="${SVG}">${path}</svg>`,
      "   ",
      `<svg xmlns="${SVG}" viewBox="0 0 100 100">${"<g>".repeat(80)}${path}${"</g>".repeat(80)}</svg>`,
    ];
    return cases.map((src) => {
      const outcome = mod.admitSvgTextAsAsset(src);
      return outcome.ok ? "accepted" : outcome.error.code;
    });
  });
  expect(result).toEqual(["SECURITY", "TECHNICAL", "MALFORMED", "LIMIT"]);
  for (const code of result) expect(code).not.toBe("OK");
});
