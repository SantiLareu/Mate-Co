# Admin approved design library

## Intent and constraints
Isolated /admin-lab Spanish owner CRUD for prepared engraving SVGs. No backend/auth/editor/physical-mm integration, vectorization/rasterization/Canvas, production behavior changes, commits/push. Preserve pre-existing dirty work.

## Architecture
Lazy pathname route; strict svg/g/path admission over unchanged parseSvgImport; shared bounded grammar and analytic bounds, original d/composed matrices/uniform fillRule. Versioned ApprovedDesign and async AdminDesignRepository; geometry-only previews. Corrupt records isolated, original envelope preserved read-only; future physical placement separate.

## Completed tasks
- [x] T1: Admission/model/repository with strict bounded upload/read validation, analytic geometry and corruption safety. Single delegated writers, observed RED/GREEN; final independent29 repository tests pass.
- [x] T2: Isolated owner UI/route/search/categories/status/CRUD/safe preview/persistence/accessibility and errors. Windows browser17 admin tests pass after root-cause fixes.
- [x] T3: Independent security/reliability/coupling/future-integration review, findings corrected and independent full regression suite. Native review RDD off; dedicated reviewer dispatch unavailable without lineage, explorer fallback plus verifier used.

## Evidence
Earlier Linux browser-blocked status superseded by existing Windows runtime through interop, no installation. Follow-up fixes documented odd/tasks/admin-lab-windows-fixes.md: canonical SVG whitelist, closed-details JSON test reader, XML namespace fixture, raster selector, rejection classification/test form prerequisites. Independent Windows full177/177 across11 files,0 failures/skips; typecheck/build pass. No remaining tested blocker, no commits/push. Created src/admin-lab/**, src/styles/admin-lab.css, tests/admin-lab*.spec.ts and isolated entry src/main.tsx; production editor/importer unchanged.

## Remaining limitations and next step
Owner visual/product acceptance next. localStorage last-write-wins not atomic or remote backup; corrupt envelopes need explicit manual recovery; lab is not authenticated. Packed arc flags/primitives/metadata outside approved subset require external preparation. Backend/editor/physical-mm production workflow not implemented. Production permissions, backup/recovery and physical scale/tolerance are future decisions.
