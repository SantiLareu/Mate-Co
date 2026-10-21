/**
 * J3 — Saved-job resolver/adapter in /production-lab (browser, Stage 2 S5/S7).
 *
 * Public flows only, through the existing routes and UI actions:
 * /admin pending-job detail → explicit open-in-lab control →
 * /production-lab?jobId=<id>. No internal module mocking to bypass UI.
 *
 * Every test runs against the default production jobs database inside a
 * fresh browser context per test; teardown deletes ONLY the jobs database
 * this suite touched. The admin catalog (localStorage) is never written.
 *
 * Conventions reused from the existing suites: reload-tolerant readiness
 * (expect.poll, no sleeps), addInitScript fault injection only, no
 * retry masking real failures.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const JOBS_DB_NAME = "mateco.jobs.v1";
const GHOST_PATH = "M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z";
const messiSvg = (): string =>
  readFileSync(
    fileURLToPath(new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url)),
    "utf8",
  );

async function gotoReady(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.getElementById("root")?.childElementCount ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

async function clearJobsDb(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.evaluate(async (name: string) => {
    try {
      if (typeof indexedDB === "undefined" || indexedDB == null) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, JOBS_DB_NAME);
}

async function gotoLab(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/production-lab");
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toBeVisible();
}

/** Seed one job with texts + catalog icons through the real repository. */
async function seedTextIconJob(
  page: import("@playwright/test").Page,
  attemptKey: string,
  label: string,
): Promise<void> {
  await page.evaluate(
    async ({
      name,
      key,
      text,
    }: {
      name: string;
      key: string;
      text: string;
    }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
      const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
      const store = repo.createJobsRepository({ name });
      const captured = snapshot.captureComposition({
        texts: [
          {
            id: `t-${key}`,
            text,
            fontFamily: "Georgia",
            angle: 90,
            radius: 374,
            inverted: false,
            scale: 1,
          },
        ],
        icons: [
          {
            id: `i-${key}`,
            type: "icon",
            iconId: "spark",
            angle: 270,
            radius: 357.5,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        graphics: [],
        approved: [],
        circularLines: "single",
        resolveIcon: (iconId: string) => {
          const found = (
            icons as unknown as {
              iconById: Record<
                string,
                { id: string; name: string; category: string; paths: string[] }
              >;
            }
          ).iconById[iconId];
          if (!found) return null;
          return {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          };
        },
      });
      if (!captured.ok) throw new Error("seed capture failed");
      const created = await store.create({
        attemptKey: key,
        composition: captured.composition,
      });
      if (!created.ok) throw new Error("seed create failed");
    },
    { name: JOBS_DB_NAME, key: attemptKey, text: label },
  );
}

/** Canonical stored bytes of one job (read-only round trip). */
async function storedBytes(
  page: import("@playwright/test").Page,
  attemptKey: string,
): Promise<string> {
  return page.evaluate(
    async ({ name, key }: { name: string; key: string }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const store = repo.createJobsRepository({ name });
      const gotten = await store.get(key);
      if (!gotten.ok) throw new Error(`get failed: ${gotten.error.code}`);
      return JSON.stringify(gotten.job);
    },
    { name: JOBS_DB_NAME, key: attemptKey },
  );
}

async function fillDiameters(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
}

/** Completed measurement: neither pending nor stuck measuring. */
async function expectMeasured(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(page.getByTestId("lab-measuring")).toHaveCount(0);
}

test("S5: default path without ?jobId still shows the demo fixture", async ({
  page,
}) => {
  await gotoLab(page);
  await expect(page.getByTestId("lab-source-kind")).toHaveAttribute(
    "data-source",
    "demo",
  );
  await expect(page.getByTestId("lab-source-kind")).toContainText(
    /demostraci/i,
  );
  // Demo original: the real MatePreview composition, unchanged.
  const original = page.getByTestId("lab-original");
  await expect(original.locator("[data-text-id]")).toHaveCount(2);
  await expect(original.locator("[data-icon-id]")).toHaveCount(2);
  await expect(original.locator("[data-approved-id]")).toHaveCount(1);
  await expect(page.getByTestId("lab-source-fingerprint")).toBeVisible();
  // No job UI leaks into the demo path.
  await expect(page.getByTestId("lab-job-error")).toHaveCount(0);
  await expect(page.getByTestId("lab-job-original")).toHaveCount(0);
  await clearJobsDb(page);
});

test("S5: admin detail opens the saved job in the physical lab", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-1", "Mate de laboratorio");
  await page.goto("/admin");
  await expect(page.getByTestId("jobs-pending-item")).toHaveCount(1);
  await page.getByTestId("jobs-pending-open-lab-job-1").click();
  await expect(page.getByTestId("jobs-pending-detail")).toBeVisible();
  await page.getByTestId("jobs-pending-open-in-lab-lab-job-1").click();
  // Explicit open-in-lab control lands on the job address, no auto redirect.
  await expect(page).toHaveURL(/\/production-lab\?jobId=lab-job-1/);
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toBeVisible();
  // Source is named explicitly: the selected job, never a silent demo.
  const kind = page.getByTestId("lab-source-kind");
  await expect(kind).toHaveAttribute("data-source", "job");
  await expect(kind).toContainText("lab-job-1");
  // Original renders the STORED composition (embedded defs, read-only).
  const original = page.getByTestId("lab-job-original");
  await expect(original).toBeVisible();
  await expect(original).toContainText("Mate de laboratorio");
  await expect(page.getByTestId("lab-original")).toHaveCount(0);
  // The demo fixture stays one explicit step away.
  await expect(page.getByTestId("lab-demo-link")).toHaveAttribute(
    "href",
    "/production-lab",
  );
  // Physical policy reused: annular mapping, outer-diameter sizes.
  await fillDiameters(page);
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  await expect(page.getByTestId("lab-inner-circle")).toHaveAttribute("r", "30");
  await expectMeasured(page);
  await clearJobsDb(page);
});

test("S5: missing job is an explicit named error, never a demo fallback", async ({
  page,
}) => {
  await page.goto("/production-lab?jobId=no-such-job");
  await expect(
    page.getByRole("heading", { name: "Laboratorio de preparación física" }),
  ).toBeVisible();
  const error = page.getByTestId("lab-job-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/no existe/i);
  // No silent demo: neither original pane nor physical scene renders.
  await expect(page.getByTestId("lab-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-job-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-source-kind")).toHaveAttribute(
    "data-source",
    "job-error",
  );
  // Recovery is explicit: the demo fixture behind its own path.
  await page.getByTestId("lab-demo-link").click();
  await expect(page).toHaveURL(/\/production-lab$/);
  await expect(page.getByTestId("lab-source-kind")).toHaveAttribute(
    "data-source",
    "demo",
  );
  await expect(
    page.getByTestId("lab-original").locator("[data-text-id]"),
  ).toHaveCount(2);
  await clearJobsDb(page);
});

test("S5: embedded icon without catalog entry paints the stored original", async ({
  page,
}) => {
  await gotoReady(page);
  await page.evaluate(
    async ({ name, d }: { name: string; d: string }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const store = repo.createJobsRepository({ name });
      // Stored composition with an embedded definition for an iconId that
      // does NOT exist in the live catalog: the lab original must paint
      // from the embedded copy only (same contract as the admin preview).
      const created = await store.create({
        attemptKey: "lab-job-ghost",
        composition: {
          texts: [
            {
              id: "t-ghost",
              text: "Fantasma",
              fontFamily: "Georgia",
              angle: 0,
              radius: 374,
              inverted: false,
              scale: 1,
            },
          ],
          icons: [
            {
              id: "i-ghost",
              iconId: "ghost-not-in-catalog",
              definition: {
                id: "ghost-not-in-catalog",
                name: "Fantasma",
                category: "Símbolos",
                paths: [d],
                frame: { width: 32, height: 32 },
                paint: {
                  fill: "none",
                  stroke: "#171717",
                  strokeWidth: 1.7,
                  linecap: "round",
                  linejoin: "round",
                  innerTransform: "scale(1.4) translate(-16 -16)",
                },
              },
              angle: 270,
              radius: 357.5,
              scale: 1,
              rotation: 0,
              mirrored: false,
              inverted: false,
            },
          ],
          graphics: [],
          approved: [],
          circularLines: "none",
        } as never,
      });
      if (!created.ok)
        throw new Error(`ghost seed failed: ${created.error.code}`);
    },
    { name: JOBS_DB_NAME, d: GHOST_PATH },
  );
  await page.goto("/production-lab?jobId=lab-job-ghost");
  const original = page.getByTestId("lab-job-original");
  await expect(original).toBeVisible();
  await expect(original.locator(`path[d="${GHOST_PATH}"]`)).toHaveCount(1);
  // Honest boundary: no live-catalog entry, so the lab names it instead
  // of silently dropping it.
  await expect(page.getByTestId("lab-job-icons-note")).toContainText("i-ghost");
  await fillDiameters(page);
  await expectMeasured(page);
  await clearJobsDb(page);
});

test("S5: corrupt stored job is an explicit named error, valid jobs intact", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-good", "Trabajo válido");
  // Corrupt record written around the repository (bypasses validation),
  // beside the valid job — never through the catalog.
  await page.evaluate(
    async ({ name, key }: { name: string; key: string }) => {
      const opened = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = opened.transaction("jobs", "readwrite");
        tx.objectStore("jobs").put({
          attemptKey: key,
          id: key,
          version: 999,
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          composition: {
            texts: [],
            icons: [],
            graphics: [],
            approved: [],
            circularLines: "none",
          },
        });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        opened.close();
      }
    },
    { name: JOBS_DB_NAME, key: "lab-job-corrupt" },
  );
  // The corrupt job opens as an explicit damaged-job error, not the demo.
  await page.goto("/production-lab?jobId=lab-job-corrupt");
  const error = page.getByTestId("lab-job-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText(/dañad/i);
  await expect(page.getByTestId("lab-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-job-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  // The valid neighbor still opens untouched.
  await page.goto("/production-lab?jobId=lab-job-good");
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Trabajo válido",
  );
  await fillDiameters(page);
  await expectMeasured(page);
  await clearJobsDb(page);
});

test("S5/S7: storage failure with ?jobId is explicit; demo needs no storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, "indexedDB", {
        get() {
          return undefined;
        },
        configurable: true,
      });
    } catch {
      // The repository still probes support and reports an explicit error.
    }
  });
  // A selected job that cannot be read is an explicit storage error —
  // the demo fixture must NOT stand in for it.
  await page.goto("/production-lab?jobId=any-job");
  const error = page.getByTestId("lab-job-error");
  await expect(error).toBeVisible();
  await expect(error).not.toBeEmpty();
  await expect(page.getByTestId("lab-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-job-original")).toHaveCount(0);
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  // Without ?jobId the fixture/demo path renders with no storage at all.
  await page.goto("/production-lab");
  await expect(page.getByTestId("lab-source-kind")).toHaveAttribute(
    "data-source",
    "demo",
  );
  await expect(
    page.getByTestId("lab-original").locator("[data-text-id]"),
  ).toHaveCount(2);
  await clearJobsDb(page);
});

