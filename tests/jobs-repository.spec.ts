/**
 * J1 — Native IndexedDB jobs repository (browser).
 *
 * Every test uses an isolated database name injected via options, so the
 * default production jobs database and the admin catalog are never
 * touched. Only the test's own unique database may be deleted in teardown.
 * Faults are injected with the existing addInitScript pattern (no source
 * UI test hooks).
 */
import { expect, test } from "@playwright/test";

let dbCounter = 0;
function uniqueDbName(): string {
  dbCounter += 1;
  return `mateco-jobs-test-${Date.now().toString(36)}-${dbCounter}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Reload-tolerant navigation: on a cold dev server the first load can be
 * followed by a vite full-reload, which destroys an in-flight evaluate
 * context. expect.poll re-runs across navigations, so readiness is
 * deterministic without sleeps or suite retries.
 */
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

test("S3: create + get round-trip keeps id, date, status and composition", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
    const resolveIcon = (iconId: string) => {
      const found: {
        id: string;
        name: string;
        category: string;
        paths: string[];
      } = icons.iconById[iconId];
      if (!found) return null;
      return {
        id: found.id,
        name: found.name,
        category: found.category,
        paths: [...found.paths],
      };
    };
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Mi mate",
          fontFamily: "Georgia",
          angle: 90,
          radius: 374,
          inverted: false,
          scale: 1,
        },
      ],
      icons: [
        {
          id: "i1",
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
      resolveIcon,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const created = await store.create({
      attemptKey: "attempt-1",
      composition: captured.composition,
    });
    if (!created.ok)
      return { stage: "create-failed", code: created.error.code };
    const fetched = await store.get("attempt-1");
    if (!fetched.ok) return { stage: "get-failed" };
    const listed = await store.list({ limit: 20 });
    if (!listed.ok) return { stage: "list-failed" };
    return {
      stage: "ok",
      id: created.job.id,
      status: created.job.status,
      version: created.job.version,
      createdAt: created.job.createdAt,
      text: fetched.job.composition.texts[0]?.text,
      iconName: fetched.job.composition.icons[0]?.definition.name,
      listedCount: listed.jobs.length,
      listedSkipped: listed.skipped.length,
      sameRecord:
        fetched.job.id === created.job.id &&
        fetched.job.createdAt === created.job.createdAt,
      customerPresent: "customer" in fetched.job,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.status).toBe("pending");
  expect(result.version).toBe(1);
  expect(result.text).toBe("Mi mate");
  expect(result.iconName).toBe("Destello");
  expect(result.listedCount).toBe(1);
  expect(result.listedSkipped).toBe(0);
  expect(result.sameRecord).toBe(true);
  // No customer data is invented when none was provided.
  expect(result.customerPresent).toBe(false);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error("cleanup delete failed"));
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S2: same key + same snapshot is idempotent, dates stay stable", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
    const resolveIcon = (iconId: string) => {
      const found: {
        id: string;
        name: string;
        category: string;
        paths: string[];
      } = icons.iconById[iconId];
      return found
        ? {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          }
        : null;
    };
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Reintento",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const first = await store.create({
      attemptKey: "retry-key",
      composition: captured.composition,
    });
    // Simulate an error-after-commit retry: the client retries blindly.
    const second = await store.create({
      attemptKey: "retry-key",
      composition: JSON.parse(JSON.stringify(captured.composition)) as never,
    });
    if (!first.ok || !second.ok) return { stage: "create-failed" };
    const listed = await store.list({ limit: 20 });
    if (!listed.ok) return { stage: "list-failed" };
    return {
      stage: "ok",
      sameId: first.job.id === second.job.id,
      sameDate: first.job.createdAt === second.job.createdAt,
      count: listed.jobs.length,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.sameId).toBe(true);
  expect(result.sameDate).toBe(true);
  expect(result.count).toBe(1);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S2: same key + different payload is an explicit conflict, never overwrite", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const icons = await import(/* @vite-ignore */ "/src/data/icons.ts");
    const resolveIcon = (iconId: string) => {
      const found: {
        id: string;
        name: string;
        category: string;
        paths: string[];
      } = icons.iconById[iconId];
      return found
        ? {
            id: found.id,
            name: found.name,
            category: found.category,
            paths: [...found.paths],
          }
        : null;
    };
    const store = repo.createJobsRepository({ name });
    const base = {
      texts: [],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none" as const,
      resolveIcon,
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
          text: "Modificado",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
    });
    if (!first.ok || !second.ok) return { stage: "capture-failed" };
    const created = await store.create({
      attemptKey: "conflict-key",
      composition: first.composition,
    });
    if (!created.ok) return { stage: "create-failed" };
    const clash = await store.create({
      attemptKey: "conflict-key",
      composition: second.composition,
    });
    const fetched = await store.get("conflict-key");
    if (!fetched.ok) return { stage: "get-failed" };
    return {
      stage: "ok",
      conflict: !clash.ok,
      code: clash.ok ? null : clash.error.code,
      preserved: fetched.job.composition.texts[0]?.text,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.conflict).toBe(true);
  expect(result.code).toBe("CONFLICT");
  expect(result.preserved).toBe("Original");
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S2: different keys may hold identical compositions (no global dedup)", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Mismo diseño",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const first = await store.create({
      attemptKey: "job-a",
      composition: captured.composition,
    });
    const second = await store.create({
      attemptKey: "job-b",
      composition: JSON.parse(JSON.stringify(captured.composition)) as never,
    });
    if (!first.ok || !second.ok) return { stage: "create-failed" };
    const listed = await store.list({ limit: 20 });
    if (!listed.ok) return { stage: "list-failed" };
    return {
      stage: "ok",
      distinct: first.job.id !== second.job.id,
      count: listed.jobs.length,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.distinct).toBe(true);
  expect(result.count).toBe(2);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S2: concurrent creates with the same key yield ONE record", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Carrera",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const payload = JSON.stringify(captured.composition);
    // Two independent connections racing on the same attempt key.
    const [left, right] = await Promise.all([
      repo.createJobsRepository({ name }).create({
        attemptKey: "race-key",
        composition: JSON.parse(payload) as never,
      }),
      repo.createJobsRepository({ name }).create({
        attemptKey: "race-key",
        composition: JSON.parse(payload) as never,
      }),
    ]);
    if (!left.ok || !right.ok)
      return {
        stage: "create-failed",
        left: left.ok,
        right: right.ok,
      };
    const listed = await repo
      .createJobsRepository({ name })
      .list({ limit: 20 });
    if (!listed.ok) return { stage: "list-failed" };
    return {
      stage: "ok",
      sameId: left.job.id === right.job.id,
      sameDate: left.job.createdAt === right.job.createdAt,
      count: listed.jobs.length,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.sameId).toBe(true);
  expect(result.sameDate).toBe(true);
  expect(result.count).toBe(1);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S3: corrupt, cyclic and unknown-version records are isolated, never silent loss", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t-good",
          text: "Válido",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const created = await store.create({
      attemptKey: "good-job",
      composition: captured.composition,
    });
    if (!created.ok) return { stage: "create-failed" };
    // Smuggle hostile records past the repository via raw IndexedDB.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("jobs", "readwrite");
        const table = tx.objectStore("jobs");
        // F10: cyclic INSIDE a record with a valid id field, so the
        // bounded walk itself must reject it (not a missing-field check).
        const cyclicRecord: Record<string, unknown> = {
          attemptKey: "cyclic-job",
          version: 1,
          id: "cyclic-job",
          createdAt: new Date().toISOString(),
          status: "pending",
          composition: {
            texts: [],
            icons: [],
            graphics: [],
            approved: [],
            circularLines: "none",
          },
        };
        (cyclicRecord.composition as Record<string, unknown>).self =
          cyclicRecord;
        table.put(cyclicRecord);
        table.put({
          attemptKey: "corrupt-job",
          version: 1,
          id: "corrupt-job",
          createdAt: "not-a-date",
          status: "pending",
          composition: { texts: "broken" },
        });
        table.put({
          attemptKey: "future-job",
          version: 99,
          id: "future-job",
          createdAt: new Date().toISOString(),
          status: "pending",
          composition: { texts: [] },
        });
        table.put(cyclicRecord);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(new Error("raw put failed"));
        };
      };
      open.onerror = () => reject(new Error("raw open failed"));
    });
    const listed = await store.list({ limit: 20 });
    if (!listed.ok) return { stage: "list-failed" };
    const corruptGet = await store.get("corrupt-job");
    const missingGet = await store.get("no-such-job");
    const invalidCreate = await store.create({
      attemptKey: "bad-input",
      composition: { texts: "broken" } as never,
    });
    return {
      stage: "ok",
      validKept: listed.jobs.map((job) => job.id),
      skippedCount: listed.skipped.length,
      corruptIsolated: !corruptGet.ok,
      missingCode: missingGet.ok ? null : missingGet.error.code,
      invalidRejected: !invalidCreate.ok,
      invalidCode: invalidCreate.ok ? null : invalidCreate.error.code,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.validKept).toEqual(["good-job"]);
  expect(result.skippedCount).toBeGreaterThanOrEqual(3);
  expect(result.corruptIsolated).toBe(true);
  expect(result.missingCode).toBe("NOT_FOUND");
  expect(result.invalidRejected).toBe(true);
  expect(result.invalidCode).toBe("INVALID");
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S3: failed save reports explicitly and the retry with the same key succeeds", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const failed = await store.create({
      attemptKey: "flaky-key",
      composition: { texts: [] } as never,
    });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Reintento válido",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const retried = await store.create({
      attemptKey: "flaky-key",
      composition: captured.composition,
    });
    const fetched = await store.get("flaky-key");
    return {
      stage: "ok",
      firstFailed: !failed.ok,
      retriedOk: retried.ok,
      fetchedOk: fetched.ok,
    };
  }, dbName);
  expect(result.stage).toBe("ok");
  expect(result.firstFailed).toBe(true);
  expect(result.retriedOk).toBe(true);
  expect(result.fetchedOk).toBe(true);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S3: record endures a page reload; admin catalog bytes stay untouched", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  const catalogKey = "mateco.admin-lab.designs.v1";
  await gotoReady(page);
  const seed = JSON.stringify({ version: 1, records: [] });
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
    },
    { key: catalogKey, value: seed },
  );
  const before = await page.evaluate(
    (key: string) => localStorage.getItem(key),
    catalogKey,
  );
  await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Persistente",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "double",
      resolveIcon: () => null,
    });
    if (!captured.ok) throw new Error("capture failed");
    const created = await store.create({
      attemptKey: "reload-job",
      composition: captured.composition,
    });
    if (!created.ok) throw new Error("create failed");
  }, dbName);
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
  const afterReload = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const store = repo.createJobsRepository({ name });
    const fetched = await store.get("reload-job");
    if (!fetched.ok) return { stage: "get-failed" };
    const paged = await store.list({ limit: 1 });
    if (!paged.ok) return { stage: "list-failed" };
    return {
      stage: "ok",
      id: fetched.job.id,
      text: fetched.job.composition.texts[0]?.text,
      pagedCount: paged.jobs.length,
      usesDefaultPage: paged.jobs.length <= 1,
    };
  }, dbName);
  expect(afterReload.stage).toBe("ok");
  expect(afterReload.text).toBe("Persistente");
  expect(afterReload.usesDefaultPage).toBe(true);
  const after = await page.evaluate(
    (key: string) => localStorage.getItem(key),
    catalogKey,
  );
  expect(after).toBe(before);
  await page.evaluate(
    ({ key }: { key: string }) => {
      localStorage.removeItem(key);
    },
    { key: catalogKey },
  );
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("S3: unavailable storage never reports a fake success", async ({
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
      // If the property cannot be redefined, the repository still probes
      // support and reports UNAVAILABLE instead of succeeding.
    }
  });
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const store = repo.createJobsRepository({ name });
    const created = await store.create({
      attemptKey: "nope",
      composition: {
        texts: [],
        icons: [],
        graphics: [],
        approved: [],
        circularLines: "none",
      } as never,
    });
    const fetched = await store.get("nope");
    const listed = await store.list({ limit: 5 });
    return {
      createdOk: created.ok,
      createdCode: created.ok ? null : created.error.code,
      fetchedOk: fetched.ok,
      listedOk: listed.ok,
    };
  }, uniqueDbName());
  expect(result.createdOk).toBe(false);
  expect(["UNAVAILABLE", "UNSUPPORTED"]).toContain(result.createdCode);
  expect(result.fetchedOk).toBe(false);
  expect(result.listedOk).toBe(false);
});

test("F1: transaction abort after the last cursor yields an error, never an empty success", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const store = repo.createJobsRepository({ name });
    const captured = snapshot.captureComposition({
      texts: [
        {
          id: "t1",
          text: "Abortar",
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) throw new Error("capture failed");
    const created = await store.create({
      attemptKey: "abort-job",
      composition: captured.composition,
    });
    if (!created.ok) throw new Error("seed failed");
  }, dbName);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    const store = repo.createJobsRepository({ name });
    // Fault injection that preserves native IDL delivery: the prototype
    // `onsuccess` setter is wrapped (the original setter still feeds the
    // internal slot, so events keep flowing) and cursor requests are
    // tagged so ONLY the list walk is faulted. After the repository
    // consumed the final cursor (null), the transaction is aborted:
    // success may ONLY come from tx.oncomplete, so this must surface as
    // an error and never as an empty list.
    const reqProto = IDBRequest.prototype as unknown as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(reqProto, "onsuccess");
    if (!descriptor || typeof descriptor.set !== "function")
      return { stage: "no-setter", count: -2 };
    const origSet = descriptor.set as (handler: unknown) => void;
    const origGet = descriptor.get as () => unknown;
    const storeProto = IDBObjectStore.prototype as unknown as {
      openCursor: IDBObjectStore["openCursor"];
    };
    const origOpenCursor = storeProto.openCursor;
    storeProto.openCursor = function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      const request = (origOpenCursor as (...a: unknown[]) => IDBRequest).apply(
        this,
        args,
      );
      try {
        (request as unknown as Record<string, unknown>).__jobsListCursor = true;
      } catch {
        // ignore: tagging is best-effort.
      }
      return request;
    };
    Object.defineProperty(reqProto, "onsuccess", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return origGet.call(this);
      },
      set(handler: ((event: Event) => void) | null) {
        if (typeof handler !== "function") {
          origSet.call(this, handler);
          return;
        }
        const self = this as IDBRequest & {
          __jobsListCursor?: boolean;
          transaction?: IDBTransaction | null;
          result?: unknown;
        };
        origSet.call(self, (event: Event) => {
          handler.call(self, event);
          try {
            if (self.__jobsListCursor && self.result === null)
              self.transaction?.abort();
          } catch {
            // ignore: the abort itself is the fault signal.
          }
        });
      },
    });
    try {
      const listed = await store.list({ limit: 20 });
      if (listed.ok)
        return { stage: "false-success", count: listed.jobs.length };
      return { stage: "error", count: -1, code: listed.error.code };
    } finally {
      Object.defineProperty(reqProto, "onsuccess", descriptor);
      storeProto.openCursor = origOpenCursor;
    }
  }, dbName);
  expect(result.stage).toBe("error");
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});

test("F2: late open success after BLOCKED closes the connection (no leak)", async ({
  page,
}) => {
  const dbName = uniqueDbName();
  await gotoReady(page);
  const result = await page.evaluate(async (name: string) => {
    const repo = await import(/* @vite-ignore */ "/src/jobs/repository.ts");
    // A real handle to serve as the late-arriving connection.
    const realDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("jobs"))
          open.result.createObjectStore("jobs", { keyPath: "attemptKey" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("seed failed"));
    });
    let closes = 0;
    const protoDb = IDBDatabase.prototype as unknown as {
      close: () => void;
    };
    const origClose = protoDb.close;
    protoDb.close = function (this: IDBDatabase) {
      closes += 1;
      return origClose.call(this);
    };
    const factory = indexedDB as IDBFactory;
    type LateRequest = {
      result: unknown;
      error: unknown;
      transaction: unknown;
      onsuccess: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onblocked: ((event: unknown) => void) | null;
      onupgradeneeded: ((event: unknown) => void) | null;
    };
    let late: LateRequest | null = null;
    // Hang the open: the repository watchdog must resolve BLOCKED, and a
    // later onsuccess must close the arriving connection immediately.
    (factory as unknown as Record<string, unknown>).open = () => {
      late = {
        result: realDb,
        error: null,
        transaction: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      };
      return late;
    };
    try {
      const store = repo.createJobsRepository({ name });
      const listed = await store.list({ limit: 5 });
      const blocked =
        !listed.ok && listed.error.code === "BLOCKED" ? "BLOCKED" : null;
      if (late?.onsuccess) late.onsuccess({ target: late });
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { blocked, closes };
    } finally {
      delete (factory as unknown as Record<string, unknown>).open;
      protoDb.close = origClose;
      try {
        realDb.close();
      } catch {
        // Already closed by the late-success path.
      }
    }
  }, dbName);
  expect(result.blocked).toBe("BLOCKED");
  expect(result.closes).toBeGreaterThanOrEqual(1);
  await page.evaluate(async (name: string) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, dbName);
});
