# Stage 4 typography — vector font outlines (spike)

Cierre del incremento Poppins + Lato del spike de tipografías vectoriales, antes de
cualquier integración en `src/`. El spike queda **aislado**: `src/` no lo importa.

## Specs

S1: "Investigar y resolver el único test fallido: `tests/spike-typography-kerning.spec.ts`, escenario visual 75×65 mm, rotación −35°." "Analizar si el 3% de diferencia de tinta respecto del umbral del 2% se debe a antialiasing, cuantización, diferencias reales de geometría o un error en el test." "No modificar el umbral ni desactivar la prueba únicamente para conseguir que pase."
S2: "Verificar el comportamiento del kerning real de Lato." "Preservar la comparación con Chromium, el determinismo y los fallos explícitos ante características no soportadas."
S3: "Completar la trazabilidad de Lato." "Verificar su origen oficial, commit, licencia, SHA-256 y restricciones de Reserved Font Name. Si no podés comprobar algún dato, documentarlo como pendiente."
S4: "Actualizar `spikes/typography/README.md` para reflejar Poppins, Lato, `gposKerning.ts`, los tests y sus limitaciones."
S5: "Preservar los ejemplos SVG y las métricas relevantes dentro del spike, sin incorporar archivos temporales o capturas de terceros."
S6: "Crear la documentación ODD de la Etapa 4 siguiendo las convenciones existentes del repositorio."
S7: "Ejecutar los tests focalizados y el typecheck. Si se resuelve el fallo, ejecutar la suite completa cuando el entorno lo permita."
S8: "No integrar todavía el motor en `src/`." "No modificar el editor, administrador, snapshots ni exportadores productivos." "No agregar nuevas tipografías." "No hacer commit, push ni merge." "No modificar la captura de referencia." "No relajar criterios de prueba sin una justificación técnica verificable." "Preservar todos los cambios existentes."

## Estado heredado (auditoría previa, read-only)

- Rama `experiment/illustration-stencil`, HEAD `679e1dc`, 1 commit adelante de `origin`.
- Trabajo de Antigravity **sin commitear**: `spikes/`, `references/typography/`,
  `tests/spike-typography.spec.ts`, `tests/spike-typography-kerning.spec.ts`; modificados
  `package.json` / `package-lock.json` (`opentype.js@2.0.0` devDep).
- Re-ejecución del subconjunto spike (node de Windows): **36 pasan / 1 falla** — el mismo
  fallo registrado en `test-results/.last-run.json`
  (`4200fd7bf4bd20e75089-3a921d287e62a4401a24`).
- Falla: `curved kerned outlines vs browser text (visual): 75x65 normal rotated -35` —
  `tests/spike-typography-kerning.spec.ts:479`, `inkA=3198`, `inkB=3294` → **3.0018%**
  contra el umbral de 2%.
- Regenerar los outputs del spike produce archivos **byte-idénticos** a los de Antigravity
  (`diff -rq` exit 0) → determinismo confirmado.
- Entorno: Playwright corre con `node.exe` de **Windows** (en WSL falla el arranque de
  Vite: `node_modules` fue instalado en Windows, falta `@rollup/rollup-linux-arm64-gnu`).

## Diagnóstico del test rojo (T1)

Cinco experimentos medibles (specs temporales, ya eliminados; salidas en
`test-results/spike-diagnostic/`):

1. **Aislamiento a nivel de glifo** (texto recto vs `glyphPathData` de la spike, sin
   textPath ni letter-spacing): a 400 px de *em* la diferencia de tinta es **0.00 %** y el
   IoU **1.0000** ('H', 'T'), ≤ 0.25 % en los demás. **El contorno del spike es
   pixel-idéntico al del navegador**: el fallo no es de geometría del glifo.
