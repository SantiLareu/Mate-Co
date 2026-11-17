#!/usr/bin/env node
/**
 * E5.3 — Comparación vectorial antes/después de la serialización de las
 * líneas decorativas (trazos con `stroke-width` -> superficies CERRADAS y
 * RELLENAS).
 *
 * Qué hace:
 * 1. Compila el TypeScript REAL del producto a CommonJS con el compilador
 *    del repo (node_modules/typescript), dos veces, en un scratch DENTRO del
 *    repo (test-results/e53-compare/e52-scratch) para que la resolución de
 *    node_modules siga funcionando:
 *      - "after"  : el árbol src/ actual.
 *      - "before" : una copia de src/ cuyo src/production-lab/exportSvg.ts es
 *                   el de git HEAD (818cfbd) — el que serializaba las líneas
 *                   decorativas como <circle>/<path> con stroke-width.
 *    El tsconfig del repo tiene `noEmit`, así que en la CLI se pasan
 *    explícitamente --outDir/--module commonjs/--moduleResolution node/
 *    --target ES2022/--jsx react-jsx/--skipLibCheck/--esModuleInterop.
 *    Los diagnósticos de TIPOS se ignoran (tsc igual emite el JS).
 * 2. Arma el reporte físico con el motor real (buildPhysicalReport,
 *    estrategia outer-diameter — la MISMA que usa samples/e5-1/generate.mjs,
 *    para que el grabador pueda comparar los despues-*.svg contra los
 *    archivos de E5.1 -, circularLines "double", un ícono "guitar"
 *    en ángulo 90 / radio 360 para que la línea quede interrumpida) y
 *    exporta con el exportador real (buildLabPhysicalSvg).
 * 3. Escribe, por medida, los dos archivos:
 *      - samples/e5-2/fisico/antes-<medida>.svg    (serialización vieja)
 *      - samples/e5-2/fisico/despues-<medida>.svg  (serialización nueva)
 *    más el índice samples/e5-2/fisico/index.txt (bytes + sha256 de 16 hex)
 *    y las métricas samples/e5-2/metricas.json (base del comparacion.md).
 *
 * NO usa navegador, NO rasteriza, NO toca src/ ni tests/, NO instala nada.
 *
 * Uso (Node con el node_modules del repo):
 *   node samples/e5-2/generate.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT_DIR = resolve(HERE, "fisico");
const SCRATCH = resolve(REPO, "test-results/e53-compare/e52-scratch");
const TSC = resolve(REPO, "node_modules/typescript/bin/tsc");
/** Commit con la serialización vieja de las líneas decorativas. */
const BASE_COMMIT = "818cfbd";

const MEASURES = [
  { slug: "85-50", outer: 85, inner: 50 },
  { slug: "80-60", outer: 80, inner: 60 },
  { slug: "75-65", outer: 75, inner: 65 },
];

/** Ícono del catálogo: interrumpe la línea (knockout circular). */
const ICON = {
  id: "i1",
  type: "icon",
  iconId: "guitar",
  angle: 90,
  radius: 360,
  scale: 1,
  rotation: 0,
  mirrored: false,
  inverted: false,
};

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ */
/* 1. Compilación de los dos exportadores                             */
/* ------------------------------------------------------------------ */

/**
 * Compila un árbol de fuentes a CommonJS con el compilador del repo.
 * Los errores de TIPOS no bloquean: tsc emite igual (no hay noEmitOnError),
 * y lo que importa acá es el JS emitted por el código real.
 */
