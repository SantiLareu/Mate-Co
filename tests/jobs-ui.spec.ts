/**
 * J2 — Explicit customer confirm integration + admin pending jobs (browser).
 *
 * UI flows run against the default production jobs database inside a fresh
 * browser context per test, so no unique-name injection is needed here;
 * teardown deletes ONLY the jobs database this suite touched. The admin
 * catalog (localStorage) is never written by these tests.
 *
 * Conventions reused from the existing suites: reload-tolerant gotoReady
 * (expect.poll, no sleeps), addInitScript fault injection only, no
 * gotoReady-style retry masking real failures.
 */
import { expect, test } from "@playwright/test";

const JOBS_DB_NAME = "mateco.jobs.v1";

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
    // Fault-injected pages may run without IndexedDB: never fail teardown.
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

async function jobsCount(
  page: import("@playwright/test").Page,
): Promise<number> {
  return page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const store = repo.createJobsRepository({ name });
    const listed = await store.list({ limit: 100 });
    if (!listed.ok) throw new Error(`list failed: ${listed.error.code}`);
    return listed.jobs.length;
  }, JOBS_DB_NAME);
}

async function addTextAndConfirm(
  page: import("@playwright/test").Page,
): Promise<void> {
  await gotoReady(page);
  await page.locator(".add-text").click();
  await expect(page.locator("[data-text-id]")).toBeVisible();
  await page.locator(".design-confirm").click();
  await expect(page.getByRole("heading", { name: "Tu diseño" })).toBeVisible();
}

test("S2: visiting/back/refresh never creates a job — only explicit confirm does", async ({
  page,
}) => {
  await addTextAndConfirm(page);
  // Visiting the Confirm screen is not a confirmation.
  expect(await jobsCount(page)).toBe(0);
  // Going back is not a confirmation either.
  await page.locator(".back-to-edit").click();
  await expect(page.locator(".add-text")).toBeVisible();
  expect(await jobsCount(page)).toBe(0);
  // Reloading is not a confirmation either.
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.getElementById("root")?.childElementCount ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  expect(await jobsCount(page)).toBe(0);
  await clearJobsDb(page);
});

test("S2: double click issues ONE durable job and shows the persisted id/status", async ({
  page,
}) => {
  await addTextAndConfirm(page);
  // force: both click pairs land on the CTA point without Playwright
  // re-gating actionability between them; the disabled button (stable
  // label, no layout shift) swallows the second pair at browser level
  // and the coordinator inflight guard covers the rest. Exactly ONE
  // durable job must exist.
  await page.locator(".confirm-design").dblclick({ force: true });
  const job = page.getByTestId("confirm-job");
  await expect(job).toBeVisible({ timeout: 15_000 });
  await expect(job).toContainText(/pending/i);
  expect(await jobsCount(page)).toBe(1);
  await clearJobsDb(page);
});

test("S3: failed save shows an honest typed error and retry reuses the attempt", async ({
  page,
}) => {
  await addTextAndConfirm(page);
  // Fail exactly the next IndexedDB add with a quota error.
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as unknown as {
      add: IDBObjectStore["add"];
    };
    const orig = proto.add;
    (window as unknown as Record<string, unknown>).__jobsFailNextAdd = true;
    proto.add = function (this: IDBObjectStore, ...args: unknown[]) {
      if ((window as unknown as Record<string, unknown>).__jobsFailNextAdd) {
        (window as unknown as Record<string, unknown>).__jobsFailNextAdd =
          false;
        throw new DOMException("quota", "QuotaExceededError");
      }
      return (orig as (...a: unknown[]) => IDBRequest).apply(this, args);
    };
  });
  await page.locator(".confirm-design").click();
  const error = page.getByTestId("confirm-error");
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText(/cuota|almacenamiento/i);
  expect(await jobsCount(page)).toBe(0);
  // Retry is the same unchanged attempt: it must succeed without a new key.
  await page.getByTestId("confirm-retry").click();
  await expect(page.getByTestId("confirm-job")).toBeVisible({
    timeout: 15_000,
  });
  expect(await jobsCount(page)).toBe(1);
  await clearJobsDb(page);
});

