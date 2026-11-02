/**
 * E5.1 — Generador de muestras para validación física.
 *
 * Genera, con el CÓDIGO REAL del producto (laboratorio físico en
 * milímetros + exportador del cliente en coordenadas de diseño), un conjunto
 * pequeño y representativo de archivos SVG para las tres medidas y los
 * diseños representativos.
 *
 * NO modifica el motor ni los exportadores: sólo los usa.
 *
 * Uso (Node de Windows en este repo):
 *   node samples/e5-1/generate.mjs   (en este repo, el Node de Windows: el node_modules es nativo de Windows)
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = resolve(HERE);
const PORT = 4181;

const MEASURES = [
  { slug: "85-50", outer: 85, inner: 50 },
  { slug: "80-60", outer: 80, inner: 60 },
  { slug: "75-65", outer: 75, inner: 65 },
];

const server = await createServer({
  configFile: resolve(REPO, "vite.config.ts"),
  root: REPO,
  logLevel: "warn",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`);

const messiSvg = readFileSync(resolve(REPO, "tests/fixtures/MESSI-SILHOUETTE.svg"), "utf8");

const samples = await page.evaluate(
  async ({ messiSvg, measures }) => {
    const geometry = await import("/src/production-lab/geometry.ts");
    const textMetrics = await import("/src/production-lab/textMetrics.ts");
    const labOutlines = await import("/src/production-lab/typographyOutlines.ts");
    const labExport = await import("/src/production-lab/exportSvg.ts");
    const embedModule = await import("/src/production-lab/exportApprovedAsset.ts");
    const iconsModule = await import("/src/data/icons.ts");
    const clientVector = await import("/src/export/vectorProductionExport.ts");
    const adminImport = await import("/src/admin-lab/svgAssetImport.ts");
    const adminRepo = await import("/src/admin-lab/repository.ts");
    const approvedModule = await import("/src/approved-designs/approvedDesign.ts");

    const NS = "http://www.w3.org/2000/svg";

    /* --- El diseño aprobado del fixture autorizado (catálogo del admin) --- */
    const admitted = adminImport.importSvgAsset(messiSvg);
    if (!admitted.ok) throw new Error(`importSvgAsset: ${admitted.reason}`);
    const store = adminRepo.createAdminDesignStore();
    const saved = await store.saveNew({
      name: "Messi Silueta (E5.1)",
      category: "Deportes",
      asset: admitted.asset,
    });
    if (!saved.ok) throw new Error(`saveNew: ${saved.error.message}`);
    const loaded = await store.load();
    const design = loaded.designs.find((entry) => entry.name === "Messi Silueta (E5.1)");
    if (!design) throw new Error("El diseño aprobado no apareció en el catálogo");
    // Id fijo (no un UUID aleatorio): las muestras deben ser reproducibles
    // byte a byte entre ejecuciones.
    const approvedInstance = {
      ...approvedModule.approvedDesignFromCatalog(design, 180),
      id: "e-approved-1",
    };

    /* --- Diseños representativos (mismos modelos que el editor) --- */
    const designs = [
      {
        slug: "a-texto-poppins",
        purpose: "Texto curvo con Poppins SemiBold",
        texts: [
          { id: "t1", text: "Mate&Co", fontFamily: "Poppins SemiBold", angle: 0, radius: 374, inverted: false, scale: 1 },
        ],
        icons: [],
        approved: [],
      },
      {
        slug: "b-texto-dancing",
        purpose: "Texto curvo con Dancing Script",
        texts: [
          { id: "t1", text: "Para vos", fontFamily: "Dancing Script", angle: 0, radius: 374, inverted: false, scale: 1 },
        ],
        icons: [],
        approved: [],
      },
      {
        slug: "c-texto-lato-invertido",
        purpose: "Texto Lato SemiBold invertido y rotado 180°",
        texts: [
          { id: "t1", text: "Edición 2026", fontFamily: "Lato SemiBold", angle: 180, radius: 340, inverted: true, scale: 1 },
        ],
        icons: [],
        approved: [],
      },
      {
        slug: "d-texto-y-icono",
        purpose: "Texto Poppins + ícono de guitarra",
        texts: [
          { id: "t1", text: "Mate&Co", fontFamily: "Poppins SemiBold", angle: 0, radius: 374, inverted: false, scale: 1 },
        ],
        icons: [
          { id: "i1", type: "icon", iconId: "guitar", angle: 90, radius: 340, scale: 1, rotation: 0, mirrored: false, inverted: false },
        ],
        approved: [],
      },
      {
        slug: "e-diseno-aprobado",
        purpose: "Diseño aprobado (silueta) sobre texto Poppins",
        texts: [
          { id: "t1", text: "Mate&Co", fontFamily: "Poppins SemiBold", angle: 0, radius: 374, inverted: false, scale: 1 },
        ],
        icons: [],
        approved: [approvedInstance],
      },
    ];

    /* --- Medidor de avance: el mismo que usa el laboratorio --- */
    async function measureAdvances(texts) {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("style", "position:absolute;width:10px;height:10px;opacity:0;pointer-events:none;");
      const nodes = new Map();
      for (const item of texts) {
        const scale = item.scale ?? 1;
        const node = document.createElementNS(NS, "text");
        node.setAttribute("font-family", item.fontFamily);
        node.setAttribute("font-size", String(35 * scale));
        node.setAttribute("font-weight", "600");
        node.setAttribute("letter-spacing", String(2 * scale));
        node.textContent = item.text;
        svg.appendChild(node);
        nodes.set(item.id, node);
      }
      document.body.appendChild(svg);
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((done) => requestAnimationFrame(() => done()));
      const advances = new Map();
      for (const [id, node] of nodes) {
        const length = node.getComputedTextLength?.();
        if (typeof length === "number" && Number.isFinite(length) && length > 0) {
          advances.set(id, length);
        }
      }
      svg.remove();
      return advances;
    }

    const out = [];
    for (const measure of measures) {
      for (const design of designs) {
        const advances = await measureAdvances(design.texts);
        const frameResult = geometry.createPhysicalFrame(measure.outer, measure.inner, "outer-diameter");
        if (!frameResult.ok) throw new Error("createPhysicalFrame: medidas inválidas");
        const frame = frameResult.frame;
        const measurements = textMetrics.toPhysicalMeasurements(advances, frame);
        const reportResult = geometry.buildPhysicalReport({
          outerDiameter: measure.outer,
          innerDiameter: measure.inner,
          strategy: "outer-diameter",
          texts: design.texts.map((element) => {
            const measurement = measurements.get(element.id);
            return measurement ? { element, measurement } : { element };
          }),
          icons: design.icons,
          approved: design.approved,
          circularLines: "double",
        });
        if (!reportResult.ok) throw new Error("buildPhysicalReport: reporte inválido");
        const report = reportResult.report;

        const prepared = await labOutlines.prepareLabTextOutlines(report, design.texts);
        if (!prepared.ok) throw new Error(`prepareLabTextOutlines: ${prepared.reason}`);

        const iconPaths = {};
        for (const placed of report.icons) {
          const source = design.icons.find((icon) => icon.id === placed.id);
          iconPaths[placed.id] = iconsModule.iconById[source?.iconId]?.paths ?? [];
        }

        const approvedEmbeds = {};
        for (const placed of report.approved) {
          if (placed.snapshot.version !== 3) continue;
          const embedded = embedModule.embedApprovedAsset(placed.snapshot.svg, placed.id);
          if (!embedded.ok) throw new Error(`embedApprovedAsset: ${embedded.reason}`);
          approvedEmbeds[placed.id] = embedded.svg;
        }

        const fileName = `fisico-${measure.slug}-${design.slug}.svg`;
        const built = labExport.buildLabPhysicalSvg({
          report,
          iconPaths,
          textOutlines: prepared.outlines,
          assetFlags: { hasRaster: false, hasUnsupportedFeature: false, hasText: false },
          approvedEmbeds,
          graphicsCount: 0,
          fileName,
        });
        // E5.1b: si el exportador BLOQUEA (p. ej. un elemento fuera de la
        // banda grabable), no se escribe archivo: el bloqueo queda
        // registrado en el manifiesto como tal.
        if (!built.ok) {
          out.push({
            measure: measure.slug,
            outer: measure.outer,
            inner: measure.inner,
            design: design.slug,
            purpose: design.purpose,
            blocked: { code: built.code, reason: built.reason },
            physicalFile: null,
            physicalSvg: null,
            physicalMeta: null,
            clientSvg: null,
            clientFile: null,
            texts: [],
            icons: report.icons.length,
            approved: report.approved.length,
            lines: report.lines.length,
          });
          continue;
        }

        // Determinismo: el mismo árbol produce los mismos bytes.
        const again = labExport.buildLabPhysicalSvg({
          report,
          iconPaths,
          textOutlines: prepared.outlines,
          assetFlags: { hasRaster: false, hasUnsupportedFeature: false, hasText: false },
          approvedEmbeds,
          graphicsCount: 0,
          fileName,
        });
        if (!again.ok || again.svg !== built.svg) {
          throw new Error(`El SVG físico no es determinista (${design.slug}/${measure.slug})`);
        }

        // El SVG del cliente (coordenadas de diseño): el que descarga el cliente.
        let clientSvg = null;
        if (design.approved.length === 0) {
          const clientBuilt = await clientVector.buildVectorProductionSvg({
            texts: design.texts,
            icons: design.icons,
            graphics: [],
            circularLines: "double",
          });
          clientSvg = clientBuilt;
        }

        const physical = built.svg;
        out.push({
          measure: measure.slug,
          outer: measure.outer,
          inner: measure.inner,
          design: design.slug,
          purpose: design.purpose,
          physicalFile: fileName,
          physicalSvg: physical,
          physicalMeta: built.meta,
          clientSvg,
          clientFile: clientSvg ? `cliente-${measure.slug}-${design.slug}.svg` : null,
          texts: report.texts.map((placed) => ({
            id: placed.id,
            fontSizeMm: placed.fontSizeMm,
            baselineRadiusMm: placed.baselineRadiusMm,
            angle: placed.angle,
            inverted: placed.sweep === 0,
            paths: prepared.outlines[placed.id]?.paths.length ?? 0,
            advanceMm: prepared.outlines[placed.id]?.advanceMm ?? null,
          })),
          icons: report.icons.length,
          approved: report.approved.length,
          lines: report.lines.length,
        });
      }
    }
    return out;
  },
  { messiSvg, measures: MEASURES },
);

