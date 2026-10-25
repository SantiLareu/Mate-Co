/**
 * Catálogo tipográfico del personalizador (Etapa 4).
 *
 * Comprueba que TODAS las superficies de texto usan la misma fuente real
 * (las tres empaquetadas), que no queda ninguna fuente del sistema en el
 * catálogo y que no hay sustitución silenciosa.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { TYPOGRAPHY_FONTS, TYPOGRAPHY_FONT_LIST } from "../src/typography";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CSS = readFileSync(
  resolve(HERE, "../src/styles/typography.css"),
  "utf8",
);
const SYSTEM_FAMILIES = [
  "Georgia",
  "Arial",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Segoe UI",
];

test.describe("catálogo tipográfico", () => {
  test("el catálogo son exactamente las tres fuentes aprobadas (peso 600)", () => {
    expect(TYPOGRAPHY_FONT_LIST.map((f) => f.family)).toEqual([
      "Poppins SemiBold",
      "Lato SemiBold",
      "Dancing Script",
    ]);
    expect(TYPOGRAPHY_FONT_LIST.every((f) => f.weight === 600)).toBe(true);
    // El motor compone Lato y Poppins en su peso nominal y Dancing Script en
    // el eje variable.
    expect(TYPOGRAPHY_FONTS["dancing-script"].variable).toBe(true);
    expect(TYPOGRAPHY_FONTS.lato.variable).toBe(false);
    expect(TYPOGRAPHY_FONTS.poppins.variable).toBe(false);
  });

  test("el catálogo no contiene ninguna fuente del sistema", () => {
    for (const family of SYSTEM_FAMILIES) {
      expect(
        TYPOGRAPHY_FONT_LIST.some((f) => f.family === family),
        `${family} no debe estar en el catálogo`,
      ).toBe(false);
    }
    // El CSS de las @font-face tampoco declara familias genéricas del sistema.
    const faceBlocks = CSS.split("@font-face").slice(1);
    expect(faceBlocks.length).toBe(3);
    for (const block of faceBlocks) {
      expect(block).not.toMatch(/font-family:\s*(Arial|Georgia|Verdana|sans-serif|serif)/);
    }
  });

  test("las @font-face apuntan a los mismos binarios que usa el motor", () => {
    for (const font of TYPOGRAPHY_FONT_LIST) {
      expect(CSS, `falta la @font-face de ${font.family}`).toContain(
        `font-family: "${font.family}"`,
      );
      // La URL del CSS y la del motor coinciden (path + versión).
      const cssUrl = CSS.match(
        new RegExp(`font-family: "${font.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?url\\("([^"]+)"\\)`),
      )?.[1];
      expect(cssUrl, `URL de ${font.family} en el CSS`).toBeTruthy();
      expect(cssUrl).toBe(font.url);
    }
  });

  test("el selector ofrece sólo las tres fuentes del catálogo", async ({ page }) => {
    await page.goto("/");
    // El panel de diseño es la tercera etapa del asistente.
    await page.getByRole("button", { name: /diseño|design/i }).first().click().catch(async () => {
      await page.getByText(/Paso 2|continuar/i).first().click();
    });
    const select = page.locator("select").first();
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    const catalogue = TYPOGRAPHY_FONT_LIST.map((f) => f.family);
    for (const family of catalogue) {
      expect(options, `falta ${family} en el selector`).toContain(family);
    }
    for (const family of SYSTEM_FAMILIES) {
      expect(options, `${family} no debe estar en el selector`).not.toContain(family);
    }
  });

  test("las tres fuentes reales están cargadas en el navegador", async ({ page }) => {
    await page.goto("/");
    const loaded = await page.evaluate(async (families) => {
      const results: Record<string, boolean> = {};
      for (const family of families) {
        try {
          await document.fonts.load(`600 16px "${family}"`);
        } catch {
          /* se reporta como no cargada */
        }
        results[family] = document.fonts.check(`600 16px "${family}"`);
      }
      return results;
    }, TYPOGRAPHY_FONT_LIST.map((f) => f.family));
    for (const [family, ok] of Object.entries(loaded)) {
      expect(ok, `la fuente ${family} no está cargada`).toBe(true);
    }
  });

  test("el editor pinta el texto con la fuente real del catálogo", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Diseño", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await page.locator(".add-text").click();
    // El editor pinta el texto con source.fontFamily.
    const family = await page.evaluate(() => {
      const editor = document.querySelector("svg text");
      return editor?.getAttribute("font-family") ?? null;
    });
    expect(family).not.toBeNull();
    expect(TYPOGRAPHY_FONT_LIST.map((f) => f.family)).toContain(family);
    for (const system of SYSTEM_FAMILIES) {
      expect(family).not.toBe(system);
    }
  });

  test("el laboratorio y el editor coinciden en la fuente del mismo texto", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Diseño", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await page.locator(".add-text").click();
    const editorFamily = await page.evaluate(
      () => document.querySelector("svg text")?.getAttribute("font-family") ?? null,
    );
    await page.goto("/production-lab");
    // El laboratorio es una ruta perezosamente cargada: hay que esperar al
    // render de sus textos.
    await expect(page.locator("svg text").first()).toBeVisible({ timeout: 15000 });
    const labFamily = await page.evaluate(
      () => document.querySelector("svg text")?.getAttribute("font-family") ?? null,
    );
    expect(editorFamily).not.toBeNull();
    expect(labFamily).not.toBeNull();
    expect(labFamily).toBe(editorFamily);
  });

  test("editor y laboratorio: mismo texto, misma fuente y misma geometría relativa", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Diseño", exact: true }),
    ).toHaveAttribute("aria-current", "step");
    await page.locator(".add-text").click();
    // El MISMO texto que el laboratorio usa en su demo ("Mate&Co"): sin esto
    // se compararían textos distintos.
    await page.locator("#text-content").fill("Mate&Co");
    const editor = await page.evaluate(() => {
      const el = document.querySelector("svg text");
      if (!el) return null;
      const length = el.getComputedTextLength();
      const size = Number(el.getAttribute("font-size"));
      const spacing = Number(el.getAttribute("letter-spacing") ?? 0);
      return { length, size, spacing, family: el.getAttribute("font-family") };
    });
    expect(editor).not.toBeNull();
    await page.goto("/production-lab");
    await expect(page.locator("svg text").first()).toBeVisible({ timeout: 15000 });
    const lab = await page.evaluate(() => {
      const el = document.querySelector("svg text");
      if (!el) return null;
      const length = el.getComputedTextLength();
      const size = Number(el.getAttribute("font-size"));
      const spacing = Number(el.getAttribute("letter-spacing") ?? 0);
      return { length, size, spacing, family: el.getAttribute("font-family") };
    });
    expect(lab).not.toBeNull();
    if (!editor || !lab) return;
    // Misma fuente
    expect(lab.family).toBe(editor.family);
    // Mismo tamaño relativo de fuente y de espaciado (el laboratorio escala
    // todo al marco físico, el editor al diseño: la RELACIÓN no cambia).
    const relEditor = { size: editor.size, spacing: editor.spacing / editor.size };
    const relLab = { size: lab.size, spacing: lab.spacing / lab.size };
    expect(relLab.size).toBeCloseTo(relEditor.size, 4);
    expect(relLab.spacing).toBeCloseTo(relEditor.spacing, 4);
    // Y por tanto el avance normalizado al tamaño de fuente coincide, dentro
    // de la cuantización del propio navegador (LayoutUnit 1/64 px) y del
    // redondeo mm <-> unidades de diseño: se exige el 0,1 %.
    const relative =
      Math.abs(lab.length / lab.size - editor.length / editor.size) /
      (editor.length / editor.size);
    expect(relative, "avance normalizado editor vs laboratorio").toBeLessThan(0.001);
  });

  test("el entorno de prueba es móvil (viewports y táctil)", async ({ page }) => {
    const size = page.viewportSize();
    expect(size?.width).toBe(390);
    expect(size?.height).toBe(844);
    const isTouch = await page.evaluate(
      () => "ontouchstart" in window || navigator.maxTouchPoints > 0,
    );
    expect(isTouch).toBe(true);
  });
});
