import { useEffect, useRef, useState } from 'react';
import { categories, icons } from '../data/icons';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export default function IconDrawer({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setSearch(''); setCategory(null); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [open]);
  const grid = (items: typeof icons) => <div className="icon-grid">{items.map(icon => <button type="button" className="icon-choice" key={icon.id} aria-label={icon.name} onClick={() => onChoose(icon.id)}>
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon.paths.map((path, index) => <path key={index} d={path} />)}</svg>
    <span>{icon.name}</span>
  </button>)}</div>;
  const results = icons.filter(icon => normalize(`${icon.name} ${icon.category}`).includes(normalize(search.trim())));
  return <dialog ref={dialog} className="icon-drawer" aria-labelledby="icon-drawer-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target === event.currentTarget) {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }
  }}>
    <header className="drawer-header"><h2 id="icon-drawer-title">Seleccionar ícono</h2><button type="button" className="drawer-close" aria-label="Cerrar biblioteca de íconos" onClick={onClose}>×</button></header>
    <label className="visually-hidden" htmlFor="icon-search">Buscar ícono</label>
    <input id="icon-search" className="icon-search" type="search" placeholder="Buscar ícono..." value={search} onChange={event => setSearch(event.target.value)} />
    <div className="drawer-content">
      {search.trim() ? <>{results.length ? grid(results) : <p className="icon-empty" role="status">No encontramos íconos para esa búsqueda.</p>}</> : categories.map((name, index) => <section className="icon-category" key={name}>
        <button type="button" className="category-toggle" aria-expanded={category === name} aria-controls={`icon-category-${index}`} onClick={() => setCategory(category === name ? null : name)}>{name}<span aria-hidden="true">{category === name ? '⌄' : '›'}</span></button>
        <div id={`icon-category-${index}`} hidden={category !== name}>{category === name && grid(icons.filter(icon => icon.category === name))}</div>
      </section>)}
    </div>
  </dialog>;
}
