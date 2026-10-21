# Confirmed local design jobs

Local prototype integration between customer confirmation, admin pending jobs and physical lab.
No commit/push. Preserve existing dirty branch and all catalog records.

## Specs
S1: "Cuando el cliente confirme definitivamente su personalización, crear un trabajo con una copia completa y autónoma de la composición." "No guardar solamente IDs que dependan de la biblioteca actual." Capture texts/icons including resolved definitions/graphics/full approved snapshots/circular lines and all pose/source-render fields, not transient selection/view state.
S2: "La confirmación debe ser inequívoca: no generar trabajos por visitar la pantalla Confirmar, retroceder o actualizar la página." "Evitar duplicaciones por doble clic o reintentos." Explicit final button only, atomic idempotency by confirmation attempt; unchanged retry/back-confirm reuses attempt, edits create a new attempt. Never global FNV/content-only dedup across independent drafts.
S3: "Crear un repositorio de trabajos independiente de la biblioteca de diseños." "No perder silenciosamente los trabajos ni reportar éxito si el guardado falló." Versioned schema and bounded validation, explicit errors, no catalog writes/migration; immutable detached self-contained jobs.
S4: "Agregar una sección **Trabajos pendientes** dentro de `/admin`." Show identifier/date/status/original preview and customer data only if actually provided; read-only detail. No required customer fields or invented customer records, no new order workflow.
S5: "Permitir abrir un trabajo guardado desde el administrador en el laboratorio físico." Keep demo fixture available; selected job is source of original, never silent fallback for missing/corrupt/storage error. Reuse existing physical policy: annular radial positions, outer-diameter sizes, no distortion/cosmetic changes, visible diagnostics, original unchanged.
S6: "No implementar todavía backend, pagos, emails ni sistema de autenticación." "No presentar localStorage o IndexedDB como almacenamiento compartido entre clientes reales y administrador." "No modificar el exportador productivo ni eliminar el bloqueo existente para SVGs aprobados."
S7: "Confirmación real del cliente." "Prevención de duplicados." "Persistencia y recarga." "Integridad del snapshot." "SVG aprobado que sigue funcionando aunque se elimine o desactive de la biblioteca." "Listado y detalle administrativo." "Apertura del trabajo en production-lab." "Adaptación a diferentes medidas." "Preservación del diseño original." "Errores de almacenamiento." "Compatibilidad con las funcionalidades existentes." Run typecheck/build/focused/full suite with real public flows, no retries/timeout increases to hide failures.
S8: "No hacer commit ni push." Scope Stage2 only; use necessary minimal integration seams, no unrelated refactors or functionality.

## Architecture decisions
Audit mvbv716j-f-kccj completed: App owns complete composition, definitive onConfirm currently toggles boolean only; existing customer card is static copy, no actual customer model/input, so no customer fields added. Jobs use native IndexedDB behind an async repository, own database/object store/version, never reuse catalog localStorage key or call its writes. Store complete versioned snapshots; safe existing validators/helpers reused read-only. Built-in icon definitions must be embedded; fonts remain environment-dependent unless already embedded, document fidelity limit.
Idempotency is explicit attempt identity, not weak global composition fingerprint: same unchanged in-session confirmation/retry/back-confirm reuse a stable key; new draft or changed composition allows a new job. Repository atomically get/add by key and checks mismatched payload rather than overwriting. Successful durable transaction required before UI reports saved; failed save retains retry identity. Client concurrency/in-flight completion must not falsely mark a changed design confirmed.
Status only pending in Stage2; immutable read-only jobs/detail, no processing/completion transitions. Repository validates hostile/corrupt structured values with size/depth/count budgets, isolates invalid records and reports errors without deleting data. Local-only browser/origin, not real shared storage.
Multiple original previews need instance-scoped SVG IDs and embedded icon definitions; optional backward-compatible renderer seams preferred, no global icon-catalog mutation. V3 assets stay isolated full SVG documents. Lab resolves ?jobId= read-only, explicit errors, default/demo still available; snapshot-to-composition adapter, no job mutation. Fix current child doneKeys vs parent advances ownership/key race, test A→B→A.

