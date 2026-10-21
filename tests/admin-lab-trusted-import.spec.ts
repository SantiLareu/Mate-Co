import { expect, test, type Page } from "@playwright/test";

const tightPath = "M0 0H10V10H0Z";
const farPath = "M10000 10000H10010V10010H10000Z";
for (const hidden of [
  {
    name: "no paints",
    body: `<path d="${farPath}" fill="none" stroke="none"/>`,
  },
  {
    name: "group opacity zero",
    body: `<g opacity="0"><g opacity=".5"><path d="${farPath}"/></g></g>`,
  },
  { name: "path opacity zero", body: `<path d="${farPath}" opacity="0"/>` },
  {
    name: "paint opacities zero",
    body: `<path d="${farPath}" fill-opacity="0" stroke="red" stroke-opacity="0"/>`,
  },
]) {
  test(`painted bounds exclude ${hidden.name} but preserve editable geometry`, async ({
    page,
  }) => {
    const result = await importSvg(
      page,
      wrap(`<path d="${tightPath}"/>${hidden.body}`),
    );
    expect(result.ok).toBe(true);
    expect(result.geometry.artBounds).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(result.geometry.centerlineBounds).toEqual({
      x: 0,
      y: 0,
      width: 10010,
      height: 10010,
    });
    expect(result.geometry.paths.map((p: { d: string }) => p.d)).toEqual([
      tightPath,
      farPath,
    ]);
    const roundtrip = await page.evaluate(async (geometry) => {
      const model = "/src/admin-lab/importedGeometry.ts";
      const { validateImportedGeometry } = await import(
        /* @vite-ignore */ model
      );
      return validateImportedGeometry(geometry);
    }, result.geometry);
    expect(roundtrip.ok).toBe(true);
    expect(roundtrip.geometry).toEqual(result.geometry);
  });
}

