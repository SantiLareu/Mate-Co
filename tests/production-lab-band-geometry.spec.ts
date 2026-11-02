/**
 * E5.1b — La banda grabable: el exportador físico NO puede emitir un
 * archivo aparentemente válido con el grabado fuera de la pieza.
 *
 * QUÉ DEMUESTRA
 *   1. Un elemento cuyo ancla/centro queda fuera de la banda (comparación
 *      EXACTA con los radios de referencia) BLOQUEA la exportación con el
 *      código explícito `GEOMETRY_OUT_OF_BAND` y no produce ningún archivo.
 *   2. Una holgura CONSERVADORA (envolvente que "puede" cruzar un borde,
 *      sin colisión de tinta probada) NO bloquea: se publica en
 *      `meta.clearanceWarnings` para que quien grabe la compruebe.
 *   3. El bloqueo NO recorta, escala ni desplaza nada: el reporte que
 *      entra es el mismo que sale (misma escala, mismos radios).
 *   4. Una composición que cabe en la banda sigue exportando igual que
 *      antes (sin regresión).
 *
 * CÓMO LO COMPRUEBA
 *   Con el código real del laboratorio en el navegador (`page.evaluate` con
 *   `import("/src/...")`): mismo motor, mismo reporte y mismo serializador
 *   que usa la interfaz.
 */
import { expect, test } from "@playwright/test";

type ExportOutcome = {
  ok: boolean;
  code?: string;
  reason?: string;
  svg?: string;
  meta?: {
    sizeFactor: number;
    outerDiameterMm: number;
    innerDiameterMm: number;
    clearanceWarnings?: {
      elementId: string;
      elementKind: string;
      side: string;
      signedClearanceMm: number;
      message: string;
    }[];
  };
};

type FrameFacts = {
  outerRadius: number;
  innerRadius: number;
  sizeFactor: number;
  iconCenterMm: number | null;
};

/**
 * Construye el reporte físico y llama al exportador real del laboratorio.
 *
 * `iconRadius` es el radio (unidades de diseño) del ícono; `null` = sin
 * ícono. `outer`/`inner` son las medidas en mm.
 */
async function exportLab(
  page: import("@playwright/test").Page,
  input: { outer: number; inner: number; iconRadius: number | null },
): Promise<{ outcome: ExportOutcome; frame: FrameFacts }> {
  await page.goto("/");
  return await page.evaluate(async (input) => {
    const geometry = await import("/src/production-lab/geometry.ts");
    const textMetrics = await import("/src/production-lab/textMetrics.ts");
    const labOutlines = await import("/src/production-lab/typographyOutlines.ts");
    const labExport = await import("/src/production-lab/exportSvg.ts");
    const iconsModule = await import("/src/data/icons.ts");

    const texts = [
      {
        id: "t1",
        text: "Mate&Co",
        fontFamily: "Poppins SemiBold",
        angle: 0,
        radius: 374,
        inverted: false,
        scale: 1,
      },
    ];

    // El mismo medidor de avance que usa el laboratorio.
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute;width:10px;height:10px;opacity:0;");
    const node = document.createElementNS(NS, "text");
    node.setAttribute("font-family", texts[0].fontFamily);
    node.setAttribute("font-size", "35");
    node.setAttribute("font-weight", "600");
    node.setAttribute("letter-spacing", "2");
    node.textContent = texts[0].text;
    svg.appendChild(node);
    document.body.appendChild(svg);
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => done()));
    const advance = node.getComputedTextLength();
    svg.remove();

    const frameResult = geometry.createPhysicalFrame(input.outer, input.inner, "outer-diameter");
    if (!frameResult.ok) throw new Error("createPhysicalFrame");
    const frame = frameResult.frame;
    const advances = new Map<string, number>([[texts[0].id, advance]]);
    const measurements = textMetrics.toPhysicalMeasurements(advances, frame);

    const icons =
      input.iconRadius === null
        ? []
        : [
            {
              id: "i1",
              type: "icon" as const,
              iconId: "guitar",
              angle: 90,
              radius: input.iconRadius,
              scale: 1,
              rotation: 0,
              mirrored: false,
              inverted: false,
            },
          ];

    const reportResult = geometry.buildPhysicalReport({
      outerDiameter: input.outer,
      innerDiameter: input.inner,
      strategy: "outer-diameter",
      texts: texts.map((element) => {
        const measurement = measurements.get(element.id);
        return measurement ? { element, measurement } : { element };
      }),
      icons,
      approved: [],
      circularLines: "double",
    });
    if (!reportResult.ok) throw new Error("buildPhysicalReport");
    const report = reportResult.report;

    const prepared = await labOutlines.prepareLabTextOutlines(report, texts);
    if (!prepared.ok) throw new Error(prepared.reason);

    const iconPaths: Record<string, readonly string[]> = {};
    for (const placed of report.icons) {
      iconPaths[placed.id] = iconsModule.iconById["guitar"]?.paths ?? [];
    }

    const built = labExport.buildLabPhysicalSvg({
      report,
      iconPaths,
      textOutlines: prepared.outlines,
      assetFlags: { hasRaster: false, hasUnsupportedFeature: false, hasText: false },
      graphicsCount: 0,
    });

    return {
      outcome: built as unknown as {
        ok: boolean;
        code?: string;
        reason?: string;
        svg?: string;
        meta?: {
          sizeFactor: number;
          outerDiameterMm: number;
          innerDiameterMm: number;
          clearanceWarnings?: {
            elementId: string;
            elementKind: string;
            side: string;
            signedClearanceMm: number;
            message: string;
          }[];
        };
      },
      frame: {
        outerRadius: frame.outerRadius,
        innerRadius: frame.innerRadius,
        sizeFactor: frame.sizeFactor,
        iconCenterMm: report.icons[0]?.centerRadiusMm ?? null,
      },
    };
  }, input);
}

