# E3.0 — Corrección geométrica y preparación segura del motor vectorial

Etapa E3.0 de la integración del motor vectorial en el exportador del cliente. Prepara el
adaptador (sin conectarlo) y cierra los fallos silenciosos del trazador raster. E3.1 (conectar
el camino opt-in) y E4 (migrar el default) **no** empiezan aquí.

Base: `stage4-client-export-E2.md` (reglas medidas) y `stage4-client-export-handoff.md` (E0/E1,
commit `78933ef`).

## Specs

S1: "Implementar exclusivamente E3.0: compatibilidad geométrica, normalización Unicode
controlada y manejo seguro de errores, sin habilitar todavía la exportación vectorial en el
producto."

S2: "Documentar primero las conclusiones verificadas de E2 en
`odd/tasks/stage4-client-export-E2.md`, diferenciando observaciones, tolerancias
experimentales y limitaciones pendientes."

S3: "Extender aditivamente los datos geométricos del motor `src/typography/` para exponer los
límites de arco por cluster. No inferir posiciones sumando `TypographyGlyph.char`, porque los
clusters pueden producir varios glifos."

S4: "Aplicar en el adaptador la ventana de visibilidad medida en Chromium, derivada del radio
real del recorrido. Mantener la centración y las transformaciones existentes."

S5: "Calcular `arcLength` a partir de la extensión angular de la tinta visible, en lugar de
utilizar el avance total. Comparar este valor con la semántica del trazador raster actual."

S6: "Implementar normalización NFC exclusivamente en la entrada del adaptador. Conservar
errores explícitos cuando el resultado no pueda reproducirse fielmente. No generalizar la
equivalencia a todos los caracteres sin pruebas."

S7: "Revisar y corregir en `src/export/textOutlines.ts` los casos de fallo que hoy pueden
devolver `null` y ocasionar omisión silenciosa. Mantener `null` solamente para texto vacío o
sin contenido dibujable legítimo."

S8: "Conservar la validación del catálogo: una fuente desconocida no debe sustituirse
silenciosamente por una del sistema."

S9 (pruebas): "Paridad con Chromium real para textos largos. Escalas 0,3 / 1 / 3. Radios 305 /
374 / 410. Texto normal, invertido y rotado. Clusters de varios glifos y ligaduras. Comparación
de los límites del recorrido con el DOM real. Comparación de `arcLength` y banda de protección.
NFC y caracteres incompatibles. Ausencia de texto omitido silenciosamente. No regresión del
laboratorio. Typecheck y build."

S10: "No relajar los umbrales existentes. Cualquier tolerancia adicional para glifos de
frontera debe identificarse como experimental y justificarse con mediciones."

S11 (restricciones): "No modificar `src/export/productionSvg.ts`. No modificar
`src/components/ConfirmPanel.tsx`. No conectar el adaptador. No modificar snapshots, trabajos
confirmados ni administrador. No instalar nuevas dependencias. No modificar `main`. No incluir
`references/typography/`. No realizar commit, push ni merge. No comenzar E3.1 ni E4."

S12: "Si corregir la omisión silenciosa del trazador raster requiere cambiar un contrato
compartido fuera del alcance autorizado, detenerse y presentar la alternativa antes de
modificarlo."

## Tasks

- [x] T1 (S2) — Documentar E2: `odd/tasks/stage4-client-export-E2.md` con observaciones,
  tolerancias experimentales y limitaciones pendientes separadas. Sin commit.
- [x] T2 (S3) — Motor: exponer los límites de arco por **cluster** (`sStartMm`/`sEndMm`) y el
  rango de caracteres del cluster, de forma aditiva (`TypographyResult.clusters`). Ninguna
  posición inferida sumando `TypographyGlyph.char`. Ruta: src/typography.
- [x] T3 (S4, S5, S6) — Adaptador: ventana de visibilidad `-pi*R <= sStart <= pi*R` derivada
  de `pathRadius`; `arcLength` = extensión angular de la tinta visible; normalización NFC
  sólo en la entrada. Ruta: src/export.
- [x] T4 (S7) — Trazador raster: `null` sólo para texto vacío/sólo espacios; el resto de
  fallos, `throw` con código explícito. Ruta: src/export.
- [x] T5 (S8) — Catálogo: la validación `FONT_NOT_IN_CATALOGUE` se conserva en el adaptador.
  En el trazador raster: **decisión del propietario = opción A, transitoria** — se conserva
  tal cual (validar el catálogo o embeber la fuente rompe 2 pruebas cuya migración es E4) y
  el defecto queda **expresamente documentado** en el código y en el ODD: el raster **puede
  sustituir la fuente**, **no debe usarse como fallback silencioso** y **no es equivalente
  al diseño**. Ruta: src/export.
- [x] T6 (S9) — Pruebas nuevas: matriz de recorte (escala 0,3/1/3 × radio 305/374/410 ×
  normal/invertido/rotado), límites del recorrido contra el DOM real, clusters de varios
  glifos y ligaduras, `arcLength` y banda de protección, NFC y caracteres incompatibles,
  ausencia de omisión silenciosa. Ruta: tests.
