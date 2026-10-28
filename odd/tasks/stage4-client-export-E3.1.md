# E3.1 — Integración opt-in del exportador vectorial del cliente

Conecta el adaptador vectorial (`src/export/vectorTextOutlines.ts`, ya validado en
E3.0) al exportador del cliente mediante una **opción experimental interna**, sin
cambiar el comportamiento predeterminado ni exponer controles técnicos al cliente.
Base: `stage4-client-export-E2.md` (reglas medidas) y `stage4-client-export-E3.md`
(E3.0, commit `1b3200e`).

## Specs

S1: "Conectar el adaptador vectorial al exportador del cliente mediante una opción
experimental interna, sin cambiar el comportamiento predeterminado ni exponer nuevas
opciones técnicas al cliente final."

S2: "Reutilizar `src/export/vectorTextOutlines.ts` sin duplicar el motor."

S3: "Incorporar una selección interna explícita del trazador vectorial para pruebas."

S4: "Mantener `traceTextElement` como comportamiento predeterminado."

S5: "No habilitar automáticamente VTracer si falla HarfBuzz."

S6: "Mantener exportación atómica: si falta un texto o falla un trazador, no generar
archivo."

S7: "Preservar íconos, imágenes subidas, líneas decorativas y sus transformaciones."

S8: "Conservar la compatibilidad de los contratos públicos actuales."

S9: "No exponer un selector técnico nuevo en la interfaz del cliente."

S10: "No alterar confirmación de pedidos, snapshots ni almacenamiento."

S11: "Conservar el mecanismo de reversión al camino anterior sin fallback silencioso."

S12 (pre-flight): "Evaluar e implementar una validación previa mínima, únicamente para el
camino vectorial: Fuente perteneciente al catálogo. Disponibilidad del motor HarfBuzz.
Glifos admitidos. Normalización NFC compatible. Errores accionables. Evitar ejecutar dos
veces una conversión completa innecesariamente. Si el pre-flight requiere cambios
importantes en el flujo de confirmación, documentar la alternativa y detenerse antes de
modificar ese contrato."

S13 (verificación): "Probar: Texto normal, invertido y rotado. Las tres tipografías. Texto
largo y escalas extremas. Diseños combinados con texto, íconos e imágenes subidas.
Knockout y bandas decorativas. Determinismo del SVG. Fallo explícito sin descarga parcial.
Compatibilidad del exportador predeterminado anterior. Ausencia de regresiones en
confirmación de pedidos. Typecheck, build y regresión completa. Registrar las diferencias
entre los SVG del camino raster y vectorial. No modificar pruebas únicamente para ocultar
cambios de comportamiento."

S14 (restricciones): "No modificar `main`. No habilitar la exportación vectorial como
predeterminada. No modificar las opciones visibles de tipografías. No modificar los
contratos de trabajos confirmados ni snapshots. No instalar dependencias nuevas. No
incluir `references/typography/`. No hacer commit, push ni merge. No comenzar E4 ni E5.
Mantener la exportación experimental hasta validación real con el grabador."

## Tasks

- [x] T1 (S1, S2) — Separar el adaptador en `composeVectorText` (motor) + `buildVectorTrace`
  (geometría), **aditivo**: `vectorTextTrace` conserva su comportamiento y sus pruebas.
- [x] T2 (S1, S3, S4, S11) — Nuevo módulo `src/export/vectorProductionExport.ts`: el modo
  experimental (`raster` por defecto), la selección explícita del trazador y el
  **mecanismo de reversión** (nunca un fallback automático).
- [x] T3 (S12) — Pre-flight mínimo **sólo del camino vectorial**: catálogo, motor
  disponible, glifos admitidos, NFC compatible y errores accionables. La composición se
  **reutiliza** en la exportación (una sola conversión).
- [x] T4 (S6, S9, S10) — `ConfirmPanel.tsx`: cableado mínimo (el pre-flight sólo corre en
  modo vectorial; el modo raster sigue el flujo actual sin cambios). Sin controles nuevos
  en la interfaz y sin tocar el contrato de confirmación.
- [x] T5 (S13) — Pruebas de integración: paridad de la geometría, diseños combinados,
  knockout, determinismo, fallo explícito sin descarga parcial y default intacto.
- [x] T8 (S1, S9) — Prueba del **build de producción**: en un build real (compilado y
  servido por la propia prueba) `?textExport=vector` NO activa el exportador vectorial.
- [x] T6 (S13) — Typecheck, build, focalizadas y regresión completa.
- [x] T7 (S13) — Documentar las diferencias medidas entre el SVG raster y el vectorial.

## Log

L1 Petición original (verbatim): "Mate&Co — E3.1: integración opt-in del exportador
vectorial del cliente" — "Conectar el adaptador vectorial al exportador del cliente mediante
una opción experimental interna, sin cambiar el comportamiento predeterminado ni exponer
nuevas opciones técnicas al cliente final." — objectives S1–S13, restricciones S14.

L2 Partida verificada: rama `experiment/illustration-stencil`, HEAD `1b3200e`, working tree
con sólo `references/typography/` sin seguimiento. El seam `TraceTextFn` de
`src/export/productionSvg.ts:52-58,132-135` ya permite inyectar el trazador (el predeterminado
sigue siendo `traceTextElement`).

L3 Flujo de descarga verificado (`src/components/ConfirmPanel.tsx:85-104`): `exportSvg` →
`buildProductionSvg(...)` → `downloadProductionSvg(svg)`; el `catch` ya publica
`reason.message` en un `role="alert"` (`:222`). La exportación ya es **atómica**: el archivo
sólo se crea si el SVG se generó entero.

