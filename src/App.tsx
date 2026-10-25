import { useRef, useState } from "react";
import StepNavigation from "./components/StepNavigation";
import type { CustomizerView } from "./components/StepNavigation";
import ConfirmPanel from "./components/ConfirmPanel";
import MatePreview from "./components/MatePreview";
import DesignPanel from "./components/DesignPanel";
import type { TextElement } from "./components/CurvedText";
import {
  TEXT_RADIUS,
  clampTextRadius,
  clampTextScale,
} from "./components/CurvedText";
import IconDrawer from "./components/IconDrawer";
import { TYPOGRAPHY_FONT_LIST } from "./typography";
import ApprovedDesignDrawer from "./components/ApprovedDesignDrawer";
import type { RenderableDesign } from "./admin-lab/types";
import {
  approvedDesignFromCatalog,
  normalizeApprovedDesign,
  type ApprovedDesignInstance,
} from "./approved-designs/approvedDesign";
import { ICON_CENTER, normalizeIcon } from "./components/IconElement";
import type { DesignIcon } from "./components/IconElement";
import ImageUploadDialog from "./components/ImageUploadDialog";
import {
  normalizeUploadedGraphic,
  uploadedGraphicFromVectorized,
} from "./components/UploadedGraphic";
import type { UploadedGraphicElement } from "./components/UploadedGraphic";
import type { VectorizedResult } from "./vectorization/vectorize/vectorizeMask";
import { createConfirmationCoordinator } from "./jobs/coordinator";
import type { ConfirmationCoordinator } from "./jobs/coordinator";
import { createJobsRepository } from "./jobs/repository";
import type { JobsRepository } from "./jobs/repository";
import { iconById } from "./data/icons";

export type Template = 1 | 2 | 3;
export type CircularLines = "none" | "single" | "double";