2. **Barrido de escala de layout** (la referencia_PASS_FLOAT expresada en unidades de
   píxel en vez de mm): con la referencia en mm, el IoU contra el contorno es **0.77**;
   en píxeles sube a **0.92**. Motivo: Chromium compone el texto en el sistema de
   coordenadas de usuario del SVG, así que encuadrada en mm compone a un *em* de
   **1,34 px** (caso 75×65), ajusta ahí la rejilla de los glifos y después la CTM lo
   magnifica ×24.
3. **Correlación de desplazamiento**: ningún desplazamiento rígido de ±3 px mejora el
   solapamiento → la diferencia **no** es un error de posición.
4. **`text-rendering="geometricPrecision"`**: empeora (IoU 0.67, longitud +0,75 %) →
   no era *hinting* sino la escala de composición.
5. **Aislamiento por glifo a distintos tamaños**: con los **mismos** contornos, la
   diferencia de área entre texto y path es 0 % a 400 px, ≤ 1 % a 200 px, 0–8,6 % a
   64 px y 0–39 % a 16 px. A un *em* de 32 px (75×65) es ~3 %, **por encima del
   umbral de 2 %**: el criterio de área comparaba un raster de glifos *hint-eado* contra
   un raster vectorial *sin hint* y **no podía cumplirse ni con un contorno perfecto**.

**Causa**: error en el **método de medición** (dos partes): referencia compuesta a un
*em* de 1,34 px (fieldad de la referencia) y criterio de área de tinta en lugar de un
criterio geométrico (ruido del rasterizador por encima del umbral). La geometría del
motor nunca estuvo mal: el residual medido era la cuantización de layout del propio
navegador.

## Corrección aplicada (T2)

Dos cambios de medición, en los dos specs (Poppins y Lato), **sin tocar umbrales del
reporte** (longitud ≤ 1 %, posición ≤ 0,2 mm, rotación ≤ 0,5°, divergencia ≤ 0,2 mm):

1. **Referencia en píxeles de dispositivo** (1 mm = 24 px) en el test de geometría y en
   el visual: el navegador compone y rasteriza el texto al tamaño en el que se compara.
   Efecto medido: residual de posición por glifo **0,0986 → 0,0110 mm** (85×50) y
   **0,0448 → 0,0046 mm** (75×65); IoU **0,77 → 0,92**.
2. **Criterio visual físico**: la razón de área de tinta se conserva como *métrica
   reportada* y deja de ser aserción; la aserción pasa a ser la **desviación tinta-tinta
   en mm** (distancia de cada píxel de tinta al píxel de tinta más cercano de la otra
   representación): `max ≤ 0,2 mm`, `media ≤ 0,05 mm`, `beyond = 0`. Se conserva el test
   de divergencia por píxel (≤ 0,5 % a 0,2 mm) y se **agrega un control de sensibilidad**
   que debe ver un error geométrico real: sin kerning (Lato) o desplazado 0,5 mm
   (Poppins, 2,5× la tolerancia).

**La salida del motor no cambia**: los SHA-256 de los SVG de ejemplo de Poppins y de
Lato son idénticos antes y después de la corrección (el cambio afecta a cómo se
*compara*, no a lo que se genera).

Separación medida entre contorno correcto y error real: media 0,0007–0,0024 mm vs
0,10–0,30 mm; máximo 0,042–0,059 mm vs 0,50–0,94 mm.

## Fase 2 — Evaluación de Dancing Script Bold (2026-10-24, sin implementación)

**Decisión: NO se implementa Dancing Script en el spike.** Requiere capacidades
que el motor no tiene, y una de ellas es una condición de parada acordada.

