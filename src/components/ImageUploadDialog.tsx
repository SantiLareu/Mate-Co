import { useEffect, useRef, useState } from 'react';
import { analyzeBackground } from '../vectorization/backgroundAnalysis';
import { selectBestCandidates } from '../vectorization/candidateSelection';
import { loadImageFile } from '../vectorization/imageLoader';
import { generateMaskCandidates } from '../vectorization/masks';
import { normalizeRaster } from '../vectorization/normalize';
import type { BinaryMask, MaskCandidate } from '../vectorization/types';
import { vectorizeMask, type VectorizedResult } from '../vectorization/vectorize/vectorizeMask';
import '../styles/vector-lab.css';
import '../styles/upload-dialog.css';

export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp';
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Phase = 'idle' | 'preparing' | 'results' | 'vectorizing';

function MaskPreview({ mask, label }: { mask: BinaryMask; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
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
      pixels[offset + 3] = 255;
    }
    context.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
  }, [mask]);
  return <canvas ref={ref} className="upload-result-preview" role="img" aria-label={label} />;
}

type Props = { open: boolean; onClose: () => void; onConfirm: (result: VectorizedResult) => void };

export default function ImageUploadDialog({ open, onClose, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [options, setOptions] = useState<ReturnType<typeof selectBestCandidates>>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<MaskCandidate['strategy'] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    request.current += 1;
    setPhase('idle');
    setOptions([]);
    setSelectedStrategy(null);
    setError('');
    dialog.current?.showModal();
  }, [open ]);

  const selectedOption = options.find(option => option.candidate.strategy === selectedStrategy) ?? null;

  const chooseFile = async (file?: File) => {
    if (!file || phase === 'preparing' || phase === 'vectorizing') return;
    const current = ++request.current;
    setPhase('preparing');
    setError('');
    setOptions([]);
    setSelectedStrategy(null);
    try {
      if (!SUPPORTED_TYPES.includes(file.type)) throw new Error('unsupported');
      const image = await loadImageFile(file);
      // Let the preparing state paint before the synchronous candidate pass.
      await new Promise(resolve => setTimeout(resolve, 30));
      if (current !== request.current) return;
      const normalized = normalizeRaster(image.raster);
      const candidates = generateMaskCandidates(normalized, analyzeBackground(normalized));
      const best = selectBestCandidates(candidates);
      if (current !== request.current) return;
      if (!best.length) throw new Error('empty');
      setOptions(best);
      setSelectedStrategy(best[0].candidate.strategy);
      setPhase('results');
    } catch {
      if (current !== request.current) return;
      setPhase('idle');
      setError('No pudimos preparar esta imagen. Probá con otra.');
    }
  };

  const useResult = async () => {
    if (!selectedOption || phase === 'vectorizing') return;
    const current = ++request.current;
    setPhase('vectorizing');
    setError('');
    try {
      const result = await vectorizeMask(selectedOption.candidate.mask);
      if (current !== request.current) return;
      onConfirm(result);
    } catch {
      if (current !== request.current) return;
      setPhase('results');
      setError('No pudimos vectorizar el resultado.');
    }
  };

  return <dialog ref={dialog} className="icon-drawer upload-dialog" aria-labelledby="upload-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="drawer-header">
      <h2 id="upload-dialog-title">Subir imagen</h2>
      <button type="button" className="drawer-close" aria-label="Cerrar subida de imagen" onClick={onClose}>×</button>
    </header>
    {phase === 'preparing' && <p role="status">Preparando tu diseño…</p>}
    {phase === 'vectorizing' && <p role="status">Preparando imagen para usar…</p>}
    {error && <p className="vector-error" role="alert">{error}</p>}
    {phase === 'idle' && <>
      <label className="vector-file-button upload-file-button">
        <span>Seleccionar PNG, JPG o WebP</span>
        <input type="file" accept={UPLOAD_ACCEPT} onChange={event => void chooseFile(event.target.files?.[0])} />
      </label>
    </>}
    {phase === 'results' && <>
      <p className="upload-intro">Elegí el resultado que más te guste</p>
      <div className={`client-option-list option-count-${options.length}`}>
        {options.map(option => {
          const selected = option.candidate.strategy === selectedStrategy;
          return <button
            key={option.candidate.strategy}
            type="button"
            className={`client-option${selected ? ' selected' : ''}`}
            aria-pressed={selected}
            onClick={() => setSelectedStrategy(option.candidate.strategy)}
          >
            <div className="client-option-preview"><MaskPreview mask={option.candidate.mask} label={`Resultado para grabado: ${option.label}`} /></div>
            <span>{option.label}{selected ? ' ✓' : ''}</span>
          </button>;
        })}
      </div>
      <div className="client-result-action">
        <button type="button" disabled={!selectedOption} onClick={() => void useResult()}>Usar este resultado</button>
        <label className="upload-secondary">
          <span>Probar con otra imagen</span>
          <input type="file" accept={UPLOAD_ACCEPT} onChange={event => void chooseFile(event.target.files?.[0])} />
        </label>
      </div>
    </>}
  </dialog>;
}
