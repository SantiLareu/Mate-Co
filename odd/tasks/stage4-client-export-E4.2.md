# E4.2 — Corrección de tipografías heredadas y fidelidad del exportador raster

Cierra el defecto de **sustitución silenciosa de tipografías** en el exportador raster del
cliente y hace que los dos caminos (raster y vectorial) respeten el catálogo real.
Base: `stage4-client-export-E2.md`, `stage4-client-export-E3.md`, `stage4-client-export-E3.1.md`
y `stage4-client-export-E4.1.md` (commit `2d8c5f6`).

## Specs

S1 (decisión del propietario): "Las fuentes antiguas que no pertenecen al catálogo actual
deben rechazarse con un mensaje accionable." Catálogo autorizado: **Poppins SemiBold**,
**Lato SemiBold**, **Dancing Script**. "No sustituir fuentes de manera automática ni silenciosa."

S2: "Hacer que el trazador raster utilice los archivos reales de las fuentes del catálogo."

S3: "Reutilizar los mecanismos existentes de carga de fuentes." "Evitar dependencias nuevas y
duplicación innecesaria de datos."

S4: "Rechazar explícitamente cualquier familia fuera del catálogo mediante
`FONT_NOT_IN_CATALOGUE`." "Mantener `FONT_UNAVAILABLE` para errores de carga de fuentes."

S5: "No utilizar una fuente del sistema como fallback silencioso." "Garantizar que ningún SVG
se descargue incompleto si falla el trazado." "Preservar textos normales, curvos, invertidos
y rotados." "Mantener el autoajuste implementado en E4.1." "No alterar el motor vectorial
salvo que exista un problema de compatibilidad comprobado."

S6 (compatibilidad): "Revisar los fixtures de pruebas que todavía utilizan fuentes antiguas.
Distinguir: fixtures del exportador del cliente que deben migrarse al catálogo; fixtures de
compatibilidad histórica que deben mantenerse para verificar la lectura de datos antiguos. No
modificar datos reales de IndexedDB ni realizar migraciones automáticas. Ante un diseño
antiguo con una fuente fuera del catálogo, mostrar un error claro indicando que debe
seleccionar una tipografía disponible. No modificar snapshots ni trabajos ya confirmados."

S7 (restricciones): "No cambiar el exportador predeterminado. No comenzar E4.3, E4.4 ni E5. No
modificar main. No modificar trabajos confirmados ni snapshots persistidos. No instalar nuevas
dependencias. No incluir `references/typography/`. No hacer commit, push ni merge todavía. No
declarar los SVG aptos para grabado real."

## Tasks

- [x] T1 (S1, S2, S3, S4) — El trazador raster **embebe la fuente real**: la fuente del
  catálogo entra en su SVG como data URI (`<style>@font-face`), que es la única forma de que un
  SVG cargado como `<img>` use la letra buena. Se reutiliza el cargador del motor
  (`loadFontBytes`, ya cacheado) y se cachea la data URI por fuente.
- [x] T2 (S1, S4, S5) — El raster **rechaza** las familias fuera del catálogo
  (`FONT_NOT_IN_CATALOGUE`, con la lista de las disponibles en el mensaje) y mantiene
  `FONT_UNAVAILABLE` cuando el binario no se puede cargar.
- [x] T3 (S5) — El motor vectorial **no se toca**: ya validaba el catálogo y fallaba con
  `FONT_UNAVAILABLE`.
- [x] T4 (S6) — Fixtures: se migran al catálogo los **3** del exportador del cliente
  (`tests/export-production-svg.spec.ts`); se conservan **intactos** los de compatibilidad
  histórica (trabajos, snapshots, UI de trabajos, laboratorio, importador de assets) y los que
  **afirman** el rechazo (`export-vector-text-failures`, `export-vector-client-integration`).
- [x] T5 (S7) — Pruebas: paridad raster↔navegador con la misma fuente real, las tres
  tipografías, familia desconocida, fuente no disponible, sin fallback silencioso, texto
  normal/invertido/rotado, geometría y grupos del SVG conservados y autoajuste de E4.1 intacto.

## Log

L1 Petición original (verbatim): "Mate&Co — E4.2: corrección de tipografías heredadas y
fidelidad del exportador raster" — "Corregir la sustitución de fuentes del exportador raster y
asegurar que tanto el exportador clásico como el vectorial respeten el catálogo real. No
activar todavía el vectorial como predeterminado." — objectives S1–S7.

L2 Causa comprobada: el trazador raster arma un SVG con `<text font-family="Poppins
SemiBold">` y lo carga como `<img>`. Un SVG cargado como imagen **no puede pedir fuentes
externas**, así que el texto se dibujaba con la tipografía de reserva del sistema y el archivo
que se descargaba tenía **otra letra**. Medido en E2/E3.0: 15 580 px de tinta frente a los
32 867 px del navegador con la fuente real (mismo texto). Además el raster no validaba el
catálogo: una familia desconocida se sustituía en silencio.

L3 Solución: la fuente del catálogo va **embebida** en el SVG temporal del trazador como data
URI (`<style>@font-face{…src:url(data:font/ttf;base64,…) format("truetype")}</style>`), que es
el mecanismo que ya usan las pruebas de paridad contra el navegador. Los bytes se piden con
`loadFontBytes` (el cargador del motor, ya cacheado) y la data URI se cachea por fuente ⇒ sin
dependencias nuevas y sin duplicar los datos. El SVG **exportado** no cambia: sigue llevando
sólo geometría (sin `<text>`, sin `@font-face`, sin imágenes).

