# Continuación — integración del motor vectorial en el exportador del CLIENTE

**Estado al apagar el equipo (2026-10-25).** Etapas **E0 y E1** de la auditoría
multiagente: implementadas y en verde. **Sin commit** (pendiente de revisión).
**No se ha conectado el adaptador al flujo del cliente** (por contrato de la
etapa E0): nada de lo hecho cambia hoy el archivo que descarga el cliente.

## 1. Objetivo original de E0 y E1

- **E0**: crear `src/export/vectorTextOutlines.ts` como adaptador entre el motor
  HarfBuzz (`src/typography/`) y el contrato `TraceTextFn` del exportador del
  cliente, **sin modificar** `productionSvg.ts`; y trasladar la resolución de
  fuentes del catálogo (`catalogueFontForFamily`) a `src/typography/` para que
  `src/export` no dependa del módulo del laboratorio.
- **E1**: pruebas de paridad entre los contornos vectoriales del adaptador y la
  **vista previa real del cliente** (no cálculos internos del motor).

Contexto: la auditoría (previo) Conclusions clave: el exportador del cliente
**ya es async** y **ya tiene un seam de inyección** (`TraceTextFn`); el texto es
el **único** elemento rasterizado del archivo del cliente; el snapshot guarda la
composición, **no** el SVG → cambiar el exportador no invalida trabajos.

## 2. Trabajo completado / pendiente

**Completado**
- E0: adaptador vectorial (sin conectar) + `catalogueFontForFamily` mudado a
  `src/typography/catalogue.ts` (el laboratorio lo re-exporta → sus consumidores
  siguen funcionando) + tipos de `inkBox` exactos.
- E1: 11 tests de paridad contra el navegador real (3 fuentes, normal/invertido/
  rotado, texto largo, sólo espacios, glifo ausente, no-NFC, determinismo,
  comparación de `inkBox`).

**Pendiente**
- E2 (decisión del propietario): política de fallos — fuentes del sistema, glifo
  ausente, no-NFC, plan B por texto.
- E3: camino vectorial **opt-in** en `productionSvg.ts` + `ConfirmPanel.tsx`
  (cambio de contrato: `Promise<string>` → resultado con código, o `throw`).
- E4: migrar el default + actualizar los tests que fijan `scale(0.33)`/nº de
  paths y los 2 E2 con `fontFamily: 'Georgia'`.
- E5: validación con el grabador real.

## 3. Archivos modificados y finalidad

| Archivo | Estado | Finalidad |
|---|---|---|
| `src/export/vectorTextOutlines.ts` | **nuevo** | Adaptador `TraceTextFn` con HarfBuzz, en **unidades de diseño 900×900** (sin mm). Sin conectar. |
| `src/typography/catalogue.ts` | **nuevo** | `catalogueFontForFamily(family) → TypographyFontId \| null` (null = fuera del catálogo, sin sustitución). |
| `src/production-lab/typographyOutlines.ts` | **modificado** (+5/−12) | Importa de `../typography/catalogue` y re-exporta `catalogueFontForFamily` (compatibilidad). |
| `tests/export-vector-text-parity.spec.ts` | **nuevo** | 11 tests de paridad contra la vista previa real del navegador. |

**Intactos (verificado)**: `src/export/productionSvg.ts`, `src/export/textOutlines.ts`,
`src/export/geometry.ts`, `src/components/{CurvedText,DesignPanel,ConfirmPanel}.tsx`,
`src/admin-lab/`, `src/jobs/`, `references/typography/` (fuera de todo commit).

### Decisiones del adaptador (E0)

- Unidades de diseño: `fontSize = 35·scale`, `letterSpacing = 2·scale`,
  radio base `radius − 14·scale`, `dy = 26·scale` (invertido), `weight = 600`
  siempre (Dancing Script es variable), **`angleDegrees = 0`** (el exportador ya
  gira el grupo; duplicarlo lo giraría dos veces).
- `cropX = cropY = 450`, `pixelScale = 1` (el motor centra en (0,0) y el
  `translate(cropX cropY)` del exportador lleva los paths al centro del cliente).
- `inkBox`: bbox **exacto** (extremos analíticos de las curvas) **+450/+450**, en
  marco **sin rotar** (el exportador lo gira después con `rotateBox`).
- `arcLength` = `totalAdvanceMm` del motor (avance, en unidades de diseño).
- Vacío → `null`; sólo espacios → `null` (el motor da avance pero ningún path:
  sin banda fantasma); familia fuera del catálogo → `Error FONT_NOT_IN_CATALOGUE`;
  glifo ausente / no NFC / fuente no disponible → `Error` con el código del motor.
  **Nunca** sustituye ni normaliza.

