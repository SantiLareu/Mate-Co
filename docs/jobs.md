# Trabajos confirmados locales (Stage 2)

Prototipo local: el cliente confirma su personalización, el trabajo se
guarda en IndexedDB del mismo navegador y el dueño lo revisa en `/admin`.

## Arquitectura

- `src/jobs/snapshot.ts` — snapshot inmutable y autónomo (versión 1):
  copia completa de textos, íconos (definición incorporada, nunca un
  `iconId` al catálogo vivo), gráficos, diseños aprobados (v1/v2/v3
  completos) y líneas circulares. Validadores totales con presupuestos
  de tamaño/profundidad/cantidad; lo inválido se devuelve, nunca se
  lanza ni se oculta.
- `src/jobs/repository.ts` — repositorio nativo IndexedDB con base,
  store y versión propios (`mateco.jobs.v1` / `jobs` / 1): nunca la
  clave del catálogo ni `localStorage`, sin escrituras al catálogo.
  Éxito SOLO en `tx.oncomplete` (escritura y lecturas); errores
  tipados (`UNAVAILABLE/DENIED/QUOTA/BLOCKED/TRANSACTION_ABORTED/
  UNSUPPORTED/CORRUPT/INVALID/NOT_FOUND/CONFLICT`); trabajos
  inmutables en estado `pending`; idempotencia atómica por clave de
  intento en UNA transacción (mismo contenido = mismo trabajo,
  distinto contenido = `CONFLICT`, sin dedup global por contenido).
- `src/jobs/coordinator.ts` — coordinador de confirmación: la ÚNICA
  captura ocurre en `confirm()` explícito (visitar/retroceder/recargar
  nunca escriben); guardia antibloqueo sincrónica por clave (doble
  clic = UNA escritura); reintento sin cambios reusa la clave; un
  cambio acuña clave nueva; el resultado lleva clave/revisión para que
  la UI ignore éxitos tardíos de un diseño ya editado.
- `src/App.tsx` + `src/components/ConfirmPanel.tsx` — el clic
  explícito captura y persiste; el estado muestra el trabajo honesto
  (id/estado) o el error tipado con reintento del mismo intento.
- `src/components/PendingJobs.tsx` — sección **Trabajos pendientes**
  en `/admin` (sin ruta nueva): lista y detalle de solo lectura.
- `src/components/JobSnapshotPreview.tsx` — preview fiel de solo
  lectura con semántica del renderer vivo e ids por instancia.

## Convenciones

- Tests de interacción fuera de `tsconfig.json` (`include: ["src"]`):
  convención del repo, sin cambios de config (F5).
- Cada test usa su propia base de datos o flujos UI con limpieza; el
  catálogo y los datos existentes se preservan intactos.

## Límites honestos

- Almacenamiento local del mismo origen: NO compartido entre cliente
  real y administrador; sin backend, pagos, emails ni autenticación.
- Tipografías dependientes del entorno (nombres, sin vectorizar).
- Exportador productivo y bloqueo de SVGs aprobados intactos.

## J3 — Apertura de trabajos en el laboratorio físico (S5)

- El detalle de cada trabajo en `/admin` ofrece «Abrir en laboratorio
  físico»: un enlace plano a la ruta existente
  `/production-lab?jobId=<attemptKey>` (sin redirección automática, sin
  arquitectura nueva de rutas).
- El laboratorio resuelve el trabajo con un único `get` de solo lectura
  del repositorio existente (sin escrituras ni suscripciones). Trabajo
  inexistente, dañado o ilegible por almacenamiento → estado de error
  explícito con nombre (`lab-job-error`, código en `data-code`); la
  demostración NUNCA lo reemplaza en silencio. Sin `?jobId`, el fixture
  de demostración sigue disponible en su dirección explícita.
- El panel indica la fuente siempre (`lab-source-kind`: `demo`,
  `job-loading`, `job`, `job-error`). El original del trabajo se
  renderiza con `JobSnapshotPreview` (definiciones incorporadas, v3 por
  Blob, v1/v2 por geometría controlada, gráficos incluidos); el motor
  físico reutiliza la política vigente (anclas anulares, tamaño por
  diámetro exterior, sin clamps, diagnósticos visibles) con avances
  medidos por texto almacenado tras `document.fonts.ready`.
- Adaptador en `src/production-lab/JobComposition.tsx`: composición
  inmutable 1:1 desde el snapshot (pose y fuentes preservadas, sin
  normalizar ni reescribir arte; el snapshot aprobado se comparte por
  referencia). Límites declarados: íconos sin entrada en el catálogo
  vivo se pintan en el original pero la vista física conserva solo su
  posición/envolvente en el reporte (`lab-job-icons-note`); las
  imágenes del trabajo viven en el original intacto, fuera del alcance
  del motor físico (`lab-job-graphics-note`).
- La sonda de avances es propiedad del padre: identidad de medición por
  composición+textos+fuentes (`labSourceMeasureKey`), remontaje por
  clave y cierre de completitud sobre la misma clave — el ciclo
  trabajo A → demo → trabajo A siempre completa, sin `doneKeys` hijo
  ni carrera con la referencia del padre.
