# Trusted admin SVG import

## Intent and constraints
Admin decides engraving suitability. Software checks web security/bounded parsing/technical editable geometry only, preserves supported art, simple success/error UI. No commits/push/install/editor/export/raster/VTracer/strategies/mm changes; existing dirty work preserved.

## Architecture
Private svgGeometryImport reuses unchanged public transform/primitive helpers (shared parse output not used due stroke/opacity policy). ImportedGeometry v2 original paths/composed matrices/safe paints/strokes and ordered opacity groups; explicit safe React props only, no raw markup. Editable centerline and conservative visible-paint bounds derived separately, runtime projection and identical load checks. v1 normalized in memory preserving persisted format, original envelope/key unchanged; corrupt/unknown versions read-only.

## Completed tasks
- [x] A1: Bounded importer/model/admission/repository and backward compatibility with RED/GREEN security/style/metadata/primitive/budget/corruption tests. Sequential delegated writers.
- [x] A2: Simple requested messages, controlled styled preview/CRUD/reload/accessibility/async selection races, obsolete engraving-policy tests replaced by fidelity/security assertions. Sequential writer.
- [x] A3: Independent security and ordinary-SVG compatibility reviews; real findings corrected/test-first, independent security follow-up confirmed F1/F2 resolved, full Windows verification completed. RDD off; ASSESS unassessable existing untracked scope, independent verifier used.

## Evidence
Baseline177; unit22/integration215/securitycompat231/final242 passing writer. Final independent verifier muxlkrrw-9-trxf: Windows cmd.exe cwd C:\Mate&Co npm.cmd test:interaction -- --list242/12files; full242 passed0failed0skipped2.7m; typecheck clean; build896ms. Security follow-up muxlky1e-a-92xg confirmed linear monotonic scanners/full-document audit/DTD neutralization/no concrete bypass. No install needed.
Corrections: quadratic audit regex→linear scanner; any-ns ignored effect audit; early tag count/numeric converter assertions; inert clip-rule/root percent viewBox/empty placeholders/CSS enum case/canonical W3C DTD no-fetch; painted invisible bounds without deleting geometry/opacity flatten. Old v2 accepted only recomputed current/exact historical envelope and sanitized tightly, no read rewrite/forged claim trust. Hostile600KB samples tens ms; no laser judgement.

## Files
Created src/admin-lab/svgGeometryImport.ts, importedGeometry.ts, tests/admin-lab-trusted-import.spec.ts. Modified src/admin-lab/admission.ts, types.ts, repository.ts, AdminLab.tsx, geometry.ts, README.md; src/styles/admin-lab.css; tests/admin-lab-admission.spec.ts, admin-lab-repository.spec.ts, admin-lab.spec.ts. Tracking file/memory updated. Shared-source unchanged evidence from prior state+mtimes (workspace pre-dirty, no committed baseline).

## Remaining limitations and next step
Technical unsupported referenced paint servers/clip/mask/filter/use/nestedSVG/stylesheets/animations/nonroot percent lengths/text/raster; exact helpful reasons, not engraving-invalid. Conservative stroke bounds may overpad, no observed clipping. Legacy animateColor/mpath ignored under defs is nonsevere policy completeness gap, remote references still audited; no concrete bypass. localStorage non-atomic last-write-wins/manual corrupt recovery, no auth/backend/production integration. Realistic synthetic SVG fixtures only, no actual admin corpus supplied: owner should try actual source exports for UX acceptance. Production/editor/mm next stage requires separate authorization. No commit/push.
