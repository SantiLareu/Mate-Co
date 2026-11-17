# E5.3 — Líneas decorativas grabables como contornos vectoriales cerrados

Rama `experiment/illustration-stencil` · base `818cfbd` · sin commits (la
entrega lo decide el dueño).

Motivo: el grabador probó los archivos generados y pidió **un único cambio
técnico**: que las líneas decorativas dobles dejen de ser *strokes* y pasen a
ser contornos vectoriales cerrados. Todo lo demás quedó confirmado por el
grabador (íconos bien posicionados; Stitch perfecto; Messi con detalles que
no se reproducen bien pero sin tocar el motor).

## Specs

- S1: "Corregir exclusivamente la representación de las líneas decorativas
  grabables en el exportador físico." — el cambio se limita al exportador
  físico (`src/production-lab/exportSvg.ts`); el exportador del cliente y el
  resto del motor quedan intactos.
- S2: "Convertir esos trazos en superficies vectoriales cerradas y rellenas,
  con geometría equivalente al espesor original."
- S3: "Preservar curvatura, posición, longitud, grosor y extremos."
- S4: "Asegurar que las líneas grabables no dependan de stroke-width."
- S5: "Conservar las referencias de virola separadas y no grabables."
- S6: "Mantener intactos los contornos HarfBuzz, íconos, imágenes aprobadas y
  transformaciones."
- S7: "No modificar los formatos ni las dimensiones físicas de los trabajos
  existentes."
- S8: "Agregar pruebas focalizadas para verificar geometría, contornos
  cerrados y ausencia de strokes en las líneas grabables."
- S9: "Generar una muestra nueva de comparación para verificar el resultado y
  facilitar una nueva prueba en PDF vectorial, sin rasterizar."
- S10: "No implementar un exportador PDF nuevo en esta etapa: documentar si la
  conversión externa actual sigue siendo necesaria."
- S11 (restricciones): "No refactorizar íconos ni SVG anidados. No cambiar las
  tipografías. No modificar snapshots ni trabajos confirmados. No tocar main.
  No hacer commit, push, merge ni despliegue. No instalar dependencias. No
  abrir Chrome ni automatizar navegadores. No expandir esta tarea a nuevas
  funcionalidades."

## Tasks

| ID | Specs | Ruta | Estado |
|---|---|---|---|
| T1 | S1, S8 | `src/production-lab/exportSvg.ts` + `tests/production-lab-export.spec.ts` | hecha (tests primero: RED → GREEN) |
| T2 | S9 | `samples/e5-2/**` | hecha (generador node, sin navegador) |
| T3 | S10, S5, S6 | `docs/production-lab.md` | hecha |
| T4 | S7, S11 | — | verificada: `git diff HEAD` acotado a los 3 archivos de arriba |

## Log

L1 Petición original (resumen fiel, textual): "Rama: experiment/illustration-stencil
… El único cambio técnico solicitado por el grabador es que las líneas
decorativas dobles se conviertan en contornos vectoriales cerrados y no
permanezcan como strokes." + la lista de 10 tareas y restricciones.

L2 Decisión de diseño (padre): la geometría del modelo NO cambia. El reporte
sigue modelando la línea como trazo circular (de ahí salen holguras y
knockouts); lo que cambia es la SERIALIZACIÓN del archivo: cada línea sale
como `<path>` relleno negro (`fill-rule="evenodd"`), sin `stroke` ni
`stroke-width`:
- anillo completo → corona (subpath exterior `R+w/2` + subpath interior
  `R−w/2`, el hueco por `evenodd`);
- arco interrumpido → banda cerrada entre el arco exterior (`R+w/2`) y el
  interior (`R−w/2`), cerrada con segmentos radiales = extremos a tope
  (butt), que es el final exacto del trazo original.
Los límites de knockout son los mismos que usaban los arcos
(`uncoveredArcs` a centro 0): la geometría no se movió.

L3 Verificación (RED → GREEN): los 4 tests nuevos `E5.3` + las aserciones
del test `E1 single line interrupted by one icon disk` (que fijaban el
trazo) se escribieron primero y fallaron con la serialización vieja
(`<circle … stroke-width="0.1526…"/>` sin superficies rellenas); después
pasaron. Prueba de mutación (reducir el grosor de banda a la mitad) hizo
fallar 3 tests: las aserciones no son vacías.

L4 Muestra nueva (S9): `samples/e5-2/` con 3 pares antes/después
(85/50, 80/60, 75/65) generados con el CÓDIGO REAL del producto, sin
navegador y sin rasterizar: el "antes" se compila desde `818cfbd` y el
"después" desde el árbol actual. La estrategia es `outer-diameter`, la
MISMA que `samples/e5-1`, así que los anchos de banda (0,200946 /
0,189125 / 0,177305 mm) y los `data-size-factor` coinciden con las muestras
ya enviadas al grabador: `despues-*.svg` se puede comparar directamente
contra `samples/e5-1`. Equivalencia cuantitativa en
`samples/e5-2/comparacion.md`: |Δ área relleno vs área trazo| ≤ 0,0095 %,
y el Δ por construcción es ≤ 2,1·10⁻¹² % (lo que se ve es el redondeo a
0,01 mm de la serialización vieja, que la nueva elimina). Dos corridas del
generador → bytes idénticos.

L5 Estado de la conversión a PDF (S10): NO existe exportador PDF en el
producto; el laboratorio y el exportador del cliente producen SVG vectorial
puro. La conversión a PDF vectorial sigue siendo EXTERNA y SIGUE SIENDO
NECESARIA (el grabador no acepta SVG); lo que cambió es que la geometría
que llega a esa conversión ya no depende de que el software interprete
`stroke-width`. Documentado en `docs/production-lab.md`.

L6 Nota de riesgo para el grabador: en 75/65 el ícono (escala
`data-size-factor` 0,08865) hace que su envolvente conservadora cruce ambos
bordes ⇒ el lienzo del archivo es 76,02 × 76,02 mm, no 75. El exportador no
recorta ni reescala: hay que colocarlo **por posición**, sin "ajustar a la
pieza" (mismo fenómeno que el archivo de diseño aprobado de e5-1, 77,1 mm).

L7 Pruebas (finales): `tsc --noEmit` OK (node Linux y node Windows).
Focalizadas del exportador físico: **7/7** (`E1 root`, `E1 single line`,
`E1 knockout converters` + los 4 `E5.3`) con el patrón node sin navegador.
Build de producción: **OK** (362,17 kB, 1,09 s).
Regresión completa: **626/626** (15,7 min) — ejecutada con el node de
Windows, que es el entorno donde el repo se puede correr: `node_modules` es
nativo de Windows (falta `@rollup/rollup-linux-arm64-gnu` y el binario de
Chromium 1208 en Linux), así que la suite completa se corrió sobre una
COPIA del árbol con los cambios aplicados en `C:\e53-verify` (fuera del
repo, sin commits). El `node_modules` original quedó intacto.
Comparación de la suite antes/después en Linux (patrón node, sin navegador):
200 passed / 405 failed antes y **204 passed / 405 failed** después, con el
MISMO conjunto de fallos (los 405 son `browserType.launch: Executable
doesn't exist`, un bloqueo ambiental previo y ajeno al cambio). Los 4 tests
extra son los nuevos `E5.3`.
