import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * P2 bounded browser suite (S1–S8): isolated /production-lab route only.
 * Original pane uses the real MatePreview with the frozen source fixture;
 * physical pane renders the SAME pure-report numbers (no new equations).
 * Font-dependent advances are never asserted literally — only report↔SVG
 * consistency and deterministic outer-diameter math (Ro=Do/2, Ri=Di/2).
 */

const MESSI_SHA =
  "e456ef5da86cdcca3c4371eca66b37ff421da9939c16905edd17e9d05dbad4bc";
const messiHash = () =>
  createHash("sha256")
    .update(
      readFileSync(
        fileURLToPath(
          new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url),
        ),
      ),
    )
    .digest("hex");

async function gotoLab(page: Page) {
  await page.goto("/production-lab");
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toBeVisible();
}

test("route renders lab with blank inputs and the real original composition", async ({
  page,
}) => {
  await gotoLab(page);
  await expect(page.getByTestId("lab-outer-input")).toHaveValue("");
  await expect(page.getByTestId("lab-inner-input")).toHaveValue("");
  // No assumed physical values: invalid/blank clears the physical scene.
  await expect(page.getByTestId("lab-no-physical")).toBeVisible();
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  // Original pane: SAME types as the source fixture (texts, icons, Messi, double lines).
  const original = page.getByTestId("lab-original");
  await expect(original.locator("[data-text-id]")).toHaveCount(2);
  await expect(original.locator("[data-icon-id]")).toHaveCount(2);
  await expect(original.locator("[data-approved-id]")).toHaveCount(1);
  await expect(original.locator(".decorative-lines circle")).toHaveCount(2);
  const href = await original
    .locator("[data-approved-id] image.approved-art")
    .getAttribute("href");
  expect(href).toMatch(/^blob:/);
});

test("valid 100/60 maps both diameters exactly to Ro50/Ri30", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  const svg = page.getByTestId("lab-physical-svg");
  await expect(svg).toBeVisible();
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  await expect(page.getByTestId("lab-inner-circle")).toHaveAttribute("r", "30");
  await expect(page.getByTestId("lab-frame")).toContainText("100 mm");
  await expect(page.getByTestId("lab-frame")).toContainText("60 mm");
  await expect(page.getByTestId("lab-frame")).toContainText("Ro 50 mm");
  await expect(page.getByTestId("lab-frame")).toContainText("Ri 30 mm");
});

test("icon pose and text parameters follow the pure report numbers", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  // C2: este caso fija el modo A (los números esperados son Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  // Spark at angle 90/radius 360: center (40.381679389313, 0), uniform kSize.
  const spark = page.getByTestId("lab-physical-icon-lab-icon-spark");
  await expect(spark).toBeVisible();
  expect(Number(await spark.getAttribute("data-center-x"))).toBeCloseTo(
    40.381679389313,
    6,
  );
  expect(Number(await spark.getAttribute("data-center-y"))).toBeCloseTo(0, 6);
  expect(Number(await spark.getAttribute("data-local-scale"))).toBeCloseTo(
    50 / 423,
    9,
  );
  await expect(spark).toHaveAttribute("data-rotation", "15");
  await expect(spark).toHaveAttribute("data-mirrored", "false");
  expect(await spark.getAttribute("transform")).toContain(
    await spark.getAttribute("data-center-x"),
  );
  // Top text: deterministic font math (35*50/423), report-tied span.
  const text = page.getByTestId("lab-physical-text-lab-text-top");
  await expect(text).toHaveAttribute("data-half-span", /.+/);
  expect(Number(await text.getAttribute("data-font-size-mm"))).toBeCloseTo(
    (35 * 50) / 423,
    9,
  );
  await expect(text).toHaveAttribute("data-sweep", "1");
  await expect(page.locator("#lab-physical-curve-lab-text-top")).toHaveCount(1);
  // Own path IDs: no collision with the original MatePreview fixed IDs.
  await expect(page.locator("#curve-lab-text-top")).toHaveCount(1);
  // SVG span equals the serialized pure-report span (no stale equations).
  const json = JSON.parse(
    (await page.getByTestId("lab-report-json").textContent()) ?? "",
  );
  const reported = json.texts.find(
    (entry: { id: string }) => entry.id === "lab-text-top",
  );
  expect(Number(await text.getAttribute("data-half-span"))).toBe(
    reported.halfSpanDegrees,
  );
  expect(Number(await text.getAttribute("data-font-size-mm"))).toBe(
    reported.fontSizeMm,
  );
});