test.describe("laboratorio físico: la banda grabable", () => {
  test("un elemento fuera de la banda bloquea la exportación con código explícito", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 75/65 con un ícono a 450 unidades de diseño: su centro queda fuera
    // del radio exterior (violación DEMOSTRADA, no una envolvente).
    const { outcome, frame } = await exportLab(page, { outer: 75, inner: 65, iconRadius: 450 });
    expect(frame.iconCenterMm, "centro del ícono (mm)").toBeGreaterThan(frame.outerRadius);
    expect(outcome.ok, "no debe exportar").toBe(false);
    expect(outcome.code, "código del bloqueo").toBe("GEOMETRY_OUT_OF_BAND");
    expect(outcome.reason, "motivo legible").toContain("i1");
    // No hay archivo: nada se "recorta" ni se "acomoda" por la vía silenciosa.
    expect(outcome.svg, "sin SVG").toBeUndefined();
  });

  test("el bloqueo no recorta, escala ni desplaza el reporte", async ({ page }) => {
    test.setTimeout(120_000);
    const { outcome, frame } = await exportLab(page, { outer: 75, inner: 65, iconRadius: 450 });
    expect(outcome.ok).toBe(false);
    // La escala y los radios son los pedidos: el exportador no los tocó.
    expect(frame.outerRadius, "radio exterior (mm)").toBe(37.5);
    expect(frame.innerRadius, "radio interior (mm)").toBe(32.5);
    expect(frame.sizeFactor, "factor de escala").toBeCloseTo(75 / 2 / 423, 6);
  });

  test("una holgura conservadora no bloquea: se publica para que la revise el grabador", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // 75/65 con el ícono dentro de la banda: su envolvente conservadora
    // puede cruzar el borde interior, pero la tinta no está probada.
    const { outcome, frame } = await exportLab(page, { outer: 75, inner: 65, iconRadius: 340 });
    expect(frame.iconCenterMm, "centro del ícono dentro de la banda").toBeGreaterThan(frame.innerRadius);
    expect(frame.iconCenterMm, "centro del ícono dentro de la banda").toBeLessThan(frame.outerRadius);
    expect(outcome.ok, "sí exporta").toBe(true);
    const warnings = outcome.meta?.clearanceWarnings ?? [];
    expect(warnings.length, "aviso de holgura publicado").toBeGreaterThan(0);
    expect(warnings[0].elementId, "elemento del aviso").toBe("i1");
    expect(warnings[0].signedClearanceMm, "holgura firmada negativa").toBeLessThan(0);
    expect(outcome.svg, "archivo generado").toContain('id="lab-engraving"');
  });

  test("una composición que entra en la banda sigue exportando igual", async ({ page }) => {
    test.setTimeout(120_000);
    // 85/50: banda ancha, todo dentro → sin bloqueos ni avisos.
    const { outcome } = await exportLab(page, { outer: 85, inner: 50, iconRadius: 340 });
    expect(outcome.ok, "sí exporta").toBe(true);
    expect(outcome.code, "sin código de error").toBeUndefined();
    expect(outcome.meta?.clearanceWarnings ?? [], "sin avisos de holgura").toEqual([]);
    expect(outcome.svg, "archivo generado").toContain('id="lab-ring-reference"');
    expect(outcome.svg, "sin texto vivo").not.toContain("<text");
    expect(outcome.svg, "medidas en mm").toMatch(/width="[\d.]+mm"/);
  });
});