test("zero fill opacity leaves visible stroke; zero stroke opacity removes only stroke margin", async ({
  page,
}) => {
  const stroke = await importSvg(
    page,
    wrap(
      `<path d="${tightPath}" fill-opacity="0" stroke="red" stroke-width="2" stroke-linejoin="bevel"/>`,
    ),
  );
  expect(stroke.ok).toBe(true);
  expect(stroke.geometry.artBounds).toEqual({
    x: -1,
    y: -1,
    width: 12,
    height: 12,
  });
  const fill = await importSvg(
    page,
    wrap(
      `<path d="${tightPath}" stroke="red" stroke-width="200" stroke-opacity="0"/>`,
    ),
  );
  expect(fill.ok).toBe(true);
  expect(fill.geometry.artBounds).toEqual({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
});

test("definite transparent concrete paint does not overframe visible art", async ({
  page,
}) => {
  for (const paint of [
    "transparent",
    "#abc0",
    "#12345600",
    "rgba(1,2,3,0)",
    "rgb(1 2 3 / 0%)",
    "hsl(120 50% 40% / 0)",
  ]) {
    const result = await importSvg(
      page,
      wrap(
        `<path d="${tightPath}"/><path d="${farPath}" fill="${paint}" stroke="${paint}" stroke-width="20"/>`,
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.geometry.artBounds).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(result.geometry.paths).toHaveLength(2);
  }
});

test("fully invisible valid art imports with positive centerline fallback, not suitability rejection", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(
      `<g opacity="0"><path d="${farPath}" stroke="red" stroke-width="20"/></g>`,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.artBounds).toEqual({
    x: 10000,
    y: 10000,
    width: 10,
    height: 10,
  });
  expect(result.geometry.artBounds).toEqual(result.geometry.centerlineBounds);
  expect(result.geometry.paths[0].d).toBe(farPath);
  expect(result.geometry.nodes).toEqual([
    { kind: "group", opacity: 1, children: [1] },
    { kind: "group", opacity: 0, children: [2] },
    { kind: "path", opacity: 1, path: 0 },
  ]);
  for (const d of ["M0 0", "M0 0H10"]) {
    await expectFailure(
      page,
      wrap(`<path d="${d}" fill="none" stroke="none"/>`),
      "INVALID_GEOMETRY",
    );
  }
});

test("tiny positive ancestor opacities still bound potential paint; invisible stroked lines reload with finite fallback", async ({
  page,
}) => {
  const tiny = await importSvg(
    page,
    wrap(
      `<g opacity="1e-200"><g opacity="1e-200"><path d="${farPath}"/></g></g>`,
    ),
  );
  expect(tiny.ok).toBe(true);
  expect(tiny.geometry.artBounds).toEqual({
    x: 10000,
    y: 10000,
    width: 10,
    height: 10,
  });
  const line = await importSvg(
    page,
    wrap(
      '<g opacity="0"><path d="M0 0H10" stroke="red" stroke-width="2" stroke-linejoin="bevel"/></g>',
    ),
  );
  expect(line.ok).toBe(true);
  expect(line.geometry.artBounds).toEqual({
    x: 0,
    y: -0.5,
    width: 10,
    height: 1,
  });
  const reloaded = await page.evaluate(async (geometry) => {
    const model = "/src/admin-lab/importedGeometry.ts";
    const { validateImportedGeometry } = await import(/* @vite-ignore */ model);
    const old = structuredClone(geometry);
    old.artBounds = { x: -1, y: -1, width: 12, height: 2 };
    return [validateImportedGeometry(geometry), validateImportedGeometry(old)];
  }, line.geometry);
  for (const checked of reloaded) {
    expect(checked.ok).toBe(true);
    expect(checked.geometry).toEqual(line.geometry);
  }
});

test("invisible paths still consume work and coordinate validation on import and model load", async ({
  page,
}) => {
  for (const body of [
    '<path d="M0 0H1000001V10Z" fill="none" stroke="none"/>',
    '<g opacity="0" transform="translate(1000000 0)"><path d="M0 0H10V10Z"/></g>',
    `<g opacity="0"><path d="M0 0C${"1 1 2 2 3 3 ".repeat(15000)}"/><path d="M0 0C${"1 1 2 2 3 3 ".repeat(15000)}"/></g>`,
  ]) {
    const result = await importSvg(
      page,
      wrap(`<path d="${tightPath}"/>${body}`),
    );
    expect(result.ok).toBe(false);
    expect(["INVALID_GEOMETRY", "LIMIT"]).toContain(result.code);
  }
  const result = await importSvg(
    page,
    wrap(`<path d="${tightPath}"/><path d="${farPath}" opacity="0"/>`),
  );
  const checked = await page.evaluate(async (geometry) => {
    const model = "/src/admin-lab/importedGeometry.ts";
    const { validateImportedGeometry } = await import(/* @vite-ignore */ model);
    return ["M0 0H1000001V10Z", "M0 0L"].map((d) => {
      const clone = structuredClone(geometry);
      clone.paths[1].d = d;
      return validateImportedGeometry(clone).ok;
    });
  }, result.geometry);
  expect(checked).toEqual([false, false]);
});

const square = '<path d="M10 10H90V90H10Z"/>';
const wrap = (body: string, attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attrs}>${body}</svg>`;

async function importSvg(page: Page, text: string) {
  await page.goto("/admin-lab");
  return page.evaluate(async (source) => {
    const modulePath = "/src/admin-lab/svgGeometryImport.ts";
    const { importTrustedSvg } = await import(/* @vite-ignore */ modulePath);
    return importTrustedSvg(source);
  }, text);
}

async function expectFailure(
  page: Page,
  source: string,
  code: string,
  reason?: string,
) {
  const result = await importSvg(page, source);
  expect(result.ok).toBe(false);
  expect(result.code).toBe(code);
  if (reason) expect(result.reason).toContain(reason);
}

test("realistic root, metadata and original paths with composed transform", async ({
  page,
}) => {
  const d = "M10 10 H90 V90 H10 Z";
  const result = await importSvg(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg"
    xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.0"
    width="1920pt" height="1080pt" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet">
    <title>Arte</title><desc>Editable</desc><metadata><inkscape:info url="https://vendor.example/info">inert</inkscape:info></metadata>
    <defs><linearGradient id="unused"><stop offset="0" stop-color="red"/></linearGradient></defs>
    <g inkscape:label="Capa" transform="translate(20 30)"><path id="art" d="${d}" transform="scale(2)"/></g>
    </svg>`,
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.version).toBe(2);
  expect(result.geometry.paths[0].d).toBe(d);
  expect(result.geometry.paths[0].matrix).toEqual({
    a: 2,
    b: 0,
    c: 0,
    d: 2,
    e: 20,
    f: 30,
  });
  expect(result.geometry.artBounds).toEqual({
    x: 40,
    y: 50,
    width: 160,
    height: 160,
  });
  expect(JSON.stringify(result.geometry)).not.toContain("inkscape");
});

test("concrete colors, mixed fill rules and controlled stroke style", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<g fill="rebeccapurple" fill-opacity=".8" stroke="rgb(20, 30, 40)"
    stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="6"
    stroke-dasharray="3 2" stroke-dashoffset="-1" stroke-opacity=".7">
    <path d="M10 10H90V90H10Z" fill-rule="evenodd"/>
    <path d="M20 20H80V80H20Z" style="fill:hsl(120 50% 40% / .6);fill-rule:nonzero;stroke:#abcd"/>
    </g>`),
  );
  expect(result.ok).toBe(true);
  const [first, second] = result.geometry.paths;
  expect(first.style).toMatchObject({
    fill: "rebeccapurple",
    stroke: "rgb(20, 30, 40)",
    strokeWidth: 4,
    linecap: "round",
    linejoin: "bevel",
    miterlimit: 6,
    dasharray: [3, 2],
    dashoffset: -1,
    fillRule: "evenodd",
    fillOpacity: 0.8,
    strokeOpacity: 0.7,
  });
  expect(second.style.fill).toBe("hsl(120 50% 40% / .6)");
  expect(second.style.fillRule).toBe("nonzero");
});

test("overlapping art retains ordered group opacity, not multiplied path alpha", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<g opacity=".5"><g opacity=".6">${square}
    <path d="M20 20H80V80H20Z" opacity=".4"/></g></g>`),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.nodes).toEqual([
    { kind: "group", opacity: 1, children: [1] },
    { kind: "group", opacity: 0.5, children: [2] },
    { kind: "group", opacity: 0.6, children: [3, 4] },
    { kind: "path", opacity: 1, path: 0 },
    { kind: "path", opacity: 0.4, path: 1 },
  ]);
  expect(
    result.geometry.paths.map(
      (p: { style: { fillOpacity: number } }) => p.style.fillOpacity,
    ),
  ).toEqual([1, 1]);
});

