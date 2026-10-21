/**
 * Regression battery for the v3 sanitized-asset admin design pipeline.
 *
 * Every case exercises the PUBLIC pipeline end-to-end where possible:
 * admitSvgTextAsAsset → saveNew (repository) → fresh load from the envelope
 * → read re-validation → serialized asset out. Content assertions always
 * parse the sanitized output with DOMParser in the browser and assert
 * structure/attributes (never whole-document substrings).
 *
 * Case map:
 *  1. MESSI fixture (owner-supplied; skip when absent)
 *  2. Group transform preserved, geometry intact
 *  3. Negative Y scale transform preserved verbatim
 *  4. Multiple paths (≥5, distinct d) present in order
 *  5. Colors/strokes (named/hex/rgb, stroke-width, opacities) preserved
 *  6. metadata dropped, everything else intact
 *  7. width/height/version (1.0 and 1.1) accepted, preserved, derived
 *  8. Repository reload: stable fixed point, sanitizeStoredSvgAsset consistent
 *  9. Security: <script> purged, file still accepted
 * 10. Security: on* attributes purged, file still accepted
 * 11. Security: external refs purged (accepted) / xml-stylesheet PI (SECURITY)
 * 12. End-to-end: mixed v1+v2+v3 library, versions intact (compat contract)
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SVG_NS = "http://www.w3.org/2000/svg";
const MESSI_PATH = fileURLToPath(
  new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url),
);
const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="${SVG_NS}" ${attrs}>${body}</svg>`;

async function gotoLab(page: Page): Promise<void> {
  await page.goto("/admin-lab");
}

// ---------------------------------------------------------------------------
// 1. MESSI fixture: real externally-prepared silhouette supplied by the
// owner. NEVER synthesized here: read from disk, SKIP when absent.
// The file carries the inert standard W3C SVG 1.0 (20010904) DOCTYPE, which
// the sanitizer tolerates and drops (dropped-not-rejected: an identifier,
// never a network request). This case runs end-to-end (no skip when the
// fixture is present) and pins the silhouette contract below.
// ---------------------------------------------------------------------------
test("1. MESSI silhouette survives the full pipeline as a stable fixed point", async ({
  page,
}) => {
  let source: string | null = null;
  try {
    source = readFileSync(MESSI_PATH, "utf8");
  } catch {
    source = null;
  }
  if (source === null) {
    test.skip(
      true,
      "Fixture tests/fixtures/MESSI-SILHOUETTE.svg absent — pending from " +
        "owner; MESSI pipeline case skipped, not failed.",
    );
    return;
  }
  const input: string = source;
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const parse = (svg: string): Document =>
      new DOMParser().parseFromString(svg, "image/svg+xml");
    const BLACK = new Set(["#000000", "#000", "black", "rgb(0,0,0)"]);
    const norm = (value: string): string =>
      value.toLowerCase().replace(/\s+/g, "");
    const facts = (svg: string) => {
      const doc = parse(svg);
      const root = doc.documentElement;
      const all = Array.from(doc.getElementsByTagName("*"));
      const gs = Array.from(doc.getElementsByTagName("g"));
      const paths = Array.from(doc.getElementsByTagName("path"));
      const firstG = gs[0];
      const inG = firstG ? Array.from(firstG.getElementsByTagName("path")) : [];
      return {
        parserError: doc.getElementsByTagName("parsererror").length > 0,
        version: root.getAttribute("version"),
        viewBox: root.getAttribute("viewBox"),
        widthAttr: root.getAttribute("width"),
        heightAttr: root.getAttribute("height"),
        preserveAspectRatio: root.getAttribute("preserveAspectRatio"),
        gCount: gs.length,
        gTransform: firstG?.getAttribute("transform") ?? null,
        pathCount: paths.length,
        pathsInGCount: inG.length,
        ds: paths.map((p) => p.getAttribute("d")),
        gDs: inG.map((p) => p.getAttribute("d")),
        fillsBlack: paths.map((p) =>
          BLACK.has(
            norm(p.getAttribute("fill") ?? firstG?.getAttribute("fill") ?? ""),
          ),
        ),
        strokesNone: paths.map(
          (p) =>
            (
              p.getAttribute("stroke") ??
              firstG?.getAttribute("stroke") ??
              "none"
            ).toLowerCase() === "none",
        ),
        tags: all.map((el) => (el.localName ?? "").toLowerCase()),
      };
    };
    const inputFacts = facts(text);
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok)
      throw new Error(
        `MESSI admit failed: ${admitted.error.code}: ${admitted.error.reason}`,
      );
    const asset = admitted.draft.asset;
    const outFacts = facts(asset.svg);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Messi",
      category: "Arte",
      asset,
    });
    if (!saved.ok) throw new Error("MESSI save failed");
    const persistedRaw = data.get(repo.ADMIN_LAB_STORAGE_KEY)!;
    const persistedSvg = (
      JSON.parse(persistedRaw).records[0] as { svg: string }
    ).svg;
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as {
      svg: string;
      width: number | null;
      height: number | null;
      viewBox: { x: number; y: number; width: number; height: number } | null;
      version: number;
    };
    const reFacts = facts(rec.svg);
    const revalidated = assets.sanitizeStoredSvgAsset({
      svg: rec.svg,
      width: rec.width,
      height: rec.height,
      viewBox: rec.viewBox,
    });
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      inputFacts,
      outFacts,
      reFacts,
      outSvg: asset.svg,
      persistedSvg,
      width: asset.width,
      height: asset.height,
      viewBox: asset.viewBox,
      reWidth: rec.width,
      reHeight: rec.height,
      reViewBox: rec.viewBox,
      reVersion: rec.version,
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      revalidatedOk: revalidated !== null,
      revalidatedFields:
        revalidated !== null &&
        revalidated.width === rec.width &&
        revalidated.height === rec.height &&
        JSON.stringify(revalidated.viewBox) === JSON.stringify(rec.viewBox),
      count: reloaded.designs.length,
      corrupted: reloaded.corrupted,
    };
  }, input);

  // Fixture shape as supplied by the owner: svg > 1 g (transform) > 2 paths.
  expect(result.inputFacts.gCount).toBe(1);
  expect(result.inputFacts.pathCount).toBe(2);
  expect(result.inputFacts.pathsInGCount).toBe(2);
  expect(result.inputFacts.gTransform).toBe(
    "translate(0.000000,225.000000) scale(0.100000,-0.100000)",
  );
  // Inert SVG 1.0 DOCTYPE is the only prologue trigger: it is dropped,
  // never rendered, so sanitized output carries no DOCTYPE.
  expect(result.inputFacts.version).toBe("1.0");
  // Import preserves group transform and both paths verbatim.
  expect(result.outFacts.parserError).toBe(false);
  expect(result.outFacts.gTransform).toBe(result.inputFacts.gTransform);
  expect(result.outFacts.ds).toEqual(result.inputFacts.ds);
  expect(result.outFacts.pathCount).toBe(2);
  // Root presentation contract preserved.
  expect(result.outFacts.version).toBe("1.0");
  expect(result.outFacts.viewBox).toBe(result.inputFacts.viewBox);
  expect(result.outFacts.widthAttr).toBe(result.inputFacts.widthAttr);
  expect(result.outFacts.heightAttr).toBe(result.inputFacts.heightAttr);
  expect(result.outFacts.preserveAspectRatio).toBe(
    result.inputFacts.preserveAspectRatio,
  );
  expect(result.outFacts.fillsBlack).toEqual([true, true]);
  expect(result.outFacts.strokesNone).toEqual([true, true]);
  // Inert DOCTYPE dropped from sanitized output (whole-pipeline fixed point).
  expect(result.outSvg).not.toContain("DOCTYPE");
  expect(result.outSvg).not.toContain("svg10.dtd");
  expect(result.persistedSvg).toBe(result.outSvg);
  // Fixture geometry contract: 300/225 pt -> user units (x96/72).
  expect(result.width).toBe(400);
  expect(result.height).toBe(300);
  expect(result.viewBox).toEqual({ x: 0, y: 0, width: 300, height: 225 });
  expect(result.outFacts.viewBox).toBe("0 0 300.000000 225.000000");
  expect(result.outFacts.widthAttr).toBe("300.000000pt");
  expect(result.outFacts.heightAttr).toBe("225.000000pt");
  expect(result.outFacts.preserveAspectRatio).toBe("xMidYMid meet");
  // Save → reload → re-validation is a stable fixed point with consistent fields.
  expect(result.fixedPoint).toBe(true);
  expect(result.revalidatedOk).toBe(true);
  expect(result.revalidatedFields).toBe(true);
  expect(result.reWidth).toBe(result.width);
  expect(result.reHeight).toBe(result.height);
  expect(result.reViewBox).toEqual(result.viewBox);
  expect(result.reWidth).toBe(400);
  expect(result.reHeight).toBe(300);
  expect(result.reVersion).toBe(3);
  expect(result.count).toBe(1);
  expect(result.corrupted).toBe(false);
  // Serialized asset out still carries the same g transform, 2 black paths.
  expect(result.reFacts.gTransform).toBe(result.inputFacts.gTransform);
  expect(result.reFacts.gDs).toEqual(result.inputFacts.gDs);
  expect(result.reFacts.pathCount).toBe(2);
  expect(result.reFacts.fillsBlack).toEqual([true, true]);
});

// ---------------------------------------------------------------------------
// 2. Group transform (synthetic): transform preserved, geometry intact.
// ---------------------------------------------------------------------------
test("2. group transform survives admit → save → reload", async ({ page }) => {
  const source =
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">` +
    `<g transform="translate(10 20) scale(2)">` +
    `<path d="M0 0H40V40H0Z" fill="#123456"/>` +
    `<path d="M0 20L60 20" fill="none" stroke="red" stroke-width="4"/>` +
    `</g></svg>`;
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Grupo",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const g = doc.getElementsByTagName("g")[0];
    const paths = Array.from(doc.getElementsByTagName("path"));
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      gTransform: g?.getAttribute("transform") ?? null,
      pathCount: paths.length,
      ds: paths.map((p) => p.getAttribute("d")),
      firstFill: paths[0]?.getAttribute("fill") ?? null,
      secondStroke: paths[1]?.getAttribute("stroke") ?? null,
      secondStrokeWidth: paths[1]?.getAttribute("stroke-width") ?? null,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.gTransform).toBe("translate(10 20) scale(2)");
  expect(result.pathCount).toBe(2);
  expect(result.ds).toEqual(["M0 0H40V40H0Z", "M0 20L60 20"]);
  expect(result.firstFill).toBe("#123456");
  expect(result.secondStroke).toBe("red");
  expect(result.secondStrokeWidth).toBe("4");
});

// ---------------------------------------------------------------------------
// 3. Negative Y scale is preserved verbatim on the element.
// ---------------------------------------------------------------------------
test("3. negative Y scale transform is preserved verbatim", async ({
  page,
}) => {
  const source = wrap(
    `<g transform="scale(1,-1)"><path d="M0 0H10V10Z" fill="black"/></g>`,
  );
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Espejo",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const g = doc.getElementsByTagName("g")[0];
    const paths = Array.from(doc.getElementsByTagName("path"));
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      gTransform: g?.getAttribute("transform") ?? null,
      pathCount: paths.length,
      d: paths[0]?.getAttribute("d") ?? null,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.gTransform).toBe("scale(1,-1)");
  expect(result.pathCount).toBe(1);
  expect(result.d).toBe("M0 0H10V10Z");
});

// ---------------------------------------------------------------------------
// 4. Multiple paths (≥5 distinct d) all present in order.
// ---------------------------------------------------------------------------
test("4. six distinct paths come back in document order", async ({ page }) => {
  const ds = [
    "M0 0H10V10Z",
    "M20 20H30V30Z",
    "M40 40H50V50Z",
    "M60 60H70V70Z",
    "M5 80L95 80",
    "M80 5L80 95",
  ];
  const source = wrap(ds.map((d) => `<path d="${d}" fill="black"/>`).join(""));
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Trazos",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      ds: Array.from(doc.getElementsByTagName("path")).map((p) =>
        p.getAttribute("d"),
      ),
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.ds).toEqual(ds);
});

// ---------------------------------------------------------------------------
// 5. Colors/strokes: named/hex/rgb fills, stroke + width, opacities.
// ---------------------------------------------------------------------------
test("5. fills, strokes and opacities are preserved", async ({ page }) => {
  const source = wrap(
    `<path d="M0 0H10V10Z" fill="red"/>` +
      `<path d="M20 20H30V30Z" fill="#00ff00"/>` +
      `<path d="M40 40H50V50Z" fill="rgb(0,0,255)"/>` +
      `<path d="M60 60H70V70Z" fill="none" stroke="#ff0000" stroke-width="3"/>` +
      `<path d="M80 80H90V90Z" fill="black" fill-opacity="0.4" opacity="0.5"/>`,
  );
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Color",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      paints: Array.from(doc.getElementsByTagName("path")).map((p) => ({
        d: p.getAttribute("d"),
        fill: p.getAttribute("fill"),
        stroke: p.getAttribute("stroke"),
        strokeWidth: p.getAttribute("stroke-width"),
        fillOpacity: p.getAttribute("fill-opacity"),
        opacity: p.getAttribute("opacity"),
      })),
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.paints).toEqual([
    {
      d: "M0 0H10V10Z",
      fill: "red",
      stroke: null,
      strokeWidth: null,
      fillOpacity: null,
      opacity: null,
    },
    {
      d: "M20 20H30V30Z",
      fill: "#00ff00",
      stroke: null,
      strokeWidth: null,
      fillOpacity: null,
      opacity: null,
    },
    {
      d: "M40 40H50V50Z",
      fill: "rgb(0,0,255)",
      stroke: null,
      strokeWidth: null,
      fillOpacity: null,
      opacity: null,
    },
    {
      d: "M60 60H70V70Z",
      fill: "none",
      stroke: "#ff0000",
      strokeWidth: "3",
      fillOpacity: null,
      opacity: null,
    },
    {
      d: "M80 80H90V90Z",
      fill: "black",
      stroke: null,
      strokeWidth: null,
      fillOpacity: "0.4",
      opacity: "0.5",
    },
  ]);
});

// ---------------------------------------------------------------------------
// 6. metadata accepted but dropped; everything else intact.
// ---------------------------------------------------------------------------
test("6. metadata is dropped while the file is accepted", async ({ page }) => {
  const source = wrap(
    `<metadata><info xmlns:vendor="https://vendor.example/info">inert</info></metadata>` +
      `<title>Arte</title>` +
      `<g transform="translate(5 5)"><path d="M0 0H10V10Z" fill="black"/></g>`,
  );
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "SinMeta",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const all = Array.from(doc.getElementsByTagName("*"));
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      metadataCount: doc.getElementsByTagName("metadata").length,
      tags: all.map((el) => (el.localName ?? "").toLowerCase()),
      attrValues: all.flatMap((el) =>
        Array.from(el.attributes ?? []).map((a) => a.value),
      ),
      titleText: doc.getElementsByTagName("title")[0]?.textContent ?? null,
      gTransform:
        doc.getElementsByTagName("g")[0]?.getAttribute("transform") ?? null,
      pathD: doc.getElementsByTagName("path")[0]?.getAttribute("d") ?? null,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.metadataCount).toBe(0);
  expect(result.tags).not.toContain("metadata");
  expect(result.attrValues.some((v) => v.includes("vendor.example"))).toBe(
    false,
  );
  expect(result.titleText).toBe("Arte");
  expect(result.gTransform).toBe("translate(5 5)");
  expect(result.pathD).toBe("M0 0H10V10Z");
});

// ---------------------------------------------------------------------------
// 7. width/height/version (1.0 and 1.1): accepted, preserved, derived.
// ---------------------------------------------------------------------------
test("7. version 1.0 and 1.1 roots keep size attributes and derived size", async ({
  page,
}) => {
  await gotoLab(page);
  const result = await page.evaluate(async () => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const SVG = "http://www.w3.org/2000/svg";
    const outcomes = [];
    for (const version of ["1.0", "1.1"]) {
      const text =
        `<svg xmlns="${SVG}" version="${version}" width="200" height="100" viewBox="0 0 200 100">` +
        `<path d="M0 0H10V10Z" fill="black"/></svg>`;
      const admitted = admission.admitSvgTextAsAsset(text);
      if (!admitted.ok)
        throw new Error(`admit ${version} failed: ${admitted.error.code}`);
      const data = new Map<string, string>();
      const backend = {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      };
      const store = repo.createAdminDesignStore(backend);
      const saved = await store.saveNew({
        name: `Versionada ${version}`,
        category: "Arte",
        asset: admitted.draft.asset,
      });
      if (!saved.ok) throw new Error(`save ${version} failed`);
      const reloaded = await repo.createAdminDesignStore(backend).load();
      const rec = reloaded.designs[0] as unknown as {
        svg: string;
        width: number | null;
        height: number | null;
        viewBox: { x: number; y: number; width: number; height: number } | null;
      };
      const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
      const root = doc.documentElement;
      const readmitted = admission.admitSvgTextAsAsset(rec.svg);
      outcomes.push({
        version,
        fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
        rootVersion: root.getAttribute("version"),
        rootWidth: root.getAttribute("width"),
        rootHeight: root.getAttribute("height"),
        rootViewBox: root.getAttribute("viewBox"),
        derivedWidth: rec.width,
        derivedHeight: rec.height,
        derivedViewBox: rec.viewBox,
      });
    }
    return outcomes;
  });
  expect(result).toHaveLength(2);
  for (const outcome of result) {
    expect(outcome.fixedPoint).toBe(true);
    expect(outcome.rootVersion).toBe(outcome.version);
    expect(outcome.rootWidth).toBe("200");
    expect(outcome.rootHeight).toBe("100");
    expect(outcome.rootViewBox).toBe("0 0 200 100");
    expect(outcome.derivedWidth).toBe(200);
    expect(outcome.derivedHeight).toBe(100);
    expect(outcome.derivedViewBox).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  }
  expect(result.map((o) => o.version)).toEqual(["1.0", "1.1"]);
});

// ---------------------------------------------------------------------------
// 8. Reload from repository: stable fixed-point asset, re-validation consistent.
// ---------------------------------------------------------------------------
test("8. saved v3 asset reloads as a stable fixed point and re-validates", async ({
  page,
}) => {
  const source =
    `<svg xmlns="${SVG_NS}" width="120" height="80" viewBox="0 0 120 80">` +
    `<path d="M5 5H50V50Z" fill="red"/></svg>`;
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const assets = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Byte",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    // Fresh read straight from the persisted envelope, then a fresh store.
    const persistedRaw = data.get(repo.ADMIN_LAB_STORAGE_KEY)!;
    const persisted = JSON.parse(persistedRaw) as {
      version: number;
      records: Array<{ version: number; svg: string }>;
    };
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as {
      svg: string;
      width: number | null;
      height: number | null;
      viewBox: { x: number; y: number; width: number; height: number } | null;
      version: number;
    };
    const revalidated = assets.sanitizeStoredSvgAsset({
      svg: rec.svg,
      width: rec.width,
      height: rec.height,
      viewBox: rec.viewBox,
    });
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      persistedSvg: persisted.records[0].svg,
      reloadedSvg: rec.svg,
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      envelopeVersion: persisted.version,
      recordVersion: persisted.records[0].version,
      reVersion: rec.version,
      revalidatedOk: revalidated !== null,
      revalidatedWidth: revalidated?.width ?? null,
      revalidatedHeight: revalidated?.height ?? null,
      revalidatedViewBox: revalidated?.viewBox ?? null,
      recWidth: rec.width,
      recHeight: rec.height,
      recViewBox: rec.viewBox,
      count: reloaded.designs.length,
      corrupted: reloaded.corrupted,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.persistedSvg).toBe(result.reloadedSvg);
  expect(result.envelopeVersion).toBe(1);
  expect(result.recordVersion).toBe(3);
  expect(result.reVersion).toBe(3);
  expect(result.revalidatedOk).toBe(true);
  expect(result.revalidatedWidth).toBe(result.recWidth);
  expect(result.revalidatedHeight).toBe(result.recHeight);
  expect(result.revalidatedViewBox).toEqual(result.recViewBox);
  expect(result.recWidth).toBe(120);
  expect(result.recHeight).toBe(80);
  expect(result.recViewBox).toEqual({ x: 0, y: 0, width: 120, height: 80 });
  expect(result.count).toBe(1);
  expect(result.corrupted).toBe(false);
});

// ---------------------------------------------------------------------------
// 9. Security: <script> in body is purged, file still accepted.
// ---------------------------------------------------------------------------
test("9. inline script is purged without rejecting the file", async ({
  page,
}) => {
  const source = wrap(
    `<script>alert(1)</script>` +
      `<defs><script>alert(2)</script></defs>` +
      `<path d="M0 0H10V10Z" fill="black"/>`,
  );
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "SinScript",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const all = Array.from(doc.getElementsByTagName("*"));
    const attrValues = all.flatMap((el) =>
      Array.from(el.attributes ?? []).map((a) => a.value),
    );
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      scriptCount: doc.getElementsByTagName("script").length,
      tags: all.map((el) => (el.localName ?? "").toLowerCase()),
      executableTrace:
        attrValues.some((v) => /alert|javascript:/i.test(v)) ||
        (doc.documentElement.textContent ?? "").includes("alert"),
      pathD: doc.getElementsByTagName("path")[0]?.getAttribute("d") ?? null,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.scriptCount).toBe(0);
  expect(result.tags).not.toContain("script");
  expect(result.executableTrace).toBe(false);
  expect(result.pathD).toBe("M0 0H10V10Z");
});

// ---------------------------------------------------------------------------
// 10. Security: onload/... handlers on several elements are purged.
// ---------------------------------------------------------------------------
test("10. on* attributes are purged from every element", async ({ page }) => {
  const source = wrap(
    `<g onload="alert(1)" onclick="alert(2)">` +
      `<path d="M0 0H10V10Z" fill="black" onload="alert(3)" onmouseover="alert(4)"/>` +
      `</g>`,
  );
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "SinHandlers",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as { svg: string };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const all = Array.from(doc.getElementsByTagName("*"));
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      onAttrs: all.flatMap((el) =>
        Array.from(el.attributes ?? [])
          .map((a) => a.name.toLowerCase())
          .filter((name) => name.startsWith("on")),
      ),
      attrValues: all.flatMap((el) =>
        Array.from(el.attributes ?? []).map((a) => a.value),
      ),
      gCount: doc.getElementsByTagName("g").length,
      pathD: doc.getElementsByTagName("path")[0]?.getAttribute("d") ?? null,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.onAttrs).toEqual([]);
  expect(result.attrValues.some((v) => v.includes("alert"))).toBe(false);
  expect(result.gCount).toBe(1);
  expect(result.pathD).toBe("M0 0H10V10Z");
});

// ---------------------------------------------------------------------------
// 11. Security: external refs purged (accepted); stylesheet PI rejected.
// ---------------------------------------------------------------------------
test("11. external references purged; stylesheet PI is SECURITY", async ({
  page,
}) => {
  await gotoLab(page);
  const result = await page.evaluate(async () => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const SVG = "http://www.w3.org/2000/svg";
    const XLINK = "http://www.w3.org/1999/xlink";
    // xmlns declarations are inert identifiers kept by design, so the
    // http-check below covers every other attribute value.
    const externalValues = (svg: string): string[] => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return Array.from(doc.getElementsByTagName("*")).flatMap((el) =>
        Array.from(el.attributes ?? [])
          .filter(
            (a) =>
              a.name.toLowerCase() !== "xmlns" &&
              !a.name.toLowerCase().startsWith("xmlns:"),
          )
          .map((a) => a.value),
      );
    };
    const pipeline = async (
      text: string,
      name: string,
    ): Promise<{ svg: string }> => {
      const admitted = admission.admitSvgTextAsAsset(text);
      if (!admitted.ok)
        throw new Error(`${name} admit failed: ${admitted.error.code}`);
      const data = new Map<string, string>();
      const backend = {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      };
      const store = repo.createAdminDesignStore(backend);
      const saved = await store.saveNew({
        name,
        category: "Arte",
        asset: admitted.draft.asset,
      });
      if (!saved.ok) throw new Error(`${name} save failed`);
      const reloaded = await repo.createAdminDesignStore(backend).load();
      const rec = reloaded.designs[0] as unknown as { svg: string };
      const readmitted = admission.admitSvgTextAsAsset(rec.svg);
      if (!readmitted.ok || readmitted.draft.asset.svg !== rec.svg)
        throw new Error(`${name} not a sanitizer fixed point`);
      return { svg: rec.svg };
    };
    const httpsOut = await pipeline(
      `<svg xmlns="${SVG}" viewBox="0 0 100 100"><a href="https://evil.example/x"><path d="M1 1H5V5Z"/></a>` +
        `<path d="M0 0H10V10Z" fill="black"/></svg>`,
      "https-href",
    );
    const xlinkOut = await pipeline(
      `<svg xmlns="${SVG}" xmlns:xlink="${XLINK}" viewBox="0 0 100 100">` +
        `<defs><path id="p" d="M1 1H5V5Z"/></defs>` +
        `<use href="#p"/><use xlink:href="http://evil.example/x"/>` +
        `<path d="M0 0H10V10Z" fill="black"/></svg>`,
      "xlink-href",
    );
    const styleOut = await pipeline(
      `<svg xmlns="${SVG}" viewBox="0 0 100 100">` +
        `<path d="M1 1H5V5Z" style="fill:url(https://evil.example/p)"/>` +
        `<path d="M0 0H10V10Z" fill="black"/></svg>`,
      "style-url",
    );
    const parseTags = (svg: string): string[] => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return Array.from(doc.getElementsByTagName("*")).map((el) =>
        (el.localName ?? "").toLowerCase(),
      );
    };
    const parseDs = (svg: string): Array<string | null> => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return Array.from(doc.getElementsByTagName("path")).map((p) =>
        p.getAttribute("d"),
      );
    };
    const pi = admission.admitSvgTextAsAsset(
      `<?xml-stylesheet href="local.css"?><svg xmlns="${SVG}" viewBox="0 0 100 100">` +
        `<path d="M0 0H10V10Z"/></svg>`,
    );
    return {
      httpsValues: externalValues(httpsOut.svg),
      httpsTags: parseTags(httpsOut.svg),
      httpsDs: parseDs(httpsOut.svg),
      xlinkValues: externalValues(xlinkOut.svg),
      xlinkTags: parseTags(xlinkOut.svg),
      xlinkDs: parseDs(xlinkOut.svg),
      styleValues: externalValues(styleOut.svg),
      styleDs: parseDs(styleOut.svg),
      piOk: pi.ok,
      piCode: pi.ok ? null : pi.error.code,
    };
  });
  const hasHttp = (values: string[]): boolean =>
    values.some((v) => /https?:/i.test(v));
  // https href: anchor gone with its payload, sibling geometry intact.
  expect(result.httpsTags).not.toContain("a");
  expect(hasHttp(result.httpsValues)).toBe(false);
  expect(result.httpsDs).toEqual(["M0 0H10V10Z"]);
  // xlink http: evil ref gone, internal #p ref and geometry intact.
  expect(hasHttp(result.xlinkValues)).toBe(false);
  expect(result.xlinkValues).toContain("#p");
  expect(result.xlinkTags).toContain("use");
  expect(result.xlinkDs).toContain("M0 0H10V10Z");
  // style url(https): no external reference left, geometry intact.
  expect(hasHttp(result.styleValues)).toBe(false);
  expect(result.styleDs).toEqual(["M1 1H5V5Z", "M0 0H10V10Z"]);
  // xml-stylesheet PI fails closed with SECURITY.
  expect(result.piOk).toBe(false);
  expect(result.piCode).toBe("SECURITY");
});

// ---------------------------------------------------------------------------
// 12. End-to-end: mixed v1 + v2 + v3 library, versions intact (compat).
// ---------------------------------------------------------------------------
test("12. mixed v1/v2/v3 library saves, reloads, versions intact", async ({
  page,
}) => {
  await gotoLab(page);
  const result = await page.evaluate(async (square: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const geom = await import(
      /* @vite-ignore */ "/src/admin-lab/svgGeometryImport.ts"
    );
    const imported = geom.importTrustedSvg(square);
    if (!imported.ok)
      throw new Error(`geometry import failed: ${imported.code}`);
    const assetAdmitted = admission.admitSvgTextAsAsset(square);
    if (!assetAdmitted.ok)
      throw new Error(`asset admit failed: ${assetAdmitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const v1 = await store.saveNew({
      name: "Legado",
      category: "Guardas",
      paths: [{ d: "M0 0H10V10H0Z", transform: "translate(10 20) scale(2)" }],
      artBounds: { x: 10, y: 20, width: 20, height: 20 },
      fillRule: "evenodd",
    });
    if (!v1.ok) throw new Error("v1 save failed");
    const v2 = await store.saveNew({
      name: "Moderno",
      category: "Arte",
      geometry: imported.geometry,
    });
    if (!v2.ok) throw new Error("v2 save failed");
    const v3 = await store.saveNew({
      name: "Afiche",
      category: "Arte",
      asset: assetAdmitted.draft.asset,
    });
    if (!v3.ok) throw new Error("v3 save failed");
    const rawBefore = data.get(repo.ADMIN_LAB_STORAGE_KEY)!;
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const v3rec = reloaded.designs.find(
      (d) => d.id === (v3.design as unknown as { id: string }).id,
    ) as unknown as { svg: string } | undefined;
    return {
      ids: reloaded.designs.map((d) => d.id),
      versions: reloaded.designs.map((d) => d.version),
      names: reloaded.designs.map((d) => d.name),
      count: reloaded.designs.length,
      corrupted: reloaded.corrupted,
      skipped: reloaded.skipped.length,
      rawSame: data.get(repo.ADMIN_LAB_STORAGE_KEY) === rawBefore,
      v3FixedPoint: (() => {
        if (!v3rec) return false;
        const again = admission.admitSvgTextAsAsset(v3rec.svg);
        return again.ok && again.draft.asset.svg === v3rec.svg;
      })(),
    };
  }, wrap('<path d="M10 10H90V90H10Z" fill="#000000"/>'));
  expect(result.count).toBe(3);
  expect(result.versions).toEqual([1, 2, 3]);
  expect(result.names).toEqual(["Legado", "Moderno", "Afiche"]);
  expect(new Set(result.ids).size).toBe(3);
  expect(result.corrupted).toBe(false);
  expect(result.skipped).toBe(0);
  expect(result.rawSame).toBe(true);
  expect(result.v3FixedPoint).toBe(true);
});

// ---------------------------------------------------------------------------
// 13. Style element, percent width and xmlns audit through the pipeline.
// ---------------------------------------------------------------------------
test("13. style element, percent width and xmlns audit survive the pipeline", async ({
  page,
}) => {
  const source =
    `<svg xmlns="${SVG_NS}" xmlns:foo="javascript:alert(1)" viewBox="0 0 200 100" width="50%">` +
    `<style>.a{fill:red}</style>` +
    `<path class="a" d="M0 0H10V10Z"/></svg>`;
  await gotoLab(page);
  const result = await page.evaluate(async (text: string) => {
    const admission = await import(
      /* @vite-ignore */ "/src/admin-lab/admission.ts"
    );
    const repo = await import(
      /* @vite-ignore */ "/src/admin-lab/repository.ts"
    );
    const admitted = admission.admitSvgTextAsAsset(text);
    if (!admitted.ok) throw new Error(`admit failed: ${admitted.error.code}`);
    const data = new Map<string, string>();
    const backend = {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const store = repo.createAdminDesignStore(backend);
    const saved = await store.saveNew({
      name: "Estilo",
      category: "Arte",
      asset: admitted.draft.asset,
    });
    if (!saved.ok) throw new Error("save failed");
    const reloaded = await repo.createAdminDesignStore(backend).load();
    const rec = reloaded.designs[0] as unknown as {
      svg: string;
      width: number | null;
    };
    const doc = new DOMParser().parseFromString(rec.svg, "image/svg+xml");
    const all = Array.from(doc.getElementsByTagName("*"));
    const readmitted = admission.admitSvgTextAsAsset(rec.svg);
    return {
      fixedPoint: readmitted.ok && readmitted.draft.asset.svg === rec.svg,
      styleCount: doc.getElementsByTagName("style").length,
      styleText: doc.getElementsByTagName("style")[0]?.textContent ?? null,
      classKept:
        doc.getElementsByTagName("path")[0]?.getAttribute("class") ?? null,
      xmlnsFoo: Array.from(doc.documentElement.attributes ?? []).some(
        (a) => a.name.toLowerCase() === "xmlns:foo",
      ),
      hostileTrace: all
        .flatMap((el) => Array.from(el.attributes ?? []).map((a) => a.value))
        .some((v) => /javascript/i.test(v)),
      rootWidthAttr: doc.documentElement.getAttribute("width"),
      derivedWidth: rec.width,
    };
  }, source);
  expect(result.fixedPoint).toBe(true);
  expect(result.styleCount).toBe(1);
  expect(result.styleText).toContain(".a{fill:red}");
  expect(result.classKept).toBe("a");
  expect(result.xmlnsFoo).toBe(false);
  expect(result.hostileTrace).toBe(false);
  expect(result.rootWidthAttr).toBe("50%");
  expect(result.derivedWidth).toBe(100);
});