## 4. Pruebas ejecutadas y resultados reales

| Comando | Resultado |
|---|---|
| `tsc --noEmit` (producto) | **OK**, 0 errores |
| `tsc --noEmit -p spikes/typography/tsconfig.json` | **OK**, 0 errores |
| `playwright test tests/export-vector-text-parity.spec.ts` | **11 passed** (11,8 s) |
| Focalizadas (nuevas + `spike-typography`, `spike-typography-kerning`, `spike-typography-harfbuzz`, `spike-typography-harfbuzz-build`, `production-lab-typography-parity`, `production-lab-text-export`) | **72 passed** (1,3 min) |
| Regresión completa (550) | **NO ejecutada** (queda para el orquestador) |

**Diferencias geométricas medidas** (2 px por unidad de diseño, lienzo 1800×1800;
referencia = el mismo path + `<textPath startOffset="50%">` + atributos `<text>`
leídos del DOM real del editor, con la fuente embebida):

| Caso | media (u) | máxima (u) | sin pareja | avance motor vs navegador |
|---|---|---|---|---|
| Poppins "¡Fiesta! Mate&Co" | 0,0069 | 0,50 | 0 | 338,180 vs 338,384 (0,06 %) |
| Lato | 0,0111 | 0,50 | 0 | 301,063 vs 301,229 (0,06 %) |
| Dancing Script | 0,0205 | 0,50 | 0 | 253,550 vs 253,778 (0,09 %) |
| Invertido (dy 26, sweep 0) | 0,0092 | 0,50 | 0 | 293,865 vs 294,083 (0,07 %) |
| Rotado 30° | 0,0068 | 0,50 | 0 | 248,770 vs 248,937 (0,07 %) |
| Largo (47 car.) | 0,0163 | 0,71 | 0 | 921,575 vs 922,169 (0,06 %) |

`inkBox` vs tinta de la referencia: ≤ 0,16 u en x/y y ≤ 0,65 u en ancho/alto.
1 u ≈ 0,134 mm (virola 85/50, estrategia B) ⇒ desviación máxima ≈ 0,07–0,10 mm
(muy por debajo de 0,2 mm). Umbrales fijados en el spec: media ≤ 0,3 u, máxima
≤ 1,5 u, `inkBox` ≤ 2 u.

## 5. Errores y problemas conocidos

1. **El SVG cargado como `<img>` no puede pedir fuentes externas**: la
   referencia **debe** embeber la fuente (data URI). Si se olvida, el navegador
   dibuja con una tipografía de reserva y la comparación mide otra fuente. El
   test lo blinda con controles de área de tinta (±10 %) y de avance (±1 %).
2. Durante el desarrollo, una constante de fuente olvidada (Lato) produjo un
   falso fallo del 13 % de ancho; era la referencia, no el motor.
3. **El motor no recorta el texto largo y el navegador sí** (caso real a escala 3
   con 80 caracteres). Si se conectara el adaptador, hay que decidirlo
   explícitamente.
4. `arcLength` del adaptador es el avance del motor; el trazador raster mide el
   arco de la tinta → al conectar, la banda de knockout puede variar
   ligeramente respecto de la actual.
5. `src/export/vectorTextOutlines.ts` importa `clampTextScale/clampTextRadius` de
   `src/components/CurvedText.tsx` (igual que hoy `textOutlines.ts`): convención
   existente, no modificada.
6. La auditoría dejó 4 correcciones obligatorias ya incorporadas en E0/E1
   (`inkBox` +450, `angleDegrees=0`, `weight=600`, `null`/`throw` por caso) y
   3 decisiones de producto pendientes (E2).

## 6. Subagentes que participaron y su estado

| Subagente | Tarea | Estado |
|---|---|---|
| `gentle-ai-explore` | auditoría Fase A (exploración) | **terminado** |
| `gentle-ai-verify` | auditoría Fase B (riesgos) | **terminado** |
| `jd-judge-b` | auditoría Fase D (refutación) | **terminado** (2º intento; el 1º falló) |
| `jd-judge-a` | auditoría Fase E (validación) | **terminado** |
| `gentle-ai-worker` | **E0 + E1** (esta sesión) | **terminado**, todo en verde |

Todos **detenidos**; no hay subagentes en marcha. `review-risk`,
`review-refuter` y `review-validator` **no existen** en este entorno (el primero
además exige el flujo nativo de revisión) → se usaron `gentle-ai-verify`,
`jd-judge-b` y `jd-judge-a` respectivamente.

## 7. Estado de Git y HEAD

```
Rama: experiment/illustration-stencil (sincronizada con origin)
HEAD: 490802e feat(production-lab): export curved text as real vector outlines
Sin commit de E0/E1 (pendiente de revisión).
```

