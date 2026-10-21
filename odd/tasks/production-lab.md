# Physical preparation laboratory

## Specs
S1: "Inspeccioná el editor actual, el modelo de textos, íconos, SVGs aprobados, líneas circulares, geometría de la virola y exportador." Distinguish source units/calculated geometry/browser appearance.
S2: "Crear `/production-lab`, sin modificar inicialmente el editor ni el admin productivo." "Mostrar simultáneamente el original y la versión física." Immutable actual source models/Messi, no App writes.
S3: "Diámetro exterior, en mm." "Diámetro interior, en mm." "Validar valores positivos y diámetro interior menor al exterior." Blankfirst/immediate invalidation, no manufactured min/max.
S4: "La transformación debe ser determinista, documentada y reproducible." "No mejorar automáticamente el diseño, no redistribuir elementos para que quede más lindo, no alterar proporciones internas de íconos o SVGs aprobados." "Conservar el original intacto." "Si la geometría no entra, mostrar el problema; no ocultarlo."
S5: "Distinguir claramente entre geometría física calculada y apariencia simulada del grabado." "advertencias geométricas comprobables: invasión de límites, superposición y distancias a los bordes." "No inventar umbrales de fabricación sin datos proporcionados por el grabador." Conservative envelopes/potentialoverlap not exactink; advance not inkbbox.
S6: "Preparar el cálculo geométrico para reutilizarlo en exportación SVG en milímetros, pero no implementar todavía el flujo completo de pedidos." Exporter/approvedblock/currentrastertext unchanged, vector proposal documented.
S7: "exactitud de ambos diámetros; transformación de posiciones; preservación de proporciones; texto curvo; SVG aprobado con transforms internos; casos extremos de banda angosta; invalidación de medidas; original sin modificaciones; consistencia entre geometría calculada y representación visual."
S8: "No implementar backend, pedidos, autenticación ni modificar el personalizador productivo en esta etapa." "No commit ni push." Additive mainlazyroute only, preserve dirtywork.

## Geometry decision
User chose "Escalar según el diámetro exterior" after global/band-size/warp alternatives. Sourcecenter450,Ri292,Ro423,W131;angle0TOPclockwise. Ro=Do/2,Ri=Di/2,mapRadius(r)=Ri+(r-292)*(Ro-Ri)/131,kSize=Ro/423;physicalcenter0,0,p=rmap*(cos(angle-90deg),sin(...));localuniformscale=source.scale*kSize,rotation/mirror/invert retained, no autofit. Textbaseline=mapRadius(radius)-14scale*kSize,font35scale*kSize,spacing2scale*kSize,inverteddy26scale*kSize;spanpadding14*kSizeNOTelementscale/posSlope. Sourcehelper lineradii map/stroke2*kSize. Sourceartisticmask+4/+10 not manufacturingmargin. Bothrefs exact, narrowband spillvisible.

## Tasks
- [x] P1: Source/report/types/fixture+25purechecks implemented/reviewed, geometryunits/catalog29envelope/linestroke/sourceimmutability verified.
- [x] P2: IsolatedUI/route/sourcevsphysical/Messi/measurements/masks/completion/errors/provenance/docs+13browserchecks passing; parenttypecheck/buildexit0.
- [x] P3: Expanded diagnosis completed exactly as authorized: each originalcase once individually with trace (allpassed), then one fullsuite382/382passed. Finaltraces inspected,95source/test/config hashes unchangedbefore/aftereverycommand. Independentconditions/causalityreview complete; no reproducibleproductregression/causallinkestablished. No source/test edits,timeoutincrease,retries,refactors,commit/push. Stageclosed within documentedlablimits; originalfailurehistory retained.

