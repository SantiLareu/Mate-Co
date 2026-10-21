/**
 * J2 — "Trabajos pendientes" inside /admin (Stage 2, S4).
 *
 * Separate read-only section: NOT a new route and NOT a redesign of the
 * admin designs CRUD. It lists confirmed jobs (identifier, creation date,
 * status, original preview) with an optional customer line ONLY when the
 * stored job actually carries customer data — nothing is invented, and
 * no customer fields exist in this stage, so the line is absent today.
 *
 * Read-only detail per job, honest storage errors and visible skipped
 * (invalid) records. No delete/edit/processing buttons anywhere: jobs
 * are immutable in this stage. Previews render through
 * JobSnapshotPreview (embedded definitions, instance-scoped ids).
 */
import { useEffect, useRef, useState } from "react";
import {
  createJobsRepository,
  type SkippedJob,
  type StoredJob,
} from "../jobs/repository";
import { normalizeJobCompositionForPreview } from "../jobs/snapshot";
import JobSnapshotPreview from "./JobSnapshotPreview";

function formatDate(createdAt: string): string {
  try {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return createdAt;
    return date.toLocaleString("es");
  } catch {
    return createdAt;
  }
}

function JobCard({
  job,
  onOpen,
}: {
  job: StoredJob;
  onOpen: (attemptKey: string) => void;
}) {
  return (
    <li data-testid="jobs-pending-item" className="jobs-pending-card">
      <JobSnapshotPreview
        composition={job.composition}
        instanceId={`job-card-${job.attemptKey}`}
        testId={`job-snapshot-${job.attemptKey}`}
        label={`Vista previa del trabajo ${job.id}`}
      />
      <div className="jobs-pending-card-body">
        <strong>{job.id}</strong>
        <span className="jobs-pending-meta">
          {formatDate(job.createdAt)} · pendiente
        </span>
        <button
          type="button"
          data-testid={`jobs-pending-open-${job.attemptKey}`}
          className="admin-lab-ghost"
          onClick={() => onOpen(job.attemptKey)}
        >
          Ver detalle
        </button>
      </div>
    </li>
  );
}

function JobDetail({ job, onBack }: { job: StoredJob; onBack: () => void }) {
  const preview = normalizeJobCompositionForPreview(job.composition);
  return (
    <section
      data-testid="jobs-pending-detail"
      className="jobs-pending-detail"
      aria-label={`Detalle del trabajo ${job.id}`}
    >
      <button
        type="button"
        data-testid="jobs-pending-back"
        className="admin-lab-ghost"
        onClick={onBack}
      >
        ← Volver a la lista
      </button>
      <h3>{job.id}</h3>
      <p className="jobs-pending-meta">
        Creado: {formatDate(job.createdAt)} · Estado: pendiente
      </p>
      {/* J3: explicit open-in-physical-lab control (Stage 2, S5). A plain
          link to the existing /production-lab route with ?jobId: no auto
          redirect, no new route architecture. The lab resolves the job
          read-only and names missing/corrupt/unavailable cases instead of
          falling back to its demo fixture. */}
      <p className="jobs-pending-meta">
        <a
          data-testid={`jobs-pending-open-in-lab-${job.attemptKey}`}
          className="jobs-open-lab"
          href={`/production-lab?jobId=${encodeURIComponent(job.attemptKey)}`}
        >
          Abrir en laboratorio físico
        </a>
      </p>
      {job.customer &&
      (job.customer.name !== undefined || job.customer.note !== undefined) ? (
        <p data-testid="jobs-pending-customer" className="jobs-pending-meta">
          Cliente:{" "}
          {[job.customer.name, job.customer.note]
            .filter((part) => part !== undefined && part !== "")
            .join(" — ")}
        </p>
      ) : null}
      <JobSnapshotPreview
        composition={job.composition}
        instanceId={`job-detail-${job.attemptKey}`}
        testId={`job-snapshot-detail-${job.attemptKey}`}
        label={`Vista previa del trabajo ${job.id}`}
      />
      <dl className="jobs-pending-facts">
        <div>
          <dt>Textos</dt>
          <dd>{job.composition.texts.length}</dd>
        </div>
        <div>
          <dt>Íconos</dt>
          <dd>
            {preview.icons.length > 0
              ? preview.icons.map((icon) => icon.title).join(", ")
              : "0"}
          </dd>
        </div>
        <div>
          <dt>Imágenes</dt>
          <dd>{job.composition.graphics.length}</dd>
        </div>
        <div>
          <dt>Diseños</dt>
          <dd>{job.composition.approved.length}</dd>
        </div>
        <div>
          <dt>Líneas</dt>
          <dd>{job.composition.circularLines}</dd>
        </div>
      </dl>
      <p className="admin-lab-muted">{preview.fontNote}</p>
    </section>
  );
}

export default function PendingJobs() {
  const storeRef = useRef(createJobsRepository());
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [skipped, setSkipped] = useState<SkippedJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const listed = await storeRef.current.list({ limit: 100 });
      if (!alive) return;
      if (!listed.ok) {
        setError(listed.error.message);
        setJobs([]);
        setSkipped([]);
      } else {
        setError(null);
        setJobs(listed.jobs);
        setSkipped(listed.skipped);
      }
      setLoading(false);
    };
    void refresh();
    return storeRef.current.subscribe(() => {
      void refresh();
    });
  }, []);

  useEffect(() => {
    if (selected !== null && !jobs.some((job) => job.attemptKey === selected))
      setSelected(null);
  }, [jobs, selected]);

  const detail =
    selected !== null
      ? (jobs.find((job) => job.attemptKey === selected) ?? null)
      : null;

  return (
    <section
      data-testid="jobs-pending-section"
      aria-label="Trabajos pendientes"
      className="jobs-pending"
    >
      <h2 className="jobs-pending-title">Trabajos pendientes</h2>
      <p className="admin-lab-muted">
        Diseños confirmados por clientes, guardados localmente en este
        navegador. Solo lectura: no se pueden editar ni procesar desde aquí.
      </p>
      {loading ? (
        <p className="admin-lab-muted">Cargando trabajos…</p>
      ) : error !== null ? (
        <p
          data-testid="jobs-pending-error"
          role="alert"
          className="admin-lab-error"
        >
          {error}
        </p>
      ) : detail !== null ? (
        <JobDetail job={detail} onBack={() => setSelected(null)} />
      ) : (
        <>
          {jobs.length === 0 ? (
            <p data-testid="jobs-pending-empty" className="admin-lab-empty">
              Todavía no hay trabajos confirmados en este navegador.
            </p>
          ) : (
            <ul data-testid="jobs-pending-list" className="admin-lab-grid">
              {jobs.map((job) => (
                <JobCard key={job.attemptKey} job={job} onOpen={setSelected} />
              ))}
            </ul>
          )}
          {skipped.length > 0 ? (
            <p data-testid="jobs-pending-skipped" className="admin-lab-muted">
              Aviso: {skipped.length}{" "}
              {skipped.length === 1
                ? "registro dañado quedó"
                : "registros dañados quedaron"}{" "}
              fuera de la lista y los válidos están intactos:{" "}
              {skipped.map((entry) => entry.reason).join(" ")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