```
 M src/production-lab/typographyOutlines.ts
?? src/export/vectorTextOutlines.ts
?? src/typography/catalogue.ts
?? tests/export-vector-text-parity.spec.ts
?? references/typography/          ← captura: FUERA de todo commit
```

## 8. Instrucciones para continuar mañana (sin repetir trabajo)

1. **Revisar el diff** de los 4 archivos (el núcleo está en
   `src/export/vectorTextOutlines.ts`; la decisión de `inkBox` exacto y
   `cropX/cropY=450` está en sus comentarios).
2. **Ejecutar**: `tsc --noEmit`, `tsc --noEmit -p spikes/typography/tsconfig.json`,
   `playwright test tests/export-vector-text-parity.spec.ts` y las focalizadas
   listadas arriba. **Ojo**: `node_modules` es de Windows → lanzar Playwright con
   `cmd.exe /c 'cd /d C:\Mate^&Co && node node_modules/@playwright/test/cli.js test …'`
   (rutas con `/`). Ojo: el `&` del nombre de la carpeta DEBE ir escapado
   (`C:\Mate^&Co`); sin el escape, `cmd` interpreta el `&` como separador de
   comandos y falla con «"Co" no se reconoce como un comando».
3. **Regresión completa** (550 + 11 = 561 tests) una sola vez, antes de commitear.
4. **E2 (decisión del propietario)**: política de fallos (fuentes del sistema, glifo
   ausente, no-NFC, plan B por texto) y si el cambio de bytes del archivo
   exportado (1 path por glifo, `fill-rule` nonzero) se acepta como nueva versión.
5. **E3**: conectar el adaptador de forma opt-in (el default raster intacto) →
   `productionSvg.ts` + `ConfirmPanel.tsx`; el contrato pasa a `throw` con código
   (el panel ya captura `reason instanceof Error`, no hace falta cambiar la firma).
6. **Commit** sólo tras la revisión, con `git add` de rutas explícitas, **excluyendo
   `references/typography/`**.

## 9. Revisión de E0/E1 (2026-10-27)

**Alcance**: revisar, validar y respaldar **sólo E0 y E1**. E2–E5 siguen sin
empezar. El adaptador **no** se conectó al exportador del cliente.

### Estado verificado antes de empezar

| Punto | Esperado | Verificado |
|---|---|---|
| Rama | `experiment/illustration-stencil` | ✓ igual |
| HEAD | `490802e` | ✓ igual (`feat(production-lab): export curved text as real vector outlines`) |
| `origin/experiment/illustration-stencil` | sin divergencia | ✓ `git rev-list --left-right --count` → `0  0` |
| Archivos sin commitear | 3 nuevos + 1 modificado | ✓ `src/export/vectorTextOutlines.ts`, `src/typography/catalogue.ts`, `tests/export-vector-text-parity.spec.ts` (nuevos) + `src/production-lab/typographyOutlines.ts` (modificado) |
| `references/typography/` | fuera de todo commit | ✓ sigue sin seguimiento; ningún test lo lee |

### Verificación del contrato (E0)

- `src/export/vectorTextOutlines.ts` implementa `TraceTextFn` **exactamente**
  (petición `{text, fontFamily, scale, radius, inverted}` → `TextTrace | null`
  con `paths`, `cropX`, `cropY`, `pixelScale`, `inkBox`, `arcLength`): al
  asignarlo a `const vectorTextTrace: TraceTextFn` el compilador verifica la
  conformidad.
- **No conectado**: ningún archivo de `src/` importa el adaptador; el
  exportador del cliente sigue usando `traceTextElement` (raster) como valor
  por defecto de `buildProductionSvg`. `src/export/productionSvg.ts`,
  `src/export/textOutlines.ts`, `src/components/ConfirmPanel.tsx`,
  `src/components/CurvedText.tsx`, `src/components/DesignPanel.tsx`,
  `src/admin-lab/` y `src/jobs/` están **intactos** (`git diff HEAD` vacío).
- **Sin acoplamiento al laboratorio**: `src/export/` no importa nada de
  `src/production-lab/`; el mapa familia → fuente vive ahora en
  `src/typography/catalogue.ts` y el laboratorio lo re-exporta (sus consumidores
  —incluido `tests/production-lab-typography-parity.spec.ts`— siguen
  funcionando sin cambios).