- [x] T7 (S9, S10) — E1 revisada: la prueba de no-NFC pasa a verificar la normalización
  controlada; los umbrales de E1 no se relajan.
- [x] T8 (S9) — Typecheck (producto y spike), build, focalizadas, no regresión del laboratorio
  y regresión completa.

## Log

L1 Petición original (verbatim): "Mate&Co — E3.0: corrección geométrica y preparación segura
del motor vectorial" — "Implementar exclusivamente E3.0: compatibilidad geométrica,
normalización Unicode controlada y manejo seguro de errores, sin habilitar todavía la
exportación vectorial en el producto." — objectives S1–S12, restricciones S11.

L2 Partida verificada: rama `experiment/illustration-stencil`, HEAD `78933ef`, working tree con
sólo `references/typography/` sin seguimiento.

L3 T2 (motor): `TypographyResult` gana `clusters` (texto, rango de caracteres, límites de arco
y glifos). `layoutCurveItems` pasa a devolver el inicio de arco de cada item. Aditivo: los
consumidores actuales (`src/production-lab/typographyOutlines.ts`) no cambian.

L4 T3 (adaptador): ventana de visibilidad por **centro del avance** (`|sMid| <= pi*R`),
`arcLength` recalculado como extensión angular de la tinta visible, NFC en la entrada. El
adaptador **sigue sin conectar**. La regla del centro se midió contra el DOM real de Chromium
comparando tres criterios (inicio, final, centro): sólo el del centro reproduce la ventana
del navegador en los cinco escenarios medidos (119 y 239 caracteres, escala 3, radios 305 y
410); los otros dos se equivocan por un cluster en un extremo. Resultado tras el cambio:
**0 píxeles sin pareja** en los 12 escenarios de la matriz, desviación media <=0,043 u y
máxima <=1,58 u (el glifo frontera).

L5 T4 (trazador raster): `null` sólo para texto vacío/sólo espacios; crop inválido y "sin
tinta" pasan a `throw` con código. Se comprobó que ninguna prueba existente dependía de esos
`null`.

L6 T5 (catálogo): la validación del catálogo se conserva en el adaptador. Añadirla al trazador
raster rompe `tests/export-production-svg.spec.ts` ("real curved text traces to paths in the
browser" y "real inverted text traces to different browser geometry"), que usan
`fontFamily: 'Georgia'`; migrarlos es tarea de **E4**.

**L6 — DECISIÓN DEL PROPIETARIO (E3.0): OPCIÓN A, transitoria.** El trazador raster se
conserva **sin** cambios adicionales en su validación de catálogo. La decisión es
**transitoria** y el defecto queda **expresamente documentado** (en `src/export/textOutlines.ts`
y en `odd/tasks/stage4-client-export-E2.md` §1.4 ter y decisión 4): el trazador raster
**puede sustituir la fuente**, **no debe utilizarse como fallback silencioso** (VTracer es
reversión explícita: si el camino vectorial falla, la exportación falla con su código) y
**no es equivalente al diseño** (su `arcLength` y su banda de knockout se miden sobre la tinta
de otra tipografía). La corrección definitiva (embeber la fuente + migrar las 2 pruebas con
`Georgia`) queda para **E4**.

L6 bis Hallazgo colateral (preexistente, medido): el trazador raster **sustituye la fuente
del catálogo por una del sistema en todos los textos**, porque su SVG se carga como `<img>` y
un SVG-as-imagen no puede pedir fuentes externas. Tinta medida: 15 580 px frente a 32 867 px
del navegador con la fuente real (texto de 47 caracteres). Consecuencia: su `arcLength` y su
banda de knockout se miden sobre la tinta de otra tipografía y **no son comparables** con los
del adaptador vectorial. Corregirlo (embeber la fuente) tiene la misma dependencia de E4 que
L6: sin fuente que embeber, una familia fuera del catálogo no se puede rasterizar y las 2
pruebas con `Georgia` se rompen.

L7 T6/T7 (pruebas): specs nuevas + E1 revisada. La tolerancia del glifo frontera
(≤1,6 u, 0,21 mm) queda **marcada como experimental** y con su justificación medida; los
umbrales de E1 (0,3 u media, 1,5 u máxima, 2 u `inkBox`) no se relajan. La métrica de
`arcLength` cambia de "avance del texto" a "arco de la tinta visible": es un cambio de
semántica deliberado (S5) y su tolerancia (1 % con un suelo absoluto de 2 u, por la
cuantización de la máscara de referencia) es nueva, no relajada.

L8 T8 (verificación): typecheck del producto y del spike **OK**; build **OK** (1,30 s);
specs de E3.0 + E1 revisada **23/23**; focalizadas (E3.0, E1, `export-production-svg`,
`typography`, `typography-catalogue`, paridad y export del laboratorio, los 4 del spike)
**120/120** (2,3 min); regresión completa **573/573**.

L9 Límite detectado al escribir las pruebas: la guarda `INVALID_RADIUS` del adaptador es
**inalcanzable** (`clampTextRadius` recorta el radio a [305, 410] y `clampTextScale` a
[0,3, 3], así que el radio base siempre es positivo). Se deja como guarda defensiva y la
prueba lo documenta en vez de fingir un caso que no existe.