## Tasks
- [x] J1: Self-contained immutable snapshot/validators/native IndexedDB repository/idempotent confirmation coordinator plus tests. Single bounded writer, multi-file/preparation trigger. No UI changes first unit. Validate actual model reuse, atomic persistence/duplicates/failures/isolation. Implemented by mvbvfvrk-g-jqll, RED missing-module→GREEN25/typecheck/build; independent review F1–F10 applied during J2.
- [x] J2: Explicit customer confirm integration, admin pending list/detail and correctly scoped faithful previews; minimal optional renderer support for embedded icon definitions. Sequential writer after J1. Tests actual confirm/no visiting/back/refresh side effects/double click/retry/faults/admin and asset deletion independence. Writer mvbwn5jj-i-lrlq: observed RED F1/F2/confirm-job→GREEN group1 35/35 (24.2s) + group2 34/34 (56.5s), typecheck/build success; one cold-reload flake reported (7.7h timer artifact), rerun 35/35 without masking; parent re-validates groups after J3. F5/F6/F7/F10/F8/F9 resolved/documented; CONFLICT retryable; no edits/exports to jobs.
- [x] J3: Writer mvce2cfw-j-zewy integrated /production-lab?jobId=<attemptKey> read-only resolver + immutable adapter + admin detail open control + measurement-race fix (A→B→A, parent-owned key) + tests/production-lab-jobs.spec.ts 10new. Parent spot-read seams: link uses stored attemptKey encoded, lab get read-only no writes/subscribes, named error states (lab-job-error/data-code), demo default byte-identical, measurement identity composition+texts+fonts. Focused 23/23 lab + 35/35 jobs, typecheck/build pass.
- [x] J4: Independent data integrity/idempotency/security and flow/render/physical fidelity review, bounded real fixes, final typecheck/build/focused/full verification. Independent verifier mvcekytx-k-bzob: focused groups 35/35, 23/23, 34/34; FULL suite 427/427 (0 fail/0 skip, 4.2m); typecheck clean, build 1.01s; zero flakes (no retries), workspace byte-stable. S1–S8 all MET with path:line evidence; 0 blockers; advisories: production JOBS_DB_NAME in ephemeral contexts, asset-deletion independence proven via zero-catalog-entry equivalent, fonts environment-dependent. Stage2 verified for closure.

## Evidence and next step
Current baseline382/382 after explicit diagnostic, original earlier3timeouts retained historically; hashes95 source/test/config files were unchanged in diagnosis. Windows cmd.exe/npm.cmd Chromium existing, no install needed. Branch experiment/illustration-stencil already dirty; no commits authorized. Forecast ~1500–2300 authored lines including tests advisory, tasks sequential because dependencies, no artificial splitting/minification. Begin J1 only, then integrate and review; preserve legacy data and fixture bytes.

## Next step
Stage2 verified by independent J4 (427/427 full, S1–S8 MET, 0 blockers). Report delivered to owner. Stage3 recommendation: physical SVG production/export pipeline with deterministic font outlines, vector asset embedding/local-ID policy, engraver tolerance inputs and export contract; separately backend/admin storage when needed. No commit/push until owner authorizes.

## Log
L1 Original request (verbatim):
# Mate&Co — Etapa 2: Diseños confirmados y trabajos pendientes

Trabajá con el flujo multiagente Full-Code disponible. Realizá implementación y revisión independiente cuando corresponda.

**Objetivo:** integrar el personalizador actual, el panel administrador y el laboratorio físico mediante trabajos confirmados persistidos localmente.

No hacer commit ni push sin autorización.

## 1. Auditoría previa

Revisá cómo están implementados:

