/**
 * J1 — Immutable self-contained job snapshot + confirmation coordinator.
 *
 * Pure Node tests (no DOM): snapshot capture is detached/frozen, embeds
 * builtin icon definitions, preserves IDs/pose/fonts, omits customer data
 * unless explicitly provided, and validates hostile input as total
 * functions (invalid record, never throw, never hide neighbors). The
 * coordinator only acts on explicit confirm(), reuses the attempt key for
 * unchanged retries and mints a new key for changed drafts.
 *
 * v3 asset cases need DOMParser and run in the browser below; Node-only
 * cases stay in Node so the failure mode is visible per environment.
 */
import { expect, test } from "@playwright/test";
import { iconById } from "../src/data/icons";
import { validateStoredDesign } from "../src/admin-lab/repository";
import { measureControlledPaths } from "../src/admin-lab/geometry";
import { DEFAULT_CONTROLLED_STYLE } from "../src/admin-lab/importedGeometry";
import type { DesignIcon } from "../src/components/IconElement";
import type { TextElement } from "../src/components/CurvedText";
import type { UploadedGraphicElement } from "../src/components/UploadedGraphic";
import type {
  ApprovedDesignInstance,
  ApprovedDesignSnapshot,
} from "../src/approved-designs/approvedDesign";
import {
  JOB_SNAPSHOT_LIMITS,
  JOB_SNAPSHOT_VERSION,
  canonicalCompositionPayload,
  captureComposition,
  normalizeJobCompositionForPreview,
  validateComposition,
} from "../src/jobs/snapshot";
import { createConfirmationCoordinator } from "../src/jobs/coordinator";

const CIRCULAR = "single" as const;

function textFixture(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: "text-1",
    text: "Mi mate",
    fontFamily: "Georgia",
    angle: 90,
    radius: 374,
    inverted: false,
    scale: 1,
    ...overrides,
  };
}

function iconFixture(overrides: Partial<DesignIcon> = {}): DesignIcon {
  return {
    id: "icon-1",
    type: "icon",
    iconId: "spark",
    angle: 270,
    radius: 357.5,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
    ...overrides,
  };
}

function graphicFixture(
  overrides: Partial<UploadedGraphicElement> = {},
): UploadedGraphicElement {
  return {
    id: "graphic-1",
    type: "uploaded-graphic",
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
    ...overrides,
  };
}

function v1SnapshotFixture(): ApprovedDesignSnapshot {
  const checked = validateStoredDesign({
    version: 1,
    id: "dsn-v1",
    name: "Guarda",
    category: "Guardas",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    paths: [{ d: "M10 10H90V90H10Z" }],
    artBounds: { x: 10, y: 10, width: 80, height: 80 },
    fillRule: "nonzero",
  });
  if (!checked.ok) throw new Error(`v1 fixture invalid: ${checked.reason}`);
  return checked.design;
}

function v2SnapshotFixture(): ApprovedDesignSnapshot {
  const paths = [
    {
      d: "M10 10H90V90H10Z",
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      style: { ...DEFAULT_CONTROLLED_STYLE, fill: "#123456" },
    },
  ];
  const measured = measureControlledPaths(paths);
  if (!measured.ok) throw new Error(`v2 fixture invalid: ${measured.reason}`);
  return {
    version: 2,
    id: "dsn-v2",
    name: "Color",
    category: "Arte",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    geometry: {
      version: 2,
      root: 0,
      paths,
      nodes: [
        { kind: "group", opacity: 1, children: [1] },
        { kind: "path", opacity: 1, path: 0 },
      ],
      centerlineBounds: measured.centerlineBounds,
      artBounds: measured.artBounds,
    },
  } as ApprovedDesignSnapshot;
}

function approvedFixture(
  snapshot: ApprovedDesignSnapshot,
  overrides: Partial<ApprovedDesignInstance> = {},
): ApprovedDesignInstance {
  return {
    id: "approved-1",
    type: "approved-design",
    approvedDesignId: snapshot.id,
    snapshot,
    angle: 180,
    radius: 357.5,
    scale: 1,
    rotation: 0,
    mirrored: false,
    inverted: false,
    ...overrides,
  };
}

const resolveIcon = (iconId: string) => {
  const found = iconById[iconId];
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    category: found.category,
    paths: [...found.paths],
  };
};

function fullInput() {
  return {
    texts: [textFixture()],
    icons: [iconFixture()],
    graphics: [graphicFixture()],
    approved: [approvedFixture(v1SnapshotFixture())],
    circularLines: CIRCULAR,
    resolveIcon,
  };
}