function compile({ label, cwd, outDir, entries, emitted }) {
  const args = [
    TSC,
    "--outDir",
    outDir,
    "--noEmit",
    "false",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--target",
    "ES2022",
    "--jsx",
    "react-jsx",
    "--skipLibCheck",
    "--esModuleInterop",
    ...entries,
  ];
  const run = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw new Error(`tsc (${label}): ${String(run.error.message)}`);
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  if (out) {
    const diagnostics = out.split("\n").filter((line) => /error TS\d+/.test(line));
    console.log(
      `  ${label}: ${String(diagnostics.length)} diagnóstico(s) de tipo ignorado(s) (tsc emite igual).`,
    );
  }
  // El repo es "type": "module": el JS emitido (CommonJS) necesita su propio
  // package.json para que node lo trate como CJS.
  writeFileSync(
    resolve(outDir, "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
    "utf8",
  );
  // Si tsc no emitió (y no es sólo un diagnóstico de tipos), hay que fallar
  // acá y no con un MODULE_NOT_FOUND más adelante.
  for (const expected of emitted) {
    const file = resolve(outDir, expected);
    if (!existsSync(file)) {
      throw new Error(`tsc (${label}) no emitió ${file}`);
    }
  }
  return outDir;
}

console.log("E5.3 — comparación de serialización de líneas decorativas");
console.log(`scratch: ${SCRATCH}`);

// Sólo se borra el scratch PROPIO de este generador (nada más del repo).
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

// --- after: el árbol src/ actual -----------------------------------
const AFTER_OUT = resolve(SCRATCH, "build/after");
compile({
  label: "after (src/ actual)",
  cwd: REPO,
  outDir: AFTER_OUT,
  entries: [
    "src/production-lab/exportSvg.ts",
    "src/production-lab/geometry.ts",
    "src/data/icons.ts",
  ],
  // tsc infiere rootDir = src/ (el directorio común de las entradas), así que
  // el JS emitido queda en <outDir>/production-lab/… (sin el prefijo src/).
  emitted: [
    "production-lab/exportSvg.js",
    "production-lab/geometry.js",
    "data/icons.js",
  ],
});

// --- before: copia de src/ con el exportSvg.ts de HEAD --------------
const BEFORE_SRC = resolve(SCRATCH, "before-src");
cpSync(resolve(REPO, "src"), BEFORE_SRC, { recursive: true });
const gitShow = spawnSync(
  "git",
  ["show", `${BASE_COMMIT}:src/production-lab/exportSvg.ts`],
  { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
if (gitShow.status !== 0 || !gitShow.stdout) {
  throw new Error(
    `git show ${BASE_COMMIT}:src/production-lab/exportSvg.ts falló: ${String(gitShow.stderr ?? "")}`,
  );
}
writeFileSync(
  resolve(BEFORE_SRC, "production-lab/exportSvg.ts"),
  gitShow.stdout,
  "utf8",
);
const BEFORE_OUT = resolve(SCRATCH, "build/before");
compile({
  label: `before (exportSvg.ts de ${BASE_COMMIT})`,
  cwd: BEFORE_SRC,
  outDir: BEFORE_OUT,
  entries: [
    "production-lab/exportSvg.ts",
    "production-lab/geometry.ts",
    "data/icons.ts",
  ],
  emitted: [
    "production-lab/exportSvg.js",
    "production-lab/geometry.js",
    "data/icons.js",
  ],
});

const after = {
  exportSvg: require(resolve(AFTER_OUT, "production-lab/exportSvg.js")),
  geometry: require(resolve(AFTER_OUT, "production-lab/geometry.js")),
  icons: require(resolve(AFTER_OUT, "data/icons.js")),
};
const before = {
  exportSvg: require(resolve(BEFORE_OUT, "production-lab/exportSvg.js")),
  geometry: require(resolve(BEFORE_OUT, "production-lab/geometry.js")),
  icons: require(resolve(BEFORE_OUT, "data/icons.js")),
};

/* ------------------------------------------------------------------ */
/* 2. Construcción y exportación de los pares antes/después           */
/* ------------------------------------------------------------------ */

/**
 * Reporte físico real: motor real, estrategia outer-diameter (la misma que
 * samples/e5-1/generate.mjs), doble línea.
 */
function reportFor(geometry, measure) {
  const result = geometry.buildPhysicalReport({
    outerDiameter: measure.outer,
    innerDiameter: measure.inner,
    strategy: "outer-diameter",
    texts: [],
    icons: [ICON],
    approved: [],
    circularLines: "double",
  });
  if (!result.ok) {
    throw new Error(
      `buildPhysicalReport (${measure.slug}): ${JSON.stringify(result)}`,
    );
  }
  return result.report;
}

/** Export físico real con el exportador real. */
function exportPhysical(moduleSet, report, fileName) {
  const built = moduleSet.exportSvg.buildLabPhysicalSvg({
    report,
    iconPaths: { [ICON.id]: moduleSet.icons.iconById[ICON.iconId].paths },
    textOutlines: {},
    assetFlags: { hasRaster: false, hasUnsupportedFeature: false, hasText: false },
    approvedEmbeds: {},
    graphicsCount: 0,
    fileName,
  });
  if (!built.ok) {
    throw new Error(
      `buildLabPhysicalSvg (${fileName}): ${built.code} — ${built.reason}`,
    );
  }
  return built;
}

mkdirSync(OUT_DIR, { recursive: true });

const samples = [];
for (const measure of MEASURES) {
  const reportBefore = reportFor(before.geometry, measure);
  const reportAfter = reportFor(after.geometry, measure);

  const oldFile = `antes-${measure.slug}.svg`;
  const newFile = `despues-${measure.slug}.svg`;
  const oldBuilt = exportPhysical(before, reportBefore, oldFile);
  const newBuilt = exportPhysical(after, reportAfter, newFile);

  // Determinismo interno: el mismo árbol produce los mismos bytes.
  const again = exportPhysical(after, reportAfter, newFile);
  if (again.svg !== newBuilt.svg) {
    throw new Error(`El SVG físico no es determinista (${newFile})`);
  }

  writeFileSync(resolve(OUT_DIR, oldFile), oldBuilt.svg, "utf8");
  writeFileSync(resolve(OUT_DIR, newFile), newBuilt.svg, "utf8");

  samples.push({
    measure: measure.slug,
    outer: measure.outer,
    inner: measure.inner,
    antes: oldFile,
    despues: newFile,
    antesSvg: oldBuilt.svg,
    despuesSvg: newBuilt.svg,
    meta: newBuilt.meta,
    engineLines: reportAfter.lines.map((line) => ({
      id: line.id,
      radiusMm: line.radiusMm,
      strokeWidthMm: line.strokeWidthMm,
    })),
    engineLinesBefore: reportBefore.lines.map((line) => ({
      id: line.id,
      radiusMm: line.radiusMm,
      strokeWidthMm: line.strokeWidthMm,
    })),
  });
}

/* ------------------------------------------------------------------ */
/* 3. Lectura de los archivos escritos y métricas cuantitativas        */
/* ------------------------------------------------------------------ */

const RASTER_OR_TEXT = [
  [/<text[\s>]/, "texto vivo <text>"],
  [/<image[\s>]/, "imagen <image>"],
  [/data:image/, "data:image (raster)"],
  [/@font-face/, "fuente embebida @font-face"],
  [/font-family/, "font-family"],
  [/<filter|feGaussianBlur|feImage/i, "filtro (rasterización)"],
];

/** Fill de las líneas decorativas nuevas (superficie cerrada rellena). */
const NEW_LINE_RE =
  /<path d="([^"]*)" fill="#000000" fill-rule="evenodd" transform="translate\(([-\d.]+) ([-\d.]+)\)"\/>/g;
/** Trazo de las líneas decorativas viejas. */
const OLD_LINE_RE =
  /<path d="([^"]*)" fill="none" stroke="#000000" stroke-width="([-\d.]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)"\/>/g;

