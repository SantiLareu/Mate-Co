# Approved design editor integration

## Specs
S1: "Los diseños activos cargados por el administrador deben aparecer dentro del editor del cliente como una biblioteca seleccionable." "El cliente NO debe poder subir SVG arbitrario desde este flujo." "NO duplicar la biblioteca en otro archivo." Existing repository read-only, enabled only.
S2: "NO borrarlos todavía." Demo icons/raster coexist with "Agregar diseño" drawer; search/categories/previews, empty "Todavía no hay diseños disponibles." No admin controls.
S3: "El asset SVG aprobado es inmutable." Instance id/approvedDesignId/angle/radius/scale/rotation/mirrored/inverted plus detached validated snapshot. Preserve full source viewBox/styles/internal transforms/refs; no internal path editing/flattening. Admin update/delete/disable affects future catalog, not placed snapshots.
S4: "No reinventar interaction system." Reuse useDirectDrag/captured CTM/angular+radial snap/handles/exclusive selection/mobile stable panel/touch scroll. External unit pose, independent multiples. Isolated Blob SVG documents protect IDs/local refs/CSS without rewriting source; unique wrapper/control IDs.
S5: "Diseño → Confirmar → volver a Diseño" retains App state. User chose "Integrar hasta Confirmar; bloquear esa exportación". Approved instances block export with clear message; original export works for others. No physical-mm implementation.
S6: "Usar MESSI-SILHOUETTE.svg / el ApprovedDesign correspondiente como regresión real." Real immutable fixture, admin→active→select→move→scale→rotate→mirror→Confirmar→back. Cover17 requested cases incl pixels/localID/mobile/empty/filtering.
S7: "No commit. No push." No Access/backend/login/mm/diameters/raster vectorization/VTracer/strategies/sanitizer-v3 changes; preserve pre-existing dirty work.

## Architecture
Single repository read-only catalog, App source and per-instance frozen top snapshot+pose. v3 immutable shared SVG string and copied/frozen viewBox; v1/v2 mutable structures detached element-wise (NOT deep-frozen) and runtime consumers read-only. v3 isolated vector Blob image, legacy safe controlled geometry. Explicit source width/height defines viewport when provided (browser verified), viewBox preserved internally. localStorage same-origin/browser only, no remote catalog. Future backend read seam and separate physical placement/export.

## Completed tasks
- [x] E1: Catalog/model/drawer, real previews, filtered-no-match+clear, faithful raw-bounds legacy thumb and detached snapshot guards. Delegated writer then corrections/tests.
- [x] E2: Shared interactions/exclusive selection/App state/Confirmar/export guard, dynamic knockout envelope and safe source-tagged Blob lifetime; real pointer/mobile/cross-tab/Messi public flows. No exporter code changes.
- [x] E3: Independent architecture/mobile/fidelity reviews corrected concrete issues, final independent verifier mv6tk7il-9-dhly confirmed S1–S7/current candidate. Native ASSESS unassessable dirty untracked scope,RDDoff; independent verifier used. No commit/push.

## Evidence
Observed writer RED20initial then21new/332full; review corrections32new/343full; proven raw-viewBox thumbnail-fit and nested alias RED→33new/344full. Final independent Windows cmd.exe/npm.cmd: --list344tests/15files; full344passed0failed0skipped3m51s; typecheckexit0; buildexit0/917ms85modules. Parent final current-candidate typecheck spotexit0. No retries/restarts by final verifier.
Thumbnail test31 verifies viewBox5,5,30,30/raw matrix, no fit wrapper, actual painted1:1framing; canvas centered64unit fit unchanged. Test33 verifies source detached/frozen v3 viewBox and sourceSVG unchanged under pose. Actual decoded/pixel-distinct red/blue same-ID proof, group/localCSS isolation; tests9/22pointer snapping/scale/rotation;17mobile scrollY/panel/nojump;19real second-tab admin enable updates;26Blobcleanup;18/28realMessi roundtrip/4:3decode. Fixture SHA256 e456ef5da86cdcca3c4371eca66b37ff421da9939c16905edd17e9d05dbad4bc unchanged. Old test changes limited2exact step-name selectors; no weakened assertions. Test-only Canvas pixel read is not production rasterization.

## Files
Created src/approved-designs/{catalog.ts,assetUrl.ts,approvedDesign.ts}, src/components/{ApprovedDesignDrawer.tsx,ApprovedDesignElement.tsx}, tests/approved-design.spec.ts, docs/approved-design-editor.md. Modified App.tsx, DesignPanel.tsx, MatePreview.tsx, ConfirmPanel.tsx, styles/app.css, tests/direct-manipulation.spec.ts and confirm-design.spec.ts exact locators. Fixture/adminv3/exporter unchanged. Dirty baseline limits exhaustive negative-change proof.

## Remaining limitations and next step
Windows Chromium only; no Safari/Firefox evidence. Same-browser/origin localStorage (not published catalog), last-write-wins/manual corruption recovery. Snapshot policy deliberate: disabled/deleted admin asset remains in existing placement. Conservative knockout circle can hide decorative lines beyond silhouette but cannot under-cover; Blob swap may transiently have empty safe frame. Approved physical/export-mm path intentionally blocked; no backend/login/access/mm work. Legacy copies detached not deeply frozen. Owner UX acceptance next; future physical stage needs dimensions/tolerances/layout and v3-preserving exporter contract separate authorization.

## Log
L1 original user requested Full-Code approved library integration,17checks,no commit/push; original conversation authoritative.
L2 user choice "Integrar hasta Confirmar; bloquear esa exportación".
L3 Reviews corrected knockout/URL/CTA/filter/preview and weak proof; speculative intrinsic-ratio change disproved by actual Image browser viewport.
L4 Prior verifier cancelled before thumbnail mutation, no mixed-candidate proof; final verifier ran corrected tree once and passed all344. No pending feature tasks.