await browser.close();
await server.close();

/* ------------------------------------------------------------------ */
/* Escritura de los archivos                                           */
/* ------------------------------------------------------------------ */

mkdirSync(resolve(OUT, "fisico"), { recursive: true });
mkdirSync(resolve(OUT, "cliente"), { recursive: true });

const summary = [];
for (const sample of samples) {
  if (sample.physicalSvg) {
    writeFileSync(resolve(OUT, "fisico", sample.physicalFile), sample.physicalSvg, "utf8");
  }
  if (sample.clientSvg) {
    writeFileSync(resolve(OUT, "cliente", sample.clientFile), sample.clientSvg, "utf8");
  }
  summary.push({
    measure: sample.measure,
    design: sample.design,
    purpose: sample.purpose,
    physical: sample.physicalFile ? `fisico/${sample.physicalFile}` : null,
    client: sample.clientFile ? `cliente/${sample.clientFile}` : null,
    blocked: sample.blocked ?? null,
    meta: sample.physicalMeta,
    texts: sample.texts,
    icons: sample.icons,
    approved: sample.approved,
    lines: sample.lines,
    physicalBytes: sample.physicalSvg ? sample.physicalSvg.length : null,
    clientBytes: sample.clientSvg ? sample.clientSvg.length : null,
  });
}