test("Messi v3 keeps single-source bytes, 4:3 decode and internal transform", async ({
  page,
}) => {
  expect(messiHash()).toBe(MESSI_SHA);
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  const img = page.getByTestId("lab-physical-approved-img");
  await expect(img).toBeVisible();
  const href = await img.getAttribute("href");
  expect(href).toMatch(/^blob:/);
  // Fit-64 display metadata in source units (300pt/225pt → 400×300 → 64×48).
  expect(Number(await img.getAttribute("width"))).toBeCloseTo(64, 6);
  expect(Number(await img.getAttribute("height"))).toBeCloseTo(48, 6);
  const decoded = await page.evaluate(async (src) => {
    const probe = new Image();
    await new Promise<void>((resolve, reject) => {
      probe.onload = () => resolve();
      probe.onerror = () => reject(new Error("blob did not decode"));
      probe.src = src as string;
    });
    const bytes = await (await fetch(src as string)).text();
    return {
      w: probe.naturalWidth,
      h: probe.naturalHeight,
      group: bytes.includes(
        "translate(0.000000,225.000000) scale(0.100000,-0.100000)",
      ),
      localNs: bytes.includes('xmlns="http://www.w3.org/2000/svg"'),
    };
  }, href);
  expect(decoded.w / decoded.h).toBeCloseTo(4 / 3, 2);
  expect(decoded.group).toBe(true);
  expect(decoded.localNs).toBe(true);
  expect(messiHash()).toBe(MESSI_SHA);
});

test("immediate 100→120 rebuilds without stale text metrics", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  // C2: este caso fija el modo A (los números esperados son Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  const text = page.getByTestId("lab-physical-text-lab-text-top");
  await expect(text).toHaveAttribute("data-half-span", /.+/);
  const beforeSpan = await text.getAttribute("data-half-span");
  await page.getByTestId("lab-outer-input").fill("120");
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "60");
  const after = page.getByTestId("lab-physical-text-lab-text-top");
  expect(Number(await after.getAttribute("data-font-size-mm"))).toBeCloseTo(
    (35 * 60) / 423,
    9,
  );
  const afterSpan = await after.getAttribute("data-half-span");
  expect(afterSpan).not.toBe(beforeSpan);
  const json = JSON.parse(
    (await page.getByTestId("lab-report-json").textContent()) ?? "",
  );
  expect(json.frame.outerRadius).toBe(60);
  expect(Number(afterSpan)).toBe(
    json.texts.find((entry: { id: string }) => entry.id === "lab-text-top")
      .halfSpanDegrees,
  );
});

test("invalid blank or inner>=outer removes physical but keeps original", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await page.getByTestId("lab-inner-input").fill("");
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-no-physical")).toBeVisible();
  await expect(
    page.getByTestId("lab-original").locator("[data-text-id]"),
  ).toHaveCount(2);
  await page.getByTestId("lab-inner-input").fill("120");
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  await expect(
    page.getByTestId("lab-original").locator("[data-approved-id]"),
  ).toHaveCount(1);
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
});

test("thin 100/99 keeps outer size with visible envelope spill", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("99");
  // C2: este caso fija el modo A (la escala esperada es Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  const svg = page.getByTestId("lab-physical-svg");
  expect(
    await svg.evaluate(
      (node) => getComputedStyle(node as SVGSVGElement).overflow,
    ),
  ).toBe("visible");
  await expect(page.getByTestId("lab-warnings")).toContainText("puede cruzar");
  await expect(page.getByTestId("lab-warnings")).toContainText(
    "no colisión de tinta probada",
  );
  // No autoshrink: the icon keeps the outer-diameter uniform scale.
  const spark = page.getByTestId("lab-physical-icon-lab-icon-spark");
  expect(Number(await spark.getAttribute("data-local-scale"))).toBeCloseTo(
    50 / 423,
    9,
  );
});

