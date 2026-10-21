import { useState } from "react";
import type { CircularLines } from "../App";
import {
  downloadProductionSvg,
  buildProductionSvg,
  EXPORT_FILENAME,
} from "../export/productionSvg";
import type { TextElement } from "./CurvedText";
import type { DesignIcon } from "./IconElement";
import type { UploadedGraphicElement } from "./UploadedGraphic";
import type { ApprovedDesignInstance } from "../approved-designs/approvedDesign";

export function designSummary(
  texts: TextElement[],
  icons: DesignIcon[],
  graphics: UploadedGraphicElement[],
  approved: ApprovedDesignInstance[] = [],
) {
  // The Diseños row exists only while approved instances do: the legacy
  // three-row contract stays byte-identical otherwise.
  return [
    { key: "texts", label: "Textos", count: texts.length },
    { key: "icons", label: "Íconos", count: icons.length },
    { key: "graphics", label: "Imágenes", count: graphics.length },
    ...(approved.length > 0
      ? [{ key: "designs", label: "Diseños", count: approved.length }]
      : []),
  ];
}

type Props = {
  texts: TextElement[];
  icons: DesignIcon[];
  graphics: UploadedGraphicElement[];
  approved: ApprovedDesignInstance[];
  circularLines: CircularLines;
  confirmed: boolean;
  onBack: () => void;
  onConfirm: () => void;
  /**
   * J2 durable-confirmation state (Stage 2, S2/S3). Optional so the
   * panel stays presentational: App owns the coordinator + repository.
   * `confirmed` flips ONLY on a durable write; every failure
   * (storage, quota, blocked, CONFLICT) is retryable with the same
   * attempt via onRetry — CONFLICT is repository state, never
   * user-blaming input.
   */
  confirmPhase?: "idle" | "working" | "done" | "error";
  confirmJob?: {
    id: string;
    attemptKey: string;
    status: string;
    createdAt: string;
  } | null;
  confirmError?: { code: string; message: string } | null;
  onRetry?: () => void;
};

export default function ConfirmPanel({
  texts,
  icons,
  graphics,
  approved,
  circularLines,
  confirmed,
  onBack,
  onConfirm,
  confirmPhase = "idle",
  confirmJob = null,
  confirmError = null,
  onRetry,
}: Props) {
  const summary = designSummary(texts, icons, graphics, approved);
  const empty = summary.every((entry) => entry.count === 0);
  // Integrar hasta Confirmar; bloquear esa exportación: los diseños
  // aprobados viajan con el estado pero el exportador original no los
  // serializa, así que la exportación se deshabilita con mensaje claro
  // SOLO cuando hay instancias aprobadas. Sin ellas, todo sigue igual.
  const exportBlocked = approved.length > 0;
  const [exportPhase, setExportPhase] = useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [exportError, setExportError] = useState("");

  const exportSvg = async () => {
    if (exportBlocked || exportPhase === "working") return;
    setExportPhase("working");
    setExportError("");
    try {
      const svg = await buildProductionSvg({
        texts,
        icons,
        graphics,
        circularLines,
      });
      downloadProductionSvg(svg);
      setExportPhase("done");
    } catch (reason) {
      setExportPhase("error");
      setExportError(
        reason instanceof Error ? reason.message : "No se pudo generar el SVG.",
      );
    }
  };
  return (
    <section
      className="templates confirm-panel"
      aria-labelledby="confirm-title"
    >
      <p className="eyebrow">CONFIRMAR</p>
      <h1 id="confirm-title">Tu diseño</h1>
      <p className="subtitle">
        Revisá que tu diseño esté como querés antes de continuar.
      </p>

      <div className="design-sections">
        <section
          className="design-section"
          aria-labelledby="confirm-summary-title"
        >
          <h2 id="confirm-summary-title">Contenido</h2>
          {empty ? (
            <p>
              Todavía no agregaste elementos. Volvé a editar para personalizar
              tu mate.
            </p>
          ) : (
            <ul className="confirm-summary">
              {summary
                .filter((entry) => entry.count > 0)
                .map((entry) => (
                  <li key={entry.key}>
                    {entry.label}: {entry.count}
                  </li>
                ))}
            </ul>
          )}
        </section>
        {confirmed && !empty && (
          <p role="status" data-testid="confirm-job">
            ¡Diseño confirmado! Te avisaremos cuando puedas continuar con tu
            pedido.
            {confirmJob != null && (
              <>
                {" "}
                Trabajo {confirmJob.id} · estado {confirmJob.status}.
              </>
            )}
          </p>
        )}
        {confirmPhase === "working" && !empty && !confirmed && (
          <p role="status" data-testid="confirm-working">
            Guardando tu diseño… El botón queda fijo mientras se guarda para
            evitar toques accidentales.
          </p>
        )}
        {confirmPhase === "error" &&
          confirmError != null &&
          !empty &&
          !confirmed && (
            <div className="confirm-error-block">
              <p role="alert" data-testid="confirm-error">
                {confirmError.message}
              </p>
              {onRetry != null && (
                <button
                  type="button"
                  data-testid="confirm-retry"
                  className="template-option continue confirm-retry"
                  onClick={onRetry}
                >
                  Reintentar
                </button>
              )}
            </div>
          )}
        <div className="confirm-actions">
          <button
            type="button"
            className="template-option back-to-edit"
            disabled={confirmPhase === "working"}
            onClick={onBack}
          >
            Volver a editar
          </button>
          {!empty && !confirmed && (
            <button
              type="button"
              className="template-option continue confirm-design"
              disabled={confirmPhase === "working"}
              onClick={onConfirm}
            >
              Confirmar diseño
            </button>
          )}
        </div>
        {!empty && (
          <div className="confirm-actions export-actions">
            <button
              type="button"
              className="template-option export-svg"
              disabled={exportPhase === "working" || exportBlocked}
              onClick={() => void exportSvg()}
            >
              {exportPhase === "working"
                ? "Generando SVG…"
                : "Exportar SVG de producción"}
            </button>
            {exportBlocked && (
              <p role="note">
                La exportación está bloqueada mientras haya diseños aprobados en
                el mate: el SVG de producción todavía no los incluye. Quitá los
                diseños aprobados para exportar.
              </p>
            )}
            {exportPhase === "done" && (
              <p role="status">
                SVG descargado: {EXPORT_FILENAME}. Abrilo fuera de la app para
                verificarlo.
              </p>
            )}
            {exportPhase === "error" && <p role="alert">{exportError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