export default function App() {
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [icons, setIcons] = useState<DesignIcon[]>([]);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [graphics, setGraphics] = useState<UploadedGraphicElement[]>([]);
  const [selectedGraphic, setSelectedGraphic] = useState<string | null>(null);
  const [approved, setApproved] = useState<ApprovedDesignInstance[]>([]);
  const [selectedApproved, setSelectedApproved] = useState<string | null>(null);
  const [approvedOpen, setApprovedOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [circularLines, setCircularLines] = useState<CircularLines>("none");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState<CustomizerView>("diseno");
  const [confirmed, setConfirmed] = useState(false);
  // J2 durable confirmation (Stage 2, S2/S3): the coordinator + jobs
  // repository live for the whole session so an unchanged retry or
  // back-then-confirm reuses its stable attempt key, while an edited
  // composition mints a new key. The ONLY capture site is the explicit
  // confirm click below: visiting, backing or reloading never captures.
  const coordinatorRef = useRef<ConfirmationCoordinator | null>(null);
  if (coordinatorRef.current === null)
    coordinatorRef.current = createConfirmationCoordinator();
  const jobsRepoRef = useRef<JobsRepository | null>(null);
  if (jobsRepoRef.current === null)
    jobsRepoRef.current = createJobsRepository();
  const [confirmPhase, setConfirmPhase] = useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [confirmJob, setConfirmJob] = useState<{
    id: string;
    attemptKey: string;
    status: string;
    createdAt: string;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const navigate = (next: CustomizerView) => {
    setView(next);
    if (next === "diseno") {
      setConfirmed(false);
      setConfirmPhase("idle");
      setConfirmError(null);
      setConfirmJob(null);
    }
  };
  const handleConfirm = () => {
    if (confirmPhase === "working") return;
    const coordinator = coordinatorRef.current;
    const repository = jobsRepoRef.current;
    if (!coordinator || !repository) return;
    // Snapshot captured synchronously per attempt; confirm() persists
    // async. The synchronous inflight guard makes a double click issue
    // ONE durable write.
    setConfirmPhase("working");
    setConfirmError(null);
    const draft = {
      texts,
      icons,
      graphics,
      approved,
      circularLines,
      resolveIcon: (iconId: string) => {
        const found = iconById[iconId];
        if (!found) return null;
        return {
          id: found.id,
          name: found.name,
          category: found.category,
          paths: [...found.paths],
        };
      },
    };
    void coordinator
      .confirm(draft, undefined, async (input) => {
        const stored = await repository.create({
          attemptKey: input.attemptKey,
          composition: input.composition,
          ...(input.customer ? { customer: input.customer } : {}),
        });
        if (!stored.ok)
          return {
            ok: false as const,
            error: {
              code: stored.error.code,
              message: stored.error.message,
            },
          };
        return {
          ok: true as const,
          job: {
            id: stored.job.id,
            attemptKey: stored.job.attemptKey,
            status: stored.job.status,
            createdAt: stored.job.createdAt,
          },
        };
      })
      .then((result) => {
        // Late-completion guard: an edit while the write was in flight
        // mints a new key/revision, so a stale success must never mark
        // the changed design confirmed.
        if (
          result.attemptKey !== coordinator.currentKey() ||
          result.revision !== coordinator.currentRevision()
        )
          return;
        if (result.ok) {
          setConfirmed(true);
          setConfirmPhase("done");
          setConfirmJob({
            id: result.job.id,
            attemptKey: result.job.attemptKey,
            status: result.job.status ?? "pending",
            createdAt: result.job.createdAt ?? "",
          });
        } else {
          // Every failure (storage/typed error, CONFLICT included) is
          // retryable with the SAME attempt: the coordinator retained
          // the key, so retrying simply calls handleConfirm again.
          // CONFLICT is repository state, never user-blaming input.
          setConfirmPhase("error");
          setConfirmError({
            code: result.error.code,
            message: result.error.message ?? "No se pudo guardar el trabajo.",
          });
        }
      });
  };
  const selectText = (id: string | null) => {
    setSelectedText(id);
    setSelectedIcon(null);
    setSelectedGraphic(null);
    setSelectedApproved(null);
  };
  const selectIcon = (id: string) => {
    setSelectedIcon(id);
    setSelectedText(null);
    setSelectedGraphic(null);
    setSelectedApproved(null);
  };
  const selectGraphic = (id: string) => {
    setSelectedGraphic(id);
    setSelectedText(null);
    setSelectedIcon(null);
    setSelectedApproved(null);
  };
  const selectApproved = (id: string) => {
    setSelectedApproved(id);
    setSelectedText(null);
    setSelectedIcon(null);
    setSelectedGraphic(null);
  };
  const freeAngle = (seed: number) => {
    const candidates = [90, 270, 180, 45, 135, 225, 315, 0];
    const occupied = [...texts, ...icons, ...graphics, ...approved].map(
      (item) => item.angle,
    );
    return (
      candidates.find((candidate) =>
        occupied.every(
          (value) => Math.abs(((candidate - value + 540) % 360) - 180) > 30,
        ),
      ) ?? (90 + seed * 40) % 360
    );
  };
  const updateIcon = (id: string, changes: Partial<DesignIcon>) =>
    setIcons((current) =>
      current.map((icon) =>
        icon.id === id ? normalizeIcon({ ...icon, ...changes }) : icon,
      ),
    );
  const deleteIcon = (id: string) => {
    setIcons((current) => current.filter((icon) => icon.id !== id));
    setSelectedIcon(null);
  };
  const updateGraphic = (
    id: string,
    changes: Partial<UploadedGraphicElement>,
  ) =>
    setGraphics((current) =>
      current.map((graphic) =>
        graphic.id === id
          ? normalizeUploadedGraphic({ ...graphic, ...changes })
          : graphic,
      ),
    );
  const deleteGraphic = (id: string) => {
    setGraphics((current) => current.filter((graphic) => graphic.id !== id));
    setSelectedGraphic(null);
  };
  const updateApproved = (
    id: string,
    changes: Partial<ApprovedDesignInstance>,
  ) =>
    setApproved((current) =>
      current.map((item) =>
        item.id === id
          ? normalizeApprovedDesign({ ...item, ...changes })
          : item,
      ),
    );
  const deleteApproved = (id: string) => {
    setApproved((current) => current.filter((item) => item.id !== id));
    setSelectedApproved(null);
  };
  const confirmGraphic = (result: VectorizedResult) => {
    const graphic = uploadedGraphicFromVectorized(
      result,
      freeAngle(graphics.length),
    );
    setGraphics((current) => [...current, graphic]);
    selectGraphic(graphic.id);
    setUploadOpen(false);
  };
  const addIcon = (iconId: string) => {
    const candidates = [90, 270, 180, 45, 135, 225, 315, 0];
    const occupied = [...texts, ...icons, ...graphics, ...approved].map(
      (item) => item.angle,
    );
    const angle =
      candidates.find((candidate) =>
        occupied.every(
          (value) => Math.abs(((candidate - value + 540) % 360) - 180) > 30,
        ),
      ) ?? (90 + icons.length * 40) % 360;
    const icon: DesignIcon = {
      id: crypto.randomUUID(),
      type: "icon",
      iconId,
      angle,
      radius: ICON_CENTER,
      scale: 1,
      rotation: 0,
      mirrored: false,
      inverted: false,
    };
    setIcons((current) => [...current, icon]);
    selectIcon(icon.id);
    setDrawerOpen(false);
  };
  const addApproved = (design: RenderableDesign) => {
    const instance = approvedDesignFromCatalog(
      design,
      freeAngle(approved.length),
    );
    setApproved((current) => [...current, instance]);
    selectApproved(instance.id);
    setApprovedOpen(false);
  };
  const createText = (): TextElement => ({
    id: crypto.randomUUID(),
    text: "Tu texto",
    fontFamily: TYPOGRAPHY_FONT_LIST[0].family,
    angle: 0,
    radius: TEXT_RADIUS.initial,
    inverted: false,
  });
  const updateText = (
    id: string,
    changes: Partial<Omit<TextElement, "id">>,
  ) => {
    setTexts((current) =>
      current.map((text) =>
        text.id === id
          ? {
              ...text,
              ...changes,
              scale: clampTextScale(changes.scale ?? text.scale ?? 1),
              radius: clampTextRadius(
                changes.radius ?? text.radius,
                changes.scale ?? text.scale ?? 1,
              ),
            }
          : text,
      ),
    );
  };
  const deleteText = (id: string) => {
    setTexts((current) => current.filter((text) => text.id !== id));
    setSelectedText(null);
  };
  return (
    <main className="customizer" aria-label="Personalizador de mates Mate&Co">
      <aside className="sidebar" aria-label="Diseño">
        <StepNavigation view={view} onNavigate={navigate} />
        {view === "diseno" ? (
          <DesignPanel
            selected={texts.find((text) => text.id === selectedText) ?? null}
            onAdd={() => {
              const text = createText();
              setTexts((current) => [...current, text]);
              selectText(text.id);
            }}
            selectedIcon={
              icons.find((icon) => icon.id === selectedIcon) ?? null
            }
            onAddIcon={() => setDrawerOpen(true)}
            onUpdateIcon={updateIcon}
            selectedGraphic={
              graphics.find((graphic) => graphic.id === selectedGraphic) ?? null
            }
            onUploadImage={() => setUploadOpen(true)}
            onUpdateGraphic={updateGraphic}
            selectedApproved={
              approved.find((item) => item.id === selectedApproved) ?? null
            }
            onAddApproved={() => setApprovedOpen(true)}
            onUpdateApproved={updateApproved}
            onUpdate={updateText}
            circularLines={circularLines}
            onCircularLinesChange={setCircularLines}
            onContinue={() => navigate("confirmar")}
          />
        ) : (
          <ConfirmPanel
            texts={texts}
            icons={icons}
            graphics={graphics}
            approved={approved}
            circularLines={circularLines}
            confirmed={confirmed}
            onBack={() => navigate("diseno")}
            onConfirm={handleConfirm}
            confirmPhase={confirmPhase}
            confirmJob={confirmJob}
            confirmError={confirmError}
            onRetry={handleConfirm}
          />
        )}
        <div className="user-card">
          <span className="avatar" aria-hidden="true">
            SL
          </span>
          <span className="user-name">Santiago Lareu</span>
          <button type="button" className="logout">
            Cerrar sesión
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3H4v18h5M13 7l5 5-5 5M8 12h13" />
            </svg>
          </button>
        </div>
      </aside>
      <MatePreview
        texts={texts}
        editing={view === "diseno"}
        selectedText={selectedText}
        icons={icons}
        selectedIcon={selectedIcon}
        onSelectIcon={selectIcon}
        onUpdateIcon={updateIcon}
        onDeleteIcon={deleteIcon}
        graphics={graphics}
        selectedGraphic={selectedGraphic}
        onSelectGraphic={selectGraphic}
        onUpdateGraphic={updateGraphic}
        onDeleteGraphic={deleteGraphic}
        approved={approved}
        selectedApproved={selectedApproved}
        onSelectApproved={selectApproved}
        onUpdateApproved={updateApproved}
        onDeleteApproved={deleteApproved}
        circularLines={circularLines}
        onSelectText={selectText}
        onUpdateText={updateText}
        onDeleteText={deleteText}
      />
      <IconDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChoose={addIcon}
      />
      <ApprovedDesignDrawer
        open={approvedOpen}
        onClose={() => setApprovedOpen(false)}
        onChoose={addApproved}
      />
      <ImageUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onConfirm={confirmGraphic}
      />
    </main>
  );
}
