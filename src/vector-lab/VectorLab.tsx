import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeBackground } from "../vectorization/backgroundAnalysis";
import { selectBestCandidates } from "../vectorization/candidateSelection";
import { loadImageFile } from "../vectorization/imageLoader";
import { generateMaskCandidates } from "../vectorization/masks";
import {
  DEFAULT_MAX_DIMENSION,
  normalizeRaster,
} from "../vectorization/normalize";
import type {
  BinaryMask,
  LoadedImage,
  MaskCandidate,
} from "../vectorization/types";
import {
  vectorizeMask,
  type VectorizedResult,
} from "../vectorization/vectorize/vectorizeMask";
import SvgImportLab from "./SvgImportLab";
import "../styles/vector-lab.css";

function MaskCanvas({
  mask,
  transparent = false,
  label,
}: {
  mask: BinaryMask;
  transparent?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    const pixels = new Uint8ClampedArray(mask.data.length * 4);
    for (let index = 0; index < mask.data.length; index += 1) {
      const black = mask.data[index] === 1;
      const offset = index * 4;
      pixels[offset] = black ? 0 : 255;
      pixels[offset + 1] = black ? 0 : 255;
      pixels[offset + 2] = black ? 0 : 255;
      pixels[offset + 3] = black || !transparent ? 255 : 0;
    }
    context.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
  }, [mask, transparent]);
  return (
    <canvas
      ref={ref}
      className={`vector-canvas${transparent ? " engraving-preview" : ""}`}
      role="img"
      aria-label={label}
    />
  );
}

