import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Full-SVG asset importer (future model v3): arbitrary externally-prepared
 * SVG is parsed, strictly sanitized and stored as ONE vector asset string.
 * Hostile constructs are stripped (file still accepted); only the prologue
 * (entities, stylesheets, non-canonical DTD) fails closed with SECURITY.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const wrap = (body: string, attrs = "") =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" ${attrs}>${body}</svg>`;
const square = '<path d="M0 0H10V10Z"/>';
const MESSI_PATH = fileURLToPath(
  new URL("./fixtures/MESSI-SILHOUETTE.svg", import.meta.url),
);

interface Sanitized {
  ok: boolean;
  code?: string;
  reason?: string;
  svg?: string;
  asset?: {
    svg: string;
    width: number | null;
    height: number | null;
    viewBox: { x: number; y: number; width: number; height: number } | null;
  };
  parserError?: boolean;
  tags?: string[];
  attrNames?: string[];
  attrValues?: string[];
}

async function sanitize(page: Page, source: string): Promise<Sanitized> {
  await page.goto("/admin-lab");
  return page.evaluate(async (src) => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const result = mod.importSvgAsset(src);
    if (!result.ok)
      return { ok: false, code: result.code, reason: result.reason };
    const doc = new DOMParser().parseFromString(
      result.asset.svg,
      "image/svg+xml",
    );
    const els = Array.from(doc.getElementsByTagName("*"));
    return {
      ok: true,
      svg: result.asset.svg,
      asset: result.asset,
      parserError: doc.getElementsByTagName("parsererror").length > 0,
      tags: els.map((el) => (el.localName ?? "").toLowerCase()),
      attrNames: els.flatMap((el) =>
        Array.from(el.attributes ?? []).map((a) => a.name.toLowerCase()),
      ),
      attrValues: els.flatMap((el) =>
        Array.from(el.attributes ?? []).map((a) => a.value),
      ),
    };
  }, source);
}

async function expectFailure(page: Page, source: string, code: string) {
  const result = await sanitize(page, source);
  expect(result.ok).toBe(false);
  expect(result.code).toBe(code);
  expect(typeof result.reason).toBe("string");
  expect((result.reason ?? "").length).toBeGreaterThan(0);
}

// ---------- Security: dangerous constructs stripped, file accepted ----------

test("script elements are removed, file still accepted", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<script>alert(1)</script><defs><script>alert(2)</script></defs>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.parserError).toBe(false);
  expect(result.tags).not.toContain("script");
  expect(result.svg).not.toContain("alert");
});

test("on* attributes are stripped, file still accepted", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(`<g onload="alert(1)" onClick="alert(2)">${square}</g>`),
  );
  expect(result.ok).toBe(true);
  expect(result.attrNames).not.toContain("onload");
  expect(result.attrNames).not.toContain("onclick");
  expect(result.svg).not.toContain("alert");
});

test("javascript: href is removed with its anchor", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(`<a href="javascript:alert(1)">${square}</a>`),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).not.toContain("a");
  expect((result.svg ?? "").toLowerCase()).not.toContain("javascript");
});

test("foreignObject subtrees are removed", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).not.toContain("foreignobject");
  expect(result.tags).not.toContain("div");
});

test("iframe, object, embed and link are removed", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<iframe src="https://evil.example/x"/><object data="https://evil.example/x"/><embed src="https://evil.example/x"/><link href="https://evil.example/x"/>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  for (const tag of ["iframe", "object", "embed", "link"])
    expect(result.tags).not.toContain(tag);
  expect(result.svg).not.toContain("evil.example");
});

test("external xlink:href is stripped, internal use refs survive", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">` +
      `<defs><path id="p" d="M0 0H10V10Z"/></defs>` +
      `<use href="#p"/><use xlink:href="https://evil.example/x"/>` +
      `</svg>`,
  );
  expect(result.ok).toBe(true);
  expect(result.tags).toContain("use");
  expect(result.svg).not.toContain("evil.example");
  expect(result.attrValues).toContain("#p");
});