L4 Fixtures (Fase 3): sólo los del exportador del cliente se migran
(`tests/export-production-svg.spec.ts`, 3 referencias a `Georgia`). Se conservan, porque
verifican la lectura de datos antiguos, los de `jobs-snapshot`, `jobs-repository`, `jobs-ui`,
`production-lab-*` y `admin-lab-svg-asset`; y se conservan los que **afirman el rechazo**
(`export-vector-text-failures`, `export-vector-client-integration`). No hay migraciones de
datos: el snapshot guarda la familia tal cual (`snapshot.ts:307`) y el validador sólo exige
que sea un texto no vacío.

L5 Un diseño antiguo con una fuente fuera del catálogo no se puede exportar: el error es
`FONT_NOT_IN_CATALOGUE` y el mensaje **dice qué elegir** ("elegí una de las tipografías del
catálogo: Poppins SemiBold, Lato SemiBold, Dancing Script"). No hay sustitución ni migración
automática.

L6 Diferencias medidas entre el raster anterior y el corregido (misma fuente, misma
geometría; la referencia es el navegador con la fuente embebida):

| caso | tinta antes (raster) | tinta navegador | tinta ahora (raster) | desv. media | desv. máx. | sin pareja |
|---|---|---|---|---|---|---|
| Poppins normal | (otra letra) | 12 831 | 13 484 | 0,027 u | 0,71 u | **0** |
| Poppins invertido | (otra letra) | 12 847 | 13 391 | 0,025 u | 0,50 u | **0** |
| Poppins rotado 30° | (otra letra) | 12 832 | 13 476 | 0,027 u | 0,71 u | **0** |
| Lato normal | (otra letra) | 8 994 | 9 537 | 0,034 u | 0,50 u | **0** |
| Lato invertido | (otra letra) | 8 976 | 9 614 | 0,037 u | 1,00 u | **0** |
| Dancing Script | (otra letra) | 5 573 | 6 309 | 0,067 u | 1,00 u | **0** |

Antes de E4.2 el mismo texto daba 15 580 px de tinta (la letra del sistema) frente a los
32 867 px del navegador con la fuente real; ahora el raster coincide con el navegador **con 0
píxeles sin pareja** y una desviación media ≤0,07 u, que es el error propio del rasterizado
(umbral de luminancia) y del trazado de contornos (+5 % de área: el contorno trazado engorda
un poco el borde). La diferencia corresponde **a la corrección de la fuente**, no a un defecto
geométrico: la geometría del texto (path, `startOffset`, `dy`, escala, letter-spacing) no se
tocó.

L7 Verificación: typecheck **OK**; build **OK** (bundle inicial 361,99 kB, +0,8 kB por el
trazador); spec nuevo de E4.2 **5/5**; focalizadas (E4.2 + E4.1 + `export-production-svg` +
los 5 specs vectoriales + `direct-manipulation` + `confirm-design` + `typography` ×2 +
`jobs-*` ×3 + `admin-lab-svg-asset` + laboratorio ×3) **237/237** (3,5 min); regresión
completa **608/608** (6,9 min).

L8 El exportador por defecto **no cambia**: `productionSvg.ts:134` sigue usando
`traceTextElement` por defecto y `DEFAULT_CLIENT_TEXT_EXPORT_MODE = "raster"`. El vectorial
sigue siendo experimental y desactivado.

L9 Sin migraciones de datos: el snapshot guarda la familia tal cual (`snapshot.ts:307`) y el
validador sólo exige un texto no vacío, así que un trabajo antiguo con `Georgia` **se sigue
leyendo y pintando** (con la tipografía de reserva, como siempre) y lo que falla es **el
exporte**, con un mensaje que dice qué elegir. Los trabajos confirmados, los snapshots y el
almacenamiento quedan intactos (`git diff HEAD` vacío en `src/jobs`, `src/admin-lab`,
`src/production-lab`).

L10 Riesgo que queda anotado: el SVG temporal del trazador lleva la fuente embebida
(~210 kB en base64 para Poppins, ~890 kB para Lato) ⇒ la memoria y el trabajo de parseo del
navegador crecen por texto trazado. La data URI se cachea por fuente (se base64ifica una vez),
pero el SVG se arma una vez por texto. No afecta al archivo exportado (sólo geometría) y queda
medido para E5.

L11 Cierre tras la interrupción (la sesión se cortó durante la documentación final): el árbol
local estaba **íntegro** (HEAD en `2d8c5f6`, sin commit, sin stash, sin trabajo perdido) y el
trabajo de E4.2 se conservó en disco. Se volvió a verificar **con evidencia nueva** (sin dar
por bueno el resultado anterior) y **sin repetir la regresión completa**, porque el código y
las pruebas son idénticos a los que aprobaron 608/608:

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` | OK, 0 errores |
| `vite build` | OK (1,15 s) — bundle inicial 361,99 kB |
| Focalizadas (`export-raster-font` nuevo + `export-production-svg` migrado) | **27/27** (13,7 s) |
| Exportador predeterminado | sigue siendo raster (`productionSvg.ts:134`, `DEFAULT_CLIENT_TEXT_EXPORT_MODE = "raster"`) |
| E4.3 / E4.4 | sin rastro: no hay código, pruebas ni documentos de esas etapas |
| Trabajos confirmados, snapshots, administrador y laboratorio | `git diff HEAD` **vacío** en `src/jobs`, `src/admin-lab`, `src/production-lab` |
| Divergencia con `origin/experiment/illustration-stencil` | **0 / 0** (sin commits adelantados ni atrasados) |
| `references/typography/` | **fuera** del commit (referencia local, no versionada) |

Nota de entorno: `node_modules/` está instalado para Windows (`@rollup/rollup-win32-arm64-msvc`),
así que el servidor de Vite no arranca con el Node de Linux (WSL). Las pruebas se ejecutaron con
el Node de Windows ya presente (`/mnt/c/Program Files/nodejs/node.exe`), sin instalar nada.
