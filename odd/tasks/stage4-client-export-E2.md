# E2 — Compatibilidad del motor vectorial con el cliente: reglas verificadas

**Etapa**: E2 (análisis y definición). **Estado**: cerrado, con evidencia medida.
**Anterior**: `stage4-client-export-handoff.md` (E0 + E1, commit `78933ef`).
**Siguiente**: `stage4-client-export-E3.md` (E3.0).

Este documento fija **lo que se midió**, **lo que es tolerancia experimental** y **lo que
queda pendiente**. No implementa nada: la implementación es E3.0.

---

## 0. Cómo se midió

Seis sondas Playwright/Chromium contra el servidor de desarrollo y el motor real
(`/src/typography`), reutilizando la metodología de `tests/export-vector-text-parity.spec.ts`
(tinta del navegador con la fuente embebida como data URI, contornos del motor rasterizados
con el mismo markup del exportador, comparación por desviación física en unidades de diseño).

Las sondas quedaron en `test-results/scratch/` (ignorado por git). **No son tests**: son el
instrumento de medición que hay que convertir en specs reales en E3.0.

`node_modules` está instalado para Windows: Playwright corre con
`cmd.exe /c 'cd /d C:\Mate^&Co && node node_modules/@playwright/test/cli.js test …'`
(el `&` **va escapado** como `^&`; sin el escape, `cmd` lo toma como separador de comandos).

---

## 1. Observaciones (medidas, no inferidas)

### 1.1 El path del texto de la vista previa es una circunferencia CERRADA

`src/components/CurvedText.tsx:66` define el path del texto como dos medias circunferencias
de radio `pathRadius = radius - 14 * escala`, no un arco. El `hitArc` (`:47`) es sólo área de
toque y banda de knockout del editor.

- Longitud del path: `P = 2 * pi * pathRadius` (2 262 u a escala 1; 2 086 u a escala 3).
- `startOffset="50%"` + `text-anchor="middle"` ⇒ el texto queda **centrado arriba**, que es
  el ángulo 0 del motor (`src/typography/curved.ts`, `baselinePoint`).
- El avance total del motor (`totalAdvanceMm`, con `letter-spacing` por carácter) coincide con
  el `getComputedTextLength()` del navegador con 0,06 %–0,09 % de diferencia.

### 1.2 Chromium recorta AL RANGO DEL PATH, no "a lo que entra"

**Observación central.** El navegador conserva la centración del texto y **descarta los
caracteres cuya posición en el path cae fuera de `[0, P]`**. El carácter frontera se pinta
**a medias**.

En coordenadas del motor (`s` = coordenada de arco relativa al centro del texto,
`R = pathRadius`), la regla es:

> un cluster se pinta si y solo si `|s_medio| <= pi*R`

donde `s_medio` es el arco del **punto medio del avance** del cluster.

**La regla se afinó midiendo tres criterios candidatos** contra la ventana que
reporta el DOM real (`getStartPositionOfChar`; la posición de reserva `(0,0)`
marca los caracteres no pintados). El criterio por **inicio** del avance
rechaza un cluster que el navegador sí pinta; el criterio por **final**
rechaza otro que el navegador sí pinta. Sólo el criterio por **centro**
coincide en los cinco escenarios medidos:

| Escenario | ventana del DOM | por inicio | por final | por centro | `s_medio` de la frontera |
|---|---|---|---|---|---|
| 119 car., escala 1, radio 374 | 12..106 | 13..106 | 12..106 | **12..106** | caben ±1 131 u |
| 239 car., escala 1, radio 374 | 72..166 | 73..166 | 72..165 | **72..166** | caben ±1 131 u |
| 80 car., escala 3, radio 374 | 23..56 | 23..57 | 22..56 | **23..56** | caben ±1 043 u |
| 119 car., escala 1, radio 305 | 21..97 | 22..97 | 21..96 | **21..97** | caben ±914 u |
| 119 car., escala 1, radio 410 | 7..111 | 8..111 | 7..110 | **7..111** | caben ±1 244 u |

**Caracteres pintados**, leídos del DOM real:

| Escenario | Avance | `P` | Pintados | Ventana |
|---|---|---|---|---|
| 47 car., escala 1 | 922 u | 2 262 u | **47 / 47** | cabe |
| 80 car., escala 0,3 | 493 u | 2 324 u | **80 / 80** | cabe |
| 119 car., escala 1 | 2 857 u | 2 262 u | **95 / 119** | 12..106 |
| 119 car., escala 1, invertido | 2 857 u | 2 262 u | **95 / 119** | 12..106 |
| 119 car., escala 1, rotado 30° | 2 857 u | 2 262 u | **95 / 119** | 12..106 |
| 119 car., escala 1, radio 305 | 2 857 u | 1 828 u | **77 / 119** | 21..97 |
| 119 car., escala 1, radio 410 | 2 857 u | 2 488 u | **105 / 119** | 7..111 |
| 239 car., escala 1 | 5 724 u | 2 262 u | **95 / 239** | 72..166 |
| 80 car., escala 3 | 4 926 u | 2 086 u | **34 / 80** | 23..56 |
| 80 car., escala 3, invertido | 4 926 u | 2 086 u | **34 / 80** | 23..56 |

La **rotación no cambia nada** (rota el grupo, no el path). La inversión invierte el sentido
de recorrido pero la regla es la misma (simétrica). El radio entra por `pathRadius`.

El texto **cabe** si y solo si `avance <= P`. El régimen es alcanzable por el cliente: con
escala 1 y 80 caracteres el avance entra en los 2 262 u, pero **a escala 3 el límite es
~32 caracteres**, y el editor permite escala 3 y 80 caracteres (`DesignPanel.tsx:123`).

### 1.3 Sin recorte, el motor produce texto que el cliente no ve