writeFileSync(resolve(OUT, "muestras.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

/* ------------------------------------------------------------------ */
/* Verificaciones sobre los archivos escritos                          */
/* ------------------------------------------------------------------ */

const problems = [];
for (const sample of samples) {
  if (!sample.physicalSvg) {
    // Bloqueo explícito del exportador: se registra, no se escribe archivo.
    if (!sample.blocked?.code) problems.push(`${sample.design}/${sample.measure}: bloqueado sin código`);
    continue;
  }
  const physical = sample.physicalSvg;
  const checks = [
    ["sin texto vivo", !/<text[\s>]/.test(physical)],
    ["sin imágenes rasterizadas", !/<image[\s>]/.test(physical)],
    ["sin fuente embebida", !physical.includes("@font-face")],
    ["grupo de grabado", physical.includes('id="lab-engraving"')],
    ["referencias de la virola", physical.includes('id="lab-ring-reference"')],
    ["medidas en mm", /width="[\d.]+mm" height="[\d.]+mm"/.test(physical)],
    ["viewBox", /viewBox="0 0 [\d.]+ [\d.]+"/.test(physical)],
    ["viewBox = width = height", (() => {
      const m = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(physical);
      return !!m && m[1] === m[2] && m[3] === m[4] && m[1] === m[3];
    })()],
  ];
  for (const [name, ok] of checks) {
    if (!ok) problems.push(`${sample.physicalFile}: ${name}`);
  }
  if (sample.clientSvg) {
    const client = sample.clientSvg;
    if (/<text[\s>]/.test(client)) problems.push(`${sample.clientFile}: texto vivo`);
    if (/<image[\s>]/.test(client)) problems.push(`${sample.clientFile}: imagen raster`);
    if (!client.includes('id="engraving-design"')) problems.push(`${sample.clientFile}: grupo de grabado`);
  }
}

console.log(`muestras generadas: ${samples.length}`);
console.log(
  `físicos: ${samples.filter((s) => s.physicalSvg).length} · clientes: ${samples.filter((s) => s.clientSvg).length} · bloqueados: ${samples.filter((s) => s.blocked).length}`,
);
for (const sample of samples) {
  if (sample.blocked) console.log(` - bloqueado ${sample.measure}/${sample.design}: ${sample.blocked.code}`);
}
if (problems.length > 0) {
  console.error("PROBLEMAS:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("verificaciones: OK");