test("convertible primitives, line stroke and packed arcs have analytic bounds", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<circle cx="20" cy="20" r="10"/>
    <ellipse cx="60" cy="20" rx="10" ry="5"/>
    <rect x="10" y="40" width="20" height="20" rx="3"/>
    <polygon points="40,40 60,40 50,60"/><polyline points="70,40 80,60 90,40" fill="none" stroke="blue"/>
    <line x1="10" y1="80" x2="90" y2="80" stroke="red" stroke-width="10"/>
    <path d="M10 10A30 50 0 01162.55 162.45"/>`),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.paths).toHaveLength(7);
  expect(result.geometry.paths[6].d).toBe("M10 10A30 50 0 01162.55 162.45");
  const line = await importSvg(
    page,
    wrap(
      '<line x1="10" y1="20" x2="90" y2="20" stroke="red" stroke-width="10"/>',
    ),
  );
  expect(line.ok).toBe(true);
  expect(line.geometry.centerlineBounds).toEqual({
    x: 10,
    y: 20,
    width: 80,
    height: 0,
  });
  expect(line.geometry.artBounds.y).toBeLessThanOrEqual(15);
  expect(line.geometry.artBounds.height).toBeGreaterThanOrEqual(10);
});

test("affine strokes include square caps and miter envelope without double transforms", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<g transform="translate(100 200)">
    <path d="M0 0L10 0L10 10" transform="matrix(2 3 4 5 0 0)" fill="none" stroke="black"
    stroke-width="10" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="8"/></g>`),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.centerlineBounds).toEqual({
    x: 100,
    y: 200,
    width: 60,
    height: 80,
  });
  const bounds = result.geometry.artBounds;
  expect(bounds.x).toBeLessThanOrEqual(100 - 40 * Math.hypot(2, 4));
  expect(bounds.y).toBeLessThanOrEqual(200 - 40 * Math.hypot(3, 5));
});

test("smooth quadratic endpoints and coincident arc do not invent or lose bounds", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap('<path d="M0 0Q10 20 20 0T40 0A10 10 0 1 1 40 0"/>'),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.centerlineBounds).toEqual({
    x: 0,
    y: -10,
    width: 40,
    height: 20,
  });
});

test("full security audit includes ignored metadata and definitions", async ({
  page,
}) => {
  for (const content of [
    "<metadata><script>alert(1)</script></metadata>",
    '<defs><g onload="alert(1)"/></defs>',
    "<metadata><foreignObject/></metadata>",
    "<metadata><iframe/></metadata>",
    "<defs><object/></defs>",
    "<metadata><embed/></metadata>",
    '<metadata><x href="java&#x73;cript:alert(1)"/></metadata>',
    '<defs><image href="https://evil.example/image.png"/></defs>',
    '<metadata><x style="fill:url(https://evil.example/p)"/></metadata>',
    '<metadata><style>@import "https://evil.example/x.css";</style></metadata>',
    '<metadata><x href="%6a%61vascript:alert(1)"/></metadata>',
  ])
    await expectFailure(page, wrap(content + square), "SECURITY");
});

test("remote raster wins over technical raster and remote CSS wins over unsupported CSS", async ({
  page,
}) => {
  await expectFailure(
    page,
    wrap('<image href="//evil.example/x.png"/>'),
    "SECURITY",
  );
  await expectFailure(
    page,
    wrap("<style>path{fill:url(https://evil.example/p)}</style>"),
    "SECURITY",
  );
  await expectFailure(
    page,
    wrap('<image href="data:image/png;base64,AA=="/>'),
    "RASTER",
    "Este SVG contiene una imagen raster y no puede usarse como geometría editable.",
  );
  await expectFailure(
    page,
    wrap('<text x="0" y="10">Hola</text>'),
    "LIVE_TEXT",
    "Convertí el texto a curvas antes de subir este SVG.",
  );
});

test("XML entities, external doctypes and stylesheet processing instructions are unsafe", async ({
  page,
}) => {
  for (const prefix of [
    '<!DOCTYPE svg [<!ENTITY x "hi">]>',
    '<!DOCTYPE svg SYSTEM "https://evil.example/x.dtd">',
    '<?xml-stylesheet href="local.css"?>',
  ])
    await expectFailure(page, prefix + wrap(square), "SECURITY");
  expect((await importSvg(page, "<!DOCTYPE svg>" + wrap(square))).ok).toBe(
    true,
  );
});

