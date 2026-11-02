/**
 * E5.1b — Análisis del desborde: qué elemento se sale de la banda y por qué.
 *
 * Read-only: no escribe archivos, no modifica el motor.
 *   node samples/e5-1/analyze.mjs   (en este repo, el Node de Windows: el node_modules es nativo de Windows)
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PORT = 4182;

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

const report = await page.evaluate(async () => {
  const geometry = await import("/src/production-lab/geometry.ts");
  const textMetrics = await import("/src/production-lab/textMetrics.ts");
  const NS = "http://www.w3.org/2000/svg";

  async function measureAdvances(texts) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute;width:10px;height:10px;opacity:0;");
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
      if (typeof length === "number" && Number.isFinite(length) && length > 0) advances.set(id, length);
    }
    svg.remove();
    return advances;
  }

  const texts = [
    { id: "t1", text: "Mate&Co", fontFamily: "Poppins SemiBold", angle: 0, radius: 374, inverted: false, scale: 1 },
  ];
  const icons = [
    { id: "i1", type: "icon", iconId: "guitar", angle: 90, radius: 340, scale: 1, rotation: 0, mirrored: false, inverted: false },
  ];
  const advances = await measureAdvances(texts);
  const out = [];
  for (const measure of [
    { slug: "85-50", outer: 85, inner: 50 },
    { slug: "80-60", outer: 80, inner: 60 },
    { slug: "75-65", outer: 75, inner: 65 },
  ]) {
    for (const strategy of ["outer-diameter", "band-thickness"]) {
      const frameResult = geometry.createPhysicalFrame(measure.outer, measure.inner, strategy);
      if (!frameResult.ok) continue;
      const frame = frameResult.frame;
      const measurements = textMetrics.toPhysicalMeasurements(advances, frame);
      const result = geometry.buildPhysicalReport({
        outerDiameter: measure.outer,
        innerDiameter: measure.inner,
        strategy,
        texts: texts.map((element) => {
          const measurement = measurements.get(element.id);
          return measurement ? { element, measurement } : { element };
        }),
        icons,
        approved: [],
        circularLines: "double",
      });
      if (!result.ok) continue;
      const rep = result.report;
      out.push({
        measure: measure.slug,
        strategy,
        frame: {
          outerRadius: Number(frame.outerRadius.toFixed(3)),
          innerRadius: Number(frame.innerRadius.toFixed(3)),
          band: Number((frame.outerRadius - frame.innerRadius).toFixed(3)),
          sizeFactor: Number(frame.sizeFactor.toFixed(5)),
        },
        texts: rep.texts.map((t) => ({
          id: t.id,
          anchorMm: Number(t.anchorRadiusMm.toFixed(2)),
          baselineMm: Number((t.baselineRadiusMm ?? 0).toFixed(2)),
          fontSizeMm: Number(t.fontSizeMm.toFixed(2)),
        })),
        icons: rep.icons.map((i) => ({
          id: i.id,
          centerMm: Number(i.centerRadiusMm.toFixed(2)),
          envelopeMm: Number(i.envelopeMm.toFixed(2)),
        })),
        lines: rep.lines.map((l) => ({
          radiusMm: Number(l.radiusMm.toFixed(2)),
          strokeMm: Number(l.strokeWidthMm.toFixed(3)),
        })),
        warnings: rep.warnings.map((w) => ({
          kind: w.kind,
          elementId: w.elementId ?? w.lineId ?? null,
          side: w.side ?? null,
          message: w.message,
        })),
      });
    }
  }
  return out;
});

await browser.close();
await server.close();

for (const row of report) {
  console.log(`\n=== ${row.measure} · ${row.strategy} ===`);
  console.log(`banda: ${row.frame.outerRadius} → ${row.frame.innerRadius} mm (ancho ${row.frame.band} mm, factor ${row.frame.sizeFactor})`);
  console.log(`textos: ${JSON.stringify(row.texts)}`);
  console.log(`iconos: ${JSON.stringify(row.icons)}`);
  console.log(`lineas: ${JSON.stringify(row.lines)}`);
  if (row.warnings.length === 0) console.log("warnings: ninguna");
  for (const warning of row.warnings) console.log(`  [${warning.kind}] ${warning.message}`);
}
