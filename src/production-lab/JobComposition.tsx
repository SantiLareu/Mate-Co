/**
 * J3 — Saved-job adapter for /production-lab (Stage 2, S5).
 *
 * Read-only seam between the jobs repository and the physical lab:
 *
 * - `loadLabJob` resolves `?jobId=` through the EXISTING jobs repository
 *   `get` (no writes, no subscriptions, no new route architecture). Every
 *   failure is a NAMED typed error (NOT_FOUND/CORRUPT/unavailable): the
 *   lab must render it explicitly and NEVER fall back to the demo fixture.
 * - `adaptJobCompositionForLab` builds an IMMUTABLE adapter composition
 *   from the stored snapshot for the physical engine. Pose and source
 *   fields pass through EXACTLY as stored (no clamps, no normalization,
 *   no art rewrites): the annular mapping and outer-diameter sizing live
 *   in the existing geometry module, which extrapolates and reports
 *   instead of clamping. The original rendering keeps using the full
 *   snapshot through `JobSnapshotPreview` (embedded icon definitions,
 *   full v3 Blob / v1v2 controlled geometry, graphics).
 * - Texts keep their stored font family/scale: the advance probe measures
 *   them with the real render after `document.fonts.ready` and the mm
 *   conversion reuses the existing `textMetrics` provenance — advance is
 *   never an ink bbox.
 */
import type { ApprovedDesignInstance } from "../approved-designs/approvedDesign";
import type { TextElement } from "../components/CurvedText";
import type { DesignIcon } from "../components/IconElement";
import type { CircularLines } from "../App";
import {
  createJobsRepository,
  type JobsError,
  type JobsRepository,
  type StoredJob,
} from "../jobs/repository";

/** Immutable adapter composition: lab models mapped 1:1 from the snapshot. */
export interface LabJobComposition {
  texts: TextElement[];
  icons: DesignIcon[];
  approved: ApprovedDesignInstance[];
  circularLines: CircularLines;
  jobId: string;
  attemptKey: string;
}

export type LoadLabJobResult =
  | { ok: true; job: StoredJob }
  | { ok: false; error: JobsError };

function freeze<T>(value: T): T {
  return Object.freeze(value) as T;
}

/**
 * Read-only job resolution for `?jobId=`: one `get` against the existing
 * repository, then the connection closes. Blank keys are a typed INVALID
 * (named missing-job error downstream); the repository itself names
 * NOT_FOUND / CORRUPT / storage-unavailable outcomes.
 */
export async function loadLabJob(
  jobId: string,
  repository?: JobsRepository,
): Promise<LoadLabJobResult> {
  const key = jobId.trim();
  if (key === "" || key.length > 200) {
    return {
      ok: false,
      error: {
        code: "INVALID",
        message: "Ese trabajo no existe: el identificador está vacío.",
      },
    };
  }
  const store = repository ?? createJobsRepository();
  return store.get(key);
}

/**
 * Immutable 1:1 adapter: every pose/source field is preserved exactly as
 * stored. Texts keep id/text/fontFamily/angle/radius/inverted/scale;
 * icons keep their pose (the ORIGINAL pane paints from the embedded
 * definition via JobSnapshotPreview — the adapter never rewrites art);
 * approved instances keep the SAME snapshot reference (already frozen
 * detached copies; v3 bytes shared by reference, never rewritten).
 * Source geometry is preserved: no `normalizeIcon`/`normalizeApproved`
 * clamps, no radius/scale bounding — the physical report maps and
 * reports, it never clamps.
 */
export function adaptJobCompositionForLab(job: StoredJob): LabJobComposition {
  const { composition } = job;
  const texts = composition.texts.map((entry) =>
    freeze({
      id: entry.id,
      text: entry.text,
      fontFamily: entry.fontFamily,
      angle: entry.angle,
      radius: entry.radius,
      inverted: entry.inverted,
      ...(entry.scale !== undefined ? { scale: entry.scale } : {}),
    } as TextElement),
  );
  const icons = composition.icons.map((entry) =>
    freeze({
      id: entry.id,
      type: "icon",
      iconId: entry.iconId,
      angle: entry.angle,
      radius: entry.radius,
      scale: entry.scale,
      rotation: entry.rotation,
      mirrored: entry.mirrored,
      inverted: entry.inverted,
    } as DesignIcon),
  );
  const approved = composition.approved.map((entry) =>
    freeze({
      id: entry.id,
      type: "approved-design",
      approvedDesignId: entry.approvedDesignId,
      snapshot: entry.snapshot,
      angle: entry.angle,
      radius: entry.radius,
      scale: entry.scale,
      rotation: entry.rotation,
      mirrored: entry.mirrored,
      inverted: entry.inverted,
    } as ApprovedDesignInstance),
  );
  return freeze({
    texts: freeze(texts),
    icons: freeze(icons),
    approved: freeze(approved),
    circularLines: composition.circularLines as CircularLines,
    jobId: job.id,
    attemptKey: job.attemptKey,
  });
}

/**
 * Named Spanish error for the lab's explicit job-error state. The code
 * travels in `data-code` for tests; the message names the case in plain
 * language: missing (NOT_FOUND/INVALID), damaged (CORRUPT/CONFLICT), or
 * storage-unavailable (everything else, with the repository detail).
 */
export function labJobErrorMessage(error: JobsError): string {
  switch (error.code) {
    case "NOT_FOUND":
    case "INVALID":
      return `Ese trabajo no existe en este navegador (${error.code}): revisá el enlace o volvé a abrirlo desde el administrador. La demostración no lo reemplaza.`;
    case "CORRUPT":
    case "CONFLICT":
      return `El trabajo guardado está dañado y se conserva intacto (${error.code}): ${error.message} La demostración no lo reemplaza.`;
    default:
      return `El trabajo no se pudo leer porque el almacenamiento no está disponible (${error.code}): ${error.message} La demostración no lo reemplaza.`;
  }
}
