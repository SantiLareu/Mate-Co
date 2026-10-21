# Physical lab strategy comparison

Isolated /production-lab comparison of two sizing strategies for real virola adaptation.
No commit/push. Preserve existing dirty branch, jobs data and all production behavior.

## Specs
S1: Audit current src/production-lab/**, geometry engine, curved text metrics, icons/approved v1/v2/v3, circular lines and jobId integration. Identify how outer-diameter scaling applies and what needs parameterizing. "No reemplazar ni eliminar la estrategia actual."
S2: Add strategy selector. Mode A Diámetro exterior (current): radial anchors to real band, sizes scaled by outer diameter, angles/rotations/mirrors/inversions preserved, no automatic invasion fixes. Mode B Espesor de banda (new, default IN THE LAB only): band physical thickness as reference for sizes; "Conservar las proporciones internas de cada elemento." "Conservar todos los trazos y detalles del SVG original." No deformation/simplification/vector removal. Preserve rotation/mirror/inversion/angles; radial positions relative to band; recalculate curved-text trajectory; no cumulative scaling when measures/mode change repeatedly. Not guaranteed to fit: overlaps/desbordes/density remain visible. Define/document exact formula, geometric reference and limits BEFORE implementing.
S3: Visual comparison same original composition, same diameters, same elements/transforms. Clearly show active strategy; instant toggle without losing measures/job; keep original view. Show outer/inner diameters mm, band thickness mm, applied scale factor, selected strategy. Don't modify decorative lines/technical guides beyond coherence.
S4: Geometric fidelity purpose is observing behavior; no auto-embellishment. Messi internal strokes scale down together. Observe small details, excessive line proximity, text legibility loss, overlap, physical border invasions. Distinguish objective geometric checks from approximate warnings. Never declare apt/not-apt for engraving without supplier tolerances.
S5: Test composition with curved text, library icon, complex approved SVG (Messi), circular lines. Both strategies with illustrative measures: 85/50, 80/60, 75/65. Verify internal proportions maintained in band mode. No clipping to hide overflow.
S6: Both strategies work with demo fixture and real jobs via /production-lab?jobId=. Don't modify stored snapshots; don't update/overwrite original job when changing strategy/measures; preserve IndexedDB/navigation.
S7: Add unit and browser tests: both formulas, scale factor/extreme values, angular positions preserved, SVG proportions, curved text, approved internal transforms, repeated A↔B toggle, measure changes without accumulated error, original snapshot preserved, overflow/overlap warnings, saved-job compatibility, invalid measures. Run typecheck/build/focused/full suite. No hiding failures via timeout increases or retries without diagnosis.
S8: Restrictions: no productive customizer changes, no confirmation flow changes, no admin panel changes, no jobs persistence changes, no exporter changes, no backend/auth/remote orders, no unrelated visual redesigns, "No hacer commit ni push." Mode thickness NOT product default; both coexist only in the lab.
S9: Final report: architecture, exact formulas per strategy, expected differences, files, test results, limitations/risks, technical recommendation per goals.

## Geometry decision
Stage1 established both candidates. Mode A (existing, user-chosen Stage1): Ro=Do/2, Ri=Di/2, positionSlope=(Ro-Ri)/131, mapRadius(r)=Ri+(r-292)*positionSlope, sizeFactor=Ro/423; text baseline anchorR-14*scale*sizeFactor; span padding 14*sizeFactor; line stroke 2*sizeFactor; artistic knockout masks ×sizeFactor NOT manufacturing limits. Mode B (new lab-only default): SAME anchors/mapping; sizeFactor_band=(Ro-Ri)/131=positionSlope. Source band 131 (Ri292/Ro423, center450, angle0TOP cw) from export/geometry. Under B, boundary-contacting elements map exactly to rim (radial extents scale by same factor as anchors), tangential metric ρ(r)/r differs (arc spacing changes, not internal shapes). Both modes never clamp/auto-shrink; flat/zero band invalid (inner<outer required already). Text: font/spacing/dy/baseline all use element-relative formulas ×sizeFactor with anchorR=mapRadius(radius): under B baseline=mapRadius(radius)-14*scale*positionSlope (element-relative, consistent); NO double scaling when toggling because every placement derives from immutable source units + current frame. No clipping; warnings signed lower bounds.

## Tasks
- [x] C1: Parametrized sizing policy by mvci3hws-l-8a87: PhysicalFrame.strategy ('outer-diameter' default | 'band-thickness'), single sizeFactor seam, identical anchors, per-strategy provenance. RED 5 fail→GREEN 34/34 (25 existing unmodified + 9 new), typecheck/build pass. Numeric slip in task examples (2x) adjudicated: implemented authoritative geometric formulas kA=Ro/423, kB=(Ro-Ri)/131=positionSlope, proven by rim-contact invariant (any other multiple breaks boundary-contact property). Exact per-case values: A 85/50≈0.1004728132, 80/60≈0.0945626478, 75/65≈0.0886524823; B 85/50≈0.1335877863, 80/60≈0.0763358779, 75/65≈0.0381679389. Full suite deferred to C3.
- [x] C2: Writer mvcii6g3-m-spsk delivered strategy selector (default B lab-only), readouts (diameters/band/exact factor/active strategy via String(frame.sizeFactor)), instant A↔B toggle preserving job/measures, demo+jobId both strategies, stored snapshot bytes unchanged. RED 5 fail→GREEN 18/18 production-lab + 12/12 production-lab-jobs (7 new C2 tests; 6 A-assuming tests pinned mode A additively, assertions untouched), typecheck/build pass. Full suite deferred to C3.
- [x] C3 review: Independent geometry/fidelity review mvcixa7c-n-ofm9 confirmed formulas/single seam/rim-contact/toggle/readout/job immutability/text trajectory per strategy; expected A-vs-B ratios 85/50→1.330, 80/60→0.807, 75/65→0.431 (A≡B exactly at band/outer=131/423≈0.3097). Non-invariant findings assigned to surgical writer mvee2f1s-p-wysm: floor-vs-ceiling saturation message (7° floor reachable under B thin bands), missing text-anchor definitely-outside warning, mislabeled data-display-w-mm attrs, stale docs section. Claim correction acknowledged: 6 pre-existing browser tests were pinned mode A additively (C2 'unmodified' was imprecise).
- [x] C3 verify: Raced run documented (verifier mvcixriz-o-ah0s vs writer): geometry 34/34 old tree (4 new C3 tests unexecuted), FULL 443/443 post-fix, 3 one-time jobs flake undiagnosed (concurrent foreign playwright process in same workspace; strictPort 4175). Writer completed partially (browser blocked on Linux, pure 38/38). Parent froze the tree and re-ran on Windows: production-lab-geometry 38/38 + production-lab 19/19 (57 passed, includes new C3 attr test); production-lab-jobs+jobs 47/47 (includes A→B→A, snapshot immutability, both-strategies job cases); typecheck clean, build 1.07s (98 modules). S7 gap closed on frozen tree; no parallel runs. Flake advisory: jobs-repository 3 one-time failures not reproduced in any later run; if recurring, capture trace/console before attribution. Stage verified for closure.
## Evidence
Baseline 427/427 Stage2 closed. production-lab geometry spot-read: frame.positionSlope/sizeFactor at geometry.ts:168-169, mapSourceRadius:206, scaleToPhysical:231, placements :251/:285/:297/:310/:344/:381/:410/:427/:438 all consume frame.sizeFactor → parametrization seam exists. Anchor map unchanged by strategy. Jobs read-only seam unaffected. Windows cmd.exe/npm.cmd Chromium existing, no install. Branch experiment/illustration-stencil dirty; no commits authorized. Forecast ~600–1000 authored lines incl tests advisory.

## Next step
Stage verified and closed: C1 34/34, C2 18/18+12/12, frozen-tree rerun 57+47, FULL 443/443, typecheck/build green, review invariants confirmed, labeling fixes verified. Final S9 report delivered. Recommendation: lab-only coexistence; choose strategy after real-material evidence. No commit/push.

## Log
L1 Original request (verbatim):
# Mate&Co — Comparación de estrategias de adaptación física

Trabajá utilizando el flujo multiagente Full-Code disponible, con implementación y revisión independiente.

**Objetivo:** ampliar `/production-lab` para comparar dos estrategias de adaptación geométrica de un diseño a las dimensiones reales de una virola, sin modificar todavía ningún comportamiento productivo.

**Preferencia inicial:** escalado según el espesor de la banda.

No hacer commit ni push.

## 1. Auditoría inicial

Inspeccioná la implementación actual de:

- `src/production-lab/`
- Motor geométrico y cálculo de posiciones.
- Textos curvos y métricas tipográficas.
- Íconos y SVG aprobados v1/v2/v3.
- Líneas circulares.
- Integración con trabajos guardados mediante `jobId`.

Identificá cómo se aplica actualmente el escalado basado en diámetro exterior y qué partes habría que parametrizar para permitir ambas estrategias.

**No reemplazar ni eliminar la estrategia actual.**

## 2. Incorporar dos modos seleccionables

Agregar al laboratorio un selector de estrategia:

**Modo A — Diámetro exterior (actual)**

Conservar exactamente el comportamiento existente:

- Posiciones radiales adaptadas a la banda real.
- Tamaños escalados según el diámetro exterior.
- Ángulos, rotaciones, espejos e inversiones preservados.
- Sin correcciones automáticas de invasiones.

**Modo B — Espesor de banda (nuevo, predeterminado en el laboratorio)**

Utilizar el espesor físico disponible de la virola como referencia principal para determinar el tamaño de textos, íconos y SVGs.

El objetivo es reducir o ampliar proporcionalmente los elementos cuando cambia el espesor disponible.

Requisitos:

- Conservar las proporciones internas de cada elemento.
- Conservar todos los trazos y detalles del SVG original.
- No deformar las figuras para hacerlas entrar.
- No simplificar geometría ni eliminar vectores.
- Preservar rotación, espejo, inversión y ángulos.
- Mantener posiciones radiales relativas a la banda.
- Recalcular correctamente las trayectorias de texto curvo.
- Evitar que se produzcan escalados acumulativos al cambiar repetidamente las medidas o el modo.

No asumir que la nueva estrategia garantiza que todo entre. Si un diseño presenta superposiciones, desbordes o demasiada densidad, deben seguir siendo visibles.

Antes de implementar, definir y documentar la fórmula exacta del nuevo escalado, su referencia geométrica y sus limitaciones.

## 3. Comparación visual

Permitir comparar ambas estrategias usando:

- La misma composición original.
- Los mismos diámetros exterior/interior.
- Los mismos elementos y transformaciones.

Mostrar claramente qué estrategia está activa.

Idealmente, permitir alternar instantáneamente entre ambas sin perder las medidas ni el trabajo cargado.

Conservar la vista original para comparar.

Agregar información relevante:

- Diámetro exterior e interior en mm.
- Espesor radial de banda en mm.
- Factor de escala aplicado a los elementos.
- Estrategia seleccionada.

No modificar las líneas decorativas ni las guías técnicas existentes salvo lo estrictamente necesario para que la representación sea coherente.

## 4. Fidelidad geométrica

La finalidad es mostrar cómo se comporta la composición al adaptar su tamaño a la virola real.

No queremos que el sistema embellezca los diseños automáticamente.

Por ejemplo, si Messi contiene muchos trazos internos, al reducirlo esos trazos deben conservarse y disminuir de tamaño junto con el resto.

El laboratorio debe permitir observar si:

- Los detalles quedan demasiado pequeños.
- Las líneas se acercan excesivamente.
- Los textos pierden legibilidad.
- Los elementos se superponen.
- Hay invasiones de los bordes físicos.

Distinguir las comprobaciones geométricas objetivas de las advertencias aproximadas.

No declarar que un diseño es apto o no apto para grabado sin conocer las tolerancias técnicas del proveedor.

## 5. Casos de prueba

Utilizar una composición con:

- Texto curvo.
- Ícono de biblioteca.
- SVG aprobado complejo, como Messi.
- Líneas circulares.

Probar ambas estrategias con estas medidas ilustrativas:

| Caso | Exterior | Interior |
|---|---:|---:|
| Virola amplia | 85 mm | 50 mm |
| Virola intermedia | 80 mm | 60 mm |
| Virola angosta | 75 mm | 65 mm |

Verificar especialmente que en el modo de espesor los elementos mantengan sus proporciones internas.

No introducir clipping para esconder partes que desborden.

## 6. Integración con trabajos reales

Ambas estrategias deben funcionar con:

- Fixture de demostración del laboratorio.
- Trabajos reales abiertos mediante `/production-lab?jobId=...`.

No modificar snapshots guardados.

No actualizar ni sobrescribir el trabajo original al cambiar estrategia o medidas.

Conservar el funcionamiento de IndexedDB y la navegación actual.

## 7. Pruebas y regresiones

Agregar pruebas unitarias y de navegador para:

- Fórmula de ambas estrategias.
- Factor de escala y valores extremos.
- Conservación de posiciones angulares.
- Conservación de proporciones de SVGs.
- Texto curvo.
- Transformaciones internas de SVGs aprobados.
- Alternancia repetida de modo A ↔ B.
- Cambio de medidas sin acumulación de errores.
- Preservación del snapshot original.
- Advertencias de desbordes y superposición.
- Compatibilidad con trabajos guardados.
- Medidas inválidas.

Ejecutar typecheck, build, suites específicas y suite completa.

No ocultar fallos aumentando timeouts o agregando retries sin diagnóstico.

## 8. Restricciones

- No modificar el personalizador productivo.
- No modificar el flujo de confirmación.
- No modificar el panel administrador.
- No modificar la persistencia de trabajos.
- No modificar el exportador SVG actual.
- No implementar backend, autenticación ni pedidos remotos.
- No incorporar rediseños visuales ajenos a esta comparación.
- No hacer commit ni push.

## 9. Informe final

Entregar:

1. Arquitectura de la comparación.
2. Fórmulas exactas utilizadas por cada estrategia.
3. Diferencias esperadas entre ambos resultados.
4. Archivos modificados.
5. Resultados de pruebas.
6. Limitaciones y riesgos detectados.
7. Recomendación técnica sobre cuál estrategia conviene adoptar según nuestros objetivos.

**Importante:** no convertir el modo de espesor en el comportamiento definitivo del producto. Por ahora, ambas opciones deben coexistir exclusivamente en el laboratorio para poder compararlas y decidir con evidencia.

## Log
L1 Original request (verbatim): comparison of two physical adaptation strategies in /production-lab, initial preference band thickness, sections 1–9, no commit/push. Original conversation authoritative.
L2 C1 delivered; task-example numeric 2x slip adjudicated in favor of rim-contact invariant (kA=Ro/423, kB=positionSlope).
L3 C2 delivered (selector/readouts/toggle/job+demo); 6 pre-existing browser tests pinned mode A additively.
L4 C3 review confirmed invariants; labeling fixes applied (floor/ceiling message, text-anchor outside warning, footprint attrs, docs). Verifier/writer race documented and serialized; frozen-tree rerun closed S7 gap. Stage verified.