test("external url() in style attribute is stripped", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(`<path d="M0 0H10V10Z" style="fill:url(https://evil.example/p)"/>`),
  );
  expect(result.ok).toBe(true);
  expect(result.svg).not.toContain("evil.example");
});

test("@import in style is stripped, file still accepted", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      "<g style=\"@import 'https://evil.example/x.css'\">" + square + "</g>",
    ),
  );
  expect(result.ok).toBe(true);
  expect((result.svg ?? "").toLowerCase()).not.toContain("@import");
  expect(result.svg).not.toContain("evil.example");
});

test("xml-stylesheet processing instruction is a SECURITY failure", async ({
  page,
}) => {
  await expectFailure(
    page,
    '<?xml-stylesheet href="local.css"?>' + wrap(square),
    "SECURITY",
  );
  const result = await sanitize(
    page,
    '<?xml-stylesheet href="local.css"?>' + wrap(square),
  );
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("xml-stylesheet");
});

test("prologue SECURITY failures carry precise internal reasons", async ({
  page,
}) => {
  // ENTITY declaration outside any DOCTYPE.
  const entity = await sanitize(page, `<!ENTITY x "hi">` + wrap(square));
  expect(entity.ok).toBe(false);
  expect(entity.code).toBe("SECURITY");
  expect(entity.reason).toContain("ENTITY");
  // Internal subset (entity-capable): explicit `[` detection.
  const subset = await sanitize(
    page,
    `<!DOCTYPE svg [ <!ENTITY xxe "x"> ]>` + wrap(square),
  );
  expect(subset.ok).toBe(false);
  expect(subset.code).toBe("SECURITY");
  expect(subset.reason).toContain("DOCTYPE con subconjunto interno");
  // Unknown SYSTEM identifier fails closed as non-standard.
  const system = await sanitize(
    page,
    `<!DOCTYPE svg SYSTEM "file:///etc/passwd">` + wrap(square),
  );
  expect(system.ok).toBe(false);
  expect(system.code).toBe("SECURITY");
  expect(system.reason).toContain("DOCTYPE no est\u00e1ndar");
  // Known FPI paired with an unknown SYSTEM URL is still non-standard.
  const mismatched = await sanitize(
    page,
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://evil.example/x.dtd">` +
      wrap(square),
  );
  expect(mismatched.ok).toBe(false);
  expect(mismatched.code).toBe("SECURITY");
  expect(mismatched.reason).toContain("DOCTYPE no est\u00e1ndar");
});

test("ENTITY declarations are SECURITY failures", async ({ page }) => {
  for (const prefix of [
    '<!DOCTYPE svg [<!ENTITY x "hi">]>',
    '<!DOCTYPE svg SYSTEM "https://evil.example/x.dtd">',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://evil.example/svg11.dtd">',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://evil.example/x.dtd">',
    '<!DOCTYPE svg SYSTEM "file:///etc/passwd">',
    '<!DOCTYPE svg [ <!ENTITY xxe "x"> ]>',
  ])
    await expectFailure(page, prefix + wrap(square), "SECURITY");
  // Internal subsets carry the explicit internal-subset reason…
  const subset = await sanitize(
    page,
    '<!DOCTYPE svg [ <!ENTITY xxe "x"> ]>' + wrap(square),
  );
  expect(subset.reason).toContain("DOCTYPE con subconjunto interno");
  // …while unknown identifiers carry the non-standard-DOCTYPE reason.
  const unknown = await sanitize(
    page,
    '<!DOCTYPE svg SYSTEM "file:///etc/passwd">' + wrap(square),
  );
  expect(unknown.reason).toContain("DOCTYPE no est\u00e1ndar");
});

test("SMIL set with attributeName is removed", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<defs><path id="p" d="M0 0H10V10Z"/></defs><set href="#p" attributeName="fill" to="red"/>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).not.toContain("set");
  expect((result.svg ?? "").toLowerCase()).not.toContain("attributename");
});

test("data:text/html images are removed", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(`<image href="data:text/html;base64,PGI+aGk8L2I+"/>${square}`),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).not.toContain("image");
  expect(result.svg).not.toContain("data:text/html");
});