test("unsupported appearance is technical; inert attributes and unused defs are accepted", async ({
  page,
}) => {
  for (const body of [
    '<path d="M0 0H10V10Z" fill="url(#g)"/>',
    '<g clip-path="url(#clip)">' + square + "</g>",
    '<g mask="url(#mask)">' + square + "</g>",
    '<g filter="url(#filter)">' + square + "</g>",
    '<use href="#p"/>',
    "<svg>" + square + "</svg>",
    "<style>path{fill:red}</style>" + square,
    '<g style="mix-blend-mode:multiply">' + square + "</g>",
    '<path d="M0 0H10V10Z" vector-effect="non-scaling-stroke"/>',
    '<animate attributeName="opacity"/>',
    '<path d="M0 0H10V10Z" pathLength="20" stroke="red" stroke-dasharray="2 3"/>',
  ])
    await expectFailure(page, wrap(body), "UNSUPPORTED");
  expect(
    (
      await importSvg(
        page,
        wrap(
          '<g id="x" data-note="yes" aria-label="test" unknown-editor-flag="1">' +
            square +
            "</g>",
        ),
      )
    ).ok,
  ).toBe(true);
});

test("color lexical validation never admits dynamic CSS or resource paints", async ({
  page,
}) => {
  await expectFailure(
    page,
    wrap('<path d="M0 0H10V10Z" fill="expression(alert(1))"/>'),
    "SECURITY",
  );
  for (const fill of [
    "var(--paint)",
    "currentColor",
    "context-fill",
    "rgb(NaN,0,0)",
    "#ggg",
  ]) {
    await expectFailure(
      page,
      wrap(`<path d="M0 0H10V10Z" fill="${fill}"/>`),
      "UNSUPPORTED",
    );
  }
  for (const fill of [
    "#f00",
    "#12345678",
    "aliceblue",
    "rgba(1,2,3,.5)",
    "rgb(10% 20% 30%)",
    "transparent",
  ]) {
    expect(
      (await importSvg(page, wrap(`<path d="M0 0H10V10Z" fill="${fill}"/>`)))
        .ok,
    ).toBe(true);
  }
});

test("neutral rendering attributes are inert, but malformed point/dash lists are not corrected", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(
      `<g paint-order="normal" isolation="auto" clip="auto" overflow="visible" shape-rendering="geometricPrecision">${square}</g>`,
    ),
  );
  expect(result.ok).toBe(true);
  await expectFailure(
    page,
    wrap('<polygon points="0,,0 10,10 20,0"/>'),
    "INVALID_GEOMETRY",
  );
  await expectFailure(
    page,
    wrap('<path d="M0 0H10V10Z" stroke="red" stroke-dasharray="2,,3"/>'),
    "UNSUPPORTED",
  );
});

test("geometry percentage lengths and malformed primitive numbers are not silently rewritten", async ({
  page,
}) => {
  await expectFailure(
    page,
    wrap('<circle cx="20%" cy="20" r="10"/>'),
    "UNSUPPORTED",
  );
  expect(
    (
      await importSvg(
        page,
        wrap('<rect width="20" height="20"/>', 'width="100%"'),
      )
    ).ok,
  ).toBe(true);
  for (const body of [
    '<polygon points="0,0 10,10 junk 20,0"/>',
    '<circle r="-2"/>',
    '<path d="M0 0L"/>',
  ]) {
    await expectFailure(page, wrap(body), "INVALID_GEOMETRY");
  }
});

test("file, nodes, depth, path count and aggregate implicit work are bounded", async ({
  page,
}) => {
  await expectFailure(page, wrap(square) + " ".repeat(2_000_001), "LIMIT");
  await expectFailure(
    page,
    wrap("<g>".repeat(66) + square + "</g>".repeat(66)),
    "LIMIT",
  );
  await expectFailure(page, wrap("<title/>".repeat(10_001) + square), "LIMIT");
  await expectFailure(page, wrap(square.repeat(2_001)), "LIMIT");
  const expensive = "M0 0C" + "1 1 2 2 3 3 ".repeat(15_000);
  await expectFailure(
    page,
    wrap(`<path d="${expensive}"/><path d="${expensive}"/>`),
    "LIMIT",
  );
});

