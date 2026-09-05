import { useState } from 'react';
import StepNavigation from './components/StepNavigation';
import TemplatesPanel from './components/TemplatesPanel';
import MatePreview from './components/MatePreview';
import DesignPanel from './components/DesignPanel';
import type { TextElement } from './components/CurvedText';
import { TEXT_RADIUS, clampTextRadius, clampTextScale } from './components/CurvedText';
import IconDrawer from './components/IconDrawer';
import { ICON_CENTER, normalizeIcon, templateIcons } from './components/IconElement';
import type { DesignIcon } from './components/IconElement';

export type Template = 1 | 2 | 3;

export default function App() {
  const [selected, setSelected] = useState<Template | null>(null);
  const [step, setStep] = useState<'templates' | 'design'>('templates');
  const [hasDesign, setHasDesign] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<Template | null>(null);
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [icons, setIcons] = useState<DesignIcon[]>([]);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectText = (id: string | null) => { setSelectedText(id); setSelectedIcon(null); };
  const selectIcon = (id: string) => { setSelectedIcon(id); setSelectedText(null); };
  const updateIcon = (id: string, changes: Partial<DesignIcon>) => setIcons(current => current.map(icon => icon.id === id ? normalizeIcon({ ...icon, ...changes }) : icon));
  const deleteIcon = (id: string) => { setIcons(current => current.filter(icon => icon.id !== id)); setSelectedIcon(null); };
  const addIcon = (iconId: string) => {
    const candidates = [90, 270, 180, 45, 135, 225, 315, 0];
    const occupied = [...texts, ...icons].map(item => item.angle);
    const angle = candidates.find(candidate => occupied.every(value => Math.abs(((candidate - value + 540) % 360) - 180) > 30)) ?? (90 + icons.length * 40) % 360;
    const icon: DesignIcon = { id: crypto.randomUUID(), type: 'icon', iconId, angle, radius: ICON_CENTER, scale: 1, rotation: 0, mirrored: false };
    setIcons(current => [...current, icon]); selectIcon(icon.id); setDrawerOpen(false);
  };
  const createText = (): TextElement => ({ id: crypto.randomUUID(), text: 'Tu texto', fontFamily: 'Georgia', angle: 0, radius: TEXT_RADIUS.initial, inverted: false });
  const enterDesign = (blank = false) => {
    if (blank || !hasDesign || selected !== appliedTemplate) {
      const next = !blank && selected !== null ? createText() : null;
      setTexts(next ? [next] : []);
      setIcons(!blank && selected !== null ? templateIcons(selected) : []);
      setSelectedIcon(null);
      setSelectedText(null);
      setAppliedTemplate(blank ? null : selected);
      if (blank) setSelected(null);
    }
    setHasDesign(true);
    setStep('design');
  };
  const updateText = (id: string, changes: Partial<Omit<TextElement, 'id'>>) => {
    setTexts(current => current.map(text => text.id === id
      ? { ...text, ...changes, scale: clampTextScale(changes.scale ?? text.scale ?? 1), radius: clampTextRadius(changes.radius ?? text.radius, changes.scale ?? text.scale ?? 1) } : text));
  };
  const deleteText = (id: string) => {
    setTexts(current => current.filter(text => text.id !== id));
    setSelectedText(null);
  };
  const showDesign = step === 'design' || (hasDesign && selected === appliedTemplate);
  return (
    <main className="customizer" aria-label="Personalizador de mates Mate&Co">
      <aside className="sidebar" aria-label={step === 'templates' ? 'Plantillas' : 'Diseño'}>
        <StepNavigation step={step} canEdit={hasDesign} onNavigate={next => {
          if (next === 'design') { setSelected(appliedTemplate); setStep('design'); }
          else setStep('templates');
        }} />
        {step === 'templates'
          ? <TemplatesPanel selected={selected} onSelect={setSelected} onStart={() => enterDesign(true)} onContinue={() => enterDesign()} />
          : <DesignPanel selected={texts.find(text => text.id === selectedText) ?? null}
              onAdd={() => { const text = createText(); setTexts(current => [...current, text]); selectText(text.id); }}
              selectedIcon={icons.find(icon => icon.id === selectedIcon) ?? null} onAddIcon={() => setDrawerOpen(true)} onUpdateIcon={updateIcon} onDeleteIcon={deleteIcon}
              onUpdate={updateText} onDelete={deleteText} onDeselect={() => selectText(null)} />}
        <div className="user-card">
          <span className="avatar" aria-hidden="true">SL</span>
          <span className="user-name">Santiago Lareu</span>
          <button type="button" className="logout">Cerrar sesión
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H4v18h5M13 7l5 5-5 5M8 12h13" /></svg>
          </button>
        </div>
      </aside>
      <MatePreview selected={step === 'design' ? appliedTemplate : selected}
        texts={showDesign ? texts : undefined} editing={step === 'design'} selectedText={selectedText}
        icons={showDesign ? icons : undefined} selectedIcon={selectedIcon} onSelectIcon={selectIcon} onUpdateIcon={updateIcon} onDeleteIcon={deleteIcon}
        onSelectText={selectText} onUpdateText={updateText} onDeleteText={deleteText} />
      <IconDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onChoose={addIcon} />
    </main>
  );
}