test("style element with simple selectors is kept and applied", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(
      `<style>.a{fill:red} path{stroke:blue}</style><path class="a" d="M0 0H10V10Z"/><path d="M20 20H30V30Z"/>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).toContain("style");
  expect(result.svg).toContain(".a{fill:red}");
  expect(result.attrValues).toContain("a");
});

test("style element with @import, url() or expression() is dropped, file accepted", async ({
  page,
}) => {
  for (const css of [
    `@import 'https://evil.example/x.css';`,
    `.a{fill:url(#g)}`,
    `.a{fill:url(https://evil.example/p)}`,
    `.a{fill:expression(alert(1))}`,
  ]) {
    const result = await sanitize(page, wrap(`<style>${css}</style>${square}`));
    expect(result.ok).toBe(true);
    expect(result.tags).not.toContain("style");
  }
  const check = await sanitize(
    page,
    wrap(`<style>@import 'https://evil.example/x.css';</style>${square}`),
  );
  expect((check.svg ?? "").toLowerCase()).not.toContain("@import");
  expect(check.svg).not.toContain("evil.example");
});

test("style element with complex selectors is dropped, file accepted", async ({
  page,
}) => {
  for (const css of [
    `a:hover{fill:red}`,
    `path[data-x="1"]{fill:red}`,
    `.a + .b{fill:red}`,
    `.a ~ .b{fill:red}`,
  ]) {
    const result = await sanitize(page, wrap(`<style>${css}</style>${square}`));
    expect(result.ok).toBe(true);
    expect(result.tags).not.toContain("style");
  }
});

test("SMIL animation elements are removed, file still accepted", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(
      `<animate attributeName="opacity" values="0;1"/><animateTransform attributeName="transform" type="scale" values="1;2"/><set attributeName="fill" to="red"/>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  for (const tag of ["animate", "animatetransform", "set"])
    expect(result.tags).not.toContain(tag);
});

test("nested svg is accepted and its hostile children are sanitized", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(
      `<svg x="10" y="10" width="50" height="50"><path d="M0 0H10V10Z"/><script>alert(1)</script></svg>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags?.filter((t) => t === "svg")).toHaveLength(2);
  expect(result.tags).not.toContain("script");
});

test("deep nesting is a LIMIT failure", async ({ page }) => {
  await expectFailure(
    page,
    wrap("<g>".repeat(80) + square + "</g>".repeat(80)),
    "LIMIT",
  );
});

test("node floods are LIMIT failures", async ({ page }) => {
  await expectFailure(page, wrap("<title/>".repeat(10_001) + square), "LIMIT");
});

test("hostile 600KB volumes sanitize in milliseconds", async ({ page }) => {
  test.setTimeout(20_000);
  await page.goto("/admin-lab");
  const observed = await page.evaluate(async () => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const art = '<path d="M0 0H10V10Z"/>';
    const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`;
    const cases: Array<{ name: string; source: string; expected: string }> = [
      {
        name: "benign-unknown-600KB",
        source: `${open}<g data-note="${"vendor".repeat(100_000)}">${art}</g></svg>`,
        expected: "OK",
      },
      {
        name: "local-urls-style-600KB",
        source: `${open}<g style="${"fill:url(#p);".repeat(80_000)}">${art}</g></svg>`,
        expected: "OK",
      },
      {
        name: "remote-urls-style-600KB",
        source: `${open}<g style="${"fill:url(https://evil.example/p);".repeat(20_000)}">${art}</g></svg>`,
        expected: "OK",
      },
    ];
    return cases.map(({ name, source, expected }) => {
      const start = performance.now();
      const result = mod.importSvgAsset(source);
      const ms = performance.now() - start;
      const code = result.ok ? "OK" : result.code;
      const clean =
        !result.ok || !result.asset.svg.toLowerCase().includes("evil.example");
      return { name, code, expected, ms, clean };
    });
  });
  for (const sample of observed) {
    expect(sample.code).toBe(sample.expected);
    expect(sample.clean).toBe(true);
    expect(sample.ms).toBeLessThan(5_000);
  }
});

// ---------- Fidelity: real-world innocuous structure accepted ----------

