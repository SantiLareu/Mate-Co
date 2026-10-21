# Admin lab Windows root-cause fixes

## Intent and constraints
Resolve reported Windows 175 tests/145 pass/30 fail with minimal root-cause fixes. No commits/push/install. Preserve dirty work. No editor/Confirmar/production SVG/VTracer/strategies/drag/snap/model behavior changes; no general security relaxation.

## Completed tasks
- [x] W1: Exact-case SVG whitelist lookup admits canonical viewBox/preserveAspectRatio; invalid dimensions/alternate case regressions added. Shared gate cascade resolved, admin-only invisible-path rejection classification corrected; admission helper supplies required name/category. Delegated single writer, observed Windows RED→GREEN admission12/admin17.
- [x] W2: Closed-details JSON read via textContent with content assertion; xlink fixture namespace declared keeping EXTERNAL_REFERENCE expectation; raster-specific testid/locator, SVG input retained. Delegated sequential writer; RED→GREEN SVG lab9/vectorization29.
- [x] W3: Independent scope/security review and Windows full suite/typecheck/build. Verifier muxdg14p-b-98c2 confirmed all commands, no blockers. Native ASSESS unassessable due existing untracked scope; RDD off, independent verification used.

## Definitive causes
Whitelist lowercased names but stored camelCase standards, masking downstream checks. innerText read hidden JSON as empty, not parser truncation. Unbound xlink prefix made fixture malformed XML. Bare input selector matched two valid controls. Residual test helper omitted required identity; all-invisible paths rejected as NO_GEOMETRY before admin classified them. No rejected content was newly admitted except intended canonical root attrs.

## Changed files
src/admin-lab/admission.ts; tests/admin-lab-admission.spec.ts; tests/svg-import-lab.spec.ts; src/vector-lab/VectorLab.tsx (raster testid only); tests/vectorization.spec.ts. No changes to base importer/diagnostics component/tests/admin-lab.spec.ts. Task tracking separate.

## Evidence
Windows existing node24.13/npm11.6.2/Chromium via cmd.exe cwd C:\Mate&Co, no install. Worker full177/177/typecheck/build pass. Independent npm.cmd run test:interaction -- --list:177 tests/11 files; npm.cmd run test:interaction:177 passed (2.4m),0 failed,0 skipped; npm.cmd run typecheck exit0; npm.cmd run build pass (1.20s). Two new regression tests added vs reported175; current grep175 literal sites differs from runner177 because confirm test loop expands three variants (+2).
Residual nonblocker: degenerate valid-syntax path may be described as INVISIBLE_CONTENT rather than degenerate geometry, still safely rejected. No remaining test failures. Windows browser evidence supersedes earlier Linux browser-blocked status. No commit/push.

## Next step
Corrections verified; ready for owner UX acceptance. Production/backend/editor integration remains separate authorized future work.