test("S5: job A→B→A always completes measurement, never stuck measuring", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-a", "Alfa del laboratorio");
  await seedTextIconJob(page, "lab-job-b", "Beta del laboratorio");
  // First pass on A completes through the real browser probe.
  await page.goto("/production-lab?jobId=lab-job-a");
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Alfa del laboratorio",
  );
  await fillDiameters(page);
  await expectMeasured(page);
  // Explicit in-app switch to the demo fixture, same mount.
  await page.getByTestId("lab-demo-link").click();
  await expect(page).toHaveURL(/\/production-lab$/);
  await expect(page.getByTestId("lab-source-kind")).toHaveAttribute(
    "data-source",
    "demo",
  );
  await fillDiameters(page);
  await expectMeasured(page);
  // Browser back returns to A in the same mount: measurement ownership
  // resets deterministically instead of pending forever.
  await page.goBack();
  await expect(page).toHaveURL(/\/production-lab\?jobId=lab-job-a/);
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Alfa del laboratorio",
  );
  await fillDiameters(page);
  await expectMeasured(page);
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await clearJobsDb(page);
});

test("S5: advances are measured per stored text with its stored font/scale", async ({
  page,
}) => {
  await gotoReady(page);
  await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t-big",
          text: "Grande",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
          scale: 1,
        },
        {
          id: "t-small",
          text: "Chico",
          fontFamily: "Courier New",
          angle: 180,
          radius: 340,
          inverted: true,
          scale: 0.9,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "double",
      resolveIcon: (iconId: string) => {
        const found = (
          icons as unknown as {
            iconById: Record<
              string,
              { id: string; name: string; category: string; paths: string[] }
            >;
          }
        ).iconById[iconId];
        if (!found) return null;
        return {
          id: found.id,
          name: found.name,
          category: found.category,
          paths: [...found.paths],
        };
      },
    });
    if (!captured.ok) throw new Error("seed capture failed");
    const created = await store.create({
      attemptKey: "lab-job-fonts",
      composition: captured.composition,
    });
    if (!created.ok) throw new Error("seed create failed");
  }, JOBS_DB_NAME);
  await page.goto("/production-lab?jobId=lab-job-fonts");
  // One probe node per stored text, carrying its stored font family.
  const big = page.getByTestId("lab-measure-t-big");
  const small = page.getByTestId("lab-measure-t-small");
  await expect(big).toHaveCount(1);
  await expect(small).toHaveCount(1);
  await expect(big).toHaveAttribute("font-family", "Georgia");
  await expect(small).toHaveAttribute("font-family", "Courier New");
  await expect(page.getByTestId("lab-job-original")).toContainText("Grande");
  await expect(page.getByTestId("lab-job-original")).toContainText("Chico");
  await fillDiameters(page);
  await expectMeasured(page);
  // Each stored text feeds its own physical span from its measured
  // advance: both ids land in the pure report with finite spans, and the
  // stored scale difference survives into mm font sizes.
  const json = JSON.parse(
    (await page.getByTestId("lab-report-json").textContent()) ?? "",
  );
  const byId = Object.fromEntries(
    (json.texts as Array<{ id: string; halfSpanDegrees: number }>)?.map(
      (entry) => [entry.id, entry],
    ) ?? [],
  );
  expect(Object.keys(byId).sort()).toEqual(["t-big", "t-small"]);
  expect(Number.isFinite(byId["t-big"].halfSpanDegrees)).toBe(true);
  expect(Number.isFinite(byId["t-small"].halfSpanDegrees)).toBe(true);
  // C2: este caso fija el modo A (las fuentes esperadas usan Ro/423).
  await page.getByTestId("lab-strategy-a").check();
  const bigMm = Number(
    await page
      .getByTestId("lab-physical-text-t-big")
      .getAttribute("data-font-size-mm"),
  );
  const smallMm = Number(
    await page
      .getByTestId("lab-physical-text-t-small")
      .getAttribute("data-font-size-mm"),
  );
  expect(bigMm).toBeCloseTo((35 * 50) / 423, 9);
  expect(smallMm).toBeCloseTo((35 * 0.9 * 50) / 423, 9);
  await clearJobsDb(page);
});