test("runtime validator recomputes bounds and rejects corrupt controlled data", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const results = await page.evaluate(async (source) => {
    const importer = "/src/admin-lab/svgGeometryImport.ts";
    const model = "/src/admin-lab/importedGeometry.ts";
    const { importTrustedSvg } = await import(/* @vite-ignore */ importer);
    const { validateImportedGeometry } = await import(/* @vite-ignore */ model);
    const result = importTrustedSvg(source);
    if (!result.ok) throw new Error(result.reason);
    const original = result.geometry;
    const alterations = [
      (g: typeof original) => {
        g.artBounds.width = 1;
      },
      (g: typeof original) => {
        g.centerlineBounds.x = 999;
      },
      (g: typeof original) => {
        g.nodes[0].children = [0];
      },
      (g: typeof original) => {
        g.nodes[0].children = [1, 1];
      },
      (g: typeof original) => {
        g.nodes[1].path = 20;
      },
      (g: typeof original) => {
        g.paths[0].style.strokeWidth = NaN;
      },
      (g: typeof original) => {
        g.paths[0].style.fill = "url(https://evil.example/x)";
      },
      (g: typeof original) => {
        g.paths[0].matrix.a = Infinity;
      },
      (g: typeof original) => {
        g.nodes[0].opacity = -1;
      },
      (g: typeof original) => {
        g.paths[0].style.dasharray = [-1];
      },
      (g: typeof original) => {
        g.paths.push(g.paths[0]);
      },
      (g: typeof original) => {
        g.paths[0].d = "M0 0L";
      },
      (g: typeof original) => {
        g.paths[0].style.linecap = ["round"];
      },
      (g: typeof original) => {
        g.paths[0].style.fillRule = ["evenodd"];
      },
    ];
    const corrupted = alterations.map((alter) => {
      const clone = structuredClone(original);
      alter(clone);
      return validateImportedGeometry(clone).ok;
    });
    const extra = structuredClone(original);
    extra.paths[0].onclick = "alert(1)";
    const clean = validateImportedGeometry(extra);
    return {
      good: validateImportedGeometry(original).ok,
      corrupted,
      stripped: clean.ok && !("onclick" in clean.geometry.paths[0]),
      nulls: [null, {}, [], { version: 1 }].map(
        (value) => validateImportedGeometry(value).ok,
      ),
    };
  }, wrap(square));
  expect(results.good).toBe(true);
  expect(results.stripped).toBe(true);
  expect(results.corrupted).toEqual(Array(14).fill(false));
  expect(results.nulls).toEqual([false, false, false, false]);
});

test("stylesheets and target animations inside ignored defs cannot silently change art", async ({
  page,
}) => {
  await expectFailure(
    page,
    wrap("<defs><style>path{fill:red}</style></defs>" + square),
    "UNSUPPORTED",
  );
  await expectFailure(
    page,
    wrap(
      '<defs><set href="#p" attributeName="fill" to="red"/></defs>' + square,
    ),
    "UNSUPPORTED",
  );
  await expectFailure(
    page,
    wrap(
      '<defs><style>@import "https://evil.example/x";</style></defs><text>Hi</text>',
    ),
    "SECURITY",
  );
});

test("inline importance and inheritance follow SVG cascade without flattening node opacity", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<g fill="red" opacity=".5" style="fill:blue !important;fill:green">
    <path d="M0 0H20V20Z" fill="yellow" style="fill:inherit;opacity:inherit"/></g>`),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.paths[0].style.fill).toBe("blue");
  expect(result.geometry.nodes[1].opacity).toBe(0.5);
  expect(result.geometry.nodes[2].opacity).toBe(0.5);
});

test("primitive conversion does not round away small geometry", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap('<circle cx=".00002" cy=".00002" r=".00001"/>'),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.centerlineBounds.x).toBeCloseTo(0.00001, 10);
  expect(result.geometry.centerlineBounds.y).toBeCloseTo(0.00001, 10);
  expect(result.geometry.centerlineBounds.width).toBeCloseTo(0.00002, 10);
  expect(result.geometry.centerlineBounds.height).toBeCloseTo(0.00002, 10);
});

test("strict path grammar and implicit smooth-curve aggregate work are bounded", async ({
  page,
}) => {
  for (const d of ["M,0 0H20V20Z", "M0,,0H20V20Z", "M0 0H20V20Z,"]) {
    await expectFailure(page, wrap(`<path d="${d}"/>`), "INVALID_GEOMETRY");
  }
  const curve = "M0 0T" + "1 1 ".repeat(15_000);
  await expectFailure(
    page,
    wrap(`<path d="${curve}"/><path d="${curve}"/>`),
    "LIMIT",
  );
});

test("analytic centerline bounds agree with browser curve metrics under affine transforms", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const checked = await page.evaluate(async () => {
    const modulePath = "/src/admin-lab/svgGeometryImport.ts";
    const { importTrustedSvg } = await import(/* @vite-ignore */ modulePath);
    const samples = [
      "M10 10A30 50 25 01162.55 162.45",
      "M0 0C40 100 80 -100 100 0S160 100 200 0Q220 -100 240 0T280 0Z",
      "M0 20a30 10 70 1 0 60 30a30 10 70 0 1 -60 -30",
    ];
    return samples.map((d) => {
      const result = importTrustedSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" transform="matrix(-2 .5 3 1 20 30)"/></svg>`,
      );
      if (!result.ok) throw new Error(result.reason);
      const geometry = result.geometry;
      const bounds = geometry.centerlineBounds;
      const matrix = geometry.paths[0].matrix;
      // Chromium's arc length metrics approximate ellipses; they can slightly
      // overshoot true analytic extrema. This is a cross-check, not our bounds
      // algorithm (which remains analytic and independent of browser metrics).
      const tolerance = 0.001 * Math.max(1, bounds.width, bounds.height);
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", d);
      const total = path.getTotalLength();
      for (let i = 0; i <= 1000; i++) {
        const point = path.getPointAtLength((total * i) / 1000);
        const x = matrix.a * point.x + matrix.c * point.y + matrix.e;
        const y = matrix.b * point.x + matrix.d * point.y + matrix.f;
        if (
          x < bounds.x - tolerance ||
          y < bounds.y - tolerance ||
          x > bounds.x + bounds.width + tolerance ||
          y > bounds.y + bounds.height + tolerance
        )
          return { x, y, bounds, i };
      }
      return true;
    });
  });
  expect(checked).toEqual([true, true, true]);
});