test("fingerprint constant, honest warnings, editor route unchanged", async ({
  page,
}) => {
  await gotoLab(page);
  const fp = page.getByTestId("lab-source-fingerprint");
  const before = await fp.getAttribute("data-fingerprint");
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  expect(await fp.getAttribute("data-fingerprint")).toBe(before);
  await expect(page.getByTestId("lab-warnings")).toContainText(
    "sin métricas de tinta",
  );
  await expect(page.getByTestId("lab-clearances")).toContainText(
    "distancias desconocidas",
  );
  await expect(page.getByTestId("lab-physical")).not.toContainText(
    "listo para producción",
  );
  await page.goto("/");
  await expect(page.locator("svg.mate")).toBeVisible();
  await expect(page.locator(".add-approved")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toHaveCount(0);
});

test("physical lines carry the original composition knockout, references stay unmasked", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  // C2: este caso fija el modo A (knockouts esperados con Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  const svg = page.getByTestId("lab-physical-svg");
  await expect(svg).toBeVisible();
  // Lines group is masked with the lab's own knockout id.
  const lines = page.getByTestId("lab-physical-lines");
  await expect(lines).toBeVisible();
  expect(await lines.getAttribute("mask")).toBe(
    "url(#lab-physical-lines-knockout)",
  );
  await expect(page.getByTestId("lab-physical-lines-mask")).toHaveCount(1);
  // Icon knockout mirrors the source rule at the placed center.
  const spark = page.getByTestId("lab-physical-icon-lab-icon-spark");
  const sparkKo = page.getByTestId("lab-physical-knockout-lab-icon-spark");
  await expect(sparkKo).toHaveCount(1);
  expect(Number(await sparkKo.getAttribute("cx"))).toBe(
    Number(await spark.getAttribute("data-center-x")),
  );
  expect(Number(await sparkKo.getAttribute("cy"))).toBe(
    Number(await spark.getAttribute("data-center-y")),
  );
  expect(Number(await sparkKo.getAttribute("r"))).toBeCloseTo(
    4.651931330889761,
    2,
  );
  // Text knockout mirrors the source stroked-arc rule.
  const textKo = page.getByTestId("lab-physical-knockout-lab-text-top");
  await expect(textKo).toHaveCount(1);
  expect(Number(await textKo.getAttribute("stroke-width"))).toBeCloseTo(
    5.319148936170213,
    2,
  );
  // Reference circles are never masked.
  expect(
    await page.getByTestId("lab-outer-circle").getAttribute("mask"),
  ).toBeNull();
  expect(
    await page.getByTestId("lab-inner-circle").getAttribute("mask"),
  ).toBeNull();
  // Original parity: source mask ids intact and distinct from lab ids.
  const original = page.getByTestId("lab-original");
  await expect(original.locator("#decorative-lines-knockout")).toHaveCount(1);
  await expect(original.locator("#icon-knockout-lab-icon-spark")).toHaveCount(
    1,
  );
  await expect(original.locator("#text-knockout-lab-text-top")).toHaveCount(1);
  await expect(page.locator("#lab-physical-lines-knockout")).toHaveCount(1);
  // Mask labelled as artistic source rule, never a manufacturing claim.
  await expect(page.getByTestId("lab-lines-note")).toContainText(
    "fuente: regla visual original; no margen de fabricación",
  );
  // No false line↔ink collision claim: honest unknown preserved, no pair
  // false positives on this frame.
  await expect(page.getByTestId("lab-warnings")).toContainText(
    "no se afirma invasión ni holgura de tinta",
  );
  await expect(
    page
      .getByTestId("lab-warnings")
      .locator('li[data-kind="potential-overlap"]'),
  ).toHaveCount(0);
});

