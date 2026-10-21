export type CustomizerView = 'diseno' | 'confirmar';

export default function StepNavigation({ view, onNavigate }: { view: CustomizerView; onNavigate: (view: CustomizerView) => void }) {
  return (
    <nav className="steps" aria-label="Pasos del personalizador">
      <button type="button" className={`step${view === 'diseno' ? ' active' : ''}`} aria-current={view === 'diseno' ? 'step' : undefined} onClick={() => onNavigate('diseno')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h9l5 5v15H5zM14 2v6h5M9 12h6M9 16h6M9 7h1" /></svg>
        Diseño
      </button>
      <button type="button" className={`step${view === 'confirmar' ? ' active' : ''}`} aria-current={view === 'confirmar' ? 'step' : undefined} onClick={() => onNavigate('confirmar')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></svg>
        Confirmar
      </button>
    </nav>
  );
}
