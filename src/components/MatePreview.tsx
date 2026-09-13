import type { CircularLines } from '../App';
import CurvedText from './CurvedText';
import type { TextElement } from './CurvedText';
import IconElement from './IconElement';
import type { DesignIcon } from './IconElement';

type Props = {
  texts: TextElement[];
  editing: boolean;
  selectedText: string | null;
  onSelectText: (id: string | null) => void;
  onUpdateText: (id: string, changes: Partial<Omit<TextElement, 'id'>>) => void;
  onDeleteText: (id: string) => void;
  icons: DesignIcon[];
  selectedIcon: string | null;
  onSelectIcon: (id: string) => void;
  onUpdateIcon: (id: string, changes: Partial<DesignIcon>) => void;
  onDeleteIcon: (id: string) => void;
  circularLines: CircularLines;
};

export default function MatePreview({ texts, editing, selectedText, onSelectText, onUpdateText, onDeleteText, icons, selectedIcon, onSelectIcon, onUpdateIcon, onDeleteIcon, circularLines }: Props) {
  const selectedTextElement = texts.find(text => text.id === selectedText);
  const selectedIconElement = icons.find(icon => icon.id === selectedIcon);
  const selectedIconRadians = ((selectedIconElement?.angle ?? 90) - 90) * Math.PI / 180;
  const selectedIconX = 450 + (selectedIconElement?.radius ?? 0) * Math.cos(selectedIconRadians);
  const selectedIconY = 450 + (selectedIconElement?.radius ?? 0) * Math.sin(selectedIconRadians);
  return (
    <section className="preview" aria-label="Previsualización del mate">
      <svg className="mate" viewBox="0 0 900 900" role={editing ? 'group' : 'img'} aria-labelledby="mate-title mate-description" onClick={() => { if (editing) onSelectText(null); }}>
        <title id="mate-title">Mate con virola blanca</title>
        <desc id="mate-description">Seleccioná un texto o ícono y arrastralo alrededor de la virola. También podés moverlo con el teclado.</desc>
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
          <mask id="decorative-lines-knockout" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="900" style={{ maskType: 'luminance' }}>
            <rect width="900" height="900" fill="#fff" />
            {texts.map(text => <use key={text.id} href={`#text-knockout-${text.id}`} transform={`rotate(${text.angle} 450 450)`} />)}
            {icons.map(icon => {
              const radians = (icon.angle - 90) * Math.PI / 180;
              return <use key={icon.id} href={`#icon-knockout-${icon.id}`} transform={`translate(${450 + icon.radius * Math.cos(radians)} ${450 + icon.radius * Math.sin(radians)})`} />;
            })}
          </mask>
        </defs>
        <circle cx="450" cy="450" r="423" fill="url(#rim)" stroke="#e4e6eb" strokeWidth="3" />
        <circle cx="450" cy="450" r="292" fill="url(#mate-brown)" />
        <circle cx="450" cy="450" r="292" fill="url(#inner-depth)" />
        <g className="guides" fill="none" stroke="#777b7e" strokeWidth="1" strokeDasharray="6 7" opacity=".65">
          <circle cx="450" cy="450" r="360" />
          <path d="M8 450H892M450 8V892M8 8 892 892M8 892 892 8" />
        </g>
        {circularLines !== 'none' && <g className="decorative-lines" fill="none" stroke="#65513c" strokeWidth="2" pointerEvents="none" mask="url(#decorative-lines-knockout)">
          {circularLines === 'single' ? <circle cx="450" cy="450" r="357" /> : <><circle cx="450" cy="450" r="347" /><circle cx="450" cy="450" r="367" /></>}
        </g>}
        <g className="design-text-layer">
          {texts.map(text => <CurvedText key={text.id} element={text} editing={editing} selected={selectedText === text.id}
            onSelect={onSelectText} onUpdate={onUpdateText} onDelete={onDeleteText} />)}
        </g>
        <g className="design-icon-layer">
          {icons.map(icon => <IconElement key={icon.id} element={icon} editing={editing} selected={selectedIcon === icon.id}
            onSelect={onSelectIcon} onUpdate={onUpdateIcon} onDelete={onDeleteIcon} />)}
        </g>
        <g className="selection-controls-layer" pointerEvents="none" aria-hidden="true">
          {selectedTextElement && <use href={`#text-controls-${selectedTextElement.id}`} transform={`rotate(${selectedTextElement.angle} 450 450)`} />}
          {selectedIconElement && <use href={`#icon-controls-${selectedIconElement.id}`} transform={`translate(${selectedIconX} ${selectedIconY})`} />}
        </g>
      </svg>
    </section>
  );
}