test("narrow 100/99.5 reports signed line invasions without shrinking art", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("99.5");
  // C2: este caso fija el modo A (la escala esperada es Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  await expect(page.getByTestId("lab-inner-circle")).toHaveAttribute(
    "r",
    "49.75",
  );
  await expect(page.getByTestId("lab-warnings")).toContainText("line-367");
  await expect(page.getByTestId("lab-warnings")).toContainText("line-347");
  await expect(page.getByTestId("lab-warnings")).toContainText(
    "no es umbral de fabricación",
  );
  // No autoadjust: icon keeps the outer-diameter uniform scale.
  const spark = page.getByTestId("lab-physical-icon-lab-icon-spark");
  expect(Number(await spark.getAttribute("data-local-scale"))).toBeCloseTo(
    50 / 423,
    9,
  );
});

test("entered invalid diameters show field validation, cleared fields stay blank", async ({
  page,
}) => {
  await gotoLab(page);
  // True keyboard entry of an invalid value: explicit field error, no stale scene.
  await page.getByTestId("lab-outer-input").pressSequentially("abc");
  await expect(page.getByTestId("lab-outer-error")).toBeVisible();
  await expect(page.getByTestId("lab-outer-input")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-no-physical")).toBeVisible();
  // Deliberately cleared field: blank again, never labelled an error.
  await page.getByTestId("lab-outer-input").fill("");
  await expect(page.getByTestId("lab-outer-error")).toHaveCount(0);
  await expect(page.getByTestId("lab-outer-input")).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  // Non-finite entry is invalid, not blank.
  await page.getByTestId("lab-outer-input").fill("1e400");
  await expect(page.getByTestId("lab-outer-error")).toBeVisible();
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  // Recovery still works.
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-outer-error")).toHaveCount(0);
});

test("advance probe completes as unavailable when the browser measures zero", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const proto = (window as unknown as { SVGTextElement?: object })
      .SVGTextElement as unknown as {
      prototype: { getComputedTextLength: () => number };
    };
    if (!proto?.prototype?.getComputedTextLength) return;
    const original = proto.prototype.getComputedTextLength;
    proto.prototype.getComputedTextLength = function (
      this: SVGTextElement,
    ): number {
      if (this.closest?.('[data-testid="lab-advance-measurer"]')) return 0;
      return original.call(this);
    };
  });
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  // Completed: no more measuring, explicit unavailable label.
  await expect(page.getByTestId("lab-measuring")).toHaveCount(0);
  await expect(page.getByTestId("lab-advance-unavailable")).toBeVisible();
  await expect(
    page.getByTestId("lab-text-unavailable-lab-text-top"),
  ).toBeVisible();
  await expect(page.getByTestId("lab-text-pending-lab-text-top")).toHaveCount(
    0,
  );
  // Report still finite, references valid, original untouched, no fake span.
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  await expect(page.getByTestId("lab-inner-circle")).toHaveAttribute("r", "30");
  await expect(page.getByTestId("lab-physical-text-lab-text-top")).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId("lab-original").locator("[data-text-id]"),
  ).toHaveCount(2);
});

test("C2: selector presente con modo B por defecto en el laboratorio", async ({
  page,
}) => {
  await gotoLab(page);
  const selector = page.getByTestId("lab-strategy-selector");
  await expect(selector).toBeVisible();
  await expect(selector).toContainText(/Diámetro exterior/);
  await expect(selector).toContainText(/Espesor de banda/);
  await expect(page.getByTestId("lab-strategy-a")).toHaveCount(1);
  await expect(page.getByTestId("lab-strategy-b")).toHaveCount(1);
  // Default B solo en el laboratorio.
  await expect(page.getByTestId("lab-strategy-b")).toBeChecked();
  await expect(page.getByTestId("lab-strategy-a")).not.toBeChecked();
  // Sin diámetros aún no hay lectura aplicada, pero el selector ya declara B.
  await expect(selector).toContainText(/Espesor de banda/);
});

