import type { CircularLines } from '../App';
import type { TextElement } from './CurvedText';
import type { DesignIcon } from './IconElement';

type Props = {
  selected: TextElement | null;
  onAdd: () => void;
  onUpdate: (id: string, changes: Partial<Omit<TextElement, 'id'>>) => void;
  selectedIcon: DesignIcon | null;
  onAddIcon: () => void;
  onUpdateIcon: (id: string, changes: Partial<DesignIcon>) => void;
  circularLines: CircularLines;
  onCircularLinesChange: (lines: CircularLines) => void;
};

const fonts = ['Georgia', 'Arial', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

export default function DesignPanel({ selected, onAdd, onUpdate, selectedIcon, onAddIcon, onUpdateIcon, circularLines, onCircularLinesChange }: Props) {
  return (
    <section className="templates design-panel" aria-labelledby="design-title">
      <p className="eyebrow">DISEÑO</p>
      <h1 id="design-title">Personalizá tu mate</h1>
      <p className="subtitle">Agregá elementos y acomodalos directamente sobre la virola.</p>

      <div className="design-sections">
        <section className="design-section" aria-labelledby="add-elements-title">
          <h2 id="add-elements-title">Añadir elementos</h2>
          <div className="add-elements">
            <button type="button" className="template-option add-text" onClick={onAdd}>+ Agregar texto</button>
            <button type="button" className="template-option add-icon" onClick={onAddIcon}>+ Agregar ícono</button>
          </div>
        </section>

        <section className="design-section text-section" aria-labelledby="text-editor-title">
          <h2 id="text-editor-title">Editar texto</h2>
          <div className="text-editor">
            <label htmlFor="text-content">Texto</label>
            <input id="text-content" value={selected?.text ?? ''} disabled={!selected} maxLength={80} placeholder={selected ? 'Tu texto' : 'Seleccioná un texto'} onChange={event => selected && onUpdate(selected.id, { text: event.target.value })} />
            <label htmlFor="text-font">Tipografía</label>
            <select id="text-font" value={selected?.fontFamily ?? fonts[0]} disabled={!selected} onChange={event => selected && onUpdate(selected.id, { fontFamily: event.target.value })}>
              {fonts.map(font => <option key={font} value={font}>{font}</option>)}
            </select>
            <button type="button" className="design-action" disabled={!selected} aria-pressed={selected?.inverted ?? false} onClick={() => selected && onUpdate(selected.id, { inverted: !selected.inverted })}>Invertir texto</button>
          </div>
        </section>

        <section className="design-section icon-section" aria-labelledby="icon-editor-title">
          <h2 id="icon-editor-title">Ícono</h2>
          <div className="icon-editor panel-actions">
            <button type="button" className="design-action mirror-icon" disabled={!selectedIcon} aria-pressed={selectedIcon?.mirrored ?? false} onClick={() => selectedIcon && onUpdateIcon(selectedIcon.id, { mirrored: !selectedIcon.mirrored })}>Espejo</button>
            <button type="button" className="design-action invert-icon" disabled={!selectedIcon} aria-pressed={selectedIcon?.inverted ?? false} onClick={() => selectedIcon && onUpdateIcon(selectedIcon.id, { inverted: !selectedIcon.inverted })}>Invertir</button>
            <button type="button" className="design-action reset-icon-angle" disabled={!selectedIcon} onClick={() => selectedIcon && onUpdateIcon(selectedIcon.id, { rotation: 0 })}>Ángulo inicial</button>
          </div>
        </section>

        <section className="design-section" aria-labelledby="circular-lines-title">
          <h2 id="circular-lines-title">Líneas circulares</h2>
          <div className="segmented-control" role="group" aria-label="Líneas circulares">
            {([['none', 'No'], ['single', 'Simple'], ['double', 'Doble']] as const).map(([value, label]) => (
              <button type="button" key={value} aria-pressed={circularLines === value} onClick={() => onCircularLinesChange(value)}>{label}</button>
            ))}
          </div>
        </section>

        <section className="design-section vectorize-section" aria-labelledby="vectorize-title">
          <h2 id="vectorize-title">Vectorizar imagen</h2>
          <p>Próximamente vas a poder preparar una imagen para grabarla.</p>
        </section>
      </div>
      <button type="button" className="confirm design-confirm">Continuar a confirmación</button>
    </section>
  );
}