test("realistic root attributes are accepted with derived size", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" version="1.0" width="1920pt" height="1080pt" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet"><title>Arte</title>${square}</svg>`,
  );
  expect(result.ok).toBe(true);
  expect(result.svg?.startsWith("<svg")).toBe(true);
  expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  // Absolute units convert to user units per SVG (1pt = 96/72), same
  // factors as the trusted geometry importer.
  expect(result.asset?.width).toBe(2560);
  expect(result.asset?.height).toBe(1440);
  expect(result.asset?.viewBox).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  expect(result.svg).toContain("xMidYMid");
});

test("group transforms including negative Y scale are preserved", async ({
  page,
}) => {
  for (const transform of ["translate(20 30)", "scale(1,-1)", "rotate(45)"]) {
    const result = await sanitize(
      page,
      wrap(`<g transform="${transform}">${square}</g>`),
    );
    expect(result.ok).toBe(true);
    expect(result.svg).toContain(transform);
  }
});

test("multiple paths with fills, strokes and opacities are preserved", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(
      `<path d="M0 0H10V10Z" fill="red"/><path d="M20 20H30V30Z" stroke="#00ff00" stroke-width="4" fill-opacity=".5" stroke-opacity=".7"/><path d="M40 40H50V50Z" opacity=".3"/>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags?.filter((t) => t === "path")).toHaveLength(3);
  for (const needle of ["red", "#00ff00", ".5", ".7"])
    expect(result.svg).toContain(needle);
});

test("metadata is dropped while the file is accepted", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<metadata><info xmlns:vendor="https://vendor.example/info">inert</info></metadata>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).not.toContain("metadata");
  expect(result.svg).not.toContain("vendor.example");
});

test("linearGradient with stops is preserved", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue" stop-opacity=".5"/></linearGradient></defs><path d="M0 0H10V10Z" fill="url(#g)"/>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).toContain("lineargradient");
  expect(result.tags?.filter((t) => t === "stop")).toHaveLength(2);
  expect(result.svg).toContain("url(#g)");
});

test("text and tspan are preserved", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<text x="10" y="20" font-family="Arial" font-size="12">Hola <tspan dx="2">mundo</tspan></text>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).toContain("text");
  expect(result.tags).toContain("tspan");
  expect(result.svg).toContain("Hola");
});

