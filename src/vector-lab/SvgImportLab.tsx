/**
 * Sección aislada del laboratorio: importación directa de SVG.
 *
 * NO integra con el editor principal: parsea con `parseSvgImport`, muestra
 * Original (preview sanitizado en <img>) vs Normalizado (nuestra geometría
 * en negro) más diagnóstico técnico. Sin innerHTML en ningún punto.
 */
import { useEffect, useState } from 'react';
import { buildOriginalPreviewUrl, parseSvgImport, revokePreviewUrl, SVG_IMPORT_LIMITS } from '../svg-import';
import type { SvgImportError, SvgImportResult } from '../svg-import';

type ImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string }
  | { status: 'success'; fileName: string; result: SvgImportResult; originalUrl: string }
  | { status: 'error'; fileName: string; error: SvgImportError };

/** FNV-1a sobre d+transform: detecta cualquier cambio en la representación. */
function digestPaths(paths: Array<{ d: string; transform?: string }>): string {
  let hash = 0x811c9dc5;
  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const path of paths) {
    feed(path.d);
    feed('|');
    if (path.transform) feed(path.transform);
    feed(';');
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function formatBox(box: { x: number; y: number; width: number; height: number }): string {
  const rounded = (value: number) => Math.round(value * 100) / 100;
  return `x ${rounded(box.x)} · y ${rounded(box.y)} · ${rounded(box.width)} × ${rounded(box.height)}`;
}

export default function SvgImportLab() {
  const [state, setState] = useState<ImportState>({ status: 'idle' });

  useEffect(() => {
    if (state.status === 'success') {
      const url = state.originalUrl;
      return () => revokePreviewUrl(url);
    }
    return undefined;
  }, [state]);

  const chooseFile = async (file?: File | null) => {
    if (!file) return;
    if (state.status === 'success') revokePreviewUrl(state.originalUrl);
    const fileName = file.name;
    setState({ status: 'parsing', fileName });
    try {
      const text = await file.text();
      const outcome = parseSvgImport(text);
      if (!outcome.ok) {
        setState({ status: 'error', fileName, error: outcome.error });
        return;
      }
      const originalUrl = buildOriginalPreviewUrl(text);
      setState({ status: 'success', fileName, result: outcome.result, originalUrl });
    } catch (reason) {
      setState({
        status: 'error',
        fileName,
        error: { code: 'MALFORMED', message: reason instanceof Error ? reason.message : 'No se pudo leer el archivo.' },
      });
    }
  };

  const result = state.status === 'success' ? state.result : null;
  const error = state.status === 'error' ? state.error : null;
  const viewBox = result ? `${result.viewBox.x} ${result.viewBox.y} ${result.viewBox.width} ${result.viewBox.height}` : '';

  return <section className="vector-upload svg-import" aria-labelledby="svg-import-title" data-testid="svg-import-section">
    <div className="svg-import-heading">
      <div>
        <p className="vector-lab-eyebrow">LABORATORIO · IMPORTACIÓN DIRECTA</p>
        <h2 id="svg-import-title">Importar SVG</h2>
        <p>
          Prueba aislada: el SVG se parsea como geometría vectorial directa, sin raster,
          sin máscaras y sin VTracer. Límite: {(SVG_IMPORT_LIMITS.MAX_FILE_CHARS / 1_000_000).toFixed(0)} MB,{' '}
          {SVG_IMPORT_LIMITS.MAX_PATHS.toLocaleString()} geometrías, profundidad {SVG_IMPORT_LIMITS.MAX_GROUP_DEPTH}.
        </p>
      </div>
      <label className="vector-file-button">
        <span>{state.status === 'parsing' ? 'Parseando…' : 'Seleccionar SVG'}</span>
        <input
          type="file"
          accept=".svg,image/svg+xml"
          data-testid="svg-import-input"
          onChange={event => {
            void chooseFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
    </div>

    {state.status === 'parsing' && <p role="status">Parseando {state.fileName}…</p>}

    {error && (
      <div className="svg-import-rejected" data-testid="svg-import-error" role="alert">
        <h3>SVG no compatible</h3>
        <p><strong>{state.status === 'error' ? state.fileName : ''}:</strong> {error.message}</p>
        <p className="svg-import-code">Código: {error.code}</p>
      </div>
    )}

    {result && state.status === 'success' && (
      <div data-testid="svg-import-success">
        <p className="svg-import-filename" data-testid="svg-import-status" role="status">
          {state.fileName}: {result.pathCount.toLocaleString()} paths importados como geometría directa (sin VTracer).
        </p>
        <div className="vector-comparison">
          <figure>
            <div className="vector-result-preview checkerboard">
              <img src={state.originalUrl} alt={`Original sanitizado: ${state.fileName}`} data-testid="svg-import-original" />
            </div>
            <figcaption>Original (render seguro)</figcaption>
          </figure>
          <figure>
            <div className="vector-result-preview checkerboard" data-testid="svg-import-normalized-wrap">
              <svg viewBox={viewBox} role="img" aria-label={`Normalizado: ${state.fileName}`} data-testid="svg-import-normalized">
                <g fill="#171717" fillRule="evenodd">
                  {result.paths.map((path, index) => (
                    <path key={index} d={path.d} transform={path.transform} />
                  ))}
                </g>
              </svg>
            </div>
            <figcaption>Normalizado (geometría del sistema)</figcaption>
          </figure>
        </div>

        <dl className="vector-diagnostics" data-testid="svg-import-diagnostics">
          <div><dt>Dimensiones</dt><dd>{result.widthPx} × {result.heightPx}</dd></div>
          <div><dt>ViewBox</dt><dd>{viewBox}</dd></div>
          <div><dt>Paths</dt><dd data-testid="svg-import-path-count">{result.pathCount}</dd></div>
          <div><dt>Primitivas</dt><dd>{Object.entries(result.diagnostics.primitiveCounts).filter(([, count]) => count > 0).map(([kind, count]) => `${kind}:${count}`).join(' · ')}</dd></div>
          <div><dt>Transforms</dt><dd>{result.diagnostics.transformsUsed.length > 0 ? result.diagnostics.transformsUsed.join(', ') : 'ninguno'} ({result.diagnostics.transformedElementCount} elementos)</dd></div>
          <div><dt>Fills originales</dt><dd>{result.diagnostics.fills.join(', ') || '—'}</dd></div>
          <div><dt>Strokes originales</dt><dd>{result.diagnostics.strokes.join(', ') || '—'}</dd></div>
          <div><dt>Fill-rules</dt><dd>{result.diagnostics.fillRules.join(', ') || '—'}</dd></div>
          <div><dt>Raster / texto / externo</dt><dd>no / no / no</dd></div>
          <div><dt>Validación</dt><dd data-testid="svg-import-validation">OK · geometría vectorial pura</dd></div>
          <div><dt>Bounding box normalizado</dt><dd data-testid="svg-import-bbox">{formatBox(result.normalizedBoundingBox)}</dd></div>
          <div><dt>Omitidos / avisos</dt><dd>{result.diagnostics.warnings.length > 0 ? result.diagnostics.warnings.join(' ') : 'ninguno'}</dd></div>
        </dl>
        <details className="svg-import-json">
          <summary>Representación normalizada (JSON técnico)</summary>
          <pre data-testid="svg-import-diagnostics-json">
            {JSON.stringify({ viewBox: result.viewBox, pathCount: result.pathCount, digest: digestPaths(result.paths), bbox: result.normalizedBoundingBox, diagnostics: result.diagnostics, sample: result.paths.slice(0, 3) }, null, 2)}
          </pre>
        </details>
      </div>
    )}
  </section>;
}