function matchAll(regex, text) {
  return [...text.matchAll(regex)];
}

/** Ángulo estándar (x a la derecha, y abajo) de un punto relativo al centro. */
const angleOf = (x, y) => (Math.atan2(y, x) * 180) / Math.PI;

/**
 * Extensión angular (grados, sentido horario = sentido del trazo SVG) del
 * arco de un path "M x y A r r 0 f 1 x2 y2".
 */
function arcExtent(start, end, largeArc, sweep) {
  const raw = ((angleOf(end.x, end.y) - angleOf(start.x, start.y)) % 360 + 360) % 360;
  let drawn = sweep === 1 ? raw : 360 - raw;
  if (raw === 0) drawn = 360;
  if (largeArc === 0 && drawn > 180) drawn = 360 - drawn;
  if (largeArc === 1 && drawn < 180) drawn = 360 - drawn;
  return drawn;
}

/**
 * Parseo del path de banda cerrada:
 *   "M x0 y0 A ro ro 0 laf sf x1 y1 L xi yi A ri ri 0 laf2 sf2 xi2 yi2 Z"
 *
 * OJO: las coordenadas del path ya están en el marco local del anillo
 * (centro en 0,0); el `transform="translate(half half)"` del exportador
 * lleva el conjunto al centro del lienzo. No hay que restar nada.
 */