function Metrics({ candidate }: { candidate: MaskCandidate }) {
  const { metrics } = candidate;
  return (
    <div
      className="vector-metrics"
      aria-label={`Métricas de ${candidate.label}`}
    >
      <dl>
        <div>
          <dt>Píxeles negros</dt>
          <dd>{metrics.blackPercentage.toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Componentes</dt>
          <dd>{metrics.componentCount}</dd>
        </div>
        <div>
          <dt>Componentes pequeños</dt>
          <dd>{metrics.smallComponentCount}</dd>
        </div>
        <div>
          <dt>Masa principal</dt>
          <dd>{metrics.largestComponentPercentage.toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Borde negro</dt>
          <dd>{metrics.borderCoveragePercentage.toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{candidate.score.value}/100</dd>
        </div>
      </dl>
      <p className="candidate-diagnosis">{candidate.score.summary}</p>
      {metrics.suspicious ? (
        <ul className="candidate-warnings">
          {metrics.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : (
        <p className="candidate-ok">Sin alertas automáticas.</p>
      )}
    </div>
  );
}

export default function VectorLab() {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [normalized, setNormalized] = useState<ReturnType<
    typeof normalizeRaster
  > | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<
    MaskCandidate["strategy"] | null
  >(null);
  const [committedStrategy, setCommittedStrategy] = useState<
    MaskCandidate["strategy"] | null
  >(null);
  const [vectorResult, setVectorResult] = useState<VectorizedResult | null>(
    null,
  );
  const [vectorStatus, setVectorStatus] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [vectorError, setVectorError] = useState("");
  const vectorRequest = useRef(0);
  const analysis = useMemo(
    () => (normalized ? analyzeBackground(normalized) : null),
    [normalized],
  );
  const candidates = useMemo(
    () =>
      normalized && analysis
        ? generateMaskCandidates(normalized, analysis)
        : [],
    [normalized, analysis],
  );
  const clientOptions = useMemo(
    () => selectBestCandidates(candidates),
    [candidates],
  );
  const selectedOption =
    clientOptions.find(
      (option) => option.candidate.strategy === selectedStrategy,
    ) ?? null;
  const committedOption =
    clientOptions.find(
      (option) => option.candidate.strategy === committedStrategy,
    ) ?? null;

  useEffect(() => {
    vectorRequest.current += 1;
    setSelectedStrategy(clientOptions[0]?.candidate.strategy ?? null);
    setCommittedStrategy(null);
    setVectorResult(null);
    setVectorStatus("idle");
    setVectorError("");
  }, [clientOptions]);

  const selectStrategy = (strategy: MaskCandidate["strategy"]) => {
    vectorRequest.current += 1;
    setSelectedStrategy(strategy);
    setCommittedStrategy(null);
    setVectorResult(null);
    setVectorStatus("idle");
    setVectorError("");
  };

  const vectorizeSelected = async () => {
    if (!selectedOption || vectorStatus === "processing") return;
    const request = ++vectorRequest.current;
    setVectorStatus("processing");
    setVectorError("");
    setVectorResult(null);
    try {
      const result = await vectorizeMask(selectedOption.candidate.mask);
      if (request !== vectorRequest.current) return;
      setVectorResult(result);
      setVectorStatus("success");
    } catch (reason) {
      if (request !== vectorRequest.current) return;
      setVectorStatus("error");
      setVectorError(
        reason instanceof Error
          ? reason.message
          : "No se pudo vectorizar la máscara seleccionada.",
      );
    }
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    vectorRequest.current += 1;
    setProcessing(true);
    setError("");
    setSelectedStrategy(null);
    setCommittedStrategy(null);
    setVectorResult(null);
    setVectorStatus("idle");
    setVectorError("");
    try {
      const image = await loadImageFile(file);
      setLoaded(image);
      setNormalized(normalizeRaster(image.raster));
    } catch (reason) {
      setLoaded(null);
      setNormalized(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudo procesar la imagen.",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <main className="vector-lab">
      <header className="vector-lab-header">
        <div>
          <p className="vector-lab-eyebrow">MATE&CO · DESARROLLO</p>
          <h1>Laboratorio de máscaras para grabado</h1>
          <p>
            Compará estrategias de separación antes de integrar una
            vectorización real.
          </p>
        </div>
        <a href="/">Volver al editor</a>
      </header>

      <section className="vector-upload" aria-labelledby="vector-upload-title">
        <div>
          <h2 id="vector-upload-title">Imagen de prueba</h2>
          <p>
            El archivo se procesa localmente. No se envía a ningún servidor.
          </p>
        </div>
        <label className="vector-file-button">
          <span>
            {processing ? "Procesando…" : "Seleccionar PNG, JPG o WebP"}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="vector-lab-raster-input"
            disabled={processing}
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
        </label>
        {error && (
          <p className="vector-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <SvgImportLab />

      {!loaded || !normalized ? (
        <section className="vector-empty">
          <h2>Casos preparados para explorar</h2>
          <p>
            Logos transparentes, gráficos claros u oscuros, firmas, escudos,
            dibujos y fondos de color.
          </p>
        </section>
      ) : (
        <>
          <section
            className="source-summary"
            aria-labelledby="source-summary-title"
          >
            <div className="source-preview">
              <img
                src={loaded.originalDataUrl}
                alt={`Original: ${loaded.name}`}
              />
            </div>
            <div>
              <p className="vector-lab-eyebrow">ORIGINAL</p>
              <h2 id="source-summary-title">{loaded.name}</h2>
              <dl>
                <div>
                  <dt>Dimensiones</dt>
                  <dd>
                    {loaded.originalWidth} × {loaded.originalHeight} px
                  </dd>
                </div>
                <div>
                  <dt>Transparencia</dt>
                  <dd>
                    {loaded.hasTransparency ? "Detectada" : "No detectada"}
                  </dd>
                </div>
                <div>
                  <dt>Área de trabajo</dt>
                  <dd>
                    {normalized.width} × {normalized.height} px
                  </dd>
                </div>
                <div>
                  <dt>Límite de normalización</dt>
                  <dd>{DEFAULT_MAX_DIMENSION} px</dd>
                </div>
              </dl>
            </div>
          </section>

          {analysis && (
            <section
              className="background-analysis"
              aria-labelledby="background-analysis-title"
            >
              <div className="analysis-heading">
                <div>
                  <p className="vector-lab-eyebrow">ANÁLISIS</p>
                  <h2 id="background-analysis-title">
                    Lectura automática del fondo
                  </h2>
                </div>
                <span
                  className={`analysis-confidence${analysis.complexBackground ? " low" : ""}`}
                >
                  {analysis.confidence.toFixed(0)}% de confianza
                </span>
              </div>
              <dl>
                <div>
                  <dt>Alpha útil</dt>
                  <dd>{analysis.hasUsefulAlpha ? "Sí" : "No"}</dd>
                </div>
                <div>
                  <dt>Fondo estimado</dt>
                  <dd>
                    <span
                      className="background-swatch"
                      style={{
                        backgroundColor: `rgb(${analysis.color.red}, ${analysis.color.green}, ${analysis.color.blue})`,
                      }}
                    />
                    rgb({Math.round(analysis.color.red)},{" "}
                    {Math.round(analysis.color.green)},{" "}
                    {Math.round(analysis.color.blue)})
                  </dd>
                </div>
                <div>
                  <dt>Polaridad del fondo</dt>
                  <dd>{analysis.backgroundTone}</dd>
                </div>
                <div>
                  <dt>Luminancia media del borde</dt>
                  <dd>{analysis.borderMeanLuminance.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Variación del borde</dt>
                  <dd>{analysis.borderLuminanceVariation.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>Uniformidad aproximada</dt>
                  <dd>{analysis.borderUniformityPercentage.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Borde conectado compatible</dt>
                  <dd>{analysis.connectedBorderPercentage.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Separación cromática</dt>
                  <dd>
                    {analysis.hasChromaticSeparation ? "Detectada" : "Débil"} ·{" "}
                    {analysis.contentColorSeparation.toFixed(1)}
                  </dd>
                </div>
              </dl>
              {analysis.complexBackground && (
                <p className="analysis-warning">
                  Fondo complejo / baja confianza. La candidata fotográfica se
                  conserva sin forzar una segmentación agresiva.
                </p>
              )}
            </section>
          )}

          <section
            className="client-results"
            aria-labelledby="client-results-title"
          >
            <div className="client-results-heading">
              <div>
                <p className="vector-lab-eyebrow">VISTA DEL CLIENTE</p>
                <h2 id="client-results-title">Resultado para grabado</h2>
              </div>
              <p>Así se interpretará tu imagen para el grabado.</p>
            </div>
            {clientOptions.length ? (
              <>
                <div
                  className={`client-option-list option-count-${clientOptions.length}`}
                >
                  {clientOptions.map((option) => {
                    const selected =
                      option.candidate.strategy === selectedStrategy;
                    return (
                      <button
                        key={option.candidate.strategy}
                        type="button"
                        className={`client-option${selected ? " selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() =>
                          selectStrategy(option.candidate.strategy)
                        }
                      >
                        <span>
                          {option.label}
                          {selected ? " ✓" : ""}
                        </span>
                        <div className="client-option-preview">
                          <MaskCanvas
                            mask={option.candidate.mask}
                            label={`Resultado para grabado: ${option.label}`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="client-result-action">
                  <button
                    type="button"
                    disabled={!selectedOption}
                    onClick={() =>
                      setCommittedStrategy(
                        selectedOption?.candidate.strategy ?? null,
                      )
                    }
                  >
                    Usar este resultado
                  </button>
                  {committedOption && (
                    <p role="status">
                      Resultado seleccionado: {committedOption.label}. La
                      máscara binaria quedó preparada para la siguiente etapa.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="client-no-result">
                No se encontró todavía una máscara suficientemente confiable
                para presentar.
              </p>
            )}
          </section>

          <section
            className="vector-result"
            aria-labelledby="vector-result-title"
          >
            <div className="vector-result-heading">
              <div>
                <p className="vector-lab-eyebrow">TRAZADO SVG</p>
                <h2 id="vector-result-title">Resultado vectorial</h2>
              </div>
              <p>
                Convierte directamente la máscara elegida en paths SVG reales.
              </p>
            </div>
            <div className="vector-result-action">
              <button
                type="button"
                disabled={!selectedOption || vectorStatus === "processing"}
                onClick={() => void vectorizeSelected()}
              >
                {vectorStatus === "processing"
                  ? "Vectorizando…"
                  : "Vectorizar resultado seleccionado"}
              </button>
              <p role="status" aria-live="polite">
                {vectorStatus === "idle" && "Pendiente de vectorización."}
                {vectorStatus === "processing" &&
                  "Procesando la máscara seleccionada en el navegador…"}
                {vectorStatus === "success" && "Vectorización completada."}
                {vectorStatus === "error" &&
                  "La vectorización no pudo completarse."}
              </p>
            </div>
            {vectorError && (
              <p className="vector-error" role="alert">
                {vectorError}
              </p>
            )}
            {selectedOption && vectorResult && (
              <>
                <div className="vector-comparison">
                  <figure>
                    <div className="vector-result-preview">
                      <MaskCanvas
                        mask={selectedOption.candidate.mask}
                        label="Máscara raster seleccionada"
                      />
                    </div>
                    <figcaption>Máscara seleccionada</figcaption>
                  </figure>
                  <figure>
                    <div className="vector-result-preview checkerboard">
                      <svg
                        viewBox={vectorResult.viewBox}
                        role="img"
                        aria-label="Preview del resultado vectorial"
                      >
                        {vectorResult.paths.map((path, index) => (
                          <path
                            key={`${index}-${path.d.slice(0, 20)}`}
                            d={path.d}
                            transform={path.transform}
                            fill={path.fill}
                            fillRule={path.fillRule}
                            clipRule="evenodd"
                          />
                        ))}
                      </svg>
                    </div>
                    <figcaption>Vector SVG</figcaption>
                  </figure>
                </div>
                <dl className="vector-diagnostics">
                  <div>
                    <dt>Paths</dt>
                    <dd>{vectorResult.pathCount}</dd>
                  </div>
                  <div>
                    <dt>Dimensiones</dt>
                    <dd>
                      {vectorResult.width} × {vectorResult.height}
                    </dd>
                  </div>
                  <div>
                    <dt>ViewBox</dt>
                    <dd>{vectorResult.viewBox}</dd>
                  </div>
                  <div>
                    <dt>Longitud total de d</dt>
                    <dd>
                      {vectorResult.diagnostics.totalPathDataLength.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Comandos</dt>
                    <dd>
                      {vectorResult.diagnostics.commandCount.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Tamaño SVG</dt>
                    <dd>
                      {vectorResult.diagnostics.svgSizeBytes.toLocaleString()}{" "}
                      bytes
                    </dd>
                  </div>
                  <div>
                    <dt>Tiempo</dt>
                    <dd>
                      {vectorResult.diagnostics.elapsedMilliseconds.toFixed(1)}{" "}
                      ms
                    </dd>
                  </div>
                </dl>
                {vectorResult.diagnostics.warnings.length ? (
                  <ul className="candidate-warnings vector-warnings">
                    {vectorResult.diagnostics.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="candidate-ok vector-warnings">
                    Sin alertas de complejidad.
                  </p>
                )}
              </>
            )}
          </section>

          <section
            className="candidate-section"
            aria-labelledby="candidate-title"
          >
            <div className="candidate-heading">
              <div>
                <p className="vector-lab-eyebrow">
                  DIAGNÓSTICO DEL LABORATORIO
                </p>
                <h2 id="candidate-title">Ocho interpretaciones binarias</h2>
              </div>
              <p>
                Negro representa grabado; blanco o transparente representa
                material sin grabar.
              </p>
            </div>
            <div className="candidate-list">
              {candidates.map((candidate) => {
                const isRecommended =
                  candidate.strategy === clientOptions[0]?.candidate.strategy;
                const isPhotoComparison =
                  candidate.strategy === "photo-engraving" ||
                  candidate.strategy === "illustration-stencil";
                return (
                  <article
                    key={candidate.strategy}
                    className={`candidate-card${candidate.metrics.suspicious ? " suspicious" : ""}${isRecommended ? " recommended" : ""}${isPhotoComparison ? " photo-comparison" : ""}`}
                  >
                    <header>
                      <div>
                        <h3>{candidate.label}</h3>
                        <p>{candidate.description}</p>
                      </div>
                      <span>
                        {isRecommended
                          ? "Recomendada por métricas"
                          : candidate.metrics.suspicious
                            ? "Revisar"
                            : "Candidata viable"}
                      </span>
                    </header>
                    <div className="candidate-previews">
                      <figure>
                        <div className="candidate-image">
                          <img src={loaded.originalDataUrl} alt="" />
                        </div>
                        <figcaption>Original</figcaption>
                      </figure>
                      <figure>
                        <div className="candidate-image">
                          <MaskCanvas
                            mask={candidate.mask}
                            label={`Máscara blanco y negro: ${candidate.label}`}
                          />
                        </div>
                        <figcaption>Máscara B/N</figcaption>
                      </figure>
                      <figure>
                        <div className="candidate-image checkerboard">
                          <MaskCanvas
                            mask={candidate.mask}
                            transparent
                            label={`Preview de grabado: ${candidate.label}`}
                          />
                        </div>
                        <figcaption>Preview de grabado</figcaption>
                      </figure>
                    </div>
                    <Metrics candidate={candidate} />
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