test("C2: factores exactos por estrategia en 85/50, 80/60 y 75/65", async ({
  page,
}) => {
  await gotoLab(page);
  const cases: Array<{
    outer: string;
    inner: string;
    a: number;
    b: number;
    band: string;
  }> = [
    {
      outer: "85",
      inner: "50",
      a: 0.1004728132,
      b: 0.1335877863,
      band: "17.5",
    },
    { outer: "80", inner: "60", a: 0.0945626478, b: 0.0763358779, band: "10" },
    { outer: "75", inner: "65", a: 0.0886524823, b: 0.0381679389, band: "5" },
  ];
  for (const item of cases) {
    await page.getByTestId("lab-outer-input").fill(item.outer);
    await page.getByTestId("lab-inner-input").fill(item.inner);
    const readout = page.getByTestId("lab-strategy-readout");
    await expect(readout).toBeVisible();
    // Modo B por defecto: factor de banda + espesor visible.
    await expect(readout).toHaveAttribute("data-strategy", "band-thickness");
    expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
      item.b,
      9,
    );
    await expect(readout).toContainText(item.band);
    await expect(readout).toContainText(/Espesor de banda/);
    // Lectura distinguible de la leyenda geométrica existente.
    await expect(page.getByTestId("lab-geometry-legend")).not.toContainText(
      /Estrategia activa/,
    );
    // Modo A: factor por diámetro exterior.
    await page.getByTestId("lab-strategy-a").check();
    await expect(readout).toHaveAttribute("data-strategy", "outer-diameter");
    expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
      item.a,
      9,
    );
    await expect(readout).toContainText(/Diámetro exterior/);
    // Vuelta a B: el mismo factor de banda, sin acumulación.
    await page.getByTestId("lab-strategy-b").check();
    await expect(readout).toHaveAttribute("data-strategy", "band-thickness");
    expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
      item.b,
      9,
    );
  }
});

test("C2: alternar A↔B es instantáneo y conserva medidas y composición", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("85");
  await page.getByTestId("lab-inner-input").fill("50");
  const svg = page.getByTestId("lab-physical-svg");
  await expect(svg).toBeVisible();
  const readout = page.getByTestId("lab-strategy-readout");
  const factorB = await readout.getAttribute("data-size-factor");
  // Sin recarga: la misma página y los mismos inputs tras cada alternancia.
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-outer-input")).toHaveValue("85");
  await expect(page.getByTestId("lab-inner-input")).toHaveValue("50");
  await expect(svg).toBeVisible();
  // Los diámetros físicos no cambian con la estrategia; el factor sí.
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute(
    "r",
    "42.5",
  );
  await expect(page.getByTestId("lab-inner-circle")).toHaveAttribute("r", "25");
  expect(await readout.getAttribute("data-size-factor")).not.toBe(factorB);
  const original = page.getByTestId("lab-original");
  await expect(original.locator("[data-text-id]")).toHaveCount(2);
  await expect(original.locator("[data-icon-id]")).toHaveCount(2);
  await expect(original.locator("[data-approved-id]")).toHaveCount(1);
  // Vuelta a B y de nuevo a A: todo intacto, sin acumulación.
  await page.getByTestId("lab-strategy-b").check();
  expect(await readout.getAttribute("data-size-factor")).toBe(factorB);
  await expect(page.getByTestId("lab-outer-input")).toHaveValue("85");
  await expect(svg).toBeVisible();
  await page.getByTestId("lab-strategy-a").check();
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-outer-input")).toHaveValue("85");
  await expect(original.locator("[data-text-id]")).toHaveCount(2);
  await expect(svg).toBeVisible();
});

