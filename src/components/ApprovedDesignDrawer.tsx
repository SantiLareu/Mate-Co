import { useEffect, useMemo, useRef, useState } from "react";
import type { RenderableDesign } from "../admin-lab/types";
import { useApprovedAssetUrl } from "../approved-designs/assetUrl";
import { approvedDisplayAspect } from "../approved-designs/approvedDesign";
import { ApprovedSnapshotThumb } from "./ApprovedDesignElement";
import { useApprovedDesignCatalog } from "../approved-designs/catalog";

/**
 * Customer picker for the owner's approved library.
 *
 * Distinct "Agregar diseño" drawer alongside the icon demos: existing icons
 * and raster uploads are untouched. Read-only consumption (enabled only,
 * free name/search/category grouping and filter, safe Blob preview, exact
 * empty message). No admin controls and no customer SVG upload exist here.
 */

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function ApprovedThumb({ design }: { design: RenderableDesign }) {
  const svg = design.version === 3 ? design.svg : null;
  const url = useApprovedAssetUrl(svg);
  if (design.version !== 3) {
    // v1/v2 preview the same safe controlled tree the canvas renders.
    return <ApprovedSnapshotThumb snapshot={design} />;
  }
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      className="approved-thumb"
      style={{ aspectRatio: approvedDisplayAspect(design) }}
    />
  );
}

export default function ApprovedDesignDrawer({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (design: RenderableDesign) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const { designs, ready } = useApprovedDesignCatalog();

  useEffect(() => {
    if (open) {
      setSearch("");
      setCollapsed(null);
      setCategoryFilter("Todas");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const design of designs) seen.add(design.category);
    return [...seen].sort((a, b) => a.localeCompare(b, "es"));
  }, [designs]);

  const results = useMemo(() => {
    const query = normalize(search.trim());
    return designs.filter((design) => {
      if (categoryFilter !== "Todas" && design.category !== categoryFilter)
        return false;
      if (
        query !== "" &&
        !normalize(`${design.name} ${design.category}`).includes(query)
      )
        return false;
      return true;
    });
  }, [designs, search, categoryFilter]);

  const grid = (items: RenderableDesign[]) => (
    <div className="approved-grid">
      {items.map((design) => (
        <button
          type="button"
          className="approved-choice"
          key={design.id}
          aria-label={design.name}
          onClick={() => onChoose(design)}
        >
          <ApprovedThumb design={design} />
          <span>{design.name}</span>
        </button>
      ))}
    </div>
  );

  const grouped = categoryFilter === "Todas" ? categories : [categoryFilter];
  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("Todas");
  };
  return (
    <dialog
      ref={dialog}
      className="approved-drawer"
      aria-labelledby="approved-drawer-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header className="drawer-header">
        <h2 id="approved-drawer-title">Agregar diseño</h2>
        <button
          type="button"
          className="drawer-close"
          aria-label="Cerrar biblioteca de diseños"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <label className="visually-hidden" htmlFor="approved-search">
        Buscar diseño
      </label>
      <input
        id="approved-search"
        className="approved-search"
        type="search"
        placeholder="Buscar diseño..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="approved-filter-row">
        <label htmlFor="approved-category-filter">Categoría</label>
        <select
          id="approved-category-filter"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="Todas">Todas</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="drawer-content">
        {!ready ? (
          <p className="approved-loading" role="status">
            Cargando diseños…
          </p>
        ) : designs.length === 0 ? (
          <p className="approved-empty" role="status">
            Todavía no hay diseños disponibles.
          </p>
        ) : results.length === 0 ? (
          <div className="approved-no-match" role="status">
            <p>No encontramos diseños con esos filtros.</p>
            <button type="button" onClick={clearFilters}>
              Limpiar filtros
            </button>
          </div>
        ) : search.trim() ? (
          grid(results)
        ) : (
          grouped.map((name, index) => (
            <section className="approved-category" key={name}>
              <button
                type="button"
                className="category-toggle"
                aria-expanded={collapsed !== name}
                aria-controls={`approved-category-${index}`}
                onClick={() => setCollapsed(collapsed === name ? null : name)}
              >
                {name}
                <span aria-hidden="true">{collapsed === name ? "›" : "⌄"}</span>
              </button>
              <div
                id={`approved-category-${index}`}
                hidden={collapsed === name}
              >
                {collapsed !== name &&
                  grid(results.filter((design) => design.category === name))}
              </div>
            </section>
          ))
        )}
      </div>
      <p className="approved-note">
        La biblioteca vive en este navegador y origen: en otro dispositivo se
        verá vacía hasta contar con un catálogo remoto.
      </p>
    </dialog>
  );
}
