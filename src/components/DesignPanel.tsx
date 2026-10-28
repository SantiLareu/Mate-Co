import type { CircularLines } from "../App";
import type { TextElement } from "./CurvedText";
import type { DesignIcon } from "./IconElement";
import type { UploadedGraphicElement } from "./UploadedGraphic";
import type { ApprovedDesignInstance } from "../approved-designs/approvedDesign";
import { TYPOGRAPHY_FONT_LIST } from "../typography";

type Props = {
  selected: TextElement | null;
  onAdd: () => void;
  onUpdate: (id: string, changes: Partial<Omit<TextElement, "id">>) => void;
  selectedIcon: DesignIcon | null;
  onAddIcon: () => void;
  onUpdateIcon: (id: string, changes: Partial<DesignIcon>) => void;
  selectedGraphic: UploadedGraphicElement | null;
  onUploadImage: () => void;
  onUpdateGraphic: (
    id: string,
    changes: Partial<UploadedGraphicElement>,
  ) => void;
  selectedApproved: ApprovedDesignInstance | null;
  onAddApproved: () => void;
  onUpdateApproved: (
    id: string,
    changes: Partial<ApprovedDesignInstance>,
  ) => void;
  circularLines: CircularLines;
  onCircularLinesChange: (lines: CircularLines) => void;
  onContinue: () => void;
};

/**
 * Catálogo del selector: exactamente las tres fuentes empaquetadas (Etapa 4).
 * Viene del mismo módulo que usa el motor vectorial, así que el editor y el
 * exportador no pueden divergir en el nombre ni en el peso.
 */
const fonts = TYPOGRAPHY_FONT_LIST.map((font) => font.family);

export default function DesignPanel({
  selected,
  onAdd,
  onUpdate,
  selectedIcon,
  onAddIcon,
  onUpdateIcon,
  selectedGraphic,
  onUploadImage,
  onUpdateGraphic,
  selectedApproved,
  onAddApproved,
  onUpdateApproved,
  circularLines,
  onCircularLinesChange,
  onContinue,
}: Props) {
  const activeGraphic = selectedIcon ?? selectedGraphic ?? selectedApproved;
  const updateActiveGraphic = (
    changes: Partial<DesignIcon> &
      Partial<UploadedGraphicElement> &
      Partial<ApprovedDesignInstance>,
  ) => {
    if (selectedIcon) onUpdateIcon(selectedIcon.id, changes);
    else if (selectedGraphic) onUpdateGraphic(selectedGraphic.id, changes);
    else if (selectedApproved) onUpdateApproved(selectedApproved.id, changes);
  };
  return (
    <section className="templates design-panel" aria-labelledby="design-title">
      <p className="eyebrow">DISEÑO</p>
      <h1 id="design-title">Personalizá tu mate</h1>
      <p className="subtitle">
        Agregá elementos y acomodalos directamente sobre la virola.
      </p>

      <div className="design-sections">
        <section
          className="design-section"
          aria-labelledby="add-elements-title"
        >
          <h2 id="add-elements-title">Añadir elementos</h2>
          <div className="add-elements">
            <button
              type="button"
              className="template-option add-text"
              onClick={onAdd}
            >
              + Agregar texto
            </button>
            <button
              type="button"
              className="template-option add-icon"
              onClick={onAddIcon}
            >
              + Agregar ícono
            </button>
            <button
              type="button"
              className="template-option add-approved"
              onClick={onAddApproved}
            >
              + Agregar diseño
            </button>
            <button
              type="button"
              className="template-option add-image"
              onClick={onUploadImage}
            >
              + Subir imagen
            </button>
          </div>
        </section>

        <section
          className="design-section text-section"
          aria-labelledby="text-editor-title"
        >
          <h2 id="text-editor-title">Editar texto</h2>
          <div className="text-editor">
            <label htmlFor="text-content">Texto</label>
            <input
              id="text-content"
              value={selected?.text ?? ""}
              disabled={!selected}
              maxLength={80}
              placeholder={selected ? "Tu texto" : "Seleccioná un texto"}
              onChange={(event) =>
                selected && onUpdate(selected.id, { text: event.target.value })
              }
            />
            {/* E4.1: aviso discreto y accionable cuando el texto no entra ni
                con la escala mínima. La plaza tiene altura fija (reservada
                siempre) para que el aviso NO mueva el layout: los controles
                táctiles de la vista previa no cambian de sitio. */}
            <p className="text-fit-notice" role="status">
              {selected?.textFitBlocked
                ? "No entra en la virola: acortalo el texto."
                : ""}
            </p>
            <label htmlFor="text-font">Tipografía</label>
            <select
              id="text-font"
              value={selected?.fontFamily ?? fonts[0]}
              disabled={!selected}
              onChange={(event) =>
                selected &&
                onUpdate(selected.id, { fontFamily: event.target.value })
              }
            >
              {fonts.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="design-action"
              disabled={!selected}
              aria-pressed={selected?.inverted ?? false}
              onClick={() =>
                selected &&
                onUpdate(selected.id, { inverted: !selected.inverted })
              }
            >
              Invertir texto
            </button>
          </div>
        </section>

        <section
          className="design-section icon-section"
          aria-labelledby="icon-editor-title"
        >
          <h2 id="icon-editor-title">Ícono</h2>
          <div className="icon-editor panel-actions">
            <button
              type="button"
              className="design-action mirror-icon"
              disabled={!activeGraphic}
              aria-pressed={activeGraphic?.mirrored ?? false}
              onClick={() =>
                activeGraphic &&
                updateActiveGraphic({ mirrored: !activeGraphic.mirrored })
              }
            >
              Espejo
            </button>
            <button
              type="button"
              className="design-action invert-icon"
              disabled={!activeGraphic}
              aria-pressed={activeGraphic?.inverted ?? false}
              onClick={() =>
                activeGraphic &&
                updateActiveGraphic({ inverted: !activeGraphic.inverted })
              }
            >
              Invertir
            </button>
            <button
              type="button"
              className="design-action reset-icon-angle"
              disabled={!activeGraphic}
              onClick={() =>
                activeGraphic && updateActiveGraphic({ rotation: 0 })
              }
            >
              Ángulo inicial
            </button>
          </div>
        </section>

        <section
          className="design-section"
          aria-labelledby="circular-lines-title"
        >
          <h2 id="circular-lines-title">Líneas circulares</h2>
          <div
            className="segmented-control"
            role="group"
            aria-label="Líneas circulares"
          >
            {(
              [
                ["none", "No"],
                ["single", "Simple"],
                ["double", "Doble"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={circularLines === value}
                onClick={() => onCircularLinesChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section
          className="design-section vectorize-section"
          aria-labelledby="vectorize-title"
        >
          <h2 id="vectorize-title">Vectorizar imagen</h2>
          <p>Subí una imagen y elegí cómo grabarla en la virola.</p>
        </section>
      </div>
      <button
        type="button"
        className="confirm design-confirm"
        onClick={onContinue}
      >
        Continuar a confirmación
      </button>
    </section>
  );
}