test("S5: zero advances complete as unavailable, distinct from pending", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-zero", "Cero medido");
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
  await page.goto("/production-lab?jobId=lab-job-zero");
  await fillDiameters(page);
  // Completed: no more measuring, explicit unavailable label per text.
  await expect(page.getByTestId("lab-measuring")).toHaveCount(0);
  await expect(page.getByTestId("lab-advance-unavailable")).toBeVisible();
  await expect(
    page.getByTestId("lab-text-unavailable-t-lab-job-zero"),
  ).toBeVisible();
  await expect(page.getByTestId("lab-text-pending-t-lab-job-zero")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("lab-outer-circle")).toHaveAttribute("r", "50");
  // The stored original is untouched by the unavailable measurement.
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Cero medido",
  );
  await clearJobsDb(page);
});

test("C2: job mode funciona con ambas estrategias sin mutar el snapshot", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-c2", "Estrategia guardada");
  const before = await storedBytes(page, "lab-job-c2");
  await page.goto("/production-lab?jobId=lab-job-c2");
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Estrategia guardada",
  );
  // Selector presente en modo trabajo, B por defecto.
  await expect(page.getByTestId("lab-strategy-selector")).toBeVisible();
  await expect(page.getByTestId("lab-strategy-b")).toBeChecked();
  await page.getByTestId("lab-outer-input").fill("85");
  await page.getByTestId("lab-inner-input").fill("50");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  const readout = page.getByTestId("lab-strategy-readout");
  await expect(readout).toHaveAttribute("data-strategy", "band-thickness");
  expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
    0.1335877863,
    9,
  );
  // Alternar a A: mismo trabajo, misma composición, factor distinto.
  await page.getByTestId("lab-strategy-a").check();
  await expect(page).toHaveURL(/\/production-lab\?jobId=lab-job-c2/);
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Estrategia guardada",
  );
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  await expect(readout).toHaveAttribute("data-strategy", "outer-diameter");
  expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
    0.1004728132,
    9,
  );
  // Vuelta a B y cambio de medidas: todo deriva de la fuente, sin acumular.
  await page.getByTestId("lab-strategy-b").check();
  await page.getByTestId("lab-outer-input").fill("80");
  await page.getByTestId("lab-inner-input").fill("60");
  await expect(page.getByTestId("lab-physical-svg")).toBeVisible();
  expect(Number(await readout.getAttribute("data-size-factor"))).toBeCloseTo(
    0.0763358779,
    9,
  );
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Estrategia guardada",
  );
  // Solo lectura: los bytes guardados no cambiaron (get público, sin update).
  expect(await storedBytes(page, "lab-job-c2")).toBe(before);
  await clearJobsDb(page);
});