test("S1: capture preserves IDs, pose, fonts and embeds the icon definition", () => {
  const captured = captureComposition(fullInput());
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  const { composition } = captured;
  expect(composition.texts[0]).toMatchObject({
    id: "text-1",
    text: "Mi mate",
    fontFamily: "Georgia",
    angle: 90,
    radius: 374,
    inverted: false,
  });
  // No clamping or silent art changes: exact pose values survive.
  expect(composition.icons[0]).toMatchObject({
    id: "icon-1",
    iconId: "spark",
    angle: 270,
    radius: 357.5,
    rotation: 0,
  });
  const embedded = composition.icons[0].definition;
  expect(embedded.name).toBe("Destello");
  expect(embedded.paths).toEqual(iconById["spark"].paths);
  expect(embedded.frame).toEqual({ width: 32, height: 32 });
  expect(embedded.paint.stroke).toBe("#171717");
  expect(composition.graphics[0].artBounds).toEqual({
    x: 0,
    y: 0,
    width: 12,
    height: 8,
  });
  expect(composition.circularLines).toBe("single");
  // No view/selection keys leak into the snapshot.
  expect(JSON.stringify(composition)).not.toMatch(/selected|view/i);
});

test("S1: captured snapshot is detached and frozen", () => {
  const input = fullInput();
  const captured = captureComposition(input);
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  expect(Object.isFrozen(captured.composition)).toBe(true);
  expect(Object.isFrozen(captured.composition.texts)).toBe(true);
  // Mutating the live draft after capture cannot move the snapshot.
  input.texts[0].text = "changed after capture";
  input.icons[0].angle = 12;
  expect(captured.composition.texts[0].text).toBe("Mi mate");
  expect(captured.composition.icons[0].angle).toBe(270);
});

test("S1: no customer data is invented; explicit metadata only", () => {
  const plain = captureComposition(fullInput());
  expect(plain.ok).toBe(true);
  if (!plain.ok) return;
  expect("customer" in plain.composition).toBe(false);
  const withCustomer = captureComposition({
    ...fullInput(),
    customer: { name: "Ana" },
  });
  expect(withCustomer.ok).toBe(true);
  if (!withCustomer.ok) return;
  expect(withCustomer.composition.customer).toEqual({ name: "Ana" });
});

test("S1: v1 and v2 approved snapshots round-trip with full geometry", () => {
  const captured = captureComposition({
    texts: [],
    icons: [],
    graphics: [],
    approved: [
      approvedFixture(v1SnapshotFixture(), { id: "a-v1" }),
      approvedFixture(v2SnapshotFixture(), { id: "a-v2" }),
    ],
    circularLines: "none",
    resolveIcon,
  });
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  const validated = validateComposition(
    JSON.parse(JSON.stringify(captured.composition)),
  );
  expect(validated.ok).toBe(true);
  if (!validated.ok) return;
  expect(
    validated.composition.approved.map((entry) => entry.snapshot.version),
  ).toEqual([1, 2]);
  expect(validated.composition.approved[1].approvedDesignId).toBe("dsn-v2");
});

test("S1: unknown icon stays explicit, never silently dropped", () => {
  const captured = captureComposition({
    texts: [],
    icons: [iconFixture({ iconId: "missing-icon" })],
    graphics: [],
    approved: [],
    circularLines: "none",
    resolveIcon,
  });
  expect(captured.ok).toBe(false);
  if (captured.ok) return;
  expect(captured.reason).toMatch(/icon/i);
});