test("S2: CONFLICT is a retryable state, never a user-blaming error", async ({
  page,
}) => {
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const base = {
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none" as const,
      resolveIcon: () => null,
    };
    const first = snapshot.captureComposition({
      ...base,
      texts: [
        {
          id: "t1",
          text: "Original",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
    });
    const second = snapshot.captureComposition({
      ...base,
      texts: [
        {
          id: "t1",
          text: "Otro contenido",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
    });
    if (!first.ok || !second.ok) return { stage: "capture-failed" };
    const created = await store.create({
      attemptKey: "ui-conflict-key",
      composition: first.composition,
    });
    if (!created.ok) return { stage: "seed-failed" };
    const clash = await store.create({
      attemptKey: "ui-conflict-key",
      composition: second.composition,
    });
    if (clash.ok) return { stage: "no-conflict" };
    return {
      stage: "ok",
      code: clash.error.code,
      message: clash.error.message,
    };
  }, JOBS_DB_NAME);
  expect(result.stage).toBe("ok");
  expect(result.code).toBe("CONFLICT");
  // Retryable wording (already saved / do not overwrite), never phrased as
  // invalid user input to fix.
  expect(result.message).toMatch(/guardó|reintent|no se sobrescribe/i);
  expect(result.message).not.toMatch(/inválido|corregí|tu diseño está mal/i);
  await clearJobsDb(page);
});

async function seedJob(
  page: import("@playwright/test").Page,
  attemptKey: string,
  text: string,
): Promise<void> {
  await page.evaluate(
    async ({
      name,
      key,
      label,
    }: {
      name: string;
      key: string;
      label: string;
    }) => {
      const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
      const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
      const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
      const store = repo.createJobsRepository({ name });
      const captured = snapshot.captureComposition({
        texts: [
          {
            id: `t-${key}`,
            text: label,
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
    { name: JOBS_DB_NAME, key: attemptKey, label: text },
  );
}

test("S4: admin lists seeded jobs and opens a read-only detail", async ({
  page,
}) => {
  await gotoReady(page);
  await seedJob(page, "admin-job-1", "Mate uno");
  await seedJob(page, "admin-job-2", "Mate dos");
  await page.goto("/admin");
  const section = page.getByTestId("jobs-pending-section");
  await expect(section).toBeVisible();
  await expect(section).toContainText(/trabajos pendientes/i);
  const items = page.getByTestId("jobs-pending-item");
  await expect(items).toHaveCount(2);
  // Read-only list: identifier, date, status and preview — no admin
  // processing buttons anywhere in the section.
  await expect(section).toContainText("admin-job-1");
  await expect(section).toContainText(/pendiente/i);
  await expect(
    section.getByRole("button", { name: /eliminar|procesar|completar/i }),
  ).toHaveCount(0);
  // Optional customer: none was provided, so none is invented.
  await expect(page.getByTestId("jobs-pending-customer")).toHaveCount(0);
  await page.getByTestId("jobs-pending-open-admin-job-1").click();
  const detail = page.getByTestId("jobs-pending-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("admin-job-1");
  await expect(detail).toContainText(/pendiente/i);
  await expect(
    detail.getByRole("button", { name: /eliminar|editar|procesar/i }),
  ).toHaveCount(0);
  await page.getByTestId("jobs-pending-back").click();
  await expect(page.getByTestId("jobs-pending-item")).toHaveCount(2);
  await clearJobsDb(page);
});

test("S4: preview ids stay instance-scoped across two cards (no crosswire)", async ({
  page,
}) => {
  await gotoReady(page);
  await seedJob(page, "scope-job-a", "Alcance A");
  await seedJob(page, "scope-job-b", "Alcance B");
  await page.goto("/admin");
  await expect(page.getByTestId("jobs-pending-item")).toHaveCount(2);
  const wiring = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('[data-testid="jobs-pending-item"]'),
    );
    const ids: string[] = [];
    const refs: string[] = [];
    for (const card of cards) {
      for (const node of card.querySelectorAll("[id]"))
        ids.push(node.getAttribute("id") ?? "");
      const html = card.innerHTML;
      const matches = html.matchAll(/url\(#([^)]+)\)|href=\"#([^\"]+)\"/g);
      for (const match of matches) refs.push(match[1] ?? match[2]);
    }
    const duplicates = ids.filter(
      (id, index) => id !== "" && ids.indexOf(id) !== index,
    );
    const dangling = refs.filter((ref) => ref !== "" && !ids.includes(ref));
    return { cards: cards.length, ids: ids.length, duplicates, dangling };
  });
  expect(wiring.cards).toBe(2);
  expect(wiring.ids).toBeGreaterThan(0);
  expect(wiring.duplicates).toEqual([]);
  expect(wiring.dangling).toEqual([]);
  await clearJobsDb(page);
});

test("S4: embedded icon renders without any live catalog entry", async ({
  page,
}) => {
  await gotoReady(page);
  await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const store = repo.createJobsRepository({ name });
    // Stored composition with an embedded definition for an iconId that
    // does NOT exist in the live catalog: the preview must render from
    // the embedded copy only.
    const created = await store.create({
      attemptKey: "ghost-icon-job",
      composition: {
        texts: [],
        icons: [
          {
            id: "i-ghost",
            iconId: "ghost-not-in-catalog",
            definition: {
              id: "ghost-not-in-catalog",
              name: "Fantasma",
              category: "Símbolos",
              paths: ["M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"],
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
  }, JOBS_DB_NAME);
  await page.goto("/admin");
  const item = page.getByTestId("jobs-pending-item");
  await expect(item).toHaveCount(1);
  // The embedded path data paints inside the preview even though the
  // iconId is unknown to the live catalog.
  await expect(
    item.locator('path[d="M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"]'),
  ).toHaveCount(1);
  // The embedded name travels to the read-only detail metadata.
  await page.getByTestId("jobs-pending-open-ghost-icon-job").click();
  await expect(page.getByTestId("jobs-pending-detail")).toContainText(
    "Fantasma",
  );
  await clearJobsDb(page);
});

test("S3: admin storage failure is honest, never a silent empty list", async ({
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
  await page.goto("/admin");
  await expect(page.getByTestId("jobs-pending-section")).toBeVisible();
  const error = page.getByTestId("jobs-pending-error");
  await expect(error).toBeVisible();
  await expect(error).not.toBeEmpty();
  await clearJobsDb(page);
});
