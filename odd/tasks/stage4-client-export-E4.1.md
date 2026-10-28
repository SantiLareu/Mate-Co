# E4.1 — Autoajuste de textos al recorrido circular de la virola

Evita que un texto exceda el recorrido circular mediante un ajuste **automático,
previsible y visible** del tamaño efectivo. Prepara la migración a HarfBuzz
como exportador predeterminado (E4) sin habilitarla todavía.
Base: `stage4-client-export-E2.md` (reglas medidas), `stage4-client-export-E3.md`
(E3.0) y `stage4-client-export-E3.1.md` (integración opt-in, commit `172ab50`).

## Specs

S1 (decisión del propietario, textos largos): "ajustar automáticamente el tamaño del
texto para que entre completo en el recorrido circular."

S2 (decisión del propietario, tipografías antiguas): "rechazar las familias fuera del
catálogo y solicitar al usuario elegir una de las tres aprobadas. Nunca sustituirlas
silenciosamente." — **esta tarea implementa únicamente la primera decisión.**

S3: "El texto completo debe visualizarse en el editor y coincidir con lo que
posteriormente se exportará."

S4: "No modificar todavía el exportador predeterminado."

S5 (regla geométrica): "El texto debe satisfacer: `avance <= 2 * PI * (radius - 14 *
escala)`. Usar las medidas reales del editor y del motor. No estimar el ancho contando
caracteres. Crear un helper puro compartido, por ejemplo
`src/typography/textFit.ts`, si encaja con la arquitectura."

S6 (política de autoajuste): "1. Si el texto cabe, no modificar absolutamente nada.
2. Si no cabe, reducir únicamente su tamaño efectivo hasta que entre completo.
3. Conservar el contenido exacto, la fuente, el radio, el ángulo, la inversión y la
posición. 4. No truncar caracteres ni introducir puntos suspensivos. 5. No aplicar
ajustes ocultos exclusivamente durante la exportación. 6. El tamaño visual efectivo
debe ser coherente con los controles que muestra el editor. 7. No producir saltos de
posición o de ángulo al seleccionar o arrastrar elementos. 8. No introducir bucles de
actualización de estado en React. 9. Aplicar una tolerancia conservadora y justificada
para evitar recortes por diferencias de medición entre navegador y HarfBuzz."

S7 (límite mínimo): "Antes de implementar, identificar el tamaño mínimo que admite
actualmente el editor. No reducir por debajo de ese mínimo sin autorización. Si el
texto no puede entrar ni siquiera con el tamaño mínimo permitido, mostrar un aviso
claro y bloquear su exportación con `TEXT_DOES_NOT_FIT`."

S8 (persistencia): "Definir explícitamente si el tamaño ajustado se persiste como
estado del diseño o se deriva de él. Preferir una única fuente de verdad y evitar
discrepancias entre la vista previa, los controles y la exportación."

S9 (protección de exportación): "Agregar una validación defensiva para que ningún
camino de exportación genere un archivo con texto parcialmente oculto. Esto debe
cubrir tanto el camino raster como el vectorial. Un diseño imposible de ajustar debe
producir `TEXT_DOES_NOT_FIT`, sin descargar un SVG incompleto. No realizar autoajustes
nuevos durante la exportación."

S10 (restricciones): "No cambiar el exportador predeterminado: sigue siendo raster. No
comenzar E4.2, E4.3 ni E4.4. No modificar el catálogo de tipografías. No migrar todavía
las fuentes heredadas. No instalar nuevas dependencias. No modificar main. No modificar
trabajos confirmados. No incluir `references/typography/`. No hacer commit, push ni merge
en esta tarea. No declarar que los SVG están validados para grabado real."

## Tasks

- [x] T1 (S5) — Helper puro `src/typography/textFit.ts`: la regla, el margen justificado
  y la **forma cerrada** del ajuste (sin iteración ⇒ sin realimentación ni oscilaciones).
- [x] T2 (S1, S3, S6) — Autoajuste en el editor (`CurvedText.tsx`): se mide el avance
  real, se calcula el encaje y se reduce **sólo** la escala, con la comparación
  tolerada que evita el bucle de estado.
- [x] T3 (S7, S9) — Protección de exportación en los **dos** caminos: `TEXT_DOES_NOT_FIT`
  en el trazador raster, en el trazador vectorial y en el pre-flight del camino vectorial.
- [x] T4 (S3, S8) — Coherencia: el tamaño efectivo se **persiste** en
  `TextElement.scale` (fuente única para la vista previa, los tiradores y los dos
  exportadores).
- [x] T5 (S10) — Pruebas: 15 escenarios (encaje, ajuste, escalas, radios, tipografías,
  inversión/rotación, contenido en vivo, tirador, límites, estabilidad, paridad con
  Chromium, móvil/arrastre, exportación por los dos caminos, bloqueo y no regresión).
- [x] T6 (S10) — Typecheck, build, focalizadas y regresión completa.

## Log

L1 Petición original (verbatim): "Mate&Co — E4.1: ajuste automático de textos al recorrido
de la virola" — "Evitar que un texto exceda el recorrido circular de la virola mediante un
ajuste automático, previsible y visible para el cliente." — objectives S1–S10.

L2 Partida verificada: rama `experiment/illustration-stencil`, HEAD `172ab50`, working tree
limpio salvo `references/typography/` sin seguimiento. La última regresión completa era
**586/586**.

L3 Decisión de diseño (persistencia): el tamaño ajustado **se persiste** en
`TextElement.scale`. Es la fuente única: la vista previa (`CurvedText`), los tiradores y
los dos exportadores leen el mismo valor ⇒ no puede haber discrepancias entre lo que se
ve, lo que se toca y lo que se graba. La alternativa (guardar la escala *pedida* y
derivar la efectiva) obligaría al exportador a derivar el encaje ⇒ un ajuste oculto
durante la exportación (prohibido por S6.5) y un cambio en `productionSvg.ts`. **Consecuencia
documentada**: al acortar el texto, el tamaño no vuelve a crecer solo (hay que ampliarlo
con el tirador).

L4 El mínimo del editor es **0,3** (`TEXT_SCALE.min`) y el máximo **3**: el autoajuste
nunca sale de ese rango (S7). Si el texto no entra ni a 0,3, el editor deja el texto a
0,3 y la exportación se bloquea con `TEXT_DOES_NOT_FIT` (S9).

L5 La forma cerrada del ajuste: el avance es lineal con la escala (la fuente y el
`letter-spacing` escalan juntos y la medida del navegador no tiene *hinting*), así que
`avance(escala) = A0 · escala` y la regla se despeja en una sola operación:

    escala  <=  f · 2π · radio / (A0 + f · 28π)

con `f = 0,99` (margen del 1 %, justificado por la diferencia medida entre navegador y
HarfBuzz: 0,06 %–0,09 %). Sin iteración ⇒ sin realimentación ⇒ sin oscilaciones; y el
cálculo es una función pura de las medidas ⇒ el mismo conjunto da siempre el mismo
resultado.

L6 La medición se hace con `getComputedTextLength()` del DOM real (`CurvedText.tsx`), que
es el avance exacto de la fuente del catálogo con su `letter-spacing`; **no** se estima
contando caracteres (S5). Tras cargar las fuentes (`document.fonts.ready`) se vuelve a
medir: hasta entonces la medición sería de la tipografía de reserva.

L7 La protección de exportación (S9) se aplica en la **frontera**: el trazador raster
(`traceTextElement`), el trazador vectorial (`traceVectorText`) y el pre-flight del camino
vectorial. `composeVectorText` **no** la aplica a propósito: así la geometría del recorte
sigue siendo verificable por debajo de la frontera (la evidencia de E3.0 sigue viva) y el
bloqueo ocurre exactamente donde se genera el archivo.

L8 Efecto colateral asumido: con el bloqueo, el **glifo de frontera** (el residuo de
0,21 mm de E2) queda fuera del alcance de la exportación — el caso recortado ya no llega
al archivo. La geometría se conserva como defensa en profundidad.

L9 Valores medidos del ajuste (editor real, Poppins/Lato/Dancing, 80 caracteres = el
máximo que admite el input). Se pide ×2 con el tirador y el ajuste deja la escala en el
máximo que entra:

| caso | avance por escala (`A0`) | escala efectiva | avance resultante | recorrido |
|---|---|---|---|---|
| 80 car. Poppins, radio 374 | 1 901,9 u | **1,1696** | 2 224,6 u | 2 224,6 u |
| 80 car. Lato, radio 374 | 1 726,3 u | **1,2829** | 2 214,7 u | 2 214,7 u |
| 80 car. Dancing Script, radio 374 | 1 422,4 u | **1,5412** | 2 192,2 u | 2 192,2 u |
| 80 car. Poppins, radio 305 | 1 901,9 u | **0,9539** | 1 814,1 u | 1 814,1 u |
| texto corto (7 car.) | 180,9 u | 2,0000 (no ajusta: entra) | 361,7 u | 2 174,0 u |

El ajuste es exacto por construcción: el avance resultante queda en el 100 % del recorrido
disponible (con el margen del 1 %). El radio 305 es el caso que hace falta para que un
texto de 80 caracteres no entre a escala 1.

L10 Verificación: typecheck **OK**; build **OK** (bundle inicial 360,45 kB, +1 kB por el
helper del encaje); spec nuevo de E4.1 **13/13**; focalizadas (E4.1 + los 5 specs
vectoriales + `export-production-svg` + `direct-manipulation` + `confirm-design` +
`typography` ×2 + `jobs-snapshot` + `jobs-ui` + laboratorio ×2) **144/144** (3,1 min);
regresión completa **599/599**.

L11 Observación metodológica (importante): `getComputedTextLength()` mide el avance
**real** del texto con la fuente del catálogo y su `letter-spacing` (medido: coincide con
la medida en canvas dentro del 0,05 %), pero **sólo si la fuente ya está cargada**: antes
de eso mide la tipografía de reserva (1 901,9 u frente a 2 856,8 u para el mismo texto).
Por eso el efecto vuelve a medir cuando `document.fonts.ready` se resuelve: si no, el
ajuste se calcularía sobre la fuente equivocada. También se comprobó que el editor limita
el texto a **80 caracteres** (`DesignPanel.tsx`, `maxLength`): a escala 1 y radio 374 el
texto de 80 caracteres entra justo (1 901,9 u sobre 2 261,9 u), y es el radio 305 o una
escala mayor lo que hace que no entre.

L12 Corrección posterior (revisión UX, E4.1 cierre):

**(a) Aviso en el editor cuando el texto no entra ni con la escala mínima.** El
ajuste se detenía en 0,3 y el error sólo aparecía al exportar. Ahora el editor lo
avisa: el efecto que calcula el ajuste marca `TextElement.textFitBlocked` cuando
`fitTextToPath` devuelve `doesNotFit`, y el panel de texto muestra un aviso
discreto y accionable ("No entra en la virola: acortalo el texto."). El aviso
**no toca el diseño** (no se trunca el contenido, no se baja de 0,3, no se
introduce un segundo estado de escala: la bandera es un aviso transitorio y no
se persiste — el snapshot copia sólo los campos del diseño). La plaza del aviso
tiene **altura fija** (reservada siempre): en móvil el panel va encima del
lienzo y cualquier crecimiento lo desplazaría, con lo que los controles táctiles
cambiarían de sitio. Verificado: la caja del lienzo en coordenadas de página no
cambia.

**(b) Tipografías que no cargan.** Con la fuente de reserva, la medición del DOM
miente (1 901,9 u en vez de 2 856,8 u para el mismo texto) y el raster podría
exportar una letra que no era la elegida. Ahora:
  - `src/typography/fontAvailability.ts` (nuevo): `isFontAvailable(family)` usa
    `document.fonts.check`, la misma comprobación que ya usa
    `tests/typography-catalogue.spec.ts` (mecanismo reutilizado, sin sistema
    nuevo de fuentes ni dependencias).
  - el editor **no calcula el autoajuste** si la familia no está disponible: no
    se toca el diseño con una medida de la tipografía de reserva; se vuelve a
    medir cuando `document.fonts.ready` se resuelve.
  - el trazador raster ya no se traga el fallo de carga: `ensureFontLoaded`
    lanza `FONT_UNAVAILABLE` si la fuente no está disponible, de modo que **no
    se exporta silenciosamente otra tipografía**. El camino vectorial ya fallaba
    con `FONT_UNAVAILABLE`/`FONT_NOT_IN_CATALOGUE` ⇒ los dos caminos son
    explícitos.

Comprobado que el chequeo no rompe los 2 E2 que usan `Georgia`: en el navegador
de pruebas Georgia, Arial y Courier New están disponibles (son tipografías del
sistema) y `document.fonts.check` devuelve `true`; las tres del catálogo
devuelven `false` hasta que el navegador las pide (que es exactamente cuando
hay un texto que las usa).

L13 Recuperación tras una interrupción (la máquina se apagó durante la ejecución):
el árbol local estaba **íntegro** (HEAD seguía en `172ab50`, sin commit) y todo el
trabajo de E4.1 se conservó en disco. Se volvió a verificar **con evidencia nueva**
(sin dar por bueno el resultado anterior):

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | OK, 0 errores |
| `vite build` | OK (1,19 s) — bundle inicial 361,15 kB |
| Focalizadas (E4.1 + los 5 specs vectoriales + `export-production-svg` + `direct-manipulation` + `confirm-design` + `typography` ×2 + `jobs-snapshot`/`jobs-ui`/`jobs-repository` + laboratorio ×3) | **184/184** (3,7 min) |
| Regresión completa | **603/603** (8,1 min) |
| Exportador predeterminado | sigue siendo raster (`productionSvg.ts:134`, `DEFAULT_CLIENT_TEXT_EXPORT_MODE = "raster"`, `VECTOR_EXPORT_EXPERIMENTAL_ENABLED = false`) |
| Trabajos confirmados, snapshots, administrador y laboratorio | `git diff HEAD` **vacío** |

Nota: en una corrida anterior de la regresión completa falló un test del admin
(`admin-lab-svg-asset.spec.ts`, "MESSI fixture prologue…"): es **flaky** (pasa en
aislamiento y no toca nada de E4.1); las dos corridas completas posteriores dieron
603/603.