Fuente oficial evaluada: `ofl/dancingscript/DancingScript[wght].ttf`
(133 636 bytes, SHA-256 `21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c`),
google/fonts `main`, OFL 1.1, **Reserved Font Name "Dancing Script"**, fuente
upstream googlefonts/DancingScript @ `291f87c05206179b6bfd53735a5638b5cc84e3b3`,
643 glifos, 1000 upm, **eje `wght` 400–700** (por defecto 400). El estático
`DancingScript-Bold.ttf` ya **no se distribuye** (se retiró en `be7d803a18df`,
2019); solo existe en el historial (`1b408cfce4dd`, 2016, 122 748 bytes,
SHA-256 `16ccbad9c1534d114efc2d3317f9f489ec853a233b6ffefd67261d9aeeb96ab6`).
Cobertura del español: **100 %** (áéíóúüñÁÉÍÓÚÜÑ¿¡ y ASCII presentes).

Tres bloqueos, medidos:

1. **Fuente variable**: Chromium aplica el eje `wght` (longitud de la misma frase
   a em 100 px: 1730 px a 400, 1770,84 a 600, 1791,91 a 700 → **+3,6 %** entre
   extremos). El motor (opentype.js 2.0.0) lee **solo la instancia por defecto**
   (wght 400) y no interpola `gvar`/`avar`. El editor renderiza con
   `font-weight: 600` → el desajuste acumulado llega a ~1 mm en la virola 85/50,
   5× la tolerancia de 0,2 mm.
2. **GSUB contextual**: el navegador sustituye el par `or` (delta **+4,013 px**
   = 4,0 % del em, medido sobre 5625 pares). El motor no hace GSUB → exportaría
   un glifo `o` distinto del que se ve en el preview. Con el estático de 2016 la
   divergencia es **mayor**: 24 pares, hasta 5,287 px (incluye `or` y `th`).
3. **Kerning no soportado**: el `kern` de Dancing Script usa `lookupFlag 8`
   (IGNORE_LIGATURES) y la fuente **tiene GDEF** → el lector GPOS del spike
   **falla cerrado** con `KERNING_UNSUPPORTED: lookup 0: lookupFlag 8 con GDEF
   (omisión de glifos) no soportado`. Correcto por diseño, pero implica que la
   fuente no es usable con el motor actual.

**Hallazgo colateral (afecta a Lato, ya commiteada)**: barrido de los 5625
pares con el kerning del spike:

| Fuente | Pares con desviación > 0,5 px | Máximo | Interpretación |
|---|---|---|---|
| Poppins SemiBold | 0 | 0,000 px | paridad exacta |
| Lato SemiBold | **12** (`ff fi fj fk fb fh ft tf ti tt fí`) | −3,741 px (3,7 % em) | GSUB `liga`/`calt` con lookups **tipo 7 (contextuales)** |

Lato **sí liga** esas secuencias en el navegador mediante lookups contextuales
(tipo 7), que no aparecen en `getLigatures('liga')` de opentype.js (por eso
parecen no existir) y que el motor no reproduce. Los deltas no dependen del
contexto circundante (verificado con `x X n A`). Secuencias frecuentes en
español: `ti` ("tienda"), `fi` ("fiesta"). **Es una diferencia de FORMA, no de
posición**: el preview y el SVG exportado no serían el mismo texto.

Consecuencia para la integración: el motor necesita **GSUB** (al menos `liga` +
`calt` contextuales) o un **guard de fallo explícito** por texto, antes de
ofrecer cualquier tipografía que tenga ligaduras latinas. Poppins (0
divergencias) es segura hoy.

### Alternativas técnicas para las tipografías con ligaduras/variaciones

| Opción | Qué resuelve | Costo | Riesgo |
|---|---|---|---|
| **A. Postergar** (Poppins + Lato con guardia de fallo) | — | bajo: implementar la guardia que detecte secuencias ligables y ** rechace** el texto | el cliente pierde la fuente en textos con `ti`/`fi`; hay que explicarlo en la UI |
| **B. Motor de shaping** (HarfBuzz WASM o `fontkit`) | GSUB completo + `gvar` | alto: dependencia nueva (~1–2 MB WASM), versión fijada, paridad real con Chromium (ambos usan HarfBuzz) | superficie de fallo nueva; reglas de fallback por idioma |
| **C. Instanciar en build** (`fonttools varLib.instancer` a wght 700) | el eje de peso | medio: paso de build con Python (no disponible hoy) + artefacto instanciado que auditar | resuelve solo el peso; **no** el GSUB |
| **D. Restringir el catálogo** a fuentes estáticas sin ligaturas latinas | ambos | bajo: se documenta el criterio al elegir tipografías | limita el diseño del producto |