## Evidence
Priorbaseline344. Independentreviews drove mixedspanunits/mask/input/zeroprobe/serialization/exactlineclearance/provenance fixes,25math+13UIpassing, parenttypecheck/buildexit0. SingleMessifixtureSHAe456ef5da86cdcca3c4371eca66b37ff421da9939c16905edd17e9d05dbad4bc unchanged. New productionlab modules/CSS/tests/docs; src/main.tsx onlysharedchange, productioneditor/admin/exporter unchanged.
Originalfulljob-1 EXIT1,379pass/3timeouts/382,28m53s;38labcases passed. direct-manipulation.spec.ts:587 lost.curved-text afterdrag/emptyeditor snapshot, svglab212stalledemptySuspense,svglab314pagefixturetimeout. RootcauseUNPROVEN. Originalfulloutput /tmp/gph4fTvZ/gentle-jobs-zEthqc/job-1.log.
PriorONEauthorizeddesktoptrace job-2 passed1/1,5.3s;trace1goto/1rootGET200/noHTTP/pageerrors,no reset reproduced. Doesnoteraseoriginalfailure or proveenvironmentcause.
Expanded procedure job-3 EXIT0 after5m4s. Individually desktop587:1passed5.3s,svgrejections212:1passed14.9s,svglimits314:1passed3.2s; then exactlyonefullsuite382passed4.5m,allstderr0bytes/no failures.95hashedsource/test/configfiles unchangedaftereach/final;MessiSHAunchanged. Traces:desktop1goto/rootGET200;SVG22and2expectednavigations/documentGET200;zeroafter/page/consolewarnings/errors. Noreload/state-lossreproduced. HistoricalrootcauseUNPROVEN; executioninstabilityplausible not proven specificinfrastructurebug. Original379/382exit1retained separately, not reclassified as passed.
Artifacts: test-results/production-lab-timeout-diagnosis/summary.json, desktop.stdout.log,svg-rejections.stdout.log,svg-limits.stdout.log,full-suite.stdout.log andmatchingstderrlogs, eachcase artifacts/**/trace.zip. Tooloutput /tmp/gph4fTvZ/gentle-jobs-zEthqc/job-3.log. Fulltrace retain-on-failure only,passingtracesnotretained. No more executions beyondauthorized3+1.

## Limits
Textink/text↔asset/line↔asset inkcollisions unknown/fontdependent; fullSVGeffects uncertified, hugefinitebrowserlimits, fixedfixtureclampvalidity andlatentkeyrace limitations documented. FuturephysicalSVG needs deterministicfontoutlines/vectorassetlocalIDCSSpolicy/toleranceinputs/exportcontract, no rasterconversion/orders/backend/auth. No commits/push.

## Next step
Stage can close: selectedlaboratoryoutcome verified25math+13UI and latestfull382/382,independentreviews/fixes done,causalitydiagnosis hasno reproducibleblocker. Historicaltimeoutrootcause remains unknown; do not claim guaranteedcross-platform/permanentstability or certifiedengraving. If it recurs, capture trace/reload/pageerrors again before attribution. No further tests/sourcechangesnow; next separatephysicalSVGproductionstage requires fontoutlines/vectorassets/exportcontract/toleranceinputs.

## Log
L1 original "Mate&Co — Etapa 1: Laboratorio de preparación física", conversation authoritative.
L2 sizechoice "Escalar según el diámetro exterior".
L3 initialopaqueUItimeout diagnosedread-only, noautomaticretry; smallerunitsimplemented.
L4 independentreviews drove realgeometry/fidelity/state fixes.
L5 originalfull379/382fail, read-onlytriage couldn'tproveeditorresetcause.
L6 singleauthorizeddesktoptracepass withoutreproduction; stageblocked atthatboundary.
L7 New user authorization (verbatim):
Autorizo un diagnóstico ampliado, pero acotado exclusivamente a los 3 timeouts de la suite completa.

Quiero distinguir entre regresiones reales del producto y problemas de infraestructura/estabilidad de Playwright.

Procedimiento:

1. Identificar exactamente los tres tests que fallaron y sus condiciones.
2. Reejecutar individualmente los casos afectados, incluyendo trazas si hace falta.
3. Revisar si existe alguna relación causal con los cambios del production-lab.
4. Si los tests individuales pasan, repetir la suite completa una vez para verificar estabilidad.
5. No modificar código productivo ni tests por un timeout aislado sin identificar primero su causa.
6. No aumentar timeouts ni agregar retries para ocultar fallos.
7. Si aparece una regresión real, corregirla de forma mínima y volver a validar.

No hacer refactors, commit ni push.

Al finalizar, indicame si podemos considerar cerrada la etapa o si queda algún problema reproducible, aportando evidencia concreta.
L8 Expanded diagnosis observed3singles+onefullGREEN onunchanged95filecandidate; traces reviewednocurrenterrors/reset, historicalcauseunproven. No source/tests/timeout/retries changed; closurecriteria met andP3done, no commit/push.
