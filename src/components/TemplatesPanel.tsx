import type { Template } from '../App';

type Props = { selected: Template | null; onSelect: (template: Template | null) => void; onStart: () => void; onContinue: () => void };

export default function TemplatesPanel({ selected, onSelect, onStart, onContinue }: Props) {
  return (
    <section className="templates" aria-labelledby="templates-title">
      <p className="eyebrow">PLANTILLAS</p>
      <h1 id="templates-title">Elegí una plantilla</h1>
      <p className="subtitle">Seleccioná una para previsualizarla en el área de diseño.</p>
      <div className="template-options" role="group" aria-label="Elegí una plantilla">
        {([2, 3, 1] as const).map(count => (
          <button type="button" key={count} className={`template-option${selected === count ? ' selected' : ''}`}
            aria-pressed={selected === count} onClick={() => onSelect(count)}>
            Texto + {count} {count === 1 ? 'Icono' : 'Iconos'}
          </button>
        ))}
      </div>
      <div className="template-actions">
        <button type="button" className="start-over" onClick={onStart}>Empezar desde cero</button>
        <button type="button" className="continue" disabled={selected === null} onClick={onContinue}>Continuar a edición</button>
      </div>
    </section>
  );
}