test("C2: atributos SVG coherentes por estrategia y sin recorte", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("85");
  await page.getByTestId("lab-inner-input").fill("50");
  const svg = page.getByTestId("lab-physical-svg");
  await expect(svg).toBeVisible();
  const readout = page.getByTestId("lab-strategy-readout");
  for (const mode of ["b", "a", "b"] as const) {
    await page.getByTestId(`lab-strategy-${mode}`).check();
    const applied = Number(await readout.getAttribute("data-size-factor"));
    expect(Number.isFinite(applied)).toBe(true);
    // El SVG declara la estrategia vigente.
    await expect(svg).toHaveAttribute(
      "data-strategy",
      mode === "a" ? "outer-diameter" : "band-thickness",
    );
    // La escala del ícono coincide con el factor aplicado (fuente escala 1).
    const spark = page.getByTestId("lab-physical-icon-lab-icon-spark");
    expect(Number(await spark.getAttribute("data-local-scale"))).toBeCloseTo(
      applied,
      9,
    );
    // Sin clipping: el desborde sigue visible en ambas estrategias.
    expect(
      await svg.evaluate(
        (node) => getComputedStyle(node as SVGSVGElement).overflow,
      ),
    ).toBe("visible");
    // Guías de referencia intactas y sin máscara.
    await expect(page.getByTestId("lab-outer-circle")).toBeVisible();
    expect(
      await page.getByTestId("lab-outer-circle").getAttribute("mask"),
    ).toBeNull();
    expect(
      await page.getByTestId("lab-inner-circle").getAttribute("mask"),
    ).toBeNull();
  }
});

test("C2: medidas inválidas rechazadas en ambas estrategias", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("120");
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  // El rechazo persiste al cambiar de estrategia y viceversa.
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  await expect(page.getByTestId("lab-strategy-readout")).toHaveCount(0);
  await page.getByTestId("lab-strategy-b").check();
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  // Recuperación válida en B.
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-strategy-readout")).toHaveAttribute(
    "data-strategy",
    "band-thickness",
  );
});

test("advance probe completes as unavailable when measurement throws", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const proto = (window as unknown as { SVGTextElement?: object })
      .SVGTextElement as unknown as {
      prototype: { getComputedTextLength: () => number };
    };
    if (!proto?.prototype?.getComputedTextLength) return;
    const original = proto.prototype.getComputedTextLength;
    proto.prototype.getComputedTextLength = function (
      this: SVGTextElement,
    ): number {
      if (this.closest?.('[data-testid="lab-advance-measurer"]'))
        throw new Error("advance unsupported");
      return original.call(this);
    };
  });
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-measuring")).toHaveCount(0);
  await expect(page.getByTestId("lab-advance-unavailable")).toBeVisible();
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  await expect(
    page.getByTestId("lab-original").locator("[data-icon-id]"),
  ).toHaveCount(2);
});

test("C3: approved node exposes base display size and placed footprint", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  const node = page.getByTestId("lab-physical-approved-lab-approved-1");
  await expect(node).toHaveCount(1);
  await expect(node).toHaveAttribute("data-display-base-w-mm", /.+/);
  await expect(node).toHaveAttribute("data-display-base-h-mm", /.+/);
  await expect(node).toHaveAttribute("data-w-mm", /.+/);
  await expect(node).toHaveAttribute("data-h-mm", /.+/);
  // Old mislabeled names are gone.
  expect(await node.getAttribute("data-display-w-mm")).toBeNull();
  expect(await node.getAttribute("data-display-h-mm")).toBeNull();
  // Fixture approved scale is 1: placed footprint equals the scale-1 base.
  expect(Number(await node.getAttribute("data-w-mm"))).toBeCloseTo(
    Number(await node.getAttribute("data-display-base-w-mm")),
    9,
  );
  expect(Number(await node.getAttribute("data-h-mm"))).toBeCloseTo(
    Number(await node.getAttribute("data-display-base-h-mm")),
    9,
  );
});

test("E3 UI wiring: demo path with zero graphics keeps the fonts gate first", async ({
  page,
}) => {
  await gotoLab(page);
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  // The demo fixture carries texts and no graphics: the fonts gate still
  // fires first, unchanged by the graphics-count wiring (demo = 0).
  await expect(page.getByTestId("lab-export-button")).toBeDisabled();
  await expect(page.getByTestId("lab-export-status")).toContainText(
    "FONT_OUTLINES_UNAVAILABLE",
  );
  await expect(page.getByTestId("lab-export-status")).not.toContainText(
    "GRAPHICS_NOT_EXPORTED",
  );
});