test("validator rejects reordered refs and oversized trees/work before measurement", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const rejected = await page.evaluate(
    async (source) => {
      const importer = "/src/admin-lab/svgGeometryImport.ts";
      const modelPath = "/src/admin-lab/importedGeometry.ts";
      const { importTrustedSvg } = await import(/* @vite-ignore */ importer);
      const { validateImportedGeometry } = await import(
        /* @vite-ignore */ modelPath
      );
      const base = importTrustedSvg(source).geometry;
      const cases = [];
      const reordered = structuredClone(base);
      reordered.nodes[0].children.reverse();
      cases.push(reordered);
      const deep = structuredClone(base);
      deep.nodes = Array.from({ length: 66 }, (_, i) => ({
        kind: "group",
        opacity: 1,
        children: [i + 1],
      }));
      deep.nodes.push({ kind: "path", opacity: 1, path: 0 });
      cases.push(deep);
      const many = structuredClone(base);
      many.nodes = Array(10_001).fill(base.nodes[0]);
      cases.push(many);
      const work = structuredClone(base);
      work.paths[0].d = "M0 0C" + "1 1 2 2 3 3 ".repeat(15_000);
      work.paths[1].d = work.paths[0].d;
      cases.push(work);
      const dash = structuredClone(base);
      dash.paths[0].style.dasharray = Array(257).fill(1);
      cases.push(dash);
      return cases.map((value) => validateImportedGeometry(value).ok);
    },
    wrap(square + square),
  );
  expect(rejected).toEqual([false, false, false, false, false]);
});

test("foreign effect tags in ignored content are unsupported, with security taking precedence", async ({
  page,
}) => {
  const foreign = 'xmlns="http://www.w3.org/1999/xhtml"';
  for (const effect of [
    `<style ${foreign}>path{fill:red}</style>`,
    `<animate ${foreign} href="#p" attributeName="fill" to="red"/>`,
    `<set ${foreign} href="#p" attributeName="fill" to="red"/>`,
  ]) {
    await expectFailure(
      page,
      wrap(`<defs>${effect}</defs>${square}`),
      "UNSUPPORTED",
    );
  }
  await expectFailure(
    page,
    wrap(
      `<defs><style ${foreign}>path{fill:url(https://evil.example/p)}</style></defs>${square}`,
    ),
    "SECURITY",
  );
  await expectFailure(
    page,
    wrap(
      `<defs><set ${foreign}/><x href="https://evil.example/p"/></defs>${square}`,
    ),
    "SECURITY",
  );
  expect(
    (
      await importSvg(
        page,
        wrap(
          `<metadata><info ${foreign} vendor="yes">inert</info></metadata>${square}`,
        ),
      )
    ).ok,
  ).toBe(true);
});

for (const prefix of ["/*x", "url("]) {
  test(`unterminated ${prefix} prefixes fail safely at bounded small scale`, async ({
    page,
  }) => {
    test.setTimeout(10_000);
    await expectFailure(
      page,
      wrap(`<metadata><x foo="${prefix.repeat(1_000)}"/></metadata>${square}`),
      "SECURITY",
    );
  });
}

test("URL audit preserves local fragments and rejects reconstructed remote CSS", async ({
  page,
}) => {
  for (const value of [
    "url(https://evil.example/p)",
    "URL( 'https://evil.example/p' )",
    "İ URL(https://evil.example/p)",
    "url(&#10;https://evil.example/p&#10;)",
    "url('#p') url(https://evil.example/p)",
    "url('#p'",
    "url(#p",
    "u/**/rl(https://evil.example/p)",
    String.raw`u\72/**/l(https://evil.example/p)`,
    "%75%72%6c(https://evil.example/p)",
    "u%2f%2ax%2a%2frl(https://evil.example/p)",
    String.raw`u\2f\2ax\2a\2f rl(https://evil.example/p)`,
    "%75%5c%37%32%6c(https://evil.example/p)",
    String.raw`java/**/\73 cript:alert(1)`,
    String.raw`@im/**/\70 ort 'https://evil.example/p'`,
  ]) {
    await expectFailure(
      page,
      wrap(`<metadata><x foo="${value}"/></metadata>${square}`),
      "SECURITY",
    );
  }
  for (const value of [
    "url(#p)",
    "URL( '#p' )",
    String.raw`u\72/**/l(#p)`,
    "%75%72%6c(#p)",
  ]) {
    expect(
      (
        await importSvg(
          page,
          wrap(`<metadata><x foo="${value}" href="#p"/></metadata>${square}`),
        )
      ).ok,
    ).toBe(true);
  }
  await expectFailure(
    page,
    wrap('<path d="M0 0H10V10Z" fill="url(#p)"/>'),
    "UNSUPPORTED",
  );
});

