# Admin design asset v2 (sanitized full-SVG asset)

## Intent and constraints
Admin approved-design library stores externally prepared engraving SVGs as ONE sanitized vector asset
(option B) instead of converting to an internal geometry subset. Admin decides engraving suitability;
software only accepts, sanitizes web risks, preserves appearance, previews, stores, and (later) allows
move/scale/rotate/mirror of the whole design as a unit.

Constraints: no commit/push; no editor/DesignPanel/production/drag-snap/physical-mm integration;
preserve pre-existing dirty work; never render untrusted SVG; no dangerouslySetInnerHTML with
untrusted content; no scripts; no external resources; do not modify the real MESSI-SILHOUETTE.svg
fixture (pending: user supplies path — not found in repo or Windows user folders).

## Decision (representation)
Option B: store the full SVG document, sanitized. Parse with DOMParser('image/svg+xml'),
prune via strict allow/deny, re-serialize ONLY from the parsed tree via XMLSerializer (no raw
passthrough), and require fixed-point stability (sanitize(output) === output). Rationale: maximum
fidelity, fewest false negatives, minimal own parser code (browser does parsing/serialization);
security controlled by allow/deny sanitizer + re-validation on read + script-inert <img> preview.
Rejected: A (still conversion-bound, same false-negative class) and C (current v2 ImportedGeometry
tree — already requires owning converters per feature; that is the pain being removed).

## Architecture
- New sanitizer/importer: `src/admin-lab/svgAssetImport.ts` — DOMParser XML parse, element/attribute
  allow-lists, deny script/on*/javascript:/vbscript:/expression/@import/external url()/href/src/base,
  foreignObject, iframe/object/embed/link, entities/DTD (external), xml-stylesheet PI, active SMIL
  (animate/animateTransform/animateMotion/set/discard), foreign-namespace rendered elements; unknown
  elements/attributes stripped by allow-list (metadata/title/desc/text/tspan/gradients/clip/mask kept
  when inert); <image> only with bounded data: URI; budgets (size/nodes/depth) enforced.
- Model v3: `ApprovedDesign` gains `{version:3, svg: string}` (sanitized serialized document starting
  with <svg xmlns=...>), metadata (id/name/category/enabled/createdAt) unchanged. v1/v2 records stay
  persisted untouched; new imports become v3. No record destruction.
- Repository: v3 records validated on read by full re-parse + re-sanitize + fixed-point compare
  (stored bytes never trusted). `FORBIDDEN_RAW_KEYS` policy becomes version-aware (v1/v2 unchanged;
  v3 uses the `svg` key and is only accepted through the sanitizer path). Corrupt/unknown versions
  remain read-only isolated.
- Preview (AdminLab): v3 designs render via Blob-URL <img> of the sanitized asset (script-inert,
  no inline markup injection); v1/v2 keep current React geometry preview. UI messages unchanged:
  simple success; security failure; genuine technical limitation.
- OUT OF SCOPE this feature: editor integration, export/production embedding, physical mm adaptation.
  Placement math for later: whole-asset <g transform> wrapper + existing artTransformForBounds ideas.

## Tasks
- [x] T0: Explore current architecture (scout map delivered; message string reality: svgGeometryImport.ts:46-50).
- [x] T1: Choose representation -> Option B (this doc).
- [ ] T2: Sanitizer/importer svgAssetImport.ts + unit security tests (RED/GREEN).
- [ ] T3: Model v3 + repository v1/v2/v3 compatibility + read re-validation + FORBIDDEN_RAW_KEYS scoping + tests.
- [ ] T4: Admission/file path + AdminLab preview (blob <img>) + messages + UI tests.
- [ ] T5: Regression suite: MESSI (fixture pending path), group transform, negative Y scale, multiple paths,
      colors/strokes, metadata, width/height/version, reload from repository, script, onload, external refs.
- [x] T6: Independent multi-agent review (architecture/fidelity/mm via explorer; security adversarial via explorer; reliability+maintainability via explorer — RDD review-* roles unavailable without native lineage) + consolidated fix rounds:
  - FX1 sanitizer: <style> audited, all fe* filters, clipPathUnits/maskUnits/vector-effect/font-style etc., percent-scaled derived dims, non-positive nulling; F1 raw-value gate, F2 CDATA→escaped text, F3 raster-only image data URIs, F4 xmlns audited, token-aware prologue; sanitizeStoredSvgAsset = fixed-point + field consistency (byte-equality removed: cross-engine lockout fix; safety from re-sanitization).
  - FX2 repository/UI: contract docs synced, F5 own-property gates, A4 MODEL_VERSION_ASSET + v3 work cost + OK-mapping removed, R3 damaged-vs-budget split (budget/duplicate skips allow delete; damage blocks writes incl. delete, recovery outside panel), R6 quota-v3 + cross-tab tests, canonical rewrite on mutation, README v3 fidelity note.
- [x] T7 pending fixture: MESSI case 1 skips until owner supplies tests/fixtures/MESSI-SILHOUETTE.svg (byte-for-byte).

## Evidence
- Scout map (gentle-ai-explore muypfdkq-1-u1aw): current v1/v2 model, admission triggers, repository
  envelope, preview, FORBIDDEN_RAW_KEYS repository.ts:130, editor/exporter not integrated with admin-lab.

## Blockers
- RESOLVED: MESSI-SILHOUETTE.svg arrived (3755 bytes, sha256 e456ef5d...); SECURITY root cause was the historical
  SVG 1.0 DOCTYPE (20010904) rejected by the SVG-1.1-only allowlist in withoutExternalDtd — false positive.
  Fix: exact-list W3C DTD allowlist (1.0/1.1/1.1 Basic/1.1 Tiny, PUBLIC+SYSTEM forms) dropped-not-rejected;
  internal subsets and unknown identifiers still SECURITY; 4 precise prologue reasons; malicious parallels tested.
  Case 1 executes and passes. Full suite 308/308 green (run 2), typecheck/build pass, fixture byte-identical.
- Residual: one flaky full-suite failure (admin-lab-admission.spec.ts:57, cold-start vite transform race under
  suite load) — no repro in 6 spec runs/38 tests; recommendation: playwright retries:1 or global-setup module
  warm-up; owner decision (test-infra policy).