function parseBand(d) {
  const n = d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g)?.map(Number) ?? [];
  if (n.length < 18) throw new Error(`Path de banda inesperado: ${d}`);
  const outer = {
    start: { x: n[0], y: n[1] },
    end: { x: n[7], y: n[8] },
    radius: n[2],
    largeArc: n[5],
    sweep: n[6],
  };
  const inner = {
    // El arco interior vuelve en sentido contrario: de (xi,yi) a (xi2,yi2).
    start: { x: n[9], y: n[10] },
    end: { x: n[16], y: n[17] },
    radius: n[11],
    largeArc: n[14],
    sweep: n[15],
  };
  return {
    outerRadius: outer.radius,
    innerRadius: inner.radius,
    extentDeg: arcExtent(outer.start, outer.end, outer.largeArc, outer.sweep),
    innerExtentDeg: arcExtent(inner.start, inner.end, inner.largeArc, inner.sweep),
    outerStartAngleDeg: angleOf(outer.start.x, outer.start.y),
    outerEndAngleDeg: angleOf(outer.end.x, outer.end.y),
  };
}

/**
 * Parseo del path de arco viejo (trazo): "M x y A r r 0 laf sf x2 y2".
 * Igual que en el caso nuevo, las coordenadas son locales al anillo.
 */
function parseStrokeArc(d, strokeWidth) {
  const numbers = d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g)?.map(Number) ?? [];
  const [x0, y0, radius, , , largeArc, sweep, x1, y1] = numbers;
  const start = { x: x0, y: y0 };
  const end = { x: x1, y: y1 };
  return {
    radius,
    strokeWidth,
    extentDeg: arcExtent(start, end, largeArc, sweep),
    startAngleDeg: angleOf(start.x, start.y),
    endAngleDeg: angleOf(end.x, end.y),
  };
}