**Recomendación**: A como mínimo (guardia de fallo explícito) + C para el peso,
y B solo si el catálogo exige fuentes con ligaduras. No integrar ninguna fuente
variable sin C.

## Fase 2 — Validación de HarfBuzz (2026-10-24)

### Bloqueo de arranque (diagnosticado y resuelto)

El harness no terminaba de inicializar. Causa real, con evidencia: **el pre-bundle
de `opentype.js` que genera el optimizador de Vite tiene dos formas de interop
distintas** — con formato CJS sólo expone `default`, con formato ESM sólo expone
los exports nombrados (`parse`, `load`, `Font`…) y **no** `default`. El núcleo del
spike importaba `opentype.js` **por defecto** → en el harness reventaba con
`SyntaxError: The requested module '.../opentype__js.js' does not provide an
export named 'default'` y `window.hb` nunca se asignaba (los 10 tests expiraban).
Corrección mínima en el núcleo: `import * as opentypeNamespace` y elegir
`ns.default ?? ns` (la forma que aporte `parse`). Verificado: el spike del
producto sigue 37/37 con **hashes byte-idénticos** a los ejemplos commiteados.

Hipótesis descartadas con evidencia: WASI (el glue de emscripten lo resuelve:
`versionString()` = 15.0.0), target `esnext` del optimizador (el error persistió
tras cambiarlo) y caché compartido del optimizador (persistió con `cacheDir`
propio).

### Validación geométrica (Fase 1)

Prueba nueva en `tests/spike-typography-harfbuzz.spec.ts`: texto curvo de
HarfBuzz contra el `<textPath>` del navegador, con la metodología del spike
(referencia en píxeles de dispositivo + desviación física tinta-tinta).

| Escenario | Resultado |
|---|---|
| 85/50, 80/60, 75/65 × normal / invertido / rotado × Poppins, Lato, Dancing Script | 3/3 tests verdes (18 comparaciones) |
| Longitud / posición / rotación / desviación | ≤ 1 % / ≤ 0,2 mm / ≤ 0,5° / ≤ 0,2 mm (mediana 0,0006 mm, `beyond` = 0) |
| 10 tests previos de HarfBuzz | 10/10 |

Dos fallos de implementación encontrados y corregidos por el camino: `face.upem`
es **propiedad** (no método) en harfbuzzjs; el `Blob` que respalda la `Face`
debe quedar **alcanzable** (el `FinalizationRegistry` de emscripten lo liberaba →
`memory access out of bounds`); el harness quedó sin `await` al volver el shaper
asíncrono; y `placement.advanceMm` no existe en `CurvePlacement` (NaN en el path).

Dos fallos **del test** (no del motor), corregidos: el literal "no NFC" estaba
precompuesto (nunca disparaba el caso) y la referencia del navegador renderizaba
la fuente **variable** en wght 600 mientras el motor componía la instancia por
defecto (400). La referencia además debe **embeber la fuente en su propio SVG**:
un SVG rasterizado como imagen no hereda las `@font-face` de la página y el texto
caía a una fuente de respaldo (43 % menos de tinta).

### Harness construido (Fase 2)

`vite build` del harness aislado: OK (221 ms). El WASM se emite como asset y el
glue lo resuelve por URL relativa a la **página** (`base` calculada según la
profundidad). Verificado sirviendo el build por HTTP: carga HarfBuzz 15.0.0 +
WASM, **0 errores** de consola/página.