- Estado completo del diseño del cliente.
- Paso de confirmación.
- Modelos de textos, íconos y diseños SVG aprobados.
- Biblioteca del administrador.
- `/production-lab` y su motor geométrico.
- Persistencia local existente.

Identificá qué estructuras se pueden reutilizar para evitar duplicación o inconsistencias.

## 2. Snapshot inmutable del diseño

Cuando el cliente confirme definitivamente su personalización, crear un trabajo con una copia completa y autónoma de la composición.

Debe preservar todas las propiedades necesarias para reconstruir exactamente el diseño original, incluidos los SVG aprobados y sus dependencias.

No guardar solamente IDs que dependan de la biblioteca actual.

La confirmación debe ser inequívoca: no generar trabajos por visitar la pantalla Confirmar, retroceder o actualizar la página.

Evitar duplicaciones por doble clic o reintentos.

## 3. Persistencia local

Crear un repositorio de trabajos independiente de la biblioteca de diseños.

Usar una solución local apropiada para un prototipo, con validación de esquema, versión de formato y manejo explícito de errores de almacenamiento.

No perder silenciosamente los trabajos ni reportar éxito si el guardado falló.

No eliminar ni modificar los datos existentes del panel administrador.

## 4. Panel administrador

Agregar una sección **Trabajos pendientes** dentro de `/admin`.

Cada trabajo debe mostrar:

- Identificador.
- Fecha de creación.
- Estado.
- Vista previa del diseño original.
- Datos del cliente, si fueron proporcionados.

Permitir abrir el detalle de cada trabajo.

No inventar datos del cliente ni exigir campos nuevos sin justificar su ubicación dentro del flujo actual.

## 5. Integración con production-lab

Permitir abrir un trabajo guardado desde el administrador en el laboratorio físico.

Sustituir el fixture de demostración por la composición real seleccionada, sin eliminar la posibilidad de seguir utilizando el fixture como caso de prueba.

Reutilizar el motor geométrico existente.

Permitir introducir diámetro exterior e interior en mm y generar la vista adaptada.

La adaptación debe mantener la política ya acordada:

- Posiciones radiales adaptadas a la nueva banda.
- Tamaños escalados según diámetro exterior.
- Sin ajustes cosméticos automáticos.
- Sin deformar los SVG aprobados.
- Advertencias geométricas visibles.
- Diseño original intacto.

## 6. Seguridad y límites

No implementar todavía backend, pagos, emails ni sistema de autenticación.

No presentar localStorage o IndexedDB como almacenamiento compartido entre clientes reales y administrador.

No modificar el exportador productivo ni eliminar el bloqueo existente para SVGs aprobados.

No incorporar funcionalidades ajenas a esta etapa.

## 7. Pruebas

Incluir casos automatizados para:

- Confirmación real del cliente.
- Prevención de duplicados.
- Persistencia y recarga.
- Integridad del snapshot.
- SVG aprobado que sigue funcionando aunque se elimine o desactive de la biblioteca.
- Listado y detalle administrativo.
- Apertura del trabajo en production-lab.
- Adaptación a diferentes medidas.
- Preservación del diseño original.
- Errores de almacenamiento.
- Compatibilidad con las funcionalidades existentes.

Ejecutar typecheck, build, pruebas específicas y suite completa.

## 8. Entrega

Informar:

1. Arquitectura implementada.
2. Archivos nuevos y modificados.
3. Flujo manual exacto para probarlo.
4. Resultados de todas las pruebas.
5. Riesgos y limitaciones.
6. Estado de Git.
7. Recomendación para la siguiente etapa.

No hacer commit ni push.

L3 J3 delivered with parent seam spot-check; J4 verifier dispatched.
L4 J4 verification completed: 427/427 full suite, S1–S8 all MET, 0 blockers, zero flakes, no retries. Advisories documented. Stage2 closed without commit/push per S8.