for (const sample of [
  {
    name: "comment-prefix-600KB",
    prefix: "/*x",
    repeats: 200_000,
    expected: "SECURITY",
  },
  {
    name: "url-prefix-600KB",
    prefix: "url(",
    repeats: 150_000,
    expected: "SECURITY",
  },
  {
    name: "benign-inert-600KB",
    prefix: "vendor",
    repeats: 100_000,
    expected: "OK",
  },
  {
    name: "terminated-comments-600KB",
    prefix: "/*x*/",
    repeats: 120_000,
    expected: "OK",
  },
  {
    name: "local-urls-600KB",
    prefix: "url(#p) ",
    repeats: 75_000,
    expected: "OK",
  },
]) {
  test(`bounded browser audit: ${sample.name}`, async ({ page }) => {
    test.setTimeout(10_000);
    await page.goto("/admin-lab");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The host deadline remains live even while the page's JS thread is busy.
      // Large payloads run only after the small-scale RED and scanner correction.
      const observed = await Promise.race([
        page.evaluate(
          async ({ prefix, repeats, art }) => {
            const modulePath = "/src/admin-lab/svgGeometryImport.ts";
            const { importTrustedSvg } = await import(
              /* @vite-ignore */ modulePath
            );
            const source = `<svg xmlns="http://www.w3.org/2000/svg"><metadata><x foo="${prefix.repeat(repeats)}"/></metadata>${art}</svg>`;
            const start = performance.now();
            const result = importTrustedSvg(source);
            return {
              code: result.ok ? "OK" : result.code,
              ms: performance.now() - start,
            };
          },
          { ...sample, art: square },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("browser evaluate exceeded 5000ms deadline")),
            5_000,
          );
        }),
      ]);
      console.log(
        "Trusted SVG bounded-work sample:",
        sample.name,
        JSON.stringify(observed),
      );
      expect(observed.code).toBe(sample.expected);
      expect(observed.ms).toBeLessThan(5_000);
    } finally {
      clearTimeout(timer);
      await page.close();
    }
  });
}

test("tag pre-gate bounds huge opening-tag populations without requiring XML parsing", async ({
  page,
}) => {
  test.setTimeout(10_000);
  await expectFailure(page, "<x ".repeat(666_000), "LIMIT");
});

test("primitive numeric restoration covers each converter grammar and degenerate dimensions", async ({
  page,
}) => {
  const result = await importSvg(
    page,
    wrap(`<circle cx="20" cy="20" r="10"/>
    <ellipse cx="60" cy="20" rx="10" ry="5"/>
    <rect x="1.000001" y="2.000002" width="3.000003" height="4.000004"/>
    <rect x="10" y="40" width="20" height="20" rx="3" ry="4"/>
    <rect x="40" y="40" width="20" height="20" rx="99"/>
    <rect x="70" y="40" width="20" height="20" rx="3" ry="0"/>
    <polygon points="40,40 60,40 50,60"/><polyline points="70,40 80,60 90,40"/>
    <line x1="10" y1="80" x2="90" y2="80" stroke="red"/>
    <line x1="10" y1="90" x2="10" y2="90" stroke="red" stroke-linecap="round"/>
    <circle r="0"/><ellipse rx="0" ry="10"/><rect width="0" height="10"/>`),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry.paths).toHaveLength(10);
  expect(result.geometry.paths[2].d).toBe(
    `M1.000001 2.000002H${1.000001 + 3.000003}V${2.000002 + 4.000004}H1.000001Z`,
  );
  expect(
    result.geometry.paths.every(
      (p: { d: string }) => !/undefined|NaN/.test(p.d),
    ),
  ).toBe(true);
});

test("inactive clipping rule and pathLength without dash mapping preserve supported art", async ({
  page,
}) => {
  for (const attrs of [
    'clip-rule="evenodd"',
    'style="fill-rule:evenodd;clip-rule:evenodd"',
    'pathLength="20"',
    'pathLength="20" stroke="red" stroke-dasharray="none" stroke-dashoffset="2"',
  ]) {
    expect(
      (await importSvg(page, wrap(`<path d="M0 0H10V10Z" ${attrs}/>`))).ok,
    ).toBe(true);
  }
  for (const attrs of [
    'clip-rule="evenodd" clip-path="url(#clip)"',
    'pathLength="20" stroke="red" stroke-dasharray="2 3"',
    'style="clip-rule:evenodd;clip-path:url(#clip)"',
    'clip-rule="bogus"',
  ]) {
    await expectFailure(
      page,
      wrap(`<path d="M0 0H10V10Z" ${attrs}/>`),
      "UNSUPPORTED",
    );
  }
  await expectFailure(
    page,
    wrap(
      `<g stroke="red" stroke-dasharray="2 3"><path d="M0 0H10V10Z" pathLength="20"/></g>`,
    ),
    "UNSUPPORTED",
  );
  expect(
    (
      await importSvg(
        page,
        wrap(
          '<g stroke="red" stroke-dasharray="2 3"><path d="M0 0H10V10Z" pathLength="20" stroke-dasharray="none"/></g>',
        ),
      )
    ).ok,
  ).toBe(true);
});