test("C2: medidas inválidas en modo trabajo rechazadas en ambas estrategias", async ({
  page,
}) => {
  await gotoReady(page);
  await seedTextIconJob(page, "lab-job-c2-invalid", "Inválido guardado");
  const before = await storedBytes(page, "lab-job-c2-invalid");
  await page.goto("/production-lab?jobId=lab-job-c2-invalid");
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Inválido guardado",
  );
  await page.getByTestId("lab-outer-input").fill("100");
  await page.getByTestId("lab-inner-input").fill("120");
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  await page.getByTestId("lab-strategy-a").check();
  await expect(page.getByTestId("lab-physical-svg")).toHaveCount(0);
  await expect(page.getByTestId("lab-diameter-issue")).toContainText("menor");
  await expect(page.getByTestId("lab-job-original")).toContainText(
    "Inválido guardado",
  );
  expect(await storedBytes(page, "lab-job-c2-invalid")).toBe(before);
  await clearJobsDb(page);
});

test("S5: opening a job never mutates its stored bytes", async ({ page }) => {
  await gotoReady(page);
  const svgText = messiSvg();
  await page.evaluate(
    async ({ name, svg }: { name: string; svg: string }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
      const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
      const adminRepo = await import(
        /* @vite-ignore */ "/src/admin-lab/repository.ts"
      );
      const store = repo.createJobsRepository({ name });
      const checked = (
        adminRepo as unknown as {
          validateStoredDesign: (value: unknown) => {
            ok: boolean;
            design?: never;
            reason?: string;
          };
        }
      ).validateStoredDesign({
        version: 1,
        id: "dsn-lab-v1",
        name: "Guarda",
        category: "Guardas",
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        paths: [{ d: "M10 10H90V90H10Z" }],
        artBounds: { x: 10, y: 10, width: 80, height: 80 },
        fillRule: "nonzero",
      });
      if (!checked.ok) throw new Error("approved fixture invalid");
      // Full v3 asset through the existing sanitizer: the stored bytes are
      // the validated source string, shared by reference downstream.
      const svgAsset = await import(
        /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
      );
      const admitted = (
        svgAsset as unknown as {
          importSvgAsset: (source: string) =>
            | {
                ok: true;
                asset: {
                  svg: string;
                  width: number | null;
                  height: number | null;
                  viewBox: {
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                  } | null;
                };
              }
            | { ok: false; reason: string };
        }
      ).importSvgAsset(svg);
      if (!admitted.ok)
        throw new Error(`v3 fixture rejected: ${admitted.reason}`);
      const captured = snapshot.captureComposition({
        texts: [
          {
            id: "t-frozen",
            text: "Intacto",
            fontFamily: "Georgia",
            angle: 0,
            radius: 374,
            inverted: false,
            scale: 1,
          },
        ],
        icons: [
          {
            id: "i-frozen",
            type: "icon",
            iconId: "spark",
            angle: 270,
            radius: 357.5,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        graphics: [
          {
            id: "g-frozen",
            paths: [{ d: "M0 0H12V8H0Z" }],
            sourceWidth: 12,
            sourceHeight: 8,
            artBounds: { x: 0, y: 0, width: 12, height: 8 },
            angle: 45,
            radius: 360,
            scale: 1,
            rotation: 10,
            mirrored: false,
            inverted: false,
          },
        ],
        approved: [
          {
            id: "a-frozen",
            type: "approved-design",
            approvedDesignId: "dsn-lab-v1",
            snapshot: checked.design as never,
            angle: 180,
            radius: 357.5,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
          {
            id: "a-v3",
            type: "approved-design",
            approvedDesignId: "dsn-lab-v3",
            snapshot: {
              version: 3,
              id: "dsn-lab-v3",
              name: "Grupo",
              category: "Arte",
              enabled: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              svg: admitted.asset.svg,
              width: admitted.asset.width,
              height: admitted.asset.height,
              viewBox: admitted.asset.viewBox,
            },
            angle: 180,
            radius: 357.5,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        circularLines: "double",
        resolveIcon: (iconId: string) => {
          const found = (
            icons as unknown as {
              iconById: Record<
                string,
                { id: string; name: string; category: string; paths: string[] }
              >;
            }
          ).iconById[iconId];
          if (!found) return null;
          return {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          };
        },
      });
      if (!captured.ok) throw new Error("seed capture failed");
      const created = await store.create({
        attemptKey: "lab-job-frozen",
        composition: captured.composition,
      });
      if (!created.ok) throw new Error("seed create failed");
    },
    { name: JOBS_DB_NAME, svg: svgText },
  );
  const before = await storedBytes(page, "lab-job-frozen");
  await page.goto("/production-lab?jobId=lab-job-frozen");
  await expect(page.getByTestId("lab-job-original")).toContainText("Intacto");
  await fillDiameters(page);
  await expectMeasured(page);
  // The stored graphic is disclosed honestly: intact in the original,
  // outside the physical engine scope.
  await expect(page.getByTestId("lab-job-graphics-note")).toContainText(
    /1 imagen/,
  );
  // v1 art renders through controlled geometry and v3 through its full
  // Blob document, both from the stored snapshot — and the stored bytes
  // are bit-identical afterwards.
  await expect(
    page.getByTestId("lab-physical-approved-a-frozen"),
  ).toBeVisible();
  const v3img = page.getByTestId("lab-physical-approved-img");
  await expect(v3img).toBeVisible();
  const href = await v3img.getAttribute("href");
  expect(href).toMatch(/^blob:/);
  const decoded = await page.evaluate(async (src) => {
    const bytes = await (await fetch(src as string)).text();
    return {
      group: bytes.includes(
        "translate(0.000000,225.000000) scale(0.100000,-0.100000)",
      ),
      localNs: bytes.includes('xmlns="http://www.w3.org/2000/svg"'),
    };
  }, href);
  expect(decoded.group).toBe(true);
  expect(decoded.localNs).toBe(true);
  expect(await storedBytes(page, "lab-job-frozen")).toBe(before);
  await clearJobsDb(page);
});

test("E3 UI wiring: job with traced graphics blocks export with GRAPHICS_NOT_EXPORTED", async ({
  page,
}) => {
  await gotoReady(page);
  // Public job pipeline, real composition: no texts (so the fonts gate
  // cannot fire first), one catalog icon, one traced graphic.
  await page.evaluate(
    async ({ name, key }: { name: string; key: string }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
      const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
      const store = repo.createJobsRepository({ name });
      const captured = snapshot.captureComposition({
        texts: [],
        icons: [
          {
            id: "i-graphics-gate",
            type: "icon",
            iconId: "spark",
            angle: 270,
            radius: 357.5,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        graphics: [
          {
            id: "g-graphics-gate",
            paths: [{ d: "M0 0H12V8H0Z" }],
            sourceWidth: 12,
            sourceHeight: 8,
            artBounds: { x: 0, y: 0, width: 12, height: 8 },
            angle: 45,
            radius: 360,
            scale: 1,
            rotation: 0,
            mirrored: false,
            inverted: false,
          },
        ],
        approved: [],
        circularLines: "single",
        resolveIcon: (iconId: string) => {
          const found = (
            icons as unknown as {
              iconById: Record<
                string,
                { id: string; name: string; category: string; paths: string[] }
              >;
            }
          ).iconById[iconId];
          if (!found) return null;
          return {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          };
        },
      });
      if (!captured.ok)
        throw new Error(`seed capture failed: ${captured.reason}`);
      const created = await store.create({
        attemptKey: key,
        composition: captured.composition,
      });
      if (!created.ok) throw new Error("seed create failed");
    },
    { name: JOBS_DB_NAME, key: "lab-job-graphics-gate" },
  );
  await page.goto("/production-lab?jobId=lab-job-graphics-gate");
  await expect(page.getByTestId("lab-job-original")).toBeVisible();
  // Honest disclosure next to the intact original.
  await expect(page.getByTestId("lab-job-graphics-note")).toContainText(
    /1 imagen/,
  );
  await fillDiameters(page);
  await expectMeasured(page);
  // The export panel blocks with the explicit machine-stable code —
  // never an enabled download, never an exportable claim.
  await expect(page.getByTestId("lab-export-button")).toBeDisabled();
  await expect(page.getByTestId("lab-export-status")).toContainText(
    "GRAPHICS_NOT_EXPORTED",
  );
  await expect(page.getByTestId("lab-export-status")).toContainText(
    /bloqueada/i,
  );
  await expect(page.getByTestId("lab-export-section")).not.toContainText(
    /Composici.n exportable/,
  );
  await expect(page.getByTestId("lab-export-section")).not.toContainText(
    /apto para grabar/i,
  );
  await clearJobsDb(page);
});