test("internal use and clipPath references are preserved", async ({ page }) => {
  const result = await sanitize(
    page,
    wrap(
      `<defs><path id="p" d="M0 0H10V10Z"/><clipPath id="c"><rect x="0" y="0" width="10" height="10"/></clipPath></defs><use href="#p" clip-path="url(#c)"/>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.tags).toContain("use");
  expect(result.tags).toContain("clippath");
  expect(result.svg).toContain('href="#p"');
  expect(result.svg).toContain("url(#c)");
});

test("every fe* primitive is kept; feImage with an external href is removed", async ({
  page,
}) => {
  const kept = await sanitize(
    page,
    wrap(
      `<defs><filter id="f"><feGaussianBlur stdDeviation="2"/><feOffset dx="1" dy="1"/><feTurbulence baseFrequency="0.1"/><feDropShadow dx="2" dy="2" stdDeviation="2"/></filter></defs>${square}`,
    ),
  );
  expect(kept.ok).toBe(true);
  expect(kept.tags).toContain("filter");
  for (const tag of [
    "fegaussianblur",
    "feoffset",
    "feturbulence",
    "fedropshadow",
  ])
    expect(kept.tags).toContain(tag);
  const internal = await sanitize(
    page,
    wrap(
      `<defs><path id="p" d="M0 0H10V10Z"/><filter id="g"><feImage href="#p"/></filter></defs>${square}`,
    ),
  );
  expect(internal.ok).toBe(true);
  expect(internal.tags).toContain("feimage");
  expect(internal.attrValues).toContain("#p");
  const external = await sanitize(
    page,
    wrap(
      `<defs><filter id="h"><feImage href="https://evil.example/x.png"/></filter></defs>${square}`,
    ),
  );
  expect(external.ok).toBe(true);
  expect(external.tags).not.toContain("feimage");
  expect(external.svg).not.toContain("evil.example");
});

test("bounded data:image images are kept; external images are removed", async ({
  page,
}) => {
  const tiny =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const good = await sanitize(
    page,
    wrap(`<image href="${tiny}" x="0" y="0" width="10" height="10"/>${square}`),
  );
  expect(good.ok).toBe(true);
  expect(good.tags).toContain("image");
  const bad = await sanitize(
    page,
    wrap(`<image href="https://evil.example/x.png"/>${square}`),
  );
  expect(bad.ok).toBe(true);
  expect(bad.tags).not.toContain("image");
});

test("unknown attributes are stripped while the file is accepted", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100"><g inkscape:label="Capa" data-note="yes" tabindex="3">${square}</g></svg>`,
  );
  expect(result.ok).toBe(true);
  expect(result.attrNames).not.toContain("inkscape:label");
  expect(result.attrNames).not.toContain("data-note");
  expect(result.attrNames).not.toContain("tabindex");
});

test("canonical SVG 1.1 doctype is tolerated but dropped from output", async ({
  page,
}) => {
  const declaration =
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  const result = await sanitize(page, declaration + wrap(square));
  expect(result.ok).toBe(true);
  expect(result.svg).not.toContain("DOCTYPE");
  expect(result.svg).not.toContain("svg11.dtd");
  expect(result.svg?.startsWith("<svg")).toBe(true);
});

test("inert standard SVG DTD references are tolerated but dropped from output", async ({
  page,
}) => {
  const declarations = [
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 20010904//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Basic//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd">',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Tiny//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-tiny.dtd">',
    '<!DOCTYPE svg SYSTEM "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">',
    '<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    "<!DOCTYPE svg>",
  ];
  for (const declaration of declarations) {
    const result = await sanitize(page, declaration + wrap(square));
    expect(result.ok).toBe(true);
    expect(result.svg).not.toContain("DOCTYPE");
    expect(result.svg?.startsWith("<svg")).toBe(true);
  }
  // SVG 1.0 PUBLIC pair is a fixed point: re-importing the sanitized
  // output (which carries no DOCTYPE) yields the identical document.
  await page.goto("/admin-lab");
  const fixed = await page.evaluate(async (declaration: string) => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const source =
      declaration +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0H10V10Z"/></svg>`;
    const first = mod.importSvgAsset(source);
    if (!first.ok) return { ok: false as const };
    const second = mod.importSvgAsset(first.asset.svg);
    if (!second.ok) return { ok: false as const };
    return {
      ok: true as const,
      equal: second.asset.svg === first.asset.svg,
      hasDoctype: first.asset.svg.includes("DOCTYPE"),
    };
  }, declarations[0]);
  expect(fixed.ok).toBe(true);
  expect(fixed).toMatchObject({ equal: true, hasDoctype: false });
});

test("MESSI fixture prologue is the inert SVG 1.0 DOCTYPE (diagnostic traceability)", async ({
  page,
}) => {
  // Permanent regression evidence for the SVG 1.0 false positive: the only
  // prologue trigger in the owner-supplied fixture is its standard W3C
  // SVG 1.0 DOCTYPE. The rest of the file (xmlns + g + 2 paths) is clean,
  // so the fixture imports, the DOCTYPE is dropped from output, and
  // swapping the known SYSTEM URL for an unknown one fails closed with
  // the non-standard-DOCTYPE reason.
  let source: string;
  try {
    source = readFileSync(MESSI_PATH, "utf8");
  } catch {
    test.skip(true, "Fixture tests/fixtures/MESSI-SILHOUETTE.svg absent.");
    return;
  }
  const imported = await sanitize(page, source);
  expect(imported.ok).toBe(true);
  expect(imported.svg).not.toContain("DOCTYPE");
  expect(imported.svg).not.toContain("svg10.dtd");
  // Same file with the DOCTYPE prologue removed imports to the same
  // sanitized document: proves the rest of the file was always clean.
  const withoutDoctype = source.replace(/<!DOCTYPE[^>]*>/, "");
  expect(withoutDoctype).not.toContain("DOCTYPE");
  const stripped = await sanitize(page, withoutDoctype);
  expect(stripped.ok).toBe(true);
  expect(stripped.svg).toBe(imported.svg);
  // Same file with an unknown SYSTEM URL still fails closed with the
  // DOCTYPE-specific reason: proves the DOCTYPE was the trigger.
  const evil = source.replace(
    "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd",
    "http://evil.example/x.dtd",
  );
  const rejected = await sanitize(page, evil);
  expect(rejected.ok).toBe(false);
  expect(rejected.code).toBe("SECURITY");
  expect(rejected.reason).toContain("DOCTYPE no est\u00e1ndar");
});

