import type { TextElement } from './CurvedText';
import { TEXT_RADIUS } from './CurvedText';
import { ICON_CENTER } from './IconElement';
import type { DesignIcon } from './IconElement';

type Props = {
  selected: TextElement | null;
  onAdd: () => void;
  onUpdate: (id: string, changes: Partial<Omit<TextElement, 'id'>>) => void;
  onDelete: (id: string) => void;
  onDeselect: () => void;
  selectedIcon: DesignIcon | null;
  onAddIcon: () => void;
  onUpdateIcon: (id: string, changes: Partial<DesignIcon>) => void;
  onDeleteIcon: (id: string) => void;
};

export default function DesignPanel({ selected, onAdd, onUpdate, onDelete, onDeselect, selectedIcon, onAddIcon, onUpdateIcon, onDeleteIcon }: Props) {
  if (selectedIcon) {
    return <section className="templates design-panel" aria-labelledby="icon-editor-title">
      <p className="eyebrow">EDITAR ÍCONO</p><h1 id="icon-editor-title">Personalizá tu ícono</h1>
      <p className="subtitle">Arrastrá el ícono sobre la virola para moverlo.</p>
      <div className="text-editor icon-editor">
        <button type="button" className="design-action center-icon" onClick={() => onUpdateIcon(selectedIcon.id, { radius: ICON_CENTER })}>Centrar</button>
        <button type="button" className="design-action mirror-icon" aria-pressed={selectedIcon.mirrored} onClick={() => onUpdateIcon(selectedIcon.id, { mirrored: !selectedIcon.mirrored })}>Espejar</button>
        <button type="button" className="design-action delete-text delete-icon" onClick={() => onDeleteIcon(selectedIcon.id)}>Eliminar ícono</button>
        <button type="button" className="finish-text" onClick={onDeselect}>Listo</button>
      </div>
    </section>;
  }
  return (
    <section className="templates design-panel" aria-labelledby="design-title">
      <p className="eyebrow" id={!selected ? 'design-title' : undefined}>{selected ? 'EDITAR TEXTO' : 'AÑADIR ELEMENTOS'}</p>
      {selected && <><h1 id="design-title">Personalizá tu texto</h1>
      <p className="subtitle">Arrastrá el texto sobre la virola para moverlo.</p></>}
      {selected ? <div className="text-editor">
        <label htmlFor="text-content">Texto</label>
        <input id="text-content" value={selected.text} maxLength={80} placeholder="Tu texto" onChange={event => onUpdate(selected.id, { text: event.target.value })} />
        <label htmlFor="text-font">Tipografía</label>
        <select id="text-font" value={selected.fontFamily} onChange={event => onUpdate(selected.id, { fontFamily: event.target.value })}>
          {['Georgia', 'Arial', 'Times New Roman', 'Trebuchet MS', 'Verdana'].map(font => <option key={font} value={font}>{font}</option>)}
        </select>
        <button type="button" className="design-action center-text" onClick={() => onUpdate(selected.id, { radius: TEXT_RADIUS.center })}>Centrar</button>
        <button type="button" className="design-action" aria-pressed={selected.inverted} onClick={() => onUpdate(selected.id, { inverted: !selected.inverted })}>Invertir texto</button>
        <button type="button" className="design-action delete-text" onClick={() => onDelete(selected.id)}>Eliminar texto</button>
        <button type="button" className="finish-text" onClick={onDeselect}>Listo</button>
      </div> : <div className="add-elements"><button type="button" className="template-option add-text" onClick={onAdd}>+ Agregar texto</button><button type="button" className="template-option add-icon" onClick={onAddIcon}>+ Agregar ícono</button></div>}
    </section>
  );
}