- **Geometría = la de la vista previa**: contrastada contra
  `src/components/CurvedText.tsx` (el path del texto es la circunferencia
  completa de radio `radius − 14 × escala`, `fontSize = 35 × escala`,
  `letter-spacing = 2 × escala`, `dy = 26 × escala` invertido, `font-weight`
  600, `text-anchor: middle`, `startOffset: 50 %`) y contra
  `src/typography/curved.ts` (el texto queda **centrado** en el arco: `pen` se
  inicializa en `−total / 2`, equivalente a `startOffset="50%"`).
- **`inkBox`**: bbox analítico exacto de las curvas (extremos de las Bézier
  cuadráticas y cúbicas, no la envolvente de los puntos de control), en el
  marco **sin rotar** — que es lo que espera el exportador, que aplica
  `rotateBox(trace.inkBox, element.angle)`. El serializador del motor sólo
  emite `M/L/Q/C/Z` absolutos, que es exactamente lo que el parser del
  adaptador reconoce.

### Verificación de las pruebas (E1)

Las 11 pruebas originales comparan contra la **vista previa real del
navegador**: la referencia se arma con el `d` del `<path>` y los atributos del
`<text>` leídos del DOM del editor, no con cálculos internos del motor. La
fuente del catálogo va embebida como data URI (un SVG cargado como `<img>` no
puede pedir fuentes externas) y hay un control de área de tinta (±10 %) y de
avance (±1 %) que falla si la referencia se construyera con otra tipografía.

**Cobertura añadida en esta revisión (12 pruebas)**: la rama
`FONT_NOT_IN_CATALOGUE` (familia fuera del catálogo) estaba documentada en el
adaptador pero **sin ninguna prueba**: la vista previa sólo ofrece tipografías
del catálogo, así que no se puede provocar desde el editor. Se añadió una
prueba que llama al adaptador con una familia de sistema (`Georgia`) y exige
un `Error` con ese código (sin sustitución).

### Resultados de la verificación

| Comando | Resultado |
|---|---|
| `tsc --noEmit` (producto) | **OK**, 0 errores |
| `tsc --noEmit -p spikes/typography/tsconfig.json` | **OK**, 0 errores |
| `vite build` | **OK** (1,27 s) |
| `playwright test tests/export-vector-text-parity.spec.ts` | **12 passed** |
| Focalizadas (nuevas + `spike-typography`, `spike-typography-kerning`, `spike-typography-harfbuzz`, `spike-typography-harfbuzz-build`, `production-lab-typography-parity`, `production-lab-text-export`) | **72 passed** (1,3 min) |
| Regresión completa | **561 passed** (6,7 min) sobre el árbol *antes* de añadir la prueba 12; repetida sobre el árbol final: **562 passed** |

### Confirmación de los problemas conocidos

1. **El motor no recorta el texto largo y el navegador sí.** Confirmado con
   precisión: el path del texto de la vista previa es la circunferencia
   completa de radio `radius − 14 × escala` (2 × π × 360 ≈ **2 262 u** a
   escala 1), no el arco de hit (`hitArc`, que sólo es área de toque y banda de
   knockout). El navegador no dibuja el texto que excede el path; el motor
   compone el texto **completo** sin recortar. Con el límite del editor (80
   caracteres) y escala 1 el texto entra de sobra; **a escala 3** (fuente
   105 u) 80 caracteres ≈ 5 000 u > 2 262 u → el navegador recorta y el motor
   no. Consecuencia al conectar: el SVG exportado puede tener **más** texto que
   la vista previa, no menos. Hay que decidirlo explícitamente (E2/E3).
2. **`arcLength` es el avance, no el arco de la tinta.** El trazador raster
   mide el arco de la tinta; el adaptador devuelve `totalAdvanceMm` (avance
   total, con el `letter-spacing` de cada carácter). El exportador deriva de
   ahí el `halfSpan` de la banda de knockout
   (`(arcLength / 2 + 14) / radius`), así que al conectar la banda puede
   variar ligeramente respecto de la actual. Además el raster usa `pathRadius`
   para el arco y el exportador usa `radius`: esa asimetría es **preexistente**
   y no la introduce el adaptador.
3. **Riesgo residual, bajo**: el adaptador depende de `clampTextScale` /
   `clampTextRadius` de `src/components/CurvedText.tsx` (misma convención que
   el trazador raster actual) y de que el motor siga serializando sólo
   `M/L/Q/C/Z` absolutos (el parser de `inkBox` depende de ello).

### Subagentes

`gentle-ai-verify` **no pudo lanzarse**: el harness lo rechaza cuando el
cambio no declara un ítem de riesgo alto (`Risk: item N`), y este cambio no
lo declara (el adaptador no está conectado → no cambia el archivo que descarga
el cliente). La verificación se hizo **inline**, con evidencia por comando.
`review-reliability` no se usó: no apareció un riesgo que justificara una
revisión adicional (mismo motivo del punto anterior).