Comparación navegador ↔ motor **sin** recortar (esto es lo que viola la política "el SVG
nunca debe incluir texto que no se vea en la vista previa"):

| Escenario | tinta navegador / motor | sin pareja | desv. media |
|---|---|---|---|
| 119 car., escala 1 | 87 316 / 102 067 | 805 | 0,42 u |
| 239 car., escala 1 | 87 806 / 159 636 | 3 570 | 1,24 u |
| 80 car., escala 3 | 221 664 / 393 499 | **82 954** | 2,13 u |

### 1.4 Con la ventana de visibilidad, la paridad vuelve a ser de píxel

Aplicando la regla de §1.2 (descartar los clusters fuera de `-pi*R <= s_inicio <= pi*R`):

| Escenario | sin pareja (sin recortar) | sin pareja (recortado) | desv. media | desv. máx. | ratio de tinta |
|---|---|---|---|---|---|
| 119 car., escala 1 | 805 | **0** | 0,031 u | 1,12 u | 1,005 |
| 119 car., invertido | 868 | **0** | 0,032 u | 1,12 u | 1,005 |
| 239 car., escala 1 | 3 570 | **0** | 0,032 u | 1,12 u | 1,005 |
| 80 car., escala 3 | 82 954 | **0** | 0,015 u | 1,50 u | 1,002 |
| 80 car., escala 3, invertido | 91 356 | **0** | 0,017 u | 1,58 u | 1,002 |
| 119 car., radio 305 | 771 | **0** | 0,026 u | 1,00 u | 1,004 |
| 119 car., radio 410 | 0 | **0** | 0,034 u | 1,12 u | 1,004 |
| 47 car. / 80 car. escala 0,3 | 0 | **0** | ≤0,043 u | ≤0,71 u | ≤1,026 |

Se probaron además las ventanas alternativas (descartar el glifo frontera de uno o de los dos
lados): **empeoran** el resultado (de 112 a 16 736 píxeles sin pareja). La ventana correcta es
exactamente el rango de caracteres que el navegador pinta.

### 1.4 bis El residuo es el glifo frontera

Con la ventana correcta, la tinta del motor queda **0,5 % por encima** de la del
navegador (87 726 px frente a 87 316 px en el caso de 119 caracteres): el navegador pinta
el carácter frontera **a medias** y el motor lo pinta entero. La diferencia se localiza
en ese único glifo (su avance cruza el borde del path).

### 1.4 ter El trazador raster sustituye la fuente (defecto preexistente)

El trazador raster construye un SVG con `font-family="Poppins SemiBold"` y lo carga
como `<img>`: **un SVG cargado como imagen no puede pedir fuentes externas**, así que el
texto se dibuja con una tipografía de reserva del sistema, no con la del catálogo. Medido
sobre la misma máscara:

| Texto | tinta del navegador (fuente real) | tinta del trazador raster |
|---|---|---|
| "Un texto bastante largo para la virola de acero" | 32 867 px | **15 580 px** |
| "á é í ó ú ñ ¿ ¡" | 6 831 px | **4 789 px** |
| 80 caracteres a escala 3 | 221 664 px | **102 598 px** |

Consecuencias: el `arcLength` del raster (y por tanto su banda de knockout) se mide sobre
la tinta de la fuente equivocada, y **no es comparable** con el del adaptador vectorial
(que sí usa la fuente del catálogo). El camino vectorial no arrastra este defecto.

Corregirlo (embeber la fuente como data URI en el SVG del raster) **rompe las 2 pruebas
que usan `fontFamily: 'Georgia'`** (`tests/export-production-svg.spec.ts`), porque una
familia fuera del catálogo no tiene fuente que embeber: es exactamente el punto que
E2 difiere a **E4**.

### 1.5 La normalización NFC ES visualmente equivalente (conjunto español medido)

Comparación de tres máscaras: navegador con forma descompuesta, navegador con forma
precompuesta, motor con forma precompuesta.

| Caso | tinta descomp. / precomp. / motor | descomp. vs precomp. | precomp. vs motor |
|---|---|---|---|
| `a`+U+0301 | 1 158 / 1 158 / 1 162 | ratio 1,0000 · 0 sin pareja · **0 u** | 0 sin pareja · 0,0039 u |
| `n`+U+0303 | 1 017 / 1 017 / 1 015 | ratio 1,0000 · 0 · **0 u** | 0 · 0,0044 u |
| `u`+U+0308 | 1 013 / 1 013 / 1 013 | ratio 1,0000 · 0 · **0 u** | 0 · 0,0020 u |
| `A`+U+0301 | 1 186 / 1 186 / 1 187 | ratio 1,0000 · 0 · **0 u** | 0 · 0,0084 u |
| `e`+U+0301 | 1 076 / 1 076 / 1 081 | ratio 1,0000 · 0 · **0 u** | 0 · 0,0079 u |

El navegador pinta **idéntico** la secuencia descompuesta y la precompuesta, y el motor sobre
la forma precompuesta coincide con el navegador.

### 1.6 La banda de knockout usa el arco de la TINTA, no el avance

- Exportador (`src/export/productionSvg.ts:143-151`):
  `halfSpan = min(135, max(7, (arcLength / 2 + 14) / radius * 180 / pi))`,
  `halfWidth = (35 * escala + 10) / 2 + 1`, `radius` = radio del **elemento**.
- Trazador raster (`src/export/textOutlines.ts:155`):
  `arcLength = (maxAngle - minAngle) * pi / 180 * pathRadius`, es decir **el arco de la tinta**
  (los píxeles de tinta extremos), no el avance.
- Adaptador vectorial (E0, hoy): devuelve `totalAdvanceMm` ⇒ la banda sería más ancha que el
  texto ⇒ el knockout se despegaría del grabado.
- El editor (`CurvedText.tsx:44,47,67`) usa el avance completo con la misma fórmula y una
  banda trazada con tapas redondas.

### 1.7 El trazador raster puede omitir texto en silencio

`src/export/textOutlines.ts` devuelve `null` en tres casos:

| Caso | Hoy | Problema |
|---|---|---|
| `!request.text` (`:57`) | `null` | Legítimo: no hay nada que dibujar |
| `cropWidth <= 0 \|\| cropHeight <= 0` (`:92`) | `null` | **Fallo de geometría** devuelto como "no hay texto" |
| `!ink` (`:146`) | `null` | **Fallo de trazado** devuelto como "no hay texto" |

Y `src/export/productionSvg.ts:142` hace `if (!trace) continue;` ⇒ **el texto desaparece del
SVG del cliente sin aviso** (por ejemplo si la webfont no carga y no hay tinta).

Además, el trazador raster **no valida el catálogo**: con una familia desconocida renderiza
con la tipografía del sistema (sustitución silenciosa). Hoy es inalcanzable desde el editor
(sólo ofrece el catálogo desde la Fase 3 de la Etapa 4), pero el contrato no lo impide.

### 1.8 La superficie de error ya existe y funciona

- `buildProductionSvg` **no** tiene `try/catch` (`productionSvg.ts:132-142`): un trazador que
  lanza ⇒ la promesa se rechaza ⇒ **no se escribe ningún archivo**.
- `ConfirmPanel.tsx:89-102` captura el error y muestra `reason.message` en un `role="alert"`
  (`:222`).
- La exportación es **atómica**: hoy ya es imposible una exportación incompleta.

---

## 2. Tolerancias experimentales

No son parte de un contrato: son los límites medidos de una estrategia concreta.

| Tolerancia | Valor | Origen | Justificación |
|---|---|---|---|
| Residuo del glifo frontera | desv. máx. **≤1,6 u**, ratio de tinta ≤1,01 | §1.4 | El navegador pinta el carácter frontera **a medias** y el motor lo pinta entero. Con 1 u ≈ 0,134 mm (virola 85/50), 1,6 u ≈ **0,21 mm**, en **un solo glifo** y sólo en el régimen de texto largo. Medido: 1,12 u (escala 1) y 1,50–1,58 u (escala 3). |
| Umbral de desviación media | ≤0,05 u | §1.4 | Coherente con el criterio del laboratorio (0,05 mm de media en el spike, 0,0163 u medido aquí). |
| Área de tinta | ±10 % | E1 | Control de que la referencia usa la misma fuente. |
| Avance | ±1 % | E1 | Control de que el motor compone como el navegador (ambos con HarfBuzz). |
| `inkBox` | ≤2 u | E1 | Caja analítica vs. tinta rasterizada. |

**La tolerancia del glifo frontera es experimental y debe quedar identificada como tal** en
la prueba que la use. No se relajan los umbrales existentes de E1 (0,3 u de media, 1,5 u de
máxima, 2 u de `inkBox`): la nueva tolerancia es un umbral **nuevo y más alto**, aplicado
sólo al caso de texto largo, y por debajo del límite físico de grabado (0,2 mm) salvo en el
peor caso medido (0,21 mm, un glifo).

---

## 3. Limitaciones pendientes

| # | Limitación | Estado |
|---|---|---|
| L1 | El residuo del glifo frontera (0,21 mm en un glifo). Un recorte exacto exigiría cortar el contorno del glifo contra el borde del path: coste alto para ese efecto. | **Aceptada** (decisión de E2), documentada |
| L2 | `halfSpan` está limitado a 135° en el editor **y** en el exportador: cuando el texto ocupa la vuelta completa, las líneas decorativas quedan sin interrumpir en 90° de la circunferencia. | **Preexistente**, compartido; se resuelve junto con la decisión de producto (§4) |
| L3 | El régimen "texto de más de una vuelta" es una experiencia pobre en el preview (el cliente ve el medio del texto y el resto desaparece sin explicación). | **Decisión de producto pendiente** (no bloquea E3.0) |
| L4 | La regla de recorte depende de la geometría de la vista previa (circunferencia cerrada + `startOffset 50 %`). Si el editor cambia el path, la regla debe cambiar con él. | **Riesgo de acoplamiento**: la regla debe derivarse de las mismas constantes que usa el preview |
| L5 | `TypographyGlyph.char` repite el texto del **cluster** en cada glifo del cluster: acumular longitudes por glifo **cuenta mal** los clusters de varios glifos. | **Trampa de implementación**: el motor debe exponer los límites de cluster |
| L6 | La equivalencia NFC está medida sólo para el conjunto español con las tres fuentes del catálogo. No está probada para todos los caracteres posibles. | **Acotada**: normalizar sólo en la entrada y conservar el error explícito si el resultado no se puede componer |
| L7 | La validación de catálogo en el trazador **raster** no existe (sustituye en silencio). Añadirla rompe 2 pruebas existentes con `fontFamily: 'Georgia'`, cuya migración está asignada a **E4**. | **Diferida a E4** (decisión de E2, ver §4) |
| L8 | El trazador **raster** sustituye la fuente del catálogo por una del sistema en **todos** los textos (su SVG cargado como `<img>` no puede pedir fuentes externas): la tinta exportada es de otra tipografía (§1.4 ter). | **Preexistente, medido**: lo arregla el camino vectorial; para el raster, la corrección cae en E4 (embeber la fuente ⇒ las 2 pruebas con `Georgia` hay que migrarlas). **Decisión del propietario (E3.0): opción A, transitoria** — el raster se conserva tal cual y el defecto queda documentado: **no se usa como fallback silencioso** y **no es equivalente al diseño** |
| L9 | El glifo frontera se pinta entero en el vector y a medias en el navegador: +0,5 % de tinta y ≤1,6 u (0,21 mm) en un solo glifo. | **Aceptada** (tolerancia experimental identificada) |

---

## 4. Decisiones de E2

1. **Política de errores** (base de E3.0):
   - `null` **sólo** para texto vacío o sin contenido dibujable legítimo (vacío / sólo espacios).
   - Cualquier otro fallo ⇒ `throw` con código explícito. Nunca una omisión silenciosa.
   - Familia fuera del catálogo ⇒ `FONT_NOT_IN_CATALOGUE`, sin sustitución.
   - Glifo ausente ⇒ `GLYPH_MISSING`. Motor no cargado ⇒ `SHAPER_UNAVAILABLE` / `FONT_UNAVAILABLE`.
   - **NFC**: se normaliza a NFC **en la entrada del adaptador** (§1.5 lo demuestra para el
     conjunto español). Si el resultado no se puede componer, error explícito (§L6).
   - VTracer queda como **reversión explícita**, nunca como reserva automática.
2. **Recorte de texto largo**: la ventana de visibilidad de §1.2 (criterio del **centro**
   del avance), implementada en el adaptador, con la regla derivada del radio real del
   recorrido.
3. **Knockout**: el adaptador debe informar `arcLength` = arco de la **tinta visible**, con la
   misma semántica que el trazador raster (§1.6), para que el archivo del cliente no cambie en
   ese aspecto.
4. **Validación de catálogo en el trazador raster**: **DECDIDA por el propietario (E3.0) —
   OPCIÓN A, transitoria**. El trazador raster se conserva **sin** cambios adicionales en su
   validación de catálogo. Añadirla (o embeber la fuente) rompe
   `tests/export-production-svg.spec.ts` ("real curved text traces to paths in the browser" y
   "real inverted text traces to different browser geometry"), que usan `fontFamily: 'Georgia'`;
   migrarlos pertenece a **E4**.

   **Esta decisión es transitoria y el defecto queda expresamente documentado**: el trazador
   raster **puede sustituir la fuente** (§1.4 ter) y, por tanto:
   - **no debe utilizarse como fallback silencioso** (si el camino vectorial falla, la
     exportación falla con su código: VTracer es reversión explícita, política #7);
   - **no es equivalente al diseño del editor**: su `arcLength` y su banda de knockout se
     miden sobre la tinta de otra tipografía y no son comparables con los del vectorial.

   La advertencia vive en el propio código (`src/export/textOutlines.ts`) y en este
   documento, para que nadie la lea como una propiedad aceptada del camino raster.
5. **Producto** (fuera del alcance técnico): qué hacer con el texto que no cabe en una vuelta.

---

## 5. Log

L1 Petición de E2 (verbatim): "Realizar primero una revisión técnica focalizada sobre: Cómo
recorta el navegador el texto curvo. Cómo maneja HarfBuzz el recorrido circular cuando el
avance excede el path. Cómo conseguir paridad sin eliminar texto visible ni incorporar texto
oculto. Qué ocurre con escala 0,3–3, inversión, rotación y textos largos. Cómo medir
correctamente el knockout de líneas decorativas. Cómo detectar errores antes de ofrecer la
descarga." + "Proponer una solución concreta, mínima y comprobable."

L2 Corrección al handoff de E0/E1: el handoff decía "El motor no recorta el texto largo y el
navegador sí". La medición precisa que el navegador **recorta al rango del path** y que
**conserva la centración**; la diferencia observable es la misma, pero la regla correcta es
distinta y ésa es la que hay que implementar.

L3 Medición de la equivalencia NFC (política aprobada #3: "únicamente si se demuestra
equivalencia visual"): demostrada para el conjunto español con las tres fuentes del catálogo
(§1.5).

L4 Diferida la validación de catálogo del trazador raster por romper 2 pruebas cuya
migración está asignada a E4 (§L7, decisión 4).
