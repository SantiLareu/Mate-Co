import type { Template } from '../App';
import CurvedText from './CurvedText';
import type { TextElement } from './CurvedText';
import IconElement, { templateIcons } from './IconElement';
import type { DesignIcon } from './IconElement';

type Props = {
  selected: Template | null;
  texts?: TextElement[];
  editing: boolean;
  selectedText: string | null;
  onSelectText: (id: string | null) => void;
  onUpdateText: (id: string, changes: Partial<Omit<TextElement, 'id'>>) => void;
  onDeleteText: (id: string) => void;
  icons?: DesignIcon[];
  selectedIcon: string | null;
  onSelectIcon: (id: string) => void;
  onUpdateIcon: (id: string, changes: Partial<DesignIcon>) => void;
  onDeleteIcon: (id: string) => void;
};

export default function MatePreview({ selected, texts, editing, selectedText, onSelectText, onUpdateText, onDeleteText, icons, selectedIcon, onSelectIcon, onUpdateIcon, onDeleteIcon }: Props) {
  return (
    <section className="preview" aria-label="Previsualización del mate">
      <svg className="mate" viewBox="0 0 900 900" role={editing ? 'group' : 'img'} aria-labelledby="mate-title mate-description" onClick={() => { if (editing) onSelectText(null); }}>
        <title id="mate-title">Mate con virola blanca</title>
        <desc id="mate-description">{editing ? 'Seleccioná un texto y arrastralo alrededor de la virola. También podés moverlo con las flechas izquierda y derecha.' : selected === null ? 'Virola sin plantilla seleccionada.' : `Plantilla con Tu texto y ${selected} ${selected === 1 ? 'icono' : 'iconos'} sobre la virola.`}</desc>
        <defs>
          <radialGradient id="rim" cx="50%" cy="51.5%" r="50%">
            <stop offset="0%" stopColor="#fff" /><stop offset="88%" stopColor="#fff" />
            <stop offset="94%" stopColor="#fdfdfd" />
            <stop offset="98%" stopColor="#f0f1f3" /><stop offset="100%" stopColor="#e7e8ea" />
          </radialGradient>
          <linearGradient id="mate-brown" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#815936" /><stop offset="1" stopColor="#603d24" />
          </linearGradient>
          <radialGradient id="inner-depth" cx="50%" cy="53%" r="52%">
            <stop offset="83%" stopColor="#2e1c10" stopOpacity="0" />
            <stop offset="100%" stopColor="#2e1c10" stopOpacity=".35" />
          </radialGradient>
          <path id="text-curve" d="M 90 450 A 360 360 0 0 1 810 450" />
        </defs>
        <circle cx="450" cy="450" r="423" fill="url(#rim)" stroke="#e4e6eb" strokeWidth="3" />
        <circle cx="450" cy="450" r="292" fill="url(#mate-brown)" />
        <circle cx="450" cy="450" r="292" fill="url(#inner-depth)" />
        <g className="guides" fill="none" stroke="#777b7e" strokeWidth="1" strokeDasharray="6 7" opacity=".65">
          <circle cx="450" cy="450" r="360" />
          <path d="M8 450H892M450 8V892M8 8 892 892M8 892 892 8" />
        </g>
        {selected !== null && <g className="template-art" fill="#65513c">
          {texts === undefined && <text fontSize="35" fontWeight="600" letterSpacing="2" textAnchor="middle">
            <textPath href="#text-curve" startOffset="50%">Tu texto</textPath>
          </text>}
        </g>}
        {texts?.map(text => <CurvedText key={text.id} element={text} editing={editing} selected={selectedText === text.id}
          onSelect={onSelectText} onUpdate={onUpdateText} onDelete={onDeleteText} />)}
        {(icons ?? (selected !== null ? templateIcons(selected) : [])).map(icon => <IconElement key={icon.id} element={icon} editing={editing} selected={selectedIcon === icon.id} onSelect={onSelectIcon} onUpdate={onUpdateIcon} onDelete={onDeleteIcon} />)}
      </svg>
      <button type="button" className="confirm">Ir a confirmación</button>
    </section>
  );
}