/** Radios de los círculos de referencia (grupo lab-ring-reference). */
function ringRadii(svg) {
  const group = /<g id="lab-ring-reference"[^>]*>([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
  return matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"\/>/g, group).map(
    (match) => Number(match[3]),
  );
}

/** Análisis de un archivo "despues": las bandas cerradas de las líneas. */
function analyzeNew(svg) {
  const bands = matchAll(NEW_LINE_RE, svg).map((match) => parseBand(match[1]));
  return { bands, radii: ringRadii(svg) };
}

/** Análisis de un archivo "antes": los arcos trazados de las líneas. */
function analyzeOld(svg) {
  const arcs = matchAll(OLD_LINE_RE, svg).map((match) =>
    parseStrokeArc(match[1], Number(match[2])),
  );
  return { arcs, radii: ringRadii(svg) };
}

const metrics = [];
for (const sample of samples) {
  const oldData = analyzeOld(sample.antesSvg);
  const newData = analyzeNew(sample.despuesSvg);
  if (oldData.arcs.length !== newData.bands.length) {
    throw new Error(
      `${sample.measure}: la cantidad de líneas no coincide (${String(oldData.arcs.length)} vs ${String(newData.bands.length)})`,
    );
  }
  const lines = newData.bands.map((band, index) => {
    const arc = oldData.arcs[index];
    const engine = sample.engineLines[index];

    // --- "despues": la banda cerrada, leída del archivo nuevo --------
    const radiusCenter = (band.outerRadius + band.innerRadius) / 2;
    const width = band.outerRadius - band.innerRadius;
    const extentRad = (band.extentDeg * Math.PI) / 180;
    const arcLength = radiusCenter * extentRad;
    const areaFilled = 0.5 * (band.outerRadius ** 2 - band.innerRadius ** 2) * extentRad;

    // --- "antes": el arco trazado, leído del archivo viejo -----------
    const oldExtentRad = (arc.extentDeg * Math.PI) / 180;
    const oldArcLength = arc.radius * oldExtentRad;
    const areaStroked = oldArcLength * arc.strokeWidth;

    // --- por construcción: los valores EXACTOS del motor --------------
    const engineOuter = engine.radiusMm + engine.strokeWidthMm / 2;
    const engineInner = engine.radiusMm - engine.strokeWidthMm / 2;
    const engineAreaFilled =
      0.5 * (engineOuter ** 2 - engineInner ** 2) * extentRad;
    const engineAreaStroked =
      engine.radiusMm * extentRad * engine.strokeWidthMm;

    return {
      lineId: engine.id,
      outerRadiusMm: band.outerRadius,
      innerRadiusMm: band.innerRadius,
      centerlineRadiusMm: radiusCenter,
      bandWidthMm: width,
      extentDeg: band.extentDeg,
      gapDeg: 360 - band.extentDeg,
      arcLengthMm: arcLength,
      areaFilledMm2: areaFilled,
      areaStrokedMm2: areaStroked,
      relativeAreaDifference: (areaFilled - areaStroked) / areaStroked,
      antes: {
        centerlineRadiusMm: arc.radius,
        bandWidthMm: arc.strokeWidth,
        extentDeg: arc.extentDeg,
        gapDeg: 360 - arc.extentDeg,
        arcLengthMm: oldArcLength,
        areaStrokedMm2: areaStroked,
        radiusDeltaMm: arc.radius - radiusCenter,
        extentDeltaDeg: arc.extentDeg - band.extentDeg,
        widthDeltaMm: arc.strokeWidth - width,
        arcLengthDeltaMm: oldArcLength - arcLength,
      },
      despues: {
        outerRadiusMm: band.outerRadius,
        innerRadiusMm: band.innerRadius,
        centerlineRadiusMm: radiusCenter,
        bandWidthMm: width,
        extentDeg: band.extentDeg,
        gapDeg: 360 - band.extentDeg,
        arcLengthMm: arcLength,
        areaFilledMm2: areaFilled,
        innerExtentDeg: band.innerExtentDeg,
      },
      engine: {
        radiusMm: engine.radiusMm,
        strokeWidthMm: engine.strokeWidthMm,
        outerRadiusMm: engineOuter,
        innerRadiusMm: engineInner,
        areaFilledMm2: engineAreaFilled,
        areaStrokedMm2: engineAreaStroked,
        relativeAreaDifference:
          (engineAreaFilled - engineAreaStroked) / engineAreaStroked,
      },
    };
  });
  metrics.push({
    measure: sample.measure,
    outer: sample.outer,
    inner: sample.inner,
    sizeFactor: sample.meta.sizeFactor,
    canvasMm: Number(/width="([\d.]+)mm"/.exec(sample.despuesSvg)?.[1] ?? 0),
    ringRadiiMm: { antes: oldData.radii, despues: newData.radii },
    antesFile: sample.antes,
    despuesFile: sample.despues,
    clearanceWarnings: sample.meta.clearanceWarnings ?? [],
    lines,
  });
}

/* ------------------------------------------------------------------ */
/* 4. Verificaciones sobre los archivos escritos                       */
/* ------------------------------------------------------------------ */

const problems = [];
for (const sample of samples) {
  for (const [label, svg] of [
    [sample.antes, sample.antesSvg],
    [sample.despues, sample.despuesSvg],
  ]) {
    for (const [pattern, description] of RASTER_OR_TEXT) {
      if (pattern.test(svg)) problems.push(`${label}: ${description}`);
    }
    if (!svg.includes('id="lab-ring-reference"')) {
      problems.push(`${label}: falta el grupo lab-ring-reference`);
    }
    if (!svg.includes('id="lab-engraving"')) {
      problems.push(`${label}: falta el grupo lab-engraving`);
    }
    const ringGroup =
      /<g id="lab-ring-reference"[^>]*>/.exec(svg)?.[0] ?? "";
    if (!ringGroup.includes('stroke="#0000FF"') || !ringGroup.includes('stroke-width="1.5"')) {
      problems.push(`${label}: el grupo de referencia no es #0000FF / 1.5`);
    }
    if (ringGroup.includes('id="lab-engraving"')) {
      problems.push(`${label}: la referencia está anidada en el grabado`);
    }
  }

  // "despues": las líneas decorativas NO pueden depender de stroke-width.
  const newLines = matchAll(NEW_LINE_RE, sample.despuesSvg);
  if (newLines.length !== sample.engineLines.length) {
    problems.push(
      `${sample.despues}: se esperaban ${String(sample.engineLines.length)} bandas y hay ${String(newLines.length)}`,
    );
  }
  for (const line of newLines) {
    if (/stroke(-width)?=/.test(line[0])) {
      problems.push(`${sample.despues}: una línea decorativa declara stroke/stroke-width`);
    }
  }
  if (/stroke="#000000"/.test(sample.despuesSvg)) {
    problems.push(`${sample.despues}: queda un trazo negro de línea decorativa`);
  }

  // "antes": las líneas decorativas SÍ son trazos con stroke-width.
  const oldLines = matchAll(OLD_LINE_RE, sample.antesSvg);
  if (oldLines.length !== sample.engineLines.length) {
    problems.push(
      `${sample.antes}: se esperaban ${String(sample.engineLines.length)} trazos y hay ${String(oldLines.length)}`,
    );
  }
  for (const line of oldLines) {
    if (!line[2] || Number(line[2]) <= 0) {
      problems.push(`${sample.antes}: trazo sin stroke-width utilizable`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4b. Comparabilidad con samples/e5-1 (la misma estrategia)          */
/* ------------------------------------------------------------------ */

/**
 * E5.1 (ya enviado al grabador) se generó con la estrategia
 * "outer-diameter". Estas muestras tienen que ser comparables archivo por
 * archivo: mismo data-strategy, mismo data-size-factor, mismos radios de
 * línea y mismos anchos de banda que los de E5.1.
 *
 * El control es de LECTURA sobre samples/e5-1 (no escribe nada ahí) y
 * tolera el redondeo a 0,01 mm del exportador viejo de E5.1.
 */
const E51_DIR = resolve(REPO, "samples/e5-1/fisico");
/** Radio de línea de E5.1 (leído del `A` del trazo viejo, redondeo 0,01 mm). */
const E51_ARC_RE = /<path d="[^"]*A([\d.]+) [\d.]+ 0 [01] [01][^"]*" fill="none" stroke="#000000"[^>]*\/>/g;

const e51Checks = [];
for (const sample of samples) {
  const e51File = resolve(
    E51_DIR,
    `fisico-${sample.measure}-d-texto-y-icono.svg`,
  );
  if (!existsSync(e51File)) {
    e51Checks.push({
      measure: sample.measure,
      comparable: false,
      detail: "no se encontró el archivo de E5.1 (control omitido)",
    });
    continue;
  }
  const e51 = readFileSync(e51File, "utf8");
  const e51Strategy = /data-strategy="([^"]+)"/.exec(e51)?.[1] ?? "";
  const e51Factor = Number(/data-size-factor="([\d.]+)"/.exec(e51)?.[1] ?? "NaN");
  const e51Widths = new Set(
    matchAll(/stroke="#000000" stroke-width="([\d.]+)"/g, e51).map((m) => m[1]),
  );
  const e51Radii = [...new Set(matchAll(E51_ARC_RE, e51).map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );
  const ourWidths = new Set(
    sample.engineLines.map((line) => String(line.strokeWidthMm)),
  );

  const checks = [
    ["estrategia", e51Strategy === "outer-diameter", `E5.1=${e51Strategy}`],
    [
      "data-size-factor",
      e51Factor === sample.meta.sizeFactor,
      `E5.1=${String(e51Factor)} / E5.2=${String(sample.meta.sizeFactor)}`,
    ],
    [
      "ancho de banda",
      e51Widths.size === 1 &&
        ourWidths.size === 1 &&
        Math.abs(Number([...e51Widths][0]) - Number([...ourWidths][0])) <= 1e-12,
      `E5.1=${[...e51Widths].join(",")} / E5.2=${[...ourWidths].join(",")}`,
    ],
    [
      "radios de línea",
      e51Radii.length === sample.engineLines.length &&
        e51Radii.every(
          (radius, index) =>
            Math.abs(radius - sample.engineLines[index].radiusMm) <= 0.005,
        ),
      `E5.1=${e51Radii.join(",")} / E5.2=${sample.engineLines
        .map((line) => line.radiusMm.toFixed(6))
        .join(",")}`,
    ],
  ];
  for (const [name, ok, detail] of checks) {
    if (!ok) problems.push(`${sample.measure}: comparabilidad con E5.1 — ${name} (${detail})`);
  }
  e51Checks.push({
    measure: sample.measure,
    comparable: checks.every(([, ok]) => ok),
    e51File: `samples/e5-1/fisico/fisico-${sample.measure}-d-texto-y-icono.svg`,
    e51Strategy,
    e51SizeFactor: e51Factor,
    e51BandWidthsMm: [...e51Widths].map(Number),
    e51LineRadiiMm: e51Radii,
    e52BandWidthsMm: [...ourWidths].map(Number),
    e52LineRadiiMm: sample.engineLines.map((line) => line.radiusMm),
  });
}

/* ------------------------------------------------------------------ */
/* 5. Índice y métricas                                                */
/* ------------------------------------------------------------------ */

const indexRows = [];
for (const sample of samples) {
  for (const name of [sample.antes, sample.despues]) {
    const bytes = readFileSync(resolve(OUT_DIR, name));
    indexRows.push({
      file: name,
      bytes: bytes.length,
      sha256_16: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    });
  }
}

const indexLines = [
  "# E5.3 — índice de las muestras antes/después (líneas decorativas)",
  "# Generado por samples/e5-2/generate.mjs — no editar a mano.",
  "# Estrategia de tamaño: outer-diameter — la MISMA que samples/e5-1/generate.mjs",
  "# (ancho de banda 0,20 / 0,19 / 0,18 mm; data-size-factor 0,10047 / 0,09456 / 0,08865).",
  "# La ÚNICA diferencia entre cada par antes/después es la serialización",
  "# de las líneas decorativas (trazo -> superficie cerrada rellena).",
  "# Formato: <archivo>  <bytes>  <sha256-16>",
  ...indexRows.map((row) => `${row.file}  ${String(row.bytes)}  ${row.sha256_16}`),
];
writeFileSync(resolve(OUT_DIR, "index.txt"), `${indexLines.join("\n")}\n`, "utf8");

writeFileSync(
  resolve(HERE, "metricas.json"),
  `${JSON.stringify(
    {
      baseCommit: BASE_COMMIT,
      strategy: "outer-diameter",
      comparabilidadE51: e51Checks,
      samples: metrics,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

/* ------------------------------------------------------------------ */
/* 6. Salida                                                           */
/* ------------------------------------------------------------------ */

console.log(`muestras generadas: ${String(samples.length * 2)} SVG`);
for (const row of indexRows) {
  console.log(`  ${row.file}  ${String(row.bytes)} bytes  ${row.sha256_16}`);
}
console.log("--- comparabilidad con samples/e5-1 (misma estrategia outer-diameter)");
for (const check of e51Checks) {
  console.log(
    `  ${check.measure}: ${check.comparable ? "comparable" : "NO COMPARABLE"}` +
      (check.e51File
        ? `  (E5.1: estrategia=${check.e51Strategy} factor=${String(check.e51SizeFactor)} ` +
          `ancho=${check.e51BandWidthsMm.map((w) => w.toFixed(6)).join("/")} mm ` +
          `R=${check.e51LineRadiiMm.join("/")} mm)`
        : `  (${check.detail})`),
  );
}
for (const entry of metrics) {
  console.log(`--- ${entry.measure} (${String(entry.sizeFactor)})`);
  for (const line of entry.lines) {
    console.log(
      `  ${line.lineId}: R antes=${line.antes.centerlineRadiusMm.toFixed(6)} / despues=${line.despues.centerlineRadiusMm.toFixed(6)} mm  ` +
        `ancho antes=${line.antes.bandWidthMm.toFixed(6)} / despues=${line.despues.bandWidthMm.toFixed(6)} mm  ` +
        `extensión antes=${line.antes.extentDeg.toFixed(4)}° / despues=${line.despues.extentDeg.toFixed(4)}°  ` +
        `largo antes=${line.antes.arcLengthMm.toFixed(6)} / despues=${line.despues.arcLengthMm.toFixed(6)} mm`,
    );
    console.log(
      `      área relleno=${line.areaFilledMm2.toFixed(6)} mm²  área trazo=${line.areaStrokedMm2.toFixed(6)} mm²  ` +
        `Δrel (archivos)=${(line.relativeAreaDifference * 100).toExponential(3)}%  ` +
        `Δrel (por construcción)=${(line.engine.relativeAreaDifference * 100).toExponential(3)}%`,
    );
  }
}

if (problems.length > 0) {
  console.error("PROBLEMAS:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("verificaciones: OK");