test("percent width/height with viewBox resolve from viewBox", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(square, 'width="100%" height="100%"'),
  );
  expect(result.ok).toBe(true);
  expect(result.asset?.width).toBe(100);
  expect(result.asset?.height).toBe(100);
  expect(result.svg).toContain("100%");
});

test("missing size and viewBox is a TECHNICAL failure", async ({ page }) => {
  await expectFailure(
    page,
    `<svg xmlns="${SVG_NS}">${square}</svg>`,
    "TECHNICAL",
  );
});

test("empty and oversized inputs fail with MALFORMED and LIMIT", async ({
  page,
}) => {
  await expectFailure(page, "   ", "MALFORMED");
  await expectFailure(page, "<svg", "MALFORMED");
  await expectFailure(page, wrap(square) + " ".repeat(2_000_001), "LIMIT");
});

test("sanitized output is a fixed point", async ({ page }) => {
  await page.goto("/admin-lab");
  const stable = await page.evaluate(async () => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" version="1.0" width="100" height="100" viewBox="0 0 100 100">` +
      `<metadata>drop me</metadata><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>` +
      `<g transform="scale(1,-1)" data-note="strip"><path d="M0 0H10V10Z" fill="url(#g)" onclick="x"/></g>` +
      `<text x="1" y="2">hi</text></svg>`;
    const first = mod.importSvgAsset(source);
    if (!first.ok) return { ok: false as const };
    const second = mod.importSvgAsset(first.asset.svg);
    if (!second.ok) return { ok: false as const };
    return {
      ok: true as const,
      equal: second.asset.svg === first.asset.svg,
      svg: first.asset.svg,
    };
  });
  expect(stable.ok).toBe(true);
  expect(stable.equal).toBe(true);
});

test("stored asset read-validation: fixed point plus field consistency, no byte-equality", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const checked = await page.evaluate(async () => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">` +
      `<path d="M0 0H10V10Z" fill="red"/></svg>`;
    const imported = mod.importSvgAsset(source);
    if (!imported.ok) return { imported: false as const };
    const asset = imported.asset;
    const good = mod.sanitizeStoredSvgAsset(asset);
    const trailing = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: asset.svg + "<!-- tampered -->",
    });
    const widen = mod.sanitizeStoredSvgAsset({
      ...asset,
      width: 999,
    });
    const edited = mod.sanitizeStoredSvgAsset({
      ...asset,
      // Clean-looking edit that desyncs a derived field: viewBox in the
      // string no longer matches the recorded one.
      svg: asset.svg.replace('viewBox="0 0 100 50"', 'viewBox="0 0 200 50"'),
    });
    // Re-sanitizable body tampering validates with the canonical output:
    // safety comes from re-sanitization, not from rejecting the read.
    const onload = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: asset.svg.replace("<path", '<path onload="alert(1)"'),
    });
    const script = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: asset.svg.replace("</svg>", "<script>alert(1)</script></svg>"),
    });
    const external = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: asset.svg.replace(
        "</svg>",
        '<image href="https://evil.example/x.png"/></svg>',
      ),
    });
    // Prologue attacks still fail the stored read closed.
    const entity = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: '<!DOCTYPE svg [<!ENTITY x "hi">]>' + asset.svg,
    });
    const pi = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: '<?xml-stylesheet href="local.css"?>' + asset.svg,
    });
    const malformed = mod.sanitizeStoredSvgAsset({
      ...asset,
      svg: "<svg",
    });
    return {
      imported: true as const,
      roundtrip: good !== null && good.svg === asset.svg,
      roundtripFields:
        good !== null &&
        good.width === 100 &&
        good.height === 50 &&
        good.viewBox !== null &&
        good.viewBox.width === 100,
      trailingOk:
        trailing !== null &&
        trailing.svg === asset.svg &&
        !trailing.svg.includes("tampered"),
      widen: widen === null,
      edited: edited === null,
      onloadCanonical:
        onload !== null &&
        !onload.svg.includes("onload") &&
        !onload.svg.includes("alert") &&
        onload.width === 100,
      scriptCanonical:
        script !== null && !script.svg.toLowerCase().includes("<script"),
      externalCanonical:
        external !== null && !external.svg.includes("evil.example"),
      entity: entity === null,
      pi: pi === null,
      malformed: malformed === null,
      junk: [
        mod.sanitizeStoredSvgAsset(null),
        mod.sanitizeStoredSvgAsset([]),
        mod.sanitizeStoredSvgAsset({}),
        mod.sanitizeStoredSvgAsset({ svg: 42 }),
        mod.sanitizeStoredSvgAsset("svg"),
        mod.sanitizeStoredSvgAsset({ svg: "   " }),
      ].every((value) => value === null),
    };
  });
  expect(checked.imported).toBe(true);
  expect(checked).toMatchObject({
    roundtrip: true,
    roundtripFields: true,
    trailingOk: true,
    widen: true,
    edited: true,
    onloadCanonical: true,
    scriptCanonical: true,
    externalCanonical: true,
    entity: true,
    pi: true,
    malformed: true,
    junk: true,
  });
});