test("root percentages with valid viewBox do not change dimensionless art", async ({
  page,
}) => {
  const reference = await importSvg(page, wrap(square));
  const percent = await importSvg(
    page,
    wrap(square, 'width="100%" height="100%"'),
  );
  expect(percent.ok).toBe(true);
  expect(percent.geometry).toEqual(reference.geometry);
  await expectFailure(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100%">' + square + "</svg>",
    "UNSUPPORTED",
  );
  await expectFailure(
    page,
    wrap('<rect width="100%" height="10"/>'),
    "UNSUPPORTED",
  );
  await expectFailure(page, wrap(square, 'width="0%"'), "INVALID_GEOMETRY");
  await expectFailure(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 100" width="100%">' +
      square +
      "</svg>",
    "INVALID_GEOMETRY",
  );
});

test("empty path and point-list placeholders are inert, but malformed geometry still rejects", async ({
  page,
}) => {
  const reference = await importSvg(page, wrap(square));
  const result = await importSvg(
    page,
    wrap(
      '<path/><path d=""/><path d="   "/><polyline/><polyline points=" "/><polygon points=""/>' +
        square,
    ),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry).toEqual(reference.geometry);
  await expectFailure(
    page,
    wrap('<path d=""/><polyline points=""/>'),
    "INVALID_GEOMETRY",
    "no contiene geometría editable",
  );
  await expectFailure(
    page,
    wrap('<path d="M0 0L"/>' + square),
    "INVALID_GEOMETRY",
  );
  await expectFailure(
    page,
    wrap('<polyline points="junk"/>' + square),
    "INVALID_GEOMETRY",
  );
});

test("canonical SVG 1.1 PUBLIC doctype is inert and never fetched; other DTDs stay unsafe", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/w3\.org|evil\.example/.test(request.url()))
      requests.push(request.url());
  });
  const declaration =
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  const reference = await importSvg(page, wrap(square));
  const result = await importSvg(
    page,
    '<?xml version="1.0"?>' + declaration + wrap(square),
  );
  expect(result.ok).toBe(true);
  expect(result.geometry).toEqual(reference.geometry);
  expect(
    (await importSvg(page, declaration.replaceAll('"', "'") + wrap(square))).ok,
  ).toBe(true);
  for (const prefix of [
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://evil.example/svg11.dtd">',
    '<!DOCTYPE svg PUBLIC "vendor" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    '<!DOCTYPE svg SYSTEM "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
    declaration.slice(0, -1) +
      ' [<!ENTITY x SYSTEM "https://evil.example/x">]>',
    declaration.slice(0, -1) + " [<!ELEMENT svg ANY>]>",
    '<?xml-stylesheet href="https://evil.example/x"?>',
  ])
    await expectFailure(page, prefix + wrap(square), "SECURITY");
  await expectFailure(
    page,
    declaration + declaration + wrap(square),
    "MALFORMED",
  );
  await expectFailure(page, wrap(square) + declaration, "MALFORMED");
  await expectFailure(
    page,
    declaration + wrap("<title>&vendor;</title>" + square),
    "MALFORMED",
  );
  expect(requests).toEqual([]);
});

test("supported CSS enums use browser-verified ASCII case-insensitive keywords", async ({
  page,
}) => {
  await page.goto("/admin-lab");
  const checked = await page.evaluate(async () => {
    const modulePath = "/src/admin-lab/svgGeometryImport.ts";
    const { importTrustedSvg } = await import(/* @vite-ignore */ modulePath);
    const source = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H20V20Z" fill="ReD" stroke="BlUe" stroke-linecap="Round" stroke-linejoin="Bevel" fill-rule="EvenOdd" style="stroke-dasharray:None;visibility:Visible;display:Inline"/></svg>`;
    const root = new DOMParser().parseFromString(
      source,
      "image/svg+xml",
    ).documentElement;
    const live = document.importNode(root, true);
    document.body.append(live);
    try {
      const css = getComputedStyle(live.firstElementChild!);
      const result = importTrustedSvg(source);
      return {
        result,
        browser: {
          linecap: css.strokeLinecap,
          linejoin: css.strokeLinejoin,
          fillRule: css.fillRule,
          dasharray: css.strokeDasharray,
        },
      };
    } finally {
      live.remove();
    }
  });
  expect(checked.browser).toEqual({
    linecap: "round",
    linejoin: "bevel",
    fillRule: "evenodd",
    dasharray: "none",
  });
  expect(checked.result.ok).toBe(true);
  expect(checked.result.geometry.paths[0].style).toMatchObject({
    fill: "red",
    stroke: "blue",
    linecap: "round",
    linejoin: "bevel",
    fillRule: "evenodd",
    dasharray: [],
  });
});

test("security audit decodes CSS escapes and URI encodings without fetching resources", async ({
  page,
}) => {
  for (const inner of [
    String.raw`<defs><style>@im\port "https://evil.example/x";</style></defs>`,
    String.raw`<metadata><x style="fill:u\72l(https://evil.example/p)"/></metadata>`,
    '<metadata><x href="%256a%2561vascript:alert(1)"/></metadata>',
    '<metadata><x href="java&#x9;script:alert(1)"/></metadata>',
  ])
    await expectFailure(page, wrap(inner + square), "SECURITY");
});