test("S3: hostile input is a total function — invalid, never throwing", () => {
  const bad: unknown[] = [
    null,
    42,
    "snapshot",
    { version: 99, composition: {} },
    { version: JOB_SNAPSHOT_VERSION, composition: null },
    { texts: "no-array", icons: [], graphics: [], approved: [] },
    {
      texts: [
        {
          id: "t",
          text: "x".repeat(JOB_SNAPSHOT_LIMITS.MAX_TEXT_CHARS + 1),
          fontFamily: "Georgia",
          angle: 0,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
    },
    {
      texts: [
        {
          id: "t",
          text: "ok",
          fontFamily: "Georgia",
          angle: Number.NaN,
          radius: 374,
          inverted: false,
        },
      ],
      icons: [],
      graphics: [],
      approved: [],
    },
    {
      texts: [],
      icons: [
        {
          id: "i",
          iconId: "spark",
          definition: { name: "x", paths: ["M0 0H1"] },
          angle: 0,
          radius: 357.5,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        },
      ],
      graphics: [],
      approved: [],
    },
    {
      texts: [],
      icons: [],
      graphics: [
        {
          id: "g",
          paths: [{ d: "M0 0H99999999999999999999999999" }],
          sourceWidth: 1,
          sourceHeight: 1,
          artBounds: { x: 0, y: 0, width: 1, height: 1 },
          angle: 0,
          radius: 357.5,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        },
      ],
      approved: [],
    },
    {
      texts: [],
      icons: [],
      graphics: [],
      approved: [
        {
          id: "a",
          approvedDesignId: "x",
          snapshot: { version: 4, id: "x" },
          angle: 0,
          radius: 357.5,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        },
      ],
    },
  ];
  for (const candidate of bad) {
    let result: { ok: boolean };
    try {
      result = validateComposition(candidate) as { ok: boolean };
    } catch (error) {
      throw new Error(
        `validateComposition threw instead of returning invalid: ${String(error)}`,
      );
    }
    expect(result.ok).toBe(false);
  }
});

test("S3: cyclic and prototype-polluted payloads are rejected safely", () => {
  const cyclic: Record<string, unknown> = {
    texts: [],
    icons: [],
    graphics: [],
    approved: [],
    circularLines: "none",
  };
  cyclic.self = cyclic;
  expect(validateComposition(cyclic).ok).toBe(false);
  const polluted = JSON.parse(
    '{"texts":[],"icons":[],"graphics":[],"approved":[],"circularLines":"none","__proto__":{"polluted":true}}',
  );
  expect(validateComposition(polluted).ok).toBe(false);
  expect(({} as Record<string, unknown>).polluted).toBe(undefined);
});

test("S3: oversized compositions fail on bounds before expensive walks", () => {
  const many = Array.from(
    { length: JOB_SNAPSHOT_LIMITS.MAX_TEXTS + 1 },
    (_, index) => textFixture({ id: `t-${index}` }),
  );
  const captured = captureComposition({
    texts: many,
    icons: [],
    graphics: [],
    approved: [],
    circularLines: "none",
    resolveIcon,
  });
  expect(captured.ok).toBe(false);
});

test("S1: canonical payload is stable and exact (no weak global key)", () => {
  const first = captureComposition(fullInput());
  const second = captureComposition(fullInput());
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  const a = canonicalCompositionPayload(first.composition);
  const b = canonicalCompositionPayload(second.composition);
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.canonical).toBe(b.canonical);
  const changed = captureComposition({
    ...fullInput(),
    texts: [textFixture({ text: "Otro texto" })],
  });
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  const c = canonicalCompositionPayload(changed.composition);
  expect(c.ok).toBe(true);
  if (!c.ok) return;
  expect(c.canonical).not.toBe(a.canonical);
});

test("S1: preview adapter reads embedded icons without the live catalog", () => {
  const captured = captureComposition(fullInput());
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  const preview = normalizeJobCompositionForPreview(captured.composition);
  expect(preview.icons[0].definition.paths).toEqual(iconById["spark"].paths);
  expect(preview.icons[0].title).toBe("Destello");
  // Fonts stay environment-dependent: documented, never outlined.
  expect(preview.texts[0].fontFamily).toBe("Georgia");
  expect(preview.fontNote).toMatch(/entorno|environment/i);
});

test("S2: coordinator mints a key only on explicit confirm, not on visit", () => {
  const coordinator = createConfirmationCoordinator();
  expect(coordinator.currentKey()).toBe(null);
  // Visiting, previewing or going back never writes: previewAttempt only
  // derives the stable identity, it performs no I/O.
  const draft = fullInput();
  const first = coordinator.previewAttempt(draft);
  const retry = coordinator.previewAttempt({ ...draft });
  expect(first.attemptKey).toBe(retry.attemptKey);
  expect(retry.isRetry).toBe(true);
  const edited = coordinator.previewAttempt({
    ...draft,
    texts: [textFixture({ text: "editado" })],
  });
  expect(edited.attemptKey).not.toBe(first.attemptKey);
  expect(edited.isRetry).toBe(false);
});

test("S2: double confirm shares one inflight write; failure retains the key", async () => {
  let writes = 0;
  const coordinator = createConfirmationCoordinator();
  const draft = fullInput();
  const writer = async (input: {
    attemptKey: string;
    composition: unknown;
  }) => {
    writes += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true as const,
      job: { id: input.attemptKey, attemptKey: input.attemptKey },
    };
  };
  const [first, second] = await Promise.all([
    coordinator.confirm(draft, undefined, writer),
    coordinator.confirm(draft, undefined, writer),
  ]);
  expect(writes).toBe(1);
  expect(first.ok && second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(first.job.id).toBe(second.job.id);

  // Failed attempt keeps the same key for the next retry.
  const failing = createConfirmationCoordinator();
  const keyBefore = failing.previewAttempt(draft).attemptKey;
  const failed = await failing.confirm(draft, undefined, async () => ({
    ok: false as const,
    error: { code: "QUOTA" as const, message: "sin espacio" },
  }));
  expect(failed.ok).toBe(false);
  expect(failing.previewAttempt(draft).attemptKey).toBe(keyBefore);
  if (failed.ok) return;
  expect(failed.attemptKey).toBe(keyBefore);
});

test("S2: late completion never falsely confirms a changed composition", async () => {
  const coordinator = createConfirmationCoordinator();
  const draft = fullInput();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = async (input: {
    attemptKey: string;
    composition: unknown;
  }) => {
    await gate;
    return {
      ok: true as const,
      job: { id: input.attemptKey, attemptKey: input.attemptKey },
    };
  };
  const pending = coordinator.confirm(draft, undefined, writer);
  // The draft changes while the write is still in flight.
  const editedKey = coordinator.previewAttempt({
    ...draft,
    texts: [textFixture({ text: "cambiado" })],
  }).attemptKey;
  release();
  const settled = await pending;
  expect(settled.ok).toBe(true);
  if (!settled.ok) return;
  // The UI can detect staleness: the settled key is no longer current.
  expect(settled.attemptKey).not.toBe(editedKey);
  expect(coordinator.currentKey()).toBe(editedKey);
});

test("S6: fonts remain environment-dependent and documented", () => {
  const captured = captureComposition(fullInput());
  expect(captured.ok).toBe(true);
  if (!captured.ok) return;
  const preview = normalizeJobCompositionForPreview(captured.composition);
  expect(preview.fontNote.length).toBeGreaterThan(0);
  // Nothing is rasterized or converted to outlines in the snapshot.
  expect(JSON.stringify(captured.composition)).not.toMatch(
    /base64|data:image/i,
  );
});

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

test("S1 v3 (browser): synthetic asset snapshot validates via the public sanitizer", async ({
  page,
}) => {
  await gotoReady(page);
  const outcome = await page.evaluate(async () => {
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">' +
      '<path d="M0 0H10V10Z" fill="red"/></svg>';
    const imported = assets.importSvgAsset(source);
    if (!imported.ok) return { stage: "import-failed" };
    const checked = repo.validateStoredDesign({
      version: 3,
      id: "dsn-v3",
      name: "Afiche",
      category: "Arte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      svg: imported.asset.svg,
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: imported.asset.viewBox,
    });
    if (!checked.ok) return { stage: "catalog-invalid" };
    const captured = snapshot.captureComposition({
      texts: [],
      icons: [],
      graphics: [],
      approved: [
        {
          id: "approved-v3",
          type: "approved-design",
          approvedDesignId: "dsn-v3",
          snapshot: checked.design,
          angle: 0,
          radius: 357.5,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        },
      ],
      circularLines: "none",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    const validated = snapshot.validateComposition(
      JSON.parse(JSON.stringify(captured.composition)),
    );
    if (!validated.ok) return { stage: "validate-failed" };
    const stored = validated.composition.approved[0].snapshot as {
      version: number;
      svg: string;
    };
    return {
      stage: "ok",
      version: stored.version,
      svgBytes: stored.svg.length,
    };
  });
  expect(outcome.stage).toBe("ok");
  expect(outcome.version).toBe(3);
  expect(outcome.svgBytes).toBeGreaterThan(0);
});

test("S1 v3 (browser): actual MESSI asset survives as read-only snapshot input", async ({
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(
    fileURLToPath(new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url)),
    "utf8",
  );
  await gotoReady(page);
  const outcome = await page.evaluate(async (messiSource: string) => {
    const snapshot = await import(/* @vite-ignore */ "/src/jobs/snapshot.ts");
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const imported = assets.importSvgAsset(messiSource);
    if (!imported.ok)
      return { stage: "import-failed", reason: imported.reason };
    const before = JSON.stringify(imported.asset);
    const checked = repo.validateStoredDesign({
      version: 3,
      id: "dsn-messi",
      name: "MESSI",
      category: "Deporte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      svg: imported.asset.svg,
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: imported.asset.viewBox,
    });
    if (!checked.ok) return { stage: "catalog-invalid" };
    const captured = snapshot.captureComposition({
      texts: [],
      icons: [],
      graphics: [],
      approved: [
        {
          id: "approved-messi",
          type: "approved-design",
          approvedDesignId: "dsn-messi",
          snapshot: checked.design,
          angle: 90,
          radius: 360,
          scale: 1,
          rotation: 0,
          mirrored: false,
          inverted: false,
        },
      ],
      circularLines: "double",
      resolveIcon: () => null,
    });
    if (!captured.ok) return { stage: "capture-failed" };
    // Snapshot capture never rewrites the catalog bytes.
    const revalidated = repo.validateStoredDesign({
      version: 3,
      id: "dsn-messi",
      name: "MESSI",
      category: "Deporte",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      svg: imported.asset.svg,
      width: imported.asset.width,
      height: imported.asset.height,
      viewBox: imported.asset.viewBox,
    });
    return {
      stage: "ok",
      catalogUnchanged: JSON.stringify(imported.asset) === before,
      catalogStillValid: revalidated.ok,
    };
  }, source);
  expect(outcome.stage).toBe("ok");
  expect(outcome.catalogUnchanged).toBe(true);
  expect(outcome.catalogStillValid).toBe(true);
});