// ---------- New contract: raw gates, CDATA, raster-only, xmlns audit ----------

test("raw percent-encoded resource refs are stripped before decoding (F1)", async ({
  page,
}) => {
  const encoded = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100"><defs><path id="p" d="M0 0H10V10Z"/></defs><use href="%23p"/>${square}</svg>`,
  );
  expect(encoded.ok).toBe(true);
  expect(encoded.tags).toContain("use");
  expect(encoded.attrValues ?? []).not.toContain("%23p");
  expect(encoded.svg).not.toContain("%23p");
  const sneaky = await sanitize(
    page,
    wrap(
      `<image href="%64ata:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="10" height="10"/>${square}`,
    ),
  );
  expect(sneaky.ok).toBe(true);
  expect(sneaky.tags).not.toContain("image");
});

test("CDATA script smuggling becomes escaped text, never markup (F2)", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    wrap(
      `<text x="10" y="20">hello<![CDATA[<script>alert(1)</script>]]>world</text>${square}`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.svg).not.toContain("<![CDATA[");
  expect(result.tags).not.toContain("script");
  expect(result.svg).toContain("&lt;script&gt;");
  await page.goto("/admin-lab");
  const text = await page.evaluate(async (svg: string) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return doc.getElementsByTagName("text")[0]?.textContent ?? null;
  }, result.svg ?? "");
  expect(text).toContain("<script>alert(1)</script>");
});

test("image data URIs are raster-only; nested SVG payloads are stripped (F3)", async ({
  page,
}) => {
  const nested = await sanitize(
    page,
    wrap(
      `<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" x="0" y="0" width="10" height="10"/>${square}`,
    ),
  );
  expect(nested.ok).toBe(true);
  expect(nested.tags).not.toContain("image");
  expect(nested.svg).not.toContain("data:image/svg+xml");
  const gif = await sanitize(
    page,
    wrap(
      `<image href="data:image/gif;base64,R0lGODdhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" x="0" y="0" width="10" height="10"/>${square}`,
    ),
  );
  expect(gif.ok).toBe(true);
  expect(gif.tags).toContain("image");
});

