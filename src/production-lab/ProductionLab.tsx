import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { importSvgAsset } from "../admin-lab/svgAssetImport";
import type { ApprovedDesignSnapshot } from "../approved-designs/approvedDesign";
import MatePreview from "../components/MatePreview";
import JobSnapshotPreview from "../components/JobSnapshotPreview";
import type { TextElement } from "../components/CurvedText";
import type { DesignIcon } from "../components/IconElement";
import type { JobIconSnapshot } from "../jobs/snapshot";
import type {
  LabExportAssetFlags,
  LabTextOutline,
  PhysicalReport,
  TextMeasurement,
} from "./types";
import { buildLabPhysicalSvg } from "./exportSvg";
import {
  embedApprovedAsset,
  scanApprovedAssetFlags,
} from "./exportApprovedAsset";
import { LAB_FONT_BLOCK_CODE } from "./exportTextOutlines";
import { prepareLabTextOutlines } from "./typographyOutlines";
import {
  buildPhysicalReport,
  createPhysicalFrame,
  serializeReport,
  SOURCE_TEXT,
} from "./geometry";
import type { DiameterIssue, SizingStrategy } from "./types";
import {
  createProductionLabFixture,
  type ProductionLabFixture,
} from "./fixture";
import messiSource from "../../tests/fixtures/MESSI-SILHOUETTE.svg?raw";
import PhysicalComposition from "./PhysicalComposition";
import { iconById } from "../data/icons";
import {
  adaptJobCompositionForLab,
  labJobErrorMessage,
  loadLabJob,
  type LabJobComposition,
} from "./JobComposition";
import type { JobsErrorCode, StoredJob } from "../jobs/repository";
import {
  labSourceMeasureKey,
  toPhysicalMeasurements,
  missingAdvanceIds,
} from "./textMetrics";
import "../styles/production-lab.css";

/**
 * Isolated physical-preparation lab (P2, S1–S8). Left: the ACTUAL source
 * composition (demo fixture through MatePreview, or a saved job through
 * JobSnapshotPreview — editing=false, frozen source, noop callbacks — the
 * original is never written). Right: the bare calculated mm scene from the
 * pure report. No App/editor/admin/exporter state is read or written; no
 * localStorage, no root DOM side effects.
 *
 * J3 (Stage 2, S5): `/production-lab?jobId=<attemptKey>` resolves the job
 * read-only through the existing jobs repository. A missing, damaged or
 * unreadable job is an EXPLICIT named error — never a silent demo
 * fallback. Without `?jobId` the demo fixture path is byte-for-byte the
 * historical default.
 */

const noop = (): void => undefined;

/**
 * Discriminated diameter parse: blank stays blank, entered invalid or
 * non-finite input is an explicit field error — never a silent blank.
 * Comma accepted as decimal separator.
 */
type DiameterParse =
  { kind: "empty" } | { kind: "invalid" } | { kind: "valid"; value: number };

function parseDiameterState(raw: string): DiameterParse {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { kind: "empty" };
  const value = Number(text);
  return Number.isFinite(value)
    ? { kind: "valid", value }
    : { kind: "invalid" };
}