L4 Diseño de la activación (decisión del orquestador): el modo se resuelve en
`src/export/vectorProductionExport.ts` y es **`raster` por defecto**; la opción `vector`
existe (a) como constante interna y (b) como parámetro de URL **sólo en desarrollo**
(`import.meta.env.DEV`), de modo que el build de producción no ofrece ninguna vía
técnica al cliente final (S9, S14). Nunca hay fallback entre modos (S5, S11).

L5 T1 (adaptador, aditivo): `composeVectorText` (motor) y `buildVectorTrace` (geometría)
quedan separados; `vectorTextTrace` mantiene su comportamiento exacto (las 12 pruebas de
E1/E3.0 siguen en verde sin tocar).

L6 T2 (activación): `src/export/clientTextExportMode.ts` (ligero) resuelve el modo
(`raster` por defecto; `vector` sólo con la constante interna o, **en desarrollo**, con
`?textExport=vector`). `src/export/vectorProductionExport.ts` (pesado) tiene el pre-flight
y el trazador. El módulo pesado se importa **bajo demanda** desde la interfaz: medido, el
bundle inicial pasa de 359,03 kB a **359,43 kB** (+0,4 kB: sólo el módulo de modo) y el motor
vectorial queda en su propio chunk (`vectorProductionExport-*.js`, 3,78 kB) — con una
importación estática el bundle inicial hubiera crecido **+8,96 kB**.

L7 T3 (pre-flight): warm-up del motor + composición de cada texto con contenido. La
composición se **reutiliza** en la exportación (el trazador del plan consulta la caché por
petición): no se ejecuta dos veces una conversión completa. Los fallos son explícitos y
accionables (`GLYPH_MISSING`, `FONT_NOT_IN_CATALOGUE`, `SHAPER_UNAVAILABLE`…).

L8 T4 (interfaz): `ConfirmPanel.tsx` cambia **sólo** el bloque de exportación: en modo raster
llama a `buildProductionSvg(state, undefined)` — idéntico a antes, porque `undefined`
dispara el valor predeterminado — y en modo vectorial hace el pre-flight y usa su trazador.
**Sin controles nuevos**, sin cambios en el contrato de confirmación, sin tocar pedidos,
snapshots ni almacenamiento. El error del pre-flight se publica con el mismo mecanismo de
siempre (`role="alert"`), con el código delante.

L9 T5 (pruebas): spec nuevo `tests/export-vector-client-integration.spec.ts` (11 tests)
escrito por `gentle-ai-worker` y revisado por el orquestador: modo predeterminado, vía
interna `?textExport=vector`, exportador por defecto **byte a byte idéntico**, camino
vectorial sin `<text>` y con la misma estructura, determinismo byte a byte, pre-flight
accionable **sin generar SVG**, validación de catálogo, NFC aceptada, reutilización de la
composición, matriz de 3 tipografías × normal/invertido/rotado, knockout y líneas
decorativas, y ausencia de controles nuevos en el panel de confirmación.

L10 T7 (diferencias medidas entre el SVG raster y el vectorial). Diseño con 2 textos
(Poppins y Lato, uno invertido y rotado a escala 1,4) y líneas decorativas en modo `double`:

| | raster | vector |
|---|---|---|
| tamaño del SVG | 46 875 B | **23 399 B (−50,1 %)** |
| paths del grupo de grabado | 3 | 3 (misma estructura) |
| arcos de las líneas decorativas | 3 | 3 (misma estructura) |
| `viewBox` | `14.25 12.79 871.5 872.96` | `14.25 12.77 871.5 872.98` |
| ¿contiene `<text>`? | no | no |
| tinta rasterizada | 97 266 px | 98 927 px (ratio 1,017) |
| desviación media entre ambos SVG | — | **0,69 u** (815 px sin pareja) |

La diferencia de geometría entre los dos archivos es **la tipografía**: el raster traza la
fuente de reserva (su SVG se carga como `<img>` y no puede pedir fuentes externas, ver
`stage4-client-export-E2.md` §1.4 ter) y el vector traza **la fuente real del catálogo**. El
vector es el correcto. El `viewBox` es prácticamente idéntico (0,02 u) y las bandas de
knockout conservan la misma estructura con extremos que difieren en unas unidades (la banda
del raster se midió sobre la tinta de la fuente sustituida).

L11 Verificación: typecheck del producto **OK**; build **OK**; focalizadas (integración,
E1, E3.0 ×2, `export-production-svg`, `confirm-design`, `typography`,
`typography-catalogue`, laboratorio ×2) **88/88** (1,9 min); regresión completa
**584/584**.

L12 T8 (build de producción): la prueba compila la aplicación con `vite build`, la sirve con
un servidor estático propio y hace el flujo real de exportación (añadir texto → confirmar →
exportar) con `?textExport=vector`. En el build de producción **no** se activa el camino
vectorial, por tres señales independientes: (a) el chunk `vectorProductionExport-*.js` no se
pide nunca; (b) la rama de desarrollo no llega al bundle (el parámetro no aparece en él); y
(c) el SVG descargado es el del camino raster (`scale(0.33……)`, la firma del trazador de mapa
de bits) y no el vectorial (`scale(1)`). Como control, el mismo flujo contra el servidor de
desarrollo SÍ activa el camino vectorial.

L13 Hallazgo methodological (importante para el futuro): el proceso de pruebas de Playwright
corre con `NODE_ENV=development` y **Vite hereda esa variable**: un `vite build` invocado sin
fijarla NO es un build de producción (`import.meta.env.DEV` queda en `true` y la rama de
desarrollo llega al bundle). La prueba fija `mode: "production"` **y** `NODE_ENV=production`
al compilar, y lo restaura después. Sin eso, la prueba habría "verificado" un build de
desarrollo y dado un falso verde.
