type Props = { step: 'templates' | 'design'; canEdit: boolean; onNavigate: (step: 'templates' | 'design') => void };

export default function StepNavigation({ step, canEdit, onNavigate }: Props) {
  return (
    <nav className="steps" aria-label="Pasos del personalizador">
      <button type="button" className={`step${step === 'templates' ? ' active' : ''}`} aria-current={step === 'templates' ? 'step' : undefined} onClick={() => onNavigate('templates')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3 2.3 6.7L19 12l-6.7 2.3L10 21l-2.3-6.7L1 12l6.7-2.3L10 3ZM19 2v6M16 5h6M20 17v4M18 19h4" /></svg>
        Plantillas
      </button>
      <button type="button" className={`step${step === 'design' ? ' active' : ''}`} aria-current={step === 'design' ? 'step' : undefined} aria-disabled={!canEdit} onClick={() => { if (canEdit) onNavigate('design'); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h9l5 5v15H5zM14 2v6h5M9 12h6M9 16h6M9 7h1" /></svg>
        Diseño
      </button>
      <button type="button" className="step" aria-disabled="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></svg>
        Confirmar
      </button>
    </nav>
  );
}