/** Stable fingerprint of the SOURCE composition to prove it never changes. */
export function fingerprintSource(fixture: ProductionLabFixture): string {
  const json = JSON.stringify(fixture);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Current `?jobId=` value, or null on the plain demo path. */
function readLabJobId(): string | null {
  const raw = new URLSearchParams(window.location.search).get("jobId");
  const key = (raw ?? "").trim();
  return key === "" ? null : key;
}

type JobLoad =
  | { kind: "ready"; job: StoredJob; lab: LabJobComposition }
  | { kind: "error"; code: JobsErrorCode; message: string };

function SourceAdvanceMeasurer({
  texts,
  measureKey,
  onAdvances,
}: {
  texts: readonly TextElement[];
  measureKey: string;
  onAdvances: (next: Map<string, number>, key: string) => void;
}) {
  // Hidden straight-text render at SOURCE units (original CurvedText font
  // size/spacing): measures advance only, never claims an ink bbox. Always
  // publishes a COMPLETED measurement for its key — a possibly empty map
  // when every element is unmeasurable (zero/throw/non-finite) — so the UI
  // completes instead of pending forever. Measured once per mount: the
  // parent remounts this probe with `key={measureKey}` on every source
  // change (job A → demo → job A included), so no cross-key memo survives
  // and no parent/child key-ref ordering race can drop the first publish.
  // The parent completion closure carries the same key, so a late
  // font-ready arrival from a superseded source is ignored deterministically.
  // No fallback lengths, no retry loops. Unmount staleness is guarded.
  const refs = useRef(new Map<string, SVGTextElement | null>());
  const callback = useRef(onAdvances);
  callback.current = onAdvances;
  const textsRef = useRef(texts);
  textsRef.current = texts;
  useEffect(() => {
    let live = true;
    let published = false;
    const key = measureKey;
    const publish = () => {
      if (!live || published) return;
      published = true;
      const out = new Map<string, number>();
      for (const item of textsRef.current) {
        try {
          const node = refs.current.get(item.id);
          const length = node?.getComputedTextLength?.();
          if (
            typeof length === "number" &&
            Number.isFinite(length) &&
            length > 0
          ) {
            out.set(item.id, length);
          }
        } catch {
          // Unsupported measurement: stays absent from the completed map
          // and the UI labels it advance-unavailable (never a fake length).
        }
      }
      if (live) callback.current(out, key);
    };
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => publish());
    }
    const frame = requestAnimationFrame(() => publish());
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [measureKey]);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="lab-advance-measurer"
      style={{
        position: "absolute",
        width: 10,
        height: 10,
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      {texts.map((item) => {
        const scale = item.scale ?? 1;
        return (
          <text
            key={item.id}
            data-testid={`lab-measure-${item.id}`}
            ref={(node) => {
              refs.current.set(item.id, node);
            }}
            fontFamily={item.fontFamily}
            fontSize={SOURCE_TEXT.fontSize * scale}
            fontWeight={600}
            letterSpacing={SOURCE_TEXT.letterSpacing * scale}
          >
            {item.text}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * E2 physical vector export panel (Stage 3 S6). Lab-local: the Blob +
 * URL.createObjectURL + revoke download helper below is additive and lives
 * in this file only (no shared download module). Reads the SAME parsed
 * PhysicalReport the preview renders; toggling strategy or measures
 * re-derives the report through the existing memo, so exports always match
 * the visible readout. Job mode stays read-only: the only repository touch
 * is the `get` that loaded the job (no writes, no subscriptions).
 * Never marks a design apt for engraving: experimental wording only.
 */
function downloadLabSvgFile(fileName: string, svgText: string): void {
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type LabExportPanelState =
  | { kind: "blocked"; reason: string; fileName: string | null }
  | {
      kind: "ready";
      reason: null;
      fileName: string;
      svg: string;
      outerDiameter: number;
      innerDiameter: number;
      strategy: SizingStrategy;
    };

function labExportFileName(report: PhysicalReport): string {
  return (
    `physical-virola-${String(report.frame.outerDiameter)}x` +
    `${String(report.frame.innerDiameter)}-${report.frame.strategy}.svg`
  );
}

function computeLabExportState(args: {
  report: PhysicalReport | null;
  advances: Map<string, number> | null;
  sourceIcons: readonly DesignIcon[];
  jobIcons: readonly JobIconSnapshot[] | null;
  graphicsCount: number;
  /**
   * Contornos vectoriales ya calculados (id del texto -> contornos). Los
   * produce el motor asíncrono; el serializador sigue siendo síncrono.
   */
  textOutlines?: Record<string, LabTextOutline> | null;
  /** Error explícito al preparar los contornos (bloquea la exportación). */
  textOutlineError?: string | null;
}): LabExportPanelState {
  const {
    report,
    advances,
    sourceIcons,
    jobIcons,
    graphicsCount,
    textOutlines,
    textOutlineError,
  } = args;
  if (!report) {
    return {
      kind: "blocked",
      reason:
        "Sin medidas válidas: ingresá ambos diámetros en milímetros, con el interior menor que el exterior.",
      fileName: null,
    };
  }
  const fileName = labExportFileName(report);
  // El texto sólo se exporta con sus contornos vectoriales reales (los
  // calcula el motor asíncrono). Si faltan o fallaron, se bloquea con el
  // código explícito: nunca un archivo con el texto sin convertir.
  if (report.texts.length > 0) {
    if (textOutlineError) {
      return {
        kind: "blocked",
        reason: `${LAB_FONT_BLOCK_CODE}: ${textOutlineError}`,
        fileName,
      };
    }
    if (!textOutlines) {
      return {
        kind: "blocked",
        reason: `${LAB_FONT_BLOCK_CODE}: calculando los contornos vectoriales del texto…`,
        fileName,
      };
    }
  }
  // Graphics scope gate (E3, J3 disclosure): traced job images are outside
  // the physical engine (texts/icons/approved only). Blocked with an
  // explicit code — never a silent omission, never an exportable claim.
  // Runs after the fonts gate so FONT_OUTLINES_UNAVAILABLE keeps precedence.
  // Same wording family as the lab-job-graphics-note below.
  if (graphicsCount > 0) {
    return {
      kind: "blocked",
      reason: `Exportación bloqueada (GRAPHICS_NOT_EXPORTED): el trabajo trae ${String(graphicsCount)} ${graphicsCount === 1 ? "imagen" : "imágenes"}: visible en el original intacto; el motor físico cubre textos, íconos y diseños aprobados.`,
      fileName,
    };
  }
  // Icon path data: demo resolves through the live catalog (iconById),
  // job mode uses the embedded definitions carried by the stored snapshot.
  const iconPaths: Record<string, readonly string[]> = {};
  for (const placed of report.icons) {
    const paths = jobIcons
      ? (jobIcons.find((entry) => entry.id === placed.id)?.definition.paths ??
        null)
      : (() => {
          const source = sourceIcons.find((item) => item.id === placed.id);
          return source ? (iconById[source.iconId]?.paths ?? null) : null;
        })();
    if (!paths) {
      return {
        kind: "blocked",
        reason: `Ícono «${placed.id}» sin definición vectorial disponible: exportación bloqueada (fail-closed).`,
        fileName,
      };
    }
    iconPaths[placed.id] = paths;
  }
  // v3 asset scan (client-side DOM pass): block naming WHICH design.
  const assetFlags: LabExportAssetFlags = {
    hasRaster: false,
    hasUnsupportedFeature: false,
    hasText: false,
  };
  const blockers: string[] = [];
  for (const placed of report.approved) {
    if (placed.snapshot.version !== 3) continue;
    const scan = scanApprovedAssetFlags(placed.snapshot.svg);
    assetFlags.hasRaster = assetFlags.hasRaster || scan.hasRaster;
    assetFlags.hasUnsupportedFeature =
      assetFlags.hasUnsupportedFeature || scan.hasUnsupportedFeature;
    assetFlags.hasText = assetFlags.hasText || scan.hasText;
    if (scan.hasRaster)
      blockers.push(
        `diseño «${placed.id}» con datos raster (RASTER_ASSET_BLOCKED)`,
      );
    if (scan.hasUnsupportedFeature)
      blockers.push(
        `diseño «${placed.id}» con característica no transferible con fidelidad ` +
          `(UNSUPPORTED_ASSET_FEATURE: filter/fe*, preserveAspectRatio de raíz distinto de xMidYMid meet o transform de raíz)`,
      );
    if (scan.hasText)
      blockers.push(
        `diseño «${placed.id}» con texto/fuente (FONT_OUTLINES_UNAVAILABLE)`,
      );
  }
  if (blockers.length > 0) {
    return {
      kind: "blocked",
      reason: `Exportación bloqueada: ${blockers.join("; ")}.`,
      fileName,
    };
  }
  if (advances === null) {
    return {
      kind: "blocked",
      reason: "Midiendo avances de texto con la fuente del navegador…",
      fileName,
    };
  }
  // v3 inline payloads: DOM namespacing per instance; any failure blocks.
  const approvedEmbeds: Record<string, string> = {};
  for (const placed of report.approved) {
    if (placed.snapshot.version !== 3) continue;
    const embedded = embedApprovedAsset(placed.snapshot.svg, placed.id);
    if (!embedded.ok) {
      return {
        kind: "blocked",
        reason: `Exportación bloqueada: diseño «${placed.id}» no integrable: ${embedded.reason}`,
        fileName,
      };
    }
    approvedEmbeds[placed.id] = embedded.svg;
  }
  const built = buildLabPhysicalSvg({
    report,
    iconPaths,
    assetFlags,
    approvedEmbeds,
    fileName,
    graphicsCount,
    ...(textOutlines ? { textOutlines } : {}),
  });
  if (!built.ok) {
    return {
      kind: "blocked",
      reason: `Exportación bloqueada (${built.code}): ${built.reason}`,
      fileName,
    };
  }
  return {
    kind: "ready",
    reason: null,
    fileName: built.meta.fileName,
    svg: built.svg,
    outerDiameter: built.meta.outerDiameterMm,
    innerDiameter: built.meta.innerDiameterMm,
    strategy: built.meta.strategy,
  };
}

function LabPhysicalExport({
  report,
  advances,
  sourceIcons,
  jobIcons,
  graphicsCount,
  textOutlines,
  textOutlineError,
}: {
  report: PhysicalReport | null;
  advances: Map<string, number> | null;
  sourceIcons: readonly DesignIcon[];
  jobIcons: readonly JobIconSnapshot[] | null;
  graphicsCount: number;
  textOutlines: Record<string, LabTextOutline> | null;
  textOutlineError: string | null;
}): React.JSX.Element {
  const state = useMemo(
    () =>
      computeLabExportState({
        report,
        advances,
        sourceIcons,
        jobIcons,
        graphicsCount,
        textOutlines,
        textOutlineError,
      }),
    [
      report,
      advances,
      sourceIcons,
      jobIcons,
      graphicsCount,
      textOutlines,
      textOutlineError,
    ],
  );
  const [lastDownload, setLastDownload] = useState<string | null>(null);
  const handleExport = useCallback(() => {
    if (state.kind !== "ready") return;
    downloadLabSvgFile(state.fileName, state.svg);
    setLastDownload(`${state.fileName}|${state.svg.length}`);
  }, [state]);
  const downloadedCurrent =
    state.kind === "ready" &&
    lastDownload === `${state.fileName}|${state.svg.length}`;
  return (
    <section
      className="lab-export"
      data-testid="lab-export-section"
      aria-label="Exportación vectorial física"
    >
      <h3>Exportación vectorial física (SVG)</h3>
      <p
        className="lab-export-experimental"
        data-testid="lab-export-experimental"
      >
        Experimental — pendiente de validación con el grabador. No declara
        diseños aptos para grabado.
      </p>
      {state.fileName !== null && state.kind !== "blocked" ? (
        <p className="lab-export-file" data-testid="lab-export-filename">
          {`Archivo: ${state.fileName} · ⌀ exterior ${state.outerDiameter} mm · ⌀ interior ${state.innerDiameter} mm · Estrategia ${state.strategy === "band-thickness" ? "espesor de banda (B)" : "diámetro exterior (A)"}.`}
        </p>
      ) : state.fileName !== null ? (
        <p className="lab-export-file" data-testid="lab-export-filename">
          {`Archivo previsto: ${state.fileName} (bloqueado, sin descarga).`}
        </p>
      ) : null}
      <button
        type="button"
        className="lab-export-button"
        data-testid="lab-export-button"
        disabled={state.kind !== "ready"}
        onClick={handleExport}
      >
        Exportar SVG físico
      </button>
      <p
        className="lab-export-status"
        data-testid="lab-export-status"
        role={state.kind === "ready" ? "status" : "alert"}
      >
        {state.kind === "ready"
          ? downloadedCurrent
            ? `Descargado ${state.fileName} (${state.svg.length} bytes, ⌀ exterior ${state.outerDiameter} mm × ⌀ interior ${state.innerDiameter} mm, estrategia ${state.strategy}). Experimental: pendiente de validación con el grabador.`
            : `Composición exportable: ${state.fileName} (⌀ exterior ${state.outerDiameter} mm × ⌀ interior ${state.innerDiameter} mm, estrategia ${state.strategy}). Esta descarga no declara aptitud para grabado.`
          : state.reason}
      </p>
    </section>
  );
}

export default function ProductionLab() {
  const [outerRaw, setOuterRaw] = useState("");
  const [innerRaw, setInnerRaw] = useState("");
  // Native number-sanitization guard: with number inputs the browser coerces
  // unparseable entry (e.g. 1e400) to "" — validity.badInput captured at the
  // input event distinguishes that from a deliberately cleared field.
  const [outerBadInput, setOuterBadInput] = useState(false);
  const [innerBadInput, setInnerBadInput] = useState(false);
  // C2: estrategia de dimensionado solo del laboratorio. B (espesor de
  // banda) es el valor inicial aquí; el producto sigue en A por defecto
  // (buildPhysicalReport/createPhysicalFrame usan 'outer-diameter' omitido).
  // Estado puro: alternar no recarga ni toca trabajo/medidas/composición.
  const [strategy, setStrategy] = useState<SizingStrategy>("band-thickness");
  const [advances, setAdvances] = useState<Map<string, number> | null>(null);

  // J3: selected-job state follows the URL (explicit user navigation and
  // browser back/forward re-sync in-mount through popstate/pageshow — no
  // router, no auto redirect). Null is the plain demo path.
  const [jobId, setJobId] = useState<string | null>(() => readLabJobId());
  useEffect(() => {
    const sync = (): void => setJobId(readLabJobId());
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) sync();
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // J3: read-only job resolution — one `get`, no writes, no subscriptions.
  // While a jobId is set the lab NEVER shows the demo: loading renders no
  // source pane, failure renders the named error state.
  const [jobLoad, setJobLoad] = useState<JobLoad | null>(null);
  useEffect(() => {
    if (jobId === null) {
      setJobLoad(null);
      return;
    }
    let alive = true;
    setJobLoad(null);
    void loadLabJob(jobId).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setJobLoad({
          kind: "ready",
          job: result.job,
          lab: adaptJobCompositionForLab(result.job),
        });
      } else {
        setJobLoad({
          kind: "error",
          code: result.error.code,
          message: labJobErrorMessage(result.error),
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [jobId]);

  // Explicit in-app return to the demo path (user-initiated, same explicit
  // address, no auto redirect): history entry so back/forward keep working.
  const goDemo = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    window.history.pushState({}, "", "/production-lab");
    setJobId(null);
  }, []);

  // Single immutable Messi source (?raw, lab chunk only), validated at
  // runtime through the existing sanitizer; deterministic id/date metadata.
  // No copied art bytes: the snapshot holds the validated source string.
  const messi = useMemo(() => {
    const outcome = importSvgAsset(messiSource);
    if (!outcome.ok) return { ok: false as const, reason: outcome.reason };
    const snapshot: ApprovedDesignSnapshot = Object.freeze({
      version: 3 as const,
      id: "messi-silhouette-lab",
      name: "Messi Silueta",
      category: "Deportes",
      enabled: true,
      createdAt: "2026-01-01",
      svg: outcome.asset.svg,
      width: outcome.asset.width,
      height: outcome.asset.height,
      viewBox: outcome.asset.viewBox ? { ...outcome.asset.viewBox } : null,
    });
    return { ok: true as const, snapshot };
  }, []);

  const fixture = useMemo(
    () => createProductionLabFixture(messi.ok ? messi.snapshot : undefined),
    [messi],
  );

  const readyLab =
    jobLoad !== null && jobLoad.kind === "ready" ? jobLoad : null;
  const jobError =
    jobLoad !== null && jobLoad.kind === "error" ? jobLoad : null;

  // The ACTIVE source: the immutable job adapter when a job is selected,
  // the frozen demo fixture otherwise. Identical engine semantics either
  // way; the ORIGINAL pane below always renders the matching source.
  const sourceTexts = readyLab ? readyLab.lab.texts : fixture.texts;
  const sourceIcons = readyLab ? readyLab.lab.icons : fixture.icons;
  const sourceApproved = readyLab ? readyLab.lab.approved : fixture.approved;
  const sourceLines = readyLab
    ? readyLab.lab.circularLines
    : fixture.circularLines;

  // Demo fingerprint is byte-identical to the historical default (same
  // frozen fixture object); a job fingerprints its immutable adapter.
  const fingerprint = useMemo(
    () =>
      readyLab
        ? fingerprintSource({
            texts: [...sourceTexts],
            icons: [...sourceIcons],
            approved: [...sourceApproved],
            circularLines: sourceLines,
          } as ProductionLabFixture)
        : fingerprintSource(fixture),
    [readyLab, fixture, sourceTexts, sourceIcons, sourceApproved, sourceLines],
  );

  // J3 parent-owned measurement identity: composition id + text ids +
  // stored fonts/scales. The probe remounts on every change (key below)
  // and the completion closure compares against this same value — no
  // child doneKeys, no parent key ref, no publish-drop race on A→B→A.
  const sourceId = readyLab ? readyLab.lab.attemptKey : "demo";
  const measureKey = useMemo(
    () => labSourceMeasureKey(sourceId, sourceTexts),
    [sourceId, sourceTexts],
  );
  const handleAdvances = useCallback(
    (next: Map<string, number>, key: string) => {
      if (key !== measureKey) return;
      // Completion is significant even when empty: it ends "measuring".
      setAdvances(new Map(next));
    },
    [measureKey],
  );

  // A new source invalidates completed advances (no stale mm reuse).
  useEffect(() => {
    setAdvances(null);
  }, [measureKey]);

  // Immediate pure rebuild on every keystroke; invalid/nonfinite/inner>=
  // outer removes the old scene and report instead of showing stale output.
  // Blank (both/partially cleared, no bad input) stays blank without errors;
  // entered invalid/non-finite input is explicit field validation.
  const outerState = parseDiameterState(outerRaw);
  const innerState = parseDiameterState(innerRaw);
  const outerFieldInvalid = outerBadInput || outerState.kind === "invalid";
  const innerFieldInvalid = innerBadInput || innerState.kind === "invalid";
  const parsed = useMemo(() => {
    if (outerFieldInvalid || innerFieldInvalid) {
      const issues: DiameterIssue[] = [];
      if (outerFieldInvalid)
        issues.push({
          code: "NOT_FINITE",
          field: "outerDiameter",
          message: "El diámetro exterior debe ser un número finito.",
        });
      if (innerFieldInvalid)
        issues.push({
          code: "NOT_FINITE",
          field: "innerDiameter",
          message: "El diámetro interior debe ser un número finito.",
        });
      return { kind: "invalid" as const, issues };
    }
    if (outerState.kind !== "valid" || innerState.kind !== "valid")
      return { kind: "blank" as const };
    const outer = outerState.value;
    const inner = innerState.value;
    const frameResult = createPhysicalFrame(outer, inner, strategy);
    if (!frameResult.ok)
      return { kind: "invalid" as const, issues: frameResult.issues };
    const measurements = advances
      ? toPhysicalMeasurements(advances, frameResult.frame)
      : new Map<string, TextMeasurement>();
    const result = buildPhysicalReport({
      outerDiameter: outer,
      innerDiameter: inner,
      strategy,
      texts: sourceTexts.map((element) => {
        const measurement = measurements.get(element.id);
        return measurement ? { element, measurement } : { element };
      }),
      icons: [...sourceIcons],
      approved: [...sourceApproved],
      circularLines: sourceLines,
    });
    if (!result.ok) return { kind: "invalid" as const, issues: result.issues };
    const serialized = serializeReport(result.report);
    return {
      kind: "ok" as const,
      report: result.report,
      json: serialized.ok ? serialized.json : null,
      serializeError: serialized.ok ? null : serialized.reason,
    };
  }, [
    outerFieldInvalid,
    innerFieldInvalid,
    outerState,
    innerState,
    sourceTexts,
    sourceIcons,
    sourceApproved,
    sourceLines,
    advances,
    strategy,
  ]);

  // Per-id advance completion: ids absent from the completed map have no
  // browser advance (advance unavailable — distinct from ink unknown).
  const unavailableAdvanceIds =
    advances === null ? [] : missingAdvanceIds(sourceTexts, advances);

  // Contornos vectoriales del texto: los calcula el motor (WASM, asíncrono) y
  // el serializador síncrono los consume como datos ya resueltos.
  //
  // La clave de preparación es un HUELLO estable (no la identidad del
  // objeto reporte): si dependiera de la identidad, cada setState volvería a
  // disparar el efecto y el componente entraría en bucle.
  const outlineKey = useMemo(() => {
    if (!parsed.report) return "";
    return JSON.stringify({
      texts: parsed.report.texts.map((placed) => [
        placed.id,
        placed.fontSizeMm,
        placed.letterSpacingMm,
        placed.baselineRadiusMm,
        placed.angle,
        placed.sweep,
        placed.invertedDyMm,
      ]),
      sources: sourceTexts.map((element) => [
        element.id,
        element.text,
        element.fontFamily,
      ]),
    });
  }, [parsed.report, sourceTexts]);
  const latestOutlineInput = useRef({
    report: parsed.report,
    sourceTexts,
  });
  latestOutlineInput.current = { report: parsed.report, sourceTexts };
  const [textOutlines, setTextOutlines] = useState<Record<
    string,
    LabTextOutline
  > | null>(null);
  const [textOutlineError, setTextOutlineError] = useState<string | null>(null);
  useEffect(() => {
    if (!outlineKey) {
      setTextOutlines(null);
      setTextOutlineError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { report, sourceTexts: texts } = latestOutlineInput.current;
      if (!report) return;
      if (report.texts.length === 0) {
        if (!cancelled) setTextOutlines({});
        return;
      }
      const prepared = await prepareLabTextOutlines(report, texts);
      if (cancelled) return;
      if (!prepared.ok) {
        setTextOutlineError(prepared.reason);
        setTextOutlines({});
        return;
      }
      setTextOutlines(prepared.outlines);
    })();
    return () => {
      cancelled = true;
    };
  }, [outlineKey]);

  // Job icons whose embedded definition has no live-catalog entry: the
  // ORIGINAL pane still paints them from the snapshot (JobSnapshotPreview),
  // but the physical icon glyph resolves through the catalog lookup like
  // the demo path — an honest boundary note, never a silent drop.
  const ghostIconIds = useMemo(
    () =>
      readyLab
        ? readyLab.lab.icons
            .filter((icon) => iconById[icon.iconId] === undefined)
            .map((icon) => icon.id)
        : [],
    [readyLab],
  );
  const jobGraphicsCount =
    readyLab && jobLoad?.kind === "ready"
      ? jobLoad.job.composition.graphics.length
      : 0;

  return (
    <main className="production-lab" data-testid="lab-root">
      <h1>Laboratorio de preparación física</h1>
      <p className="lab-lede">
        Geometría física calculada en milímetros a partir de los diámetros. A la
        izquierda, la composición original del editor; a la derecha, la
        transformación física pura: sin redistribuir elementos, sin reescalar
        arte interno, sin ocultar lo que no entra.
      </p>
      {jobId === null ? (
        <p
          className="lab-source-note"
          data-testid="lab-source-kind"
          data-source="demo"
        >
          Fuente: composición de demostración (fixture interno). Para abrir un
          trabajo guardado, usá el control «Abrir en laboratorio físico» del
          detalle en /admin.
        </p>
      ) : jobError !== null ? (
        <p
          className="lab-source-note"
          data-testid="lab-source-kind"
          data-source="job-error"
        >
          {`Fuente: trabajo ${jobId} (no disponible).`}
        </p>
      ) : readyLab !== null ? (
        <p
          className="lab-source-note"
          data-testid="lab-source-kind"
          data-source="job"
        >
          {`Fuente: trabajo guardado ${readyLab.lab.jobId} (solo lectura, sin cambios). `}
          <a
            href="/production-lab"
            data-testid="lab-demo-link"
            onClick={goDemo}
          >
            Abrir demostración
          </a>
        </p>
      ) : (
        <p
          className="lab-source-note"
          data-testid="lab-source-kind"
          data-source="job-loading"
        >
          {`Fuente: trabajo ${jobId} (cargando…).`}
        </p>
      )}
      <div className="lab-inputs">
        <label className="lab-field" htmlFor="lab-outer-input">
          Diámetro exterior (mm)
          <input
            id="lab-outer-input"
            data-testid="lab-outer-input"
            value={outerRaw}
            onChange={(event) => setOuterRaw(event.target.value)}
            onInput={(event) =>
              setOuterBadInput(event.currentTarget.validity.badInput)
            }
            inputMode="decimal"
            autoComplete="off"
            placeholder="p. ej. 100"
            aria-invalid={outerFieldInvalid}
            aria-describedby="lab-outer-error"
          />
        </label>
        <label className="lab-field" htmlFor="lab-inner-input">
          Diámetro interior (mm)
          <input
            id="lab-inner-input"
            data-testid="lab-inner-input"
            value={innerRaw}
            onChange={(event) => setInnerRaw(event.target.value)}
            onInput={(event) =>
              setInnerBadInput(event.currentTarget.validity.badInput)
            }
            inputMode="decimal"
            autoComplete="off"
            placeholder="p. ej. 60"
            aria-invalid={innerFieldInvalid}
            aria-describedby="lab-inner-error"
          />
        </label>
      </div>
      <fieldset className="lab-strategy" data-testid="lab-strategy-selector">
        <legend>Estrategia de adaptación (solo laboratorio)</legend>
        <label className="lab-strategy-option" htmlFor="lab-strategy-a">
          <input
            type="radio"
            id="lab-strategy-a"
            data-testid="lab-strategy-a"
            name="lab-strategy"
            value="outer-diameter"
            checked={strategy === "outer-diameter"}
            onChange={() => setStrategy("outer-diameter")}
          />
          Modo A — Diámetro exterior (tamaños según ⌀ exterior)
        </label>
        <label className="lab-strategy-option" htmlFor="lab-strategy-b">
          <input
            type="radio"
            id="lab-strategy-b"
            data-testid="lab-strategy-b"
            name="lab-strategy"
            value="band-thickness"
            checked={strategy === "band-thickness"}
            onChange={() => setStrategy("band-thickness")}
          />
          Modo B — Espesor de banda (tamaños según espesor disponible)
        </label>
      </fieldset>
      {outerFieldInvalid && (
        <p
          id="lab-outer-error"
          className="lab-field-error"
          data-testid="lab-outer-error"
          role="alert"
        >
          El diámetro exterior debe ser un número finito.
        </p>
      )}
      {innerFieldInvalid && (
        <p
          id="lab-inner-error"
          className="lab-field-error"
          data-testid="lab-inner-error"
          role="alert"
        >
          El diámetro interior debe ser un número finito.
        </p>
      )}
      {jobId !== null && jobError !== null ? (
        <>
          <p
            data-testid="lab-job-error"
            data-code={jobError.code}
            className="lab-job-error"
            role="alert"
          >
            {jobError.message}
          </p>
          <p className="lab-source-note">
            <a
              href="/production-lab"
              data-testid="lab-demo-link"
              onClick={goDemo}
            >
              Abrir demostración
            </a>
          </p>
        </>
      ) : jobId !== null && readyLab === null ? (
        <p data-testid="lab-job-loading" role="status">
          Cargando trabajo guardado…
        </p>
      ) : !messi.ok && jobId === null ? (
        <p data-testid="lab-sanitizer-error" role="alert">
          {`No se pudo validar la fuente aprobada del laboratorio: ${messi.reason}`}
        </p>
      ) : (
        <>
          <div className="lab-panes">
            {readyLab !== null ? (
              <section aria-label="Original" data-testid="lab-job-pane">
                <h2>Original (trabajo guardado)</h2>
                <JobSnapshotPreview
                  composition={readyLab.job.composition}
                  instanceId={`lab-job-${readyLab.lab.attemptKey}`}
                  testId="lab-job-original"
                  label={`Vista previa del trabajo ${readyLab.lab.jobId}`}
                />
                <p
                  className="lab-source-meta"
                  data-testid="lab-source-fingerprint"
                  data-fingerprint={fingerprint}
                >
                  {`Composición original inmutable del trabajo ${readyLab.lab.jobId}: ${readyLab.lab.texts.length} textos · ${readyLab.lab.icons.length} íconos · ${readyLab.job.composition.graphics.length} imágenes · ${readyLab.lab.approved.length} diseños aprobados · líneas ${readyLab.lab.circularLines}. Huella ${fingerprint}.`}
                </p>
                {ghostIconIds.length > 0 && (
                  <p
                    className="lab-advance-note"
                    data-testid="lab-job-icons-note"
                    role="status"
                  >
                    {`Íconos sin entrada en el catálogo vivo (${ghostIconIds.map((id) => `«${id}»`).join(", ")}): el original los pinta desde su definición incorporada; la vista física conserva su posición y envolvente en el reporte y las holguras.`}
                  </p>
                )}
                {jobGraphicsCount > 0 && (
                  <p
                    className="lab-advance-note"
                    data-testid="lab-job-graphics-note"
                    role="status"
                  >
                    {`El trabajo trae ${jobGraphicsCount} ${jobGraphicsCount === 1 ? "imagen" : "imágenes"}: visible en el original intacto; el motor físico cubre textos, íconos y diseños aprobados.`}
                  </p>
                )}
              </section>
            ) : (
              <section aria-label="Original" data-testid="lab-original">
                <h2>Original (editor)</h2>
                <MatePreview
                  texts={[...fixture.texts]}
                  editing={false}
                  selectedText={null}
                  onSelectText={noop}
                  onUpdateText={noop}
                  onDeleteText={noop}
                  icons={[...fixture.icons]}
                  selectedIcon={null}
                  onSelectIcon={noop}
                  onUpdateIcon={noop}
                  onDeleteIcon={noop}
                  graphics={[]}
                  selectedGraphic={null}
                  onSelectGraphic={noop}
                  onUpdateGraphic={noop}
                  onDeleteGraphic={noop}
                  approved={[...fixture.approved]}
                  selectedApproved={null}
                  onSelectApproved={noop}
                  onUpdateApproved={noop}
                  onDeleteApproved={noop}
                  circularLines={fixture.circularLines}
                />
                <p
                  className="lab-source-meta"
                  data-testid="lab-source-fingerprint"
                  data-fingerprint={fingerprint}
                >
                  {`Composición original inmutable: ${fixture.texts.length} textos · ${fixture.icons.length} íconos · ${fixture.approved.length} diseños aprobados · líneas ${fixture.circularLines}. Huella ${fingerprint}.`}
                </p>
              </section>
            )}
            <section aria-label="Física" data-testid="lab-physical">
              <h2>Composición física (mm)</h2>
              {parsed.kind !== "ok" ? (
                <p data-testid="lab-no-physical">
                  Sin geometría física: ingresá ambos diámetros en milímetros,
                  con el interior menor que el exterior.
                </p>
              ) : (
                <>
                  <p
                    className="lab-provenance-note"
                    data-testid="lab-provenance-note"
                  >
                    Círculos de referencia, posiciones y anclas: geometría
                    física calculada exacta. Envolventes: conservadoras (ver
                    leyenda). Glifos de texto: apariencia simulada dependiente
                    de la fuente y del navegador; el avance medido no es tinta
                    (caja de tinta sin medir).
                  </p>
                  <p
                    className="lab-legend-note"
                    data-testid="lab-geometry-legend"
                  >
                    Referencias y anclas: geometría calculada exacta.
                    Envolventes: conservadoras (la tinta real puede ser menor);
                    efectos SVG completos no certificados. Colisiones de tinta
                    texto↔diseño y línea↔diseño no medidas ni afirmadas: los
                    pares solo cubren discos con envolvente (íconos y diseños
                    aprobados), nunca texto ni anillos.
                  </p>
                  <p className="lab-lines-note" data-testid="lab-lines-note">
                    Líneas: trazo circular subyacente con el recorte visual de
                    la composición original (fuente: regla visual original; no
                    margen de fabricación). Los círculos de referencia nunca se
                    recortan.
                  </p>
                  <PhysicalComposition
                    report={parsed.report}
                    sourceTexts={sourceTexts}
                    sourceIcons={sourceIcons}
                    completedAdvances={advances}
                  />
                </>
              )}
              {parsed.kind === "invalid" && (
                <>
                  <ul data-testid="lab-diameter-issue" role="alert">
                    {parsed.issues.map((issue) => (
                      <li key={`${issue.field}-${issue.code}`}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                  <LabPhysicalExport
                    report={null}
                    advances={advances}
                    sourceIcons={sourceIcons}
                    jobIcons={readyLab ? readyLab.job.composition.icons : null}
                    graphicsCount={jobGraphicsCount}
                    textOutlines={textOutlines}
                    textOutlineError={textOutlineError}
                  />
                </>
              )}
              {parsed.kind === "ok" && advances === null && (
                <p data-testid="lab-measuring">
                  Midiendo avances de texto con la fuente del navegador…
                </p>
              )}
              {parsed.kind === "ok" &&
                advances !== null &&
                unavailableAdvanceIds.length > 0 && (
                  <p
                    className="lab-advance-note"
                    data-testid="lab-advance-unavailable"
                    role="status"
                  >
                    {`Avance no disponible para ${unavailableAdvanceIds.map((id) => `«${id}»`).join(", ")} (medición del navegador no disponible o vacía): se muestra la geometría de referencia y la tinta sigue sin medirse.`}
                  </p>
                )}
              {parsed.kind === "ok" && (
                <>
                  <p
                    className="lab-strategy-readout"
                    data-testid="lab-strategy-readout"
                    data-strategy={parsed.report.frame.strategy}
                    data-size-factor={String(parsed.report.frame.sizeFactor)}
                    data-outer-mm={String(parsed.report.frame.outerDiameter)}
                    data-inner-mm={String(parsed.report.frame.innerDiameter)}
                    data-band-mm={String(
                      parsed.report.frame.outerRadius -
                        parsed.report.frame.innerRadius,
                    )}
                  >
                    {`Estrategia activa: ${parsed.report.frame.strategy === "band-thickness" ? "Espesor de banda (Modo B)" : "Diámetro exterior (Modo A)"}. ⌀ exterior ${parsed.report.frame.outerDiameter} mm · ⌀ interior ${parsed.report.frame.innerDiameter} mm · Espesor de banda ${parsed.report.frame.outerRadius - parsed.report.frame.innerRadius} mm (Ro ${parsed.report.frame.outerRadius} mm − Ri ${parsed.report.frame.innerRadius} mm) · Factor de escala aplicado ${parsed.report.frame.sizeFactor}.`}
                  </p>
                  <LabPhysicalExport
                    report={parsed.report}
                    advances={advances}
                    sourceIcons={sourceIcons}
                    jobIcons={readyLab ? readyLab.job.composition.icons : null}
                    graphicsCount={jobGraphicsCount}
                    textOutlines={textOutlines}
                    textOutlineError={textOutlineError}
                  />
                  <p data-testid="lab-frame">
                    {`Anillo de referencia: ⌀ exterior ${parsed.report.frame.outerDiameter} mm (Ro ${parsed.report.frame.outerRadius} mm) · ⌀ interior ${parsed.report.frame.innerDiameter} mm (Ri ${parsed.report.frame.innerRadius} mm).`}
                  </p>
                  <ul className="lab-clearances" data-testid="lab-clearances">
                    {parsed.report.clearances.map((entry) => (
                      <li key={entry.elementId}>
                        {entry.envelopeMm === null
                          ? `${entry.elementId}: tinta sin medir, distancias desconocidas (avance ≠ tinta).`
                          : `${entry.elementId}: exterior ${entry.outerSignedMm?.toFixed(2)} mm · interior ${entry.innerSignedMm?.toFixed(2)} mm (holguras firmadas de envolvente conservadora).`}
                      </li>
                    ))}
                  </ul>
                  {parsed.report.pairClearances.length > 0 && (
                    <ul className="lab-pairs" data-testid="lab-pairs">
                      {parsed.report.pairClearances.map((pair) => (
                        <li key={`${pair.firstId}-${pair.secondId}`}>
                          {`${pair.firstId} ↔ ${pair.secondId}: centros ${pair.centerDistanceMm.toFixed(2)} mm, cota inferior ${pair.pairClearanceMm.toFixed(2)} mm.`}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ul className="lab-warnings" data-testid="lab-warnings">
                    {parsed.report.warnings.map((warning, index) => (
                      <li
                        key={`${warning.kind}-${index}`}
                        data-kind={warning.kind}
                      >
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                  {parsed.json !== null && (
                    <details data-testid="lab-report-details">
                      <summary>Reporte JSON puro (reproducibilidad)</summary>
                      <pre data-testid="lab-report-json">{parsed.json}</pre>
                    </details>
                  )}
                  {parsed.serializeError !== null && (
                    <p data-testid="lab-serialize-error" role="alert">
                      {`No se pudo serializar el reporte JSON (valores no finitos): ${parsed.serializeError}. La geometría mostrada arriba no se ve afectada.`}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
          <SourceAdvanceMeasurer
            key={measureKey}
            texts={sourceTexts}
            measureKey={measureKey}
            onAdvances={handleAdvances}
          />
        </>
      )}
    </main>
  );
}