| Pieza | Raw | gzip |
|---|---|---|
| harfbuzz.wasm | 444 394 B | 179 585 B |
| index.mjs | 85 257 B | 17 404 B |
| harfbuzz.js | 32 099 B | 6 743 B |
| **Total HarfBuzz** | **561 750 B** | **203 732 B** |

Tiempos: carga+instanciación del WASM **35,6 ms**, página lista **70 ms**,
composición+layout **2,9–8,7 ms** por texto (51 ms la primera).

## Fase 1-2 — Motor en el producto y preparación del laboratorio (2026-10-24)

### Fase 0 — Respaldo: BLOQUEADO

`git push origin experiment/illustration-stencil` **no se pudo ejecutar**: el
entorno no tiene credenciales (`could not read Username for 'https://github.com'`,
sin credential helper, sin `gh`, sin token en el entorno). Los 4 commits
siguen seguros en la rama local; el push queda pendiente de que el usuario lo
ejecute. No se hubo de divergencia: `origin` estaba 4 commits por detrás
(fast-forward limpio).

### Fase 1 — `src/typography/` (motor puro, sin efecto visible)

Motor compartido, portado del spike validado: `harfbuzz.ts` (shaper),
`curved.ts` (geometría y serialización), `fonts.ts` (catálogo), `index.ts`
(API). El shaper y la geometría son los **mismos** que el spike (sin reescribir
el layout curvo ni la serialización).

- `harfbuzzjs@1.6.4` pasa a **dependencia de runtime** (lock: +1/−2).
- `vite.config.ts` (nuevo, raíz): plugin `harfbuzz-assets` que sirve el WASM en
  dev y lo emite como asset en build, más `optimizeDeps.exclude`. El **bundle
  inicial no cambia** (357 603 B, idéntico) y **no menciona harfbuzz** → el WASM
  queda fuera del bundle inicial ✓.
- Las fuentes se sirven desde `public/typography/` (con su OFL y su
  `PROVENANCE.md`): importarlas como módulos hace que Vite intente transformarlas
  y un `.ttf` no es JavaScript.
- `src/typography/README.md` documenta el módulo.

Pruebas nuevas: `tests/typography.spec.ts` (5) — carga diferida del WASM, los 11
pares GSUB de Lato contra el navegador, **texto curvo idéntico al navegador en
85/50, 80/60 y 75/65 × normal/invertido/rotado × las 3 fuentes** (18
comparaciones), fallos explícitos y determinismo. Todas verdes con los umbrales
originales sin relajar.

Fallos encontrados y corregidos (todos de test o de tipos, ninguno del motor):
el literal "no NFC" estaba precompuesto; la conversión mm→px del avance; el
`scenario` no mapeaba `outerDiameterMm`; los paths en mm necesitaban el
escalado ×24 en el SVG de comparación; `face.upem` es propiedad; `Blob`/`Face`
debían stay alive; `HarfBuzzModule["Font"]` es el constructor y no la instancia.

### Fase 2 — Laboratorio: preparado y AISLADO (uso real sigue deshabilitado)

- `src/production-lab/typographyOutlines.ts` (nuevo): adaptador que convierte un
  texto del laboratorio en contornos vectoriales usando **exactamente** las
  medidas que el laboratorio ya calcula (fontSizeMm, letterSpacingMm,
  baselineRadiusMm, ángulo, dy). **No está conectado al exportador**: el gate
  `FONT_OUTLINES_UNAVAILABLE` sigue vigente. El mapeo de familia es explícito
  (`catalogueFontForFamily`): Georgia/Arial → `null` (nunca sustitución).
- `tests/production-lab-typography-parity.spec.ts` (nuevo, 4 tests): demuestra que
  con la misma fuente, la misma configuración tipográfica y la misma geometría,
  la vista previa del laboratorio y los contornos vectoriales coinciden
  (desviación ≤ 0,2 mm, media ≤ 0,05 mm, sin píxeles huérfanos) en las 3
  fuentes del catálogo.

