/**
 * Biblioteca de diseños aprobados del dueño (/admin oficial, aislado;
 * /admin-lab es alias de desarrollo).
 *
 * Español para el dueño, sin tecnicismos: alta con archivo SVG preparado
 * afuera, importación con preview y motivos breves, búsqueda, filtro por categoría
 * (las categorías se crean libres al escribir: las sugerencias no
 * restringen), Activar/Inactivar, edición de datos, borrado con
 * confirmación y persistencia local.
 *
 * Aislado por diseño: no toca el editor, el importador, vector-lab ni el
 * exportador. Los previews se dibujan solo con geometría admitida y
 * revalidada (árbol ordenado, pintura concreta y matrices por path); jamás se inserta
 * markup original arbitrario ni innerHTML.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  admitSvgFileAsAsset,
  fileReadErrorAssetOutcome,
  type AdmittedAssetDraft,
  type AssetAdmissionOutcome,
} from "./admission";
import { createAdminDesignStore, type SkippedRecord } from "./repository";
import PendingJobs from "../components/PendingJobs";
import type { RenderableDesign } from "./types";
import type { ImportedGeometry } from "./importedGeometry";
import type { SvgAssetViewBox } from "./svgAssetImport";
import type { ReactNode } from "react";

type FormState =
  { mode: "closed" } | { mode: "create" } | { mode: "edit"; id: string };

/** Validated input only. Group compositing stays ordered; matrices belong ONLY to paths. */
function GeometryPreview({
  geometry,
  testId,
  label,
}: {
  geometry: ImportedGeometry;
  testId: string;
  label: string;
}) {
  const renderNode = (index: number): ReactNode => {
    const node = geometry.nodes[index];
    if (node.kind === "group") {
      return (
        <g key={index} opacity={node.opacity}>
          {node.children.map(renderNode)}
        </g>
      );
    }
    const { d, matrix: m, style: s } = geometry.paths[node.path];
    return (
      <path
        key={index}
        d={d}
        transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`}
        opacity={node.opacity}
        fill={s.fill}
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        strokeLinecap={s.linecap}
        strokeLinejoin={s.linejoin}
        strokeMiterlimit={s.miterlimit}
        strokeDasharray={s.dasharray.length ? s.dasharray.join(" ") : "none"}
        strokeDashoffset={s.dashoffset}
        fillOpacity={s.fillOpacity}
        strokeOpacity={s.strokeOpacity}
        fillRule={s.fillRule}
      />
    );
  };
  const b = geometry.artBounds;
  return (
    <svg
      viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}
      data-testid={testId}
      role="img"
      aria-label={label}
      className="admin-lab-svg"
    >
      {renderNode(geometry.root)}
    </svg>
  );
}

/** v3 preview: the repository-validated sanitized asset string ONLY (never
 * the raw file text), rendered through a Blob URL so no markup is ever
 * injected into the document. Aspect comes from the stored width/height /
 * viewBox fields, never from intrinsic SVG size alone. The object URL is
 * revoked when the asset changes or the preview unmounts. */
function AssetPreview({
  svg,
  width,
  height,
  viewBox,
  testId,
  label,
}: {
  svg: string;
  width: number | null;
  height: number | null;
  viewBox: SvgAssetViewBox | null;
  testId: string;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [svg]);
  const w = width ?? viewBox?.width ?? null;
  const h = height ?? viewBox?.height ?? null;
  const style =
    w != null && h != null && w > 0 && h > 0
      ? { aspectRatio: `${w} / ${h}` }
      : undefined;
  if (url == null) return null;
  return (
    <img
      src={url}
      data-testid={testId}
      alt={label}
      className="admin-lab-svg admin-lab-asset"
      style={style}
    />
  );
}

/** Simple Spanish admission messages: security vs technical, no checklists. */
function admissionMessage(
  outcome: Extract<AssetAdmissionOutcome, { ok: false }>,
): string {
  if (outcome.error.code === "SECURITY")
    return "No pudimos importar este SVG porque contiene contenido no permitido.";
  if (
    outcome.error.code === "MALFORMED" ||
    outcome.error.code === "LIMIT" ||
    outcome.error.code === "TECHNICAL"
  )
    return "Este SVG usa una característica que todavía no podemos preservar correctamente.";
  return `No pudimos importar este SVG. ${outcome.error.reason}`;
}

export default function AdminLab() {
  const storeRef = useRef(createAdminDesignStore());
  const admissionRun = useRef(0);
  // L10: quién abrió el diálogo, para devolverle el foco al cerrar.
  const openerRef = useRef<HTMLElement | null>(null);
  const [designs, setDesigns] = useState<RenderableDesign[]>([]);
  const [skipped, setSkipped] = useState<SkippedRecord[]>([]);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [admission, setAdmission] = useState<AssetAdmissionOutcome | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [admitting, setAdmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = async () => {
    const loaded = await storeRef.current.load();
    if (loaded.unavailable) {
      setStorageNotice(
        "El almacenamiento del navegador no está disponible: la biblioteca no puede leer ni guardar. Revisá el modo privado o los permisos del sitio.",
      );
      setDesigns([]);
      setSkipped([]);
      return;
    }
    setDesigns(loaded.designs);
    setSkipped(loaded.skipped);
    // M2: el aviso refleja la ÚLTIMA lectura honesta: se limpia cuando la
    // biblioteca vuelve a estar sana, sin ocultar avisos vigentes.
    // R3: el daño genuino aísla en solo lectura; los saltos solo de
    // presupuesto/duplicado avisan pero permiten borrar para recuperar.
    if (loaded.skipped.length > 0) {
      setStorageNotice(
        loaded.damaged
          ? `Se omitieron ${loaded.skipped.length} registros con datos dañados y se conservaron los válidos: ${loaded.skipped.map((entry) => entry.reason).join(" ")}`
          : `Se omitieron ${loaded.skipped.length} registros fuera de la lista (límite o duplicado) y se conservaron los válidos: ${loaded.skipped.map((entry) => entry.reason).join(" ")} Podés eliminar diseños para volver a entrar.`,
      );
    } else {
      setStorageNotice(null);
    }
  };

  const restoreFocus = () => {
    openerRef.current?.focus?.();
    openerRef.current = null;
  };

  useEffect(() => {
    void refresh();
    return storeRef.current.subscribe(() => {
      void refresh();
    });
  }, []);

  const openCreate = () => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    admissionRun.current += 1;
    setForm({ mode: "create" });
    setName("");
    setCategory("");
    setAdmission(null);
    setFileName("");
    setFormError(null);
  };

  const openEdit = (design: RenderableDesign) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    admissionRun.current += 1;
    setForm({ mode: "edit", id: design.id });
    setName(design.name);
    setCategory(design.category);
    setAdmission(null);
    setFileName("");
    setFormError(null);
  };

  const closeForm = () => {
    admissionRun.current += 1;
    setForm({ mode: "closed" });
    setAdmission(null);
    setAdmitting(false);
    setSaving(false);
    setFormError(null);
    restoreFocus();
  };

  // M1: la lectura puede rechazar (File.text): motivo en español y
  // finally con token para no dejar `admitting` colgado jamás.
  const onFile = async (file: File | undefined) => {
    if (!file) {
      // An empty selection supersedes a pending read just like another file does.
      admissionRun.current += 1;
      setAdmission(null);
      setFileName("");
      setAdmitting(false);
      return;
    }
    const run = (admissionRun.current += 1);
    setAdmitting(true);
    setFileName(file.name);
    setAdmission(null);
    try {
      const outcome = await admitSvgFileAsAsset(file);
      // Si el dueño eligió otro archivo mientras tanto, gana la última selección.
      if (run !== admissionRun.current) return;
      setAdmission(outcome);
    } catch {
      if (run !== admissionRun.current) return;
      setAdmission(fileReadErrorAssetOutcome());
    } finally {
      if (run === admissionRun.current) setAdmitting(false);
    }
  };

  const draft: AdmittedAssetDraft | null =
    admission != null && admission.ok ? admission.draft : null;
  const editingDesign =
    form.mode === "edit"
      ? (designs.find((design) => design.id === form.id) ?? null)
      : null;
  const canSave =
    name.trim() !== "" &&
    category.trim() !== "" &&
    !admitting &&
    !saving &&
    (form.mode === "edit" || draft !== null);

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    if (form.mode === "create") {
      if (!draft) {
        setSaving(false);
        return;
      }
      const result = await storeRef.current.saveNew({
        name: name.trim(),
        category: category.trim(),
        asset: draft.asset,
      });
      setSaving(false);
      if (!result.ok) {
        setFormError(result.error.message);
        setStorageNotice(result.error.message);
        return;
      }
      if (result.skipped.length > 0) {
        setStorageNotice(
          `Se guardó el diseño. Además se omitieron ${result.skipped.length} registros con datos dañados.`,
        );
      }
      closeForm();
      await refresh();
      return;
    }
    if (form.mode !== "edit") {
      setSaving(false);
      return;
    }
    const result = await storeRef.current.updateDesign(form.id, {
      name: name.trim(),
      category: category.trim(),
    });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error.message);
      setStorageNotice(result.error.message);
      return;
    }
    closeForm();
    await refresh();
  };

  // L8: se invierte el valor GUARDADO fresco (operación toggle), no el
  // del render, que puede estar rancio entre pestañas.
  const onToggle = async (id: string) => {
    const result = await storeRef.current.toggleDesign(id);
    if (!result.ok) {
      setStorageNotice(result.error.message);
      return;
    }
    await refresh();
  };

  const askDelete = (id: string) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setConfirmDeleteId(id);
  };

  const closeConfirmDelete = () => {
    setConfirmDeleteId(null);
    restoreFocus();
  };

  const onConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    const result = await storeRef.current.removeDesign(confirmDeleteId);
    setConfirmDeleteId(null);
    restoreFocus();
    if (!result.ok) {
      setStorageNotice(result.error.message);
      return;
    }
    await refresh();
  };

  // L10: Escape cierra el diálogo abierto (confirmación primero).
  useEffect(() => {
    if (form.mode === "closed" && confirmDeleteId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDeleteId !== null) closeConfirmDelete();
      else closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const design of designs) seen.add(design.category);
    return [...seen].sort((a, b) => a.localeCompare(b, "es"));
  }, [designs]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return designs.filter((design) => {
      if (categoryFilter !== "Todas" && design.category !== categoryFilter)
        return false;
      if (
        query !== "" &&
        !`${design.name} ${design.category}`.toLowerCase().includes(query)
      )
        return false;
      return true;
    });
  }, [designs, search, categoryFilter]);

  const confirmTarget = confirmDeleteId
    ? (designs.find((design) => design.id === confirmDeleteId) ?? null)
    : null;

  return (
    <main data-testid="admin-lab-panel" className="admin-lab">
      <header className="admin-lab-head">
        <div>
          <h1 data-testid="admin-lab-title" className="admin-lab-title">
            Biblioteca de diseños
          </h1>
          <p className="admin-lab-sub">
            Subí tus diseños SVG y revisá su apariencia antes de guardarlos. La
            elección del diseño es tuya.
          </p>
        </div>
        <button
          type="button"
          data-testid="admin-lab-add"
          className="admin-lab-primary"
          onClick={openCreate}
        >
          + Agregar diseño
        </button>
      </header>

      <div
        data-testid="admin-lab-storage-notice"
        aria-live="polite"
        className={storageNotice ? "admin-lab-notice" : "admin-lab-hidden"}
      >
        {storageNotice ?? ""}
      </div>

      <section aria-label="Buscar y filtrar" className="admin-lab-tools">
        <div className="admin-lab-field">
          <label htmlFor="admin-lab-search">Buscar</label>
          <input
            id="admin-lab-search"
            data-testid="admin-lab-search"
            type="search"
            placeholder="Nombre o categoría…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="admin-lab-field">
          <label htmlFor="admin-lab-category-filter">
            Filtrar por categoría
          </label>
          <select
            id="admin-lab-category-filter"
            data-testid="admin-lab-category-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="Todas">Todas</option>
            {categories.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </section>

      {designs.length === 0 ? (
        <p data-testid="admin-lab-empty" className="admin-lab-empty">
          Todavía no hay diseños guardados. Tocá «+ Agregar diseño» para subir
          el primero.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul data-testid="admin-lab-list" className="admin-lab-grid">
          {visible.map((design) => (
            <li
              key={design.id}
              data-testid={`admin-lab-item-${design.id}`}
              className="admin-lab-card"
            >
              {design.version === 3 ? (
                <AssetPreview
                  svg={design.svg}
                  width={design.width}
                  height={design.height}
                  viewBox={design.viewBox}
                  testId={`admin-lab-thumb-${design.id}`}
                  label={design.name}
                />
              ) : (
                <GeometryPreview
                  geometry={design.geometry}
                  testId={`admin-lab-thumb-${design.id}`}
                  label={`Preview de ${design.name}`}
                />
              )}
              <div className="admin-lab-card-body">
                <strong>{design.name}</strong>
                <span className="admin-lab-category">{design.category}</span>
                <div className="admin-lab-row">
                  <button
                    type="button"
                    data-testid={`admin-lab-toggle-${design.id}`}
                    aria-pressed={design.enabled}
                    className={
                      design.enabled
                        ? "admin-lab-toggle on"
                        : "admin-lab-toggle"
                    }
                    onClick={() => void onToggle(design.id)}
                  >
                    {design.enabled ? "Activo" : "Inactivo"}
                  </button>
                  <button
                    type="button"
                    className="admin-lab-ghost"
                    onClick={() => openEdit(design)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="admin-lab-danger-ghost"
                    onClick={() => askDelete(design.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {designs.length > 0 && visible.length === 0 ? (
        <p data-testid="admin-lab-no-results" className="admin-lab-empty">
          Sin resultados para esa búsqueda.
        </p>
      ) : null}

      {/* J2: confirmed-jobs section (Stage 2, S4). Read-only, additive:
          the designs library above keeps its own data flow untouched. */}
      <PendingJobs />

      {form.mode !== "closed" ? (
        <section
          data-testid="admin-lab-form"
          role="dialog"
          aria-modal="true"
          aria-label={form.mode === "edit" ? "Editar diseño" : "Nuevo diseño"}
          className="admin-lab-modal"
        >
          <div className="admin-lab-sheet">
            <h2>{form.mode === "edit" ? "Editar diseño" : "Nuevo diseño"}</h2>
            <div className="admin-lab-field">
              <label htmlFor="admin-lab-name">Nombre</label>
              <input
                id="admin-lab-name"
                data-testid="admin-lab-name"
                type="text"
                maxLength={120}
                placeholder="p. ej. Guarda clásica"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="admin-lab-field">
              <label htmlFor="admin-lab-category">Categoría</label>
              <input
                id="admin-lab-category"
                data-testid="admin-lab-category"
                type="text"
                maxLength={60}
                list="admin-lab-category-suggestions"
                placeholder="Escribí una nueva o elegí una sugerida"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
              <datalist id="admin-lab-category-suggestions">
                {categories.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            </div>

            {form.mode === "create" ? (
              <div className="admin-lab-field">
                <label htmlFor="admin-lab-file">Archivo SVG</label>
                <input
                  id="admin-lab-file"
                  data-testid="admin-lab-file"
                  type="file"
                  accept=".svg,image/svg+xml"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                />
                {fileName !== "" ? (
                  <span className="admin-lab-file">{fileName}</span>
                ) : null}
              </div>
            ) : null}

            {admitting ? (
              <p className="admin-lab-muted">Revisando el archivo…</p>
            ) : null}

            {admission != null && !admission.ok ? (
              <p
                data-testid="admin-lab-error"
                role="alert"
                className="admin-lab-error"
              >
                {admissionMessage(admission)}
              </p>
            ) : null}

            {formError != null ? (
              <p role="alert" className="admin-lab-error">
                {formError}
              </p>
            ) : null}

            {draft != null ? (
              <div
                data-testid="admin-lab-preview"
                className="admin-lab-preview"
              >
                <p
                  data-testid="admin-lab-success"
                  role="status"
                  className="admin-lab-success"
                >
                  Diseño cargado correctamente
                </p>
                <h3>Preview</h3>
                <AssetPreview
                  svg={draft.asset.svg}
                  width={draft.asset.width}
                  height={draft.asset.height}
                  viewBox={draft.asset.viewBox}
                  testId="admin-lab-preview-svg"
                  label={name.trim() === "" ? "nuevo diseño" : name.trim()}
                />
              </div>
            ) : null}

            {editingDesign != null ? (
              <div
                data-testid="admin-lab-preview"
                className="admin-lab-preview"
              >
                <h3>Preview</h3>
                {editingDesign.version === 3 ? (
                  <AssetPreview
                    svg={editingDesign.svg}
                    width={editingDesign.width}
                    height={editingDesign.height}
                    viewBox={editingDesign.viewBox}
                    testId="admin-lab-preview-svg"
                    label={editingDesign.name}
                  />
                ) : (
                  <GeometryPreview
                    geometry={editingDesign.geometry}
                    testId="admin-lab-preview-svg"
                    label={`Preview de ${editingDesign.name}`}
                  />
                )}
              </div>
            ) : null}

            <div className="admin-lab-row">
              <button
                type="button"
                data-testid="admin-lab-save"
                className="admin-lab-primary"
                disabled={!canSave}
                onClick={() => void onSave()}
              >
                Guardar
              </button>
              <button
                type="button"
                data-testid="admin-lab-cancel"
                className="admin-lab-ghost"
                onClick={closeForm}
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {confirmTarget != null ? (
        <section
          data-testid="admin-lab-confirm-delete"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
          className="admin-lab-modal"
        >
          <div className="admin-lab-sheet">
            <h2>¿Eliminar «{confirmTarget.name}»?</h2>
            <p>Esta acción no se puede deshacer.</p>
            <div className="admin-lab-row">
              <button
                type="button"
                data-testid="admin-lab-confirm-yes"
                className="admin-lab-danger"
                onClick={() => void onConfirmDelete()}
              >
                Eliminar
              </button>
              <button
                type="button"
                data-testid="admin-lab-confirm-no"
                className="admin-lab-ghost"
                onClick={closeConfirmDelete}
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {skipped.length > 0 ? (
        <p className="admin-lab-muted admin-lab-foot">
          Aviso: {skipped.length}{" "}
          {skipped.length === 1
            ? "registro dañado quedó"
            : "registros dañados quedaron"}{" "}
          fuera de la lista y los válidos están intactos.
        </p>
      ) : null}
    </main>
  );
}