test("hostile xmlns values are stripped while the file is accepted (F4)", async ({
  page,
}) => {
  const result = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" xmlns:foo="javascript:alert(1)" viewBox="0 0 100 100">${square}</svg>`,
  );
  expect(result.ok).toBe(true);
  expect(result.attrNames).not.toContain("xmlns:foo");
  expect((result.svg ?? "").toLowerCase()).not.toContain("javascript");
  expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test("ENTITY inside a comment is not a prologue attack; a real ENTITY still fails closed", async ({
  page,
}) => {
  const commented = await sanitize(
    page,
    `<!-- <!ENTITY x "hi"> -->` + wrap(square),
  );
  expect(commented.ok).toBe(true);
  expect(commented.svg).not.toContain("ENTITY");
  await expectFailure(
    page,
    `<!DOCTYPE svg [<!ENTITY x "hi">]>` + wrap(square),
    "SECURITY",
  );
});

test("percent extents scale the viewBox; zero extents derive null", async ({
  page,
}) => {
  const half = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 200 100" width="50%" height="25%">${square}</svg>`,
  );
  expect(half.ok).toBe(true);
  expect(half.asset?.width).toBe(100);
  expect(half.asset?.height).toBe(25);
  const zero = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" width="0" height="50">${square}</svg>`,
  );
  expect(zero.ok).toBe(true);
  expect(zero.asset?.width).toBeNull();
  expect(zero.asset?.height).toBe(50);
});

test("physical length units derive user units", async ({ page }) => {
  const cm = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" width="2.54cm" height="25.4mm">${square}</svg>`,
  );
  expect(cm.ok).toBe(true);
  expect(cm.asset?.width).toBeCloseTo(96, 9);
  expect(cm.asset?.height).toBeCloseTo(96, 9);
  const inch = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" width="1in" height="72pt">${square}</svg>`,
  );
  expect(inch.ok).toBe(true);
  expect(inch.asset?.width).toBe(96);
  expect(inch.asset?.height).toBeCloseTo(96, 9);
});

test("tiny svg is TECHNICAL; BOM, CRLF, comments with markup and generic PIs are tolerated", async ({
  page,
}) => {
  await expectFailure(page, `<svg xmlns="${SVG_NS}"/>`, "TECHNICAL");
  const bom = await sanitize(page, "\uFEFF" + wrap(square));
  expect(bom.ok).toBe(true);
  const crlf = await sanitize(
    page,
    `<svg xmlns="${SVG_NS}" viewBox="0 0 100 100">\r\n<path d="M0 0H10V10Z"/>\r\n</svg>`,
  );
  expect(crlf.ok).toBe(true);
  const commentMarkup = await sanitize(
    page,
    wrap(`<!-- <script>alert(1)</script> -->${square}`),
  );
  expect(commentMarkup.ok).toBe(true);
  expect(commentMarkup.tags).not.toContain("script");
  expect(commentMarkup.svg).not.toContain("alert");
  const pi = await sanitize(page, wrap(`<?foo bar?>${square}`));
  expect(pi.ok).toBe(true);
  expect(pi.svg).not.toContain("foo");
});

test("validated output sets no scripts or handlers via innerHTML", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const result = await page.evaluate(async () => {
    const mod = await import(
      /* @vite-ignore */ "/src/admin-lab/svgAssetImport.ts"
    );
    const SVG = "http://www.w3.org/2000/svg";
    const hostile =
      `<svg xmlns="${SVG}" viewBox="0 0 100 100">` +
      `<script>alert(1)</script>` +
      `<g onload="alert(2)"><path d="M0 0H10V10Z" onclick="alert(3)"/></g>` +
      `<a href="javascript:alert(4)"><path d="M20 20H30V30Z"/></a></svg>`;
    const imported = mod.importSvgAsset(hostile);
    if (!imported.ok) return { ok: false as const };
    const div = document.createElement("div");
    div.innerHTML = imported.asset.svg;
    const onAttrs: string[] = [];
    for (const el of div.querySelectorAll("*")) {
      for (const attr of Array.from(el.attributes ?? [])) {
        if (attr.name.toLowerCase().startsWith("on")) onAttrs.push(attr.name);
      }
    }
    const html = div.innerHTML.toLowerCase();
    return {
      ok: true as const,
      scripts: div.querySelectorAll("script").length,
      onAttrs,
      hasJavascript: html.includes("javascript"),
      pathCount: div.querySelectorAll("path").length,
    };
  });
  expect(result.ok).toBe(true);
  expect(result).toMatchObject({
    scripts: 0,
    onAttrs: [],
    hasJavascript: false,
  });
  expect((result as { pathCount?: number }).pathCount).toBeGreaterThan(0);
});