### BLOQUEO DE LA FASE 2 (pide autorización)

La paridad **para los trabajos reales** exige que la vista previa use una fuente
**empaquetada**, y hoy la vista previa del laboratorio (PhysicalComposition.tsx)
pinta el texto con `source.fontFamily`: las fuentes del editor (Georgia, Arial,
Times New Roman, Trebuchet MS, Verdana), **propietarias y no redistribuibles**.
Un SVG con contornos vectoriales nunca podrá ser idéntico a esa vista previa.

→ Habilitar textos reales requiere **cambiar la lista de tipografías visibles
del personalizador** al catálogo empaquetado. Eso está explícitamente diferido
("No modificar todavía las tipografías visibles del personalizador") y afecta al
editor, a los snapshots y a los trabajos guardados. **Se detiene aquí** y se
solicita autorización.

## Tasks

- [x] T1: Diagnóstico medible del test rojo (75×65, −35°): antialiasing/rasterizador,
      no geometría; dos defectos de método aislados y cuantificados.
- [x] T2: Corrección aplicada con justificación técnica verificable; umbrales del reporte
      intactos; control de sensibilidad agregado; SVG de salida sin cambios (hashes).
- [x] T3: Kerning real de Lato verificado y pineado: 961 pares contra Chromium (490 con
      kern, error máx 0,16 unidades de fuente), 14 pines de valores GPOS, fallo cerrado
      `KERNING_UNSUPPORTED` probado sobre una copia parcheada, determinismo de salida.
- [x] T4: Trazabilidad de Lato completa en `spikes/typography/fonts/lato/PROVENANCE.md`.
- [x] T5: `spikes/typography/README.md` actualizado (Poppins, Lato, `gposKerning.ts`,
      método de medición, límites reales).
- [x] T6: Ejemplos SVG y métricas preservados en `spikes/typography/examples/` (6 SVG,
      2 tablas de hashes, 16 métricas) + `examples/README.md`. Sin temporales ni capturas
      de terceros: la captura de referencia queda intacta en `references/typography/`.
- [x] T7: Tests focalizados (spike 37/37), typecheck (`src/` OK, spike OK) y suite
      completa **512/512** (4,6 min, 0 fallos).
- [x] T8: Informe final entregado.
- [x] T11 (HarfBuzz): shaper + layout curvo reutilizando el núcleo, harness
  aislado con carga de WASM resuelta (dev y build), 13 tests nuevos (10 de
  paridad + 3 de texto curvo) más 1 de build, todos verdes.
- [x] T14: Motor compartido en `src/typography/` (shaper + geometría + catálogo,
  carga diferida, WASM fuera del bundle inicial) con 5 tests de regresión.
- [x] T15: Adaptador aislado del laboratorio (`typographyOutlines.ts`, sin tocar
  el exportador) + 4 tests de paridad vista previa/contornos.
- [ ] T16: **BLOQUEADO — pide autorización**: habilitar textos reales exige que
  el personalizador ofrezca el catálogo empaquetado (las fuentes del editor son
  propietarias) → afecta editor, snapshots y trabajos guardados.
- [x] T12: Procedencia de Dancing Script (`PROVENANCE.md`: SHA-256 verificado
  contra la distribución oficial, OFL, RFN "Dancing Script", eje `wght`).
- [x] T13: Documentación del spike actualizada (README: motor HarfBuzz,
  integración con Vite, tamaños y tiempos medidos).
- [x] T9 (Fase 2): Evaluación de Dancing Script Bold → **detenida** con tres
  bloqueos medidos (variable, GSUB contextual, kerning no soportado) + hallazgo
  colateral en Lato (12 ligaduras contextuales no reproducidas). Alternativas y
  costos documentados arriba. Ningún archivo de Dancing Script entra al repo.
