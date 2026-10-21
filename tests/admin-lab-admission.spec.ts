/** Asset admission v3 (sanitized full-SVG) + v1/v2 geometry admission unchanged.
 *
 * Asset semantics (from svgAssetImport): hostile body content is STRIPPED and
 * the file is still accepted; only the prologue (entities, stylesheet PIs,
 * non-canonical DTD) fails closed with SECURITY. Inline <script> therefore
 * never survives in an accepted asset instead of rejecting the file.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  admitSvgFileAsAsset,
  ADMIN_ADMISSION_LIMITS,
} from "../src/admin-lab/admission";

const SVG_NS = "http://www.w3.org/2000/svg";
const wrap = (inner: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="${SVG_NS}" ${attrs}>${inner}</svg>`;
const SQUARE = '<path d="M0 0H10V10Z" fill="#000000"/>';

/** Real-world-shaped export: version, pt size, viewBox, preserveAspectRatio,
 * group transform, multiple paths, metadata. */
const REALISTIC =
  `<svg version="1.0" width="1920pt" height="1080pt" viewBox="0 0 1920 1080" ` +
  `preserveAspectRatio="xMidYMid meet" xmlns="${SVG_NS}">` +
  `<title>Arte de usuario</title><metadata>Editor externo</metadata>` +
  `<g transform="translate(10 20) scale(2)">` +
  `<path d="M0 0H40V40H0Z" fill="#123456"/>` +
  `<path d="M0 20L60 20" fill="none" stroke="red" stroke-width="4"/>` +
  `</g></svg>`;

interface AssetResult {
  ok: boolean;
  code?: string;
  reason?: string;
  asset?: {
    svg: string;
    width: number | null;
    height: number | null;
    viewBox: { x: number; y: number; width: number; height: number } | null;
  };
}

async function admitAsset(page: Page, source: string): Promise<AssetResult> {
  await page.goto("/admin-lab");
  return page.evaluate(async (src) => {
    const mod = await import(/* @vite-ignore */ "/src/admin-lab/admission.ts");
    const outcome = mod.admitSvgTextAsAsset(src);
    if (!outcome.ok)
      return {
        ok: false,
        code: outcome.error.code,
        reason: outcome.error.reason,
      };
    return { ok: true, asset: outcome.draft.asset };
  }, source);
}

test("asset admite un SVG con forma real preservando tamaño y estructura", async ({
  page,
}) => {
  const result = await admitAsset(page, REALISTIC);
  expect(result.ok).toBe(true);
  // pt -> user units (1pt = 96/72): misma conversión del importador.
  expect(result.asset?.width).toBe(2560);
  expect(result.asset?.height).toBe(1440);
  expect(result.asset?.viewBox).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  expect(result.asset?.svg.startsWith("<svg")).toBe(true);
  expect(result.asset?.svg).toContain("translate(10 20) scale(2)");
  expect(result.asset?.svg).toContain("xMidYMid");
  expect(result.asset?.svg).not.toContain("<metadata");
  expect(result.asset?.svg).not.toContain("<script");
  expect(result.asset?.svg).not.toContain("alert");
  // Archivo completo por la misma vía (File real del navegador).
  await page.goto("/admin-lab");
  const viaFile = await page.evaluate(async (src) => {
    const mod = await import(/* @vite-ignore */ "/src/admin-lab/admission.ts");
    const file = new File([src], "realista.svg", { type: "image/svg+xml" });
    const outcome = await mod.admitSvgFileAsAsset(file);
    return outcome.ok ? { ok: true } : { ok: false };
  }, REALISTIC);
  expect(viaFile.ok).toBe(true);
});

test("asset: el prólogo hostil es SECURITY y el script se purga sin rechazar", async ({
  page,
}) => {
  for (const source of [
    '<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap(SQUARE),
    '<?xml-stylesheet href="https://evil.example/css"?>' + wrap(SQUARE),
  ]) {
    const result = await admitAsset(page, source);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("SECURITY");
    expect(typeof result.reason).toBe("string");
  }
  // <script> inline no sobrevive: se elimina y el archivo se admite.
  const stripped = await admitAsset(
    page,
    wrap(`<script>alert(1)</script>${SQUARE}`),
  );
  expect(stripped.ok).toBe(true);
  expect(stripped.asset?.svg).not.toContain("<script");
  expect(stripped.asset?.svg).not.toContain("alert");
});

test("asset clasifica LIMIT, TECHNICAL y MALFORMED", async ({ page }) => {
  const limit = await admitAsset(
    page,
    wrap("<g>".repeat(80) + SQUARE + "</g>".repeat(80)),
  );
  expect(limit.ok).toBe(false);
  expect(limit.code).toBe("LIMIT");

  const oversized = await admitAsset(page, wrap(SQUARE).padEnd(2_100_000, " "));
  expect(oversized.ok).toBe(false);
  expect(oversized.code).toBe("LIMIT");

  const technical = await admitAsset(
    page,
    `<svg xmlns="${SVG_NS}">${SQUARE}</svg>`,
  );
  expect(technical.ok).toBe(false);
  expect(technical.code).toBe("TECHNICAL");

  for (const source of ["   ", wrap(SQUARE).slice(0, -6)]) {
    const malformed = await admitAsset(page, source);
    expect(malformed.ok).toBe(false);
    expect(malformed.code).toBe("MALFORMED");
  }
});

test("asset no lee archivos enormes y captura fallo de File.text", async () => {
  let reads = 0;
  const enormous = {
    size: ADMIN_ADMISSION_LIMITS.MAX_FILE_BYTES + 1,
    text: async () => {
      reads++;
      return "";
    },
  };
  const rejected = await admitSvgFileAsAsset(enormous as File);
  expect(rejected.ok).toBe(false);
  expect(!rejected.ok && rejected.error.code).toBe("LIMIT");
  expect(reads).toBe(0);
  const broken = await admitSvgFileAsAsset({
    size: 10,
    text: async () => {
      throw new Error("read failed");
    },
  } as File);
  expect(!broken.ok && broken.error.code).toBe("FILE_READ_ERROR");
});

test("admisión v1/v2 por geometría sigue intacta", async ({ page }) => {
  // svgGeometryImport also parses via DOMParser, so geometry admission runs
  // in the browser like the asset path.
  await page.goto("/admin-lab");
  const result = await page.evaluate(async (boxed: string) => {
    const mod = await import(/* @vite-ignore */ "/src/admin-lab/admission.ts");
    const wrapIn = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
    const good = mod.admitSvgText(boxed);
    const hostile = mod.admitSvgText(
      wrapIn(`<script>alert(1)</script>${boxed}`),
    );
    let reads = 0;
    const guarded = await mod.admitSvgFile({
      size: mod.ADMIN_ADMISSION_LIMITS.MAX_FILE_BYTES + 1,
      text: async () => {
        reads++;
        return "";
      },
    } as File);
    return {
      goodOk: good.ok,
      pathCount: good.ok ? good.draft.pathCount : -1,
      hostileOk: hostile.ok,
      guardedOk: guarded.ok,
      reads,
    };
  }, wrap(SQUARE));
  expect(result.goodOk).toBe(true);
  expect(result.pathCount).toBeGreaterThan(0);
  expect(result.hostileOk).toBe(false);
  expect(result.guardedOk).toBe(false);
  expect(result.reads).toBe(0);
});
