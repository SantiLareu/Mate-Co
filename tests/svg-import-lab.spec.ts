/**
 * Tests de navegador del importador SVG aislado (parser completo con DOMParser).
 * Ejercitan /vector-lab: fixtures estilo PicSVG, rechazos de seguridad,
 * determinismo y equivalencia visual Original vs Normalizado.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_A = join(
  testDir,
  "..",
  "src",
  "svg-import",
  "fixtures",
  "picsvg-a-939.svg",
);
const FIXTURE_B = join(
  testDir,
  "..",
  "src",
  "svg-import",
  "fixtures",
  "picsvg-b-408.svg",
);
const scratchDir = mkdtempSync(join(tmpdir(), "svg-import-lab-"));

let tempCounter = 0;
function tempSvg(content: string): string {
  tempCounter += 1;
  const path = join(scratchDir, `case-${tempCounter}.svg`);
  writeFileSync(path, content);
  return path;
}

async function importFile(page: Page, filePath: string): Promise<void> {
  await page.goto("/vector-lab");
  await expect(page.getByTestId("svg-import-section")).toBeVisible();
  await page.getByTestId("svg-import-input").setInputFiles(filePath);
}

async function readDiagnostics(page: Page): Promise<{
  viewBox: { x: number; y: number; width: number; height: number };
  pathCount: number;
  digest: string;
  bbox: { x: number; y: number; width: number; height: number };
  diagnostics: {
    fills: string[];
    strokes: string[];
    fillRules: string[];
    transformsUsed: string[];
    transformedElementCount: number;
    primitiveCounts: Record<string, number>;
    hasRaster: boolean;
    hasText: boolean;
    hasExternalRefs: boolean;
    warnings: string[];
  };
  sample: Array<{ d: string; transform?: string }>;
}> {
  await expect(page.getByTestId("svg-import-success")).toBeVisible();
  // El JSON vive en un <pre> dentro de un <details> cerrado: innerText()
  // solo ve lo visible y devuelve vacío. Se afirma contenido en el DOM y
  // se lee textContent (sin alterar el producto ni defaultear a {}).
  const json = page.getByTestId("svg-import-diagnostics-json");
  await expect(json).toContainText("viewBox");
  const raw = await json.textContent();
  expect(raw?.trim()).not.toBe("");
  return JSON.parse(raw as string);
}

async function expectRejected(
  page: Page,
  code: string,
  messageFragment?: string,
): Promise<void> {
  const error = page.getByTestId("svg-import-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("SVG no compatible");
  await expect(error).toContainText(code);
  if (messageFragment) await expect(error).toContainText(messageFragment);
}

const wrap = (inner: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

test("fixture A (939 paths): importa con transform de grupo y fill heredado", async ({
  page,
}) => {
  await importFile(page, FIXTURE_A);
  const data = await readDiagnostics(page);
  expect(data.pathCount).toBe(939);
  await expect(page.getByTestId("svg-import-path-count")).toContainText("939");
  // Fill heredado desde el <g>: los paths no declaran fill propio.
  expect(data.diagnostics.fills).toEqual(["#000000"]);
  expect(data.diagnostics.strokes).toEqual(["none"]);
  // Transforms del grupo no se pierden: translate+scale compuestos por path.
  expect(data.diagnostics.transformsUsed).toEqual(
    expect.arrayContaining(["translate", "scale"]),
  );
  expect(data.diagnostics.transformedElementCount).toBeGreaterThan(0);
  expect(data.sample[0].transform).toMatch(/^matrix\(/);
  // La componente Y negativa de scale(0.12,-0.1) se preserva (orientación).
  const negativeY = data.sample.map((entry) =>
    Number(entry.transform?.slice(7, -1).split(" ")[3]),
  );
  expect(negativeY[0]).toBeLessThan(0);
  // Bounding box válido y contenido en el viewBox (sin desplazamiento ni flip).
  expect(data.bbox.width).toBeGreaterThan(0);
  expect(data.bbox.height).toBeGreaterThan(0);
  expect(data.bbox.x).toBeGreaterThanOrEqual(-1);
  expect(data.bbox.y).toBeGreaterThanOrEqual(-1);
  expect(data.bbox.x + data.bbox.width).toBeLessThanOrEqual(1201);
  expect(data.bbox.y + data.bbox.height).toBeLessThanOrEqual(901);
  expect(data.diagnostics.hasRaster).toBe(false);
  expect(data.diagnostics.hasText).toBe(false);
  expect(data.diagnostics.hasExternalRefs).toBe(false);
  await expect(page.getByTestId("svg-import-validation")).toContainText("OK");
});

test("fixture B (408 paths): viewBox distinto, fill-rule heredado y sub-grupo anidado", async ({
  page,
}) => {
  await importFile(page, FIXTURE_B);
  const data = await readDiagnostics(page);
  expect(data.pathCount).toBe(408);
  expect(data.viewBox).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  expect(data.diagnostics.fills).toEqual(["#111111"]);
  expect(data.diagnostics.fillRules).toEqual(["evenodd"]);
  expect(data.diagnostics.transformsUsed).toEqual(
    expect.arrayContaining(["translate", "scale", "rotate"]),
  );
  expect(data.bbox.width).toBeGreaterThan(0);
  expect(data.bbox.height).toBeGreaterThan(0);
  expect(data.bbox.x).toBeGreaterThanOrEqual(-1);
  expect(data.bbox.y).toBeGreaterThanOrEqual(-1);
  expect(data.bbox.x + data.bbox.width).toBeLessThanOrEqual(801);
  expect(data.bbox.y + data.bbox.height).toBeLessThanOrEqual(601);
});

test("primitivas y estilos heredados se resuelven sin perder el transform", async ({
  page,
}) => {
  const file = tempSvg(
    wrap(
      '<g transform="translate(10 20) scale(2)" fill="#123456" stroke="none">' +
        '<circle cx="5" cy="5" r="4"/>' +
        '<rect x="20" y="20" width="10" height="6" rx="2"/>' +
        '<g transform="rotate(90)"><line x1="0" y1="0" x2="8" y2="0"/></g>' +
        '<ellipse cx="50" cy="50" rx="6" ry="3"/>' +
        '<polyline points="60,60 70,60 70,70"/>' +
        '<polygon points="80,80 90,80 85,90"/>' +
        "</g>",
    ),
  );
  await importFile(page, file);
  const data = await readDiagnostics(page);
  expect(data.pathCount).toBe(6);
  expect(data.diagnostics.primitiveCounts).toMatchObject({
    circle: 1,
    rect: 1,
    line: 1,
    ellipse: 1,
    polyline: 1,
    polygon: 1,
    path: 0,
  });
  expect(data.diagnostics.fills).toEqual(["#123456"]);
  expect(data.diagnostics.transformsUsed).toEqual(
    expect.arrayContaining(["translate", "scale", "rotate"]),
  );
  for (const entry of data.sample) expect(entry.transform).toMatch(/^matrix\(/);
});

test("dos importaciones del mismo SVG producen representación determinista", async ({
  page,
}) => {
  await importFile(page, FIXTURE_A);
  const first = await readDiagnostics(page);
  await importFile(page, FIXTURE_A);
  const second = await readDiagnostics(page);
  expect(second.digest).toBe(first.digest);
  expect(second).toEqual(first);
});

test("el normalizado contiene únicamente geometría permitida", async ({
  page,
}) => {
  await importFile(page, FIXTURE_B);
  await expect(page.getByTestId("svg-import-success")).toBeVisible();
  const flags = await page.$$eval(
    '[data-testid="svg-import-normalized"] path',
    (paths) =>
      paths.map((path) => ({
        keys: [...path.attributes].map((attr) => attr.name).sort(),
        transform: path.getAttribute("transform"),
        d: (path.getAttribute("d") ?? "").slice(0, 8),
      })),
  );
  expect(flags.length).toBe(408);
  for (const flag of flags) {
    expect(flag.keys).toEqual(flag.transform ? ["d", "transform"] : ["d"]);
    expect(flag.d.length).toBeGreaterThan(0);
    if (flag.transform)
      expect(flag.transform).toMatch(/^matrix\((-?\d+(\.\d+)? ?){6}\)$/);
  }
});

test("rechazos de seguridad y compatibilidad con motivo concreto", async ({
  page,
}) => {
  const cases: Array<{ code: string; fragment?: string; svg: string }> = [
    {
      code: "CONTAINS_SCRIPT",
      svg: wrap('<script>alert(1)</script><path d="M0 0H10V10Z"/>'),
    },
    {
      code: "CONTAINS_FOREIGN_OBJECT",
      svg: wrap("<foreignObject><div>hola</div></foreignObject>"),
    },
    {
      code: "CONTAINS_EVENT_HANDLER",
      svg: wrap('<g onload="alert(1)"><path d="M0 0H10V10Z"/></g>'),
    },
    {
      code: "CONTAINS_EVENT_HANDLER",
      svg: wrap('<path d="M0 0H10V10Z" onclick="alert(1)"/>'),
    },
    {
      code: "CONTAINS_RASTER_IMAGE",
      fragment: "raster",
      svg: wrap('<image href="foto.png" x="0" y="0" width="10" height="10"/>'),
    },
    {
      code: "CONTAINS_LIVE_TEXT",
      fragment: "texto a curvas",
      svg: wrap('<text x="0" y="10">Hola</text>'),
    },
    {
      code: "CONTAINS_LIVE_TEXT",
      fragment: "texto a curvas",
      svg: wrap('<textPath href="#p">Hola</textPath>'),
    },
    { code: "CONTAINS_ACTIVE_CONTENT", svg: wrap('<iframe src="x"></iframe>') },
    {
      code: "EXTERNAL_REFERENCE",
      svg: wrap(
        '<rect x="0" y="0" width="10" height="10" fill="url(https://evil.example/p)"/>',
      ),
    },
    {
      code: "EXTERNAL_REFERENCE",
      svg: wrap(
        '<a xlink:href="javascript:alert(1)"><path d="M0 0H10V10Z"/></a>',
        'viewBox="0 0 100 100" xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
    },
    {
      code: "UNSAFE_DOCTYPE",
      svg: '<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap('<path d="M0 0H10V10Z"/>'),
    },
    {
      code: "MALFORMED",
      svg: '<svg viewBox="0 0 10 10"><g><path d="M0 0H10V10Z">',
    },
    {
      code: "NOT_SVG",
      svg: '<html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>',
    },
    { code: "EMPTY", svg: "   " },
    { code: "NO_GEOMETRY", svg: wrap('<g fill="#000"></g>') },
    {
      code: "INVALID_DIMENSIONS",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H10V10Z"/></svg>',
    },
    {
      code: "UNSUPPORTED_USE",
      svg: wrap('<defs><path id="p" d="M0 0H10V10Z"/></defs><use href="#p"/>'),
    },
    {
      code: "UNSUPPORTED_STYLE",
      svg: wrap('<style>.a{fill:red}</style><path class="a" d="M0 0H10V10Z"/>'),
    },
    {
      code: "UNSUPPORTED_PAINT_SERVER",
      svg: wrap(
        '<defs><linearGradient id="g"></linearGradient></defs><path d="M0 0H10V10Z" fill="url(#g)"/>',
      ),
    },
    {
      code: "UNSUPPORTED_ELEMENT",
      svg: wrap(
        '<clipPath id="c"><rect x="0" y="0" width="5" height="5"/></clipPath>',
      ),
    },
    {
      code: "CONTAINS_VISIBLE_STROKE",
      svg: wrap('<path d="M0 0H10V10Z" fill="none" stroke="red"/>'),
    },
    {
      code: "INVALID_TRANSFORM",
      svg: wrap('<g transform="warp(1)"><path d="M0 0H10V10Z"/></g>'),
    },
  ];
  for (const { code, fragment, svg } of cases) {
    await importFile(page, tempSvg(svg));
    await expectRejected(page, code, fragment);
  }
});

test("nesting excesivo y cantidad excesiva de paths se rechazan", async ({
  page,
}) => {
  let deep = '<path d="M0 0H10V10Z"/>';
  for (let index = 0; index < 40; index += 1) deep = `<g>${deep}</g>`;
  await importFile(page, tempSvg(wrap(deep)));
  await expectRejected(page, "GROUP_DEPTH_EXCEEDED");

  const many = Array.from(
    { length: 5001 },
    (_, index) => `<path d="M${index} 0h1v1h-1Z"/>`,
  ).join("");
  await importFile(page, tempSvg(wrap(many)));
  await expectRejected(page, "TOO_MANY_PATHS");
});

test("Original y Normalizado son visualmente equivalentes (fixture A)", async ({
  page,
}) => {
  await importFile(page, FIXTURE_A);
  await readDiagnostics(page);
  expect(await alphaMismatch(page)).toBeLessThan(0.01);
});

test("Original y Normalizado son visualmente equivalentes (fixture B)", async ({
  page,
}) => {
  await importFile(page, FIXTURE_B);
  await readDiagnostics(page);
  expect(await alphaMismatch(page)).toBeLessThan(0.01);
});

/**
 * Cobertura geométrica (canal alfa) del Original rasterizado vs el
 * Normalizado rasterizado al mismo tamaño. Compara alfa y no color porque el
 * normalizado se tiñe a negro de grabado a propósito (#171717 vs original).
 */
async function alphaMismatch(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const original = document.querySelector(
      '[data-testid="svg-import-original"]',
    );
    const normalized = document.querySelector(
      '[data-testid="svg-import-normalized"]',
    );
    if (!(original instanceof HTMLImageElement))
      throw new Error("Falta el panel Original");
    if (!(normalized instanceof SVGSVGElement))
      throw new Error("Falta el panel Normalizado");
    if (!original.complete || original.naturalWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        original.onload = () => resolve();
        original.onerror = () =>
          reject(new Error("No cargó el preview original"));
      });
    }
    const width = 480;
    const height = 360;
    const rasterize = (image: HTMLImageElement): Uint8ClampedArray => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Sin contexto 2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    };
    const first = rasterize(original);
    const clone = normalized.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const second = rasterize(image);
      let different = 0;
      for (let index = 3; index < first.length; index += 4) {
        if (Math.abs(first[index] - second[index]) > 24) different += 1;
      }
      return different / (width * height);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}