- [x] T10: Commit local de consolidación (`feat(spike): add Stage 4 typography
  spike with Poppins and Lato outlines`, 51 archivos) y commit de documentación
  de esta fase. Sin push, sin merge.

**Commit de la etapa**: `feat(spike): add Stage 4 typography spike with Poppins and Lato outlines`
(commit local en `experiment/illustration-stencil`, 51 archivos, +4178 líneas: 49 de
texto + 2 binarios de fuente; **no push, no merge**). Contiene T1–T8.

## Evidence

- **Suite completa**: 512/512 en 4,6 min (475 del producto + 37 del spike), 0 fallos,
  0 skip, sin reintentos ni cambios de timeout. Baseline previo del producto: 475/475.
- **Typecheck**: `tsc --noEmit` (producto, `src/`) OK; `tsc -p spikes/typography/tsconfig.json` OK.
  En los specs (fuera del `tsconfig` raíz, sin `@types/node` instalado) solo quedan
  errores **preexistentes** (módulos `node:` sin tipos, `BrowserGlyph` sin usar en
  `spike-typography.spec.ts:379`, ya presente antes de este trabajo).
- **Kerning Lato**: 961 pares, 490 con kerning, `maxErr = 0.1563` unidades de fuente,
  `maxErr` ignorando kerning 244,1 unidades; longitud de texto recto idéntica a
  `avance + kern + letter-spacing`; `KERNING_UNSUPPORTED` con motivo exacto ("tipo 3").
- **Geometría (tras la corrección)**: residual por glifo ≤ 0,0293 mm y ≤ 0,321°; longitud
  ≤ 0,0503 % de diferencia con kerning (5,0 % si se ignora).
- **Visual (tras la corrección)**: `devMean` 0,0007–0,0024 mm, `devMax` 0,042–0,059 mm,
  `beyond` 0, divergencia por píxel 0 en ambos sentidos; control de sensibilidad
  0,103–0,147 mm (Poppins, 0,5 mm) y 0,102–0,302 mm (Lato, sin kerning).
- **Trazabilidad Lato**: SHA-256 `71B8B7DE…F803C` verificado **byte a byte** contra la
  distribución oficial (`raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-SemiBold.ttf`,
  668 548 bytes); blob git local `3b1bcccc3384aef84a68242e331e1018c8e141e0` = blob
  agregado por `f3b885d5590e307e02542f1a724cec55d567fdaa` (2016-12-02, "lato: v2.015
  added (#479)"), único commit del path; `OFL.txt` y `METADATA.pb` con hashes idénticos a
  los oficiales; **Reserved Font Name "Lato"** confirmado en la primera línea de la OFL.
  Corrección documentada de `upstream_info.md` (que decía `missing_commit`): el commit
  del binario distribuido sí es identificable; el commit de las *fuentes* upstream sigue
  inferido y queda como pendiente.
- **Preservación**: los SVG de ejemplo de Poppins y Lato son **byte-idénticos** antes y
  después; `references/typography/` intacto; `src/` sin cambios (`git diff` solo muestra
  `package.json` / `package-lock.json` de Antigravity).

## Limits

- El spike **no** se integra en `src/`: el gate productivo sigue en
  `FONT_OUTLINES_UNAVAILABLE` (`src/production-lab/exportTextOutlines.ts`).
- Sin shaping completo (sin ligaduras ni alternos contextuales).
- Sin validación con el grabador real.
- Solo 2 de las 5 tipografías candidatas probadas (Lato, Playfair Display, Poppins,
  Merriweather, Dancing Script): ninguna *serif display* ni *script*.
- Lato declara Reserved Font Name "Lato": cualquier derivado debe renombrarse.
- El criterio de desviación detecta errores **a partir de ~0,2 mm** (la tolerancia
  documentada): un desplazamiento uniforme de 0,1 mm deja la desviación media en
  ~0,009 mm porque los contornos se solapan; queda fuera de la tolerancia del reporte
  y, por tanto, fuera del criterio.
- `package-lock.json` mantiene un cambio no relacionado heredado (`"peer": true` de
  `vite`): revisar antes de commitear.

## Log

L1 Original request (verbatim, Etapa 4 cierre del incremento): "Continuamos Mate&Co — Etapa 4,
spike de tipografías vectoriales." … "La auditoría anterior identificó que Antigravity dejó el
spike de Poppins completo y la ampliación a Lato parcialmente terminada." … "Quiero cerrar
correctamente ese incremento antes de integrar nada al personalizador." — objectives S1–S7,
restricciones S8.
L2 Auditoría previa (read-only): repo en `experiment/illustration-stencil` HEAD `679e1dc`;
spike sin commitear; subconjunto spike 36/37 con un único rojo reproducible
(`tests/spike-typography-kerning.spec.ts:479`, 3.0018% vs 2%); outputs de Antigravity
byte-idénticos al regenerarlos; README del spike desactualizado (no menciona
`gposKerning.ts`, Lato ni el spec de kerning); sin documento ODD ni `PROVENANCE.md` de Lato;
ejemplos Lato solo en `test-results/` (gitignored).
L3 T1 diagnóstico: cinco experimentos (aislamiento por glifo, barrido de escala de layout,
correlación de desplazamiento, `geometricPrecision`, desviación tinta-tinta). Contorno
pixel-idéntico al del navegador a 400 px (IoU 1.0000); el 3 % era ruido del rasterizador
sobre una referencia compuesta a 1,34 px. Causa: método de medición, no geometría.
L4 T2 corrección aplicada a los dos specs (referencia en píxeles de dispositivo + criterio
físico de desviación con control de sensibilidad). Umbrales del reporte intactos; SVG de
salida sin cambios (hashes idénticos).
L5 T4 trazabilidad Lato: commit del binario identificado y verificado por hash y blob git;
RFN confirmado; pendiente explícito del commit de las fuentes upstream.
L6 T5/T6 README del spike reescrito y ejemplos+métricas preservados en el spike.
L10 HarfBuzz: arranque del harness diagnosticado (interop del pre-bundle de
opentype.js) y corregido; validación focalizada 10/10; validación geométrica
curva 3/3 (18 comparaciones, umbrales originales sin relajar); build del harness
verificado con mediciones reales de tamaño y tiempo.
L7 T7 verificación: spike 37/37, typecheck de `src/` y del spike OK, suite completa
512/512 (4,6 min).
L9 Fase 2 (Dancing Script): la fuente oficial es **variable** (`DancingScript[wght].ttf`,
wght 400–700); el estático Bold ya no se distribuye. Chromium aplica el eje de peso
(+3,6 % de longitud entre 400 y 700) y una sustitución GSUB contextual para `or`
(+4,013 px = 4,0 % del em sobre 5625 pares medidos); el `kern` de la fuente usa
`lookupFlag 8` con GDEF y el motor falla cerrado (`KERNING_UNSUPPORTED`). **No se
implementa.** Hallazgo colateral: **Lato** (ya commiteada) tiene 12 pares ligables por
GSUB contextual (`liga`/`calt`, lookups tipo 7) que el motor no reproduce — el preview y
el export difieren en la FORMA del glifo, no en la posición. Poppins: 0 divergencias.
L8 Commit local creado con el alcance pedido (spike + fuentes/licencias + pruebas +
ejemplos + documentación ODD + dependencia `opentype.js`). La captura de
`references/typography/` queda **fuera** del commit (sigue sin seguimiento). Se revirtió
el cambio colateral de `package-lock.json` sobre Vite (`"peer": true`, metadata que npm
reescribe al re-resolver el árbol; `npm ci --dry-run` verificado idéntico con y sin
él): el diff del lock queda en la única adición de `opentype.js`. Los finales de línea
CRLF del lock se preservaron.
