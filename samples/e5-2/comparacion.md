# E5.3 — Equivalencia geométrica antes/después de la serialización de las líneas decorativas

Informe **cuantitativo** de que el cambio de serialización **no movió la
geometría**: las líneas decorativas del par `antes` (trazo con
`stroke-width`) y del par `despues` (superficie cerrada rellena) describen
**la misma región pintada**.

Todos los números de abajo se leen **de los dos archivos generados**
(`samples/e5-2/fisico/antes-*.svg` y `samples/e5-2/fisico/despues-*.svg`),
no de constantes del informe: los reproduce `samples/e5-2/generate.mjs`, que
deja el detalle en `samples/e5-2/metricas.json`.

**Estrategia de tamaño: `outer-diameter`** — la misma que
`samples/e5-1/generate.mjs` (ver §2). El comparador con E5.1 corre dentro del
generador y falla si dejan de coincidir la estrategia, el
`data-size-factor`, el ancho de banda o los radios de línea.

## 1. Qué se comparó y con qué fórmulas

Para cada una de las dos líneas decorativas de cada medida:

| Magnitud | Cómo se obtiene del archivo | Fórmula |
|---|---|---|
| Radio exterior de la banda | `A ro ro …` del `despues` | `R + w/2` |
| Radio interior de la banda | `A ri ri …` del `despues` | `R − w/2` |
| Radio de la línea media | (exterior + interior)/2 | `R` |
| Ancho de banda | exterior − interior | `w` (= `stroke-width` del `antes`) |
| Extensión angular del span | ángulos de los extremos del arco (`atan2`) | `ext` (grados) |
| Hueco (knockout) | 360 − ext | — |
| Largo del arco (línea media) | `R · ext_rad` | `L = R · ext·π/180` |
| **Área de la banda rellena** (`despues`) | sector anular | `A_relleno = ½·(R+w/2)² − (R−w/2)²) · ext_rad` |
| **Área del arco trazado** (`antes`) | largo × grosor | `A_trazo = L · w` |
| Diferencia relativa de área | — | `(A_relleno − A_trazo) / A_trazo` |

Las áreas son las de la **misma región**: el sector anular de la banda
cerrada es exactamente el conjunto barrido por el trazo de ancho `w` a lo
largo de la misma línea media (los extremos rectos cortan por el radio).

## 2. Estrategia y comparabilidad con samples/e5-1

Estas muestras usan **`outer-diameter`**, la **misma estrategia de tamaño**
que `samples/e5-1/generate.mjs` (la que se envió al grabador). Por eso los
`despues-*.svg` son **directamente comparables** con los archivos de E5.1:
mismo `data-size-factor`, mismos radios de línea y **mismo ancho de banda**
(el `stroke-width` de E5.1 es exactamente el `w` de la banda de E5.2).

| Medida | Archivo de E5.1 | Estrategia | `data-size-factor` | Ancho de banda `w` | Radios de línea (E5.1 / E5.2 exacto) |
|---|---|---|---|---|---|
| 85/50 | `fisico-85-50-d-texto-y-icono.svg` | outer-diameter | 0,10047281 | 0,200946 mm | 32,35 / 32,347328 · 35,02 / 35,019084 mm |
| 80/60 | `fisico-80-60-d-texto-y-icono.svg` | outer-diameter | 0,09456265 | 0,189125 mm | 34,20 / 34,198473 · 35,73 / 35,725191 mm |
| 75/65 | `fisico-75-65-d-texto-y-icono.svg` | outer-diameter | 0,08865248 | 0,177305 mm | 34,60 / 34,599237 · 35,36 / 35,362595 mm |

Los radios de E5.1 salen redondeados a 0,01 mm (el exportador viejo redondeaba
las coordenadas); el valor exacto es el de la columna derecha, y es el mismo
que usa esta muestra.

**Lo que sigue sin coincidir** (y es esperable): E5.2 es un set **enfocado en
líneas** (sin texto, sin diseño aprobado — no hay navegador), y su ícono está
a radio 360 mientras que el diseño D de E5.1 lo tiene a radio 340 **y** suma el
corte de la banda de texto. Por eso los **huecos angulares** difieren entre
E5.1 y E5.2: en 85/50, E5.2 deja los huecos de **12,27° y 12,75°** (sólo el
disco del ícono), mientras que en E5.1 el diseño D deja la línea `line-347`
en un solo tramo de 346,19° (un hueco de 13,82°) y la `line-367` partida en
dos tramos de 250,49° y 70,49° (dos huecos: el del ícono **y** el de la banda
de texto). La **banda** (mismo radio, mismo grosor, misma posición) es la
misma en ambos casos.

## 3. Radios de referencia (idénticos en los dos archivos)

| Medida | Lienzo | Círculos de referencia (`lab-ring-reference`) |
|---|---|---|
| 85/50 | 85 × 85 mm | r 42,5 / 25 mm (antes = después) |
| 80/60 | 80 × 80 mm | r 40 / 30 mm (antes = después) |
| 75/65 | **76,02 × 76,02 mm** | r 37,5 / 32,5 mm (antes = después) |

`data-size-factor`: 0,10047281 (85/50), 0,09456265 (80/60), 0,08865248
(75/65) — idéntico en `antes` y `despues`.

El lienzo de 75/65 mide 76,02 mm (y no 75) porque con `outer-diameter` el
ícono se dibuja más grande (su escala es el `data-size-factor`: 0,08865 en
vez de 0,03817) y su envolvente conservadora cruza el borde exterior
(holgura firmada −0,51 mm) y el interior (−0,32 mm). El laboratorio no recorta
ni reescala: agranda el lienzo y publica las holguras en
`metricas.json` (`clearanceWarnings`). Es el mismo caso que el archivo de
75/65 con diseño aprobado de E5.1 (77,1 mm).

## 4. Resultados por medida

### 85/50 mm (factor 0,10047281)

| | línea `line-347` | línea `line-367` |
|---|---|---|
| Radio exterior de la banda (`despues`) | 32,447801 mm | 35,119557 mm |
| Radio interior de la banda (`despues`) | 32,246855 mm | 34,918611 mm |
| Radio de línea media `despues` | 32,347328 mm | 35,019084 mm |
| Radio de línea media `antes` (leído del `A`) | 32,350000 mm | 35,020000 mm |
| Ancho `w` `despues` (exterior − interior) | 0,200946 mm | 0,200946 mm |
| Ancho `w` `antes` (`stroke-width`) | 0,200946 mm | 0,200946 mm |
| Extensión angular `despues` | 347,7345° | 347,2502° |
| Extensión angular `antes` | 347,7187° | 347,2437° |
| Hueco (knockout del ícono) `despues` | 12,2655° | 12,7498° |
| Largo del arco `despues` | 196,319584 mm | 212,238725 mm |
| Largo del arco `antes` | 196,326834 mm | 212,240332 mm |
| **Área de la banda rellena** | **39,449562 mm²** | **42,648443 mm²** |
| **Área del arco trazado** | **39,451019 mm²** | **42,648767 mm²** |
| Diferencia relativa de área | **−0,00369 %** | **−0,00076 %** |

### 80/60 mm (factor 0,09456265)

| | línea `line-347` | línea `line-367` |
|---|---|---|
| Radio exterior de la banda (`despues`) | 34,293036 mm | 35,819753 mm |
| Radio interior de la banda (`despues`) | 34,103911 mm | 35,630628 mm |
| Radio de línea media `despues` | 34,198473 mm | 35,725191 mm |
| Radio de línea media `antes` (leído del `A`) | 34,200000 mm | 35,730000 mm |
| Ancho `w` `despues` | 0,189125 mm | 0,189125 mm |
| Ancho `w` `antes` | 0,189125 mm | 0,189125 mm |
| Extensión angular `despues` | 348,1468° | 348,0918° |
| Extensión angular `antes` | 348,1521° | 348,0777° |
| Hueco (knockout del ícono) `despues` | 11,8532° | 11,9082° |
| Largo del arco `despues` | 207,800468 mm | 217,042974 mm |
| Largo del arco `antes` | 207,812891 mm | 217,063387 mm |
| **Área de la banda rellena** | **39,300325 mm²** | **41,048317 mm²** |
| **Área del arco trazado** | **39,302674 mm²** | **41,052177 mm²** |
| Diferencia relativa de área | **−0,00598 %** | **−0,00940 %** |

### 75/65 mm (factor 0,08865248)

| | línea `line-347` | línea `line-367` |
|---|---|---|
| Radio exterior de la banda (`despues`) | 34,687889 mm | 35,451248 mm |
| Radio interior de la banda (`despues`) | 34,510584 mm | 35,273943 mm |
| Radio de línea media `despues` | 34,599237 mm | 35,362595 mm |
| Radio de línea media `antes` (leído del `A`) | 34,600000 mm | 35,360000 mm |
| Ancho `w` `despues` | 0,177305 mm | 0,177305 mm |
| Ancho `w` `antes` | 0,177305 mm | 0,177305 mm |
| Extensión angular `despues` | 348,6387° | 348,6799° |
| Extensión angular `antes` | 348,6546° | 348,6723° |
| Hueco (knockout del ícono) `despues` | 11,3613° | 11,3201° |
| Largo del arco `despues` | 210,532634 mm | 215,203060 mm |
| Largo del arco `antes` | 210,546913 mm | 215,182573 mm |
| **Área de la banda rellena** | **37,328481 mm²** | **38,156571 mm²** |
| **Área del arco trazado** | **37,331013 mm²** | **38,152939 mm²** |
| Diferencia relativa de área | **−0,00678 %** | **+0,00952 %** |

## 5. Diferencia relativa de área: qué significa

- **Leída de los dos archivos**: entre **−0,0094 %** y **+0,0095 %** (|Δ| <
  0,01 %). No es cero, y la razón es conocida y verificable: la serialización
  **vieja** redondeaba las coordenadas a 0,01 mm (`round2` en
  `src/export/geometry.ts`, función `arcPath`), mientras que la nueva escribe
  el valor completo. Por eso el radio leído del `antes` aparece como 32,35 /
  35,02 / 34,20 / 35,73 / 34,60 / 35,36 mm (redondeo a 0,01 mm) en vez del
  valor exacto del motor. El desvío máximo de radio es **0,0048 mm (4,8 µm)**,
  y el de extensión angular **0,0160°**.
- **Por construcción** (con los valores **exactos** del motor, los mismos
  `R` y `w` de `report.lines`): `A_relleno` y `A_trazo` coinciden con
  diferencia relativa **≤ 4,3 · 10⁻¹² %** (ruido de punto flotante).
  Es decir: **el área pintada es la misma**; lo que queda de diferencia en los
  archivos es el redondeo del archivo viejo, que la versión nueva eliminó
  (además de eliminar la dependencia de `stroke-width`).

## 6. Qué se preserva (y por qué)

- **Posición y curvatura:** la banda se construye con los **mismos** arcos,
  con el mismo radio de línea media `R` y en el mismo marco local; el
  `transform="translate(half half)"` es idéntico al de la versión vieja
  (mismo centro del anillo en el lienzo: 42,5 / 40 / 38,01 mm).
- **Extremos (knockout):** los cortes son **radiales** (segmentos rectos que
  unen el arco exterior con el interior), o sea **extremos rectos** como los
  del trazo; el hueco detrás del ícono cae en el mismo lugar y con la misma
  apertura (12,27° / 12,75° · 11,85° / 11,91° · 11,36° / 11,32°) y los dos
  arcos de cada banda tienen **la misma extensión angular** (a 4 decimales:
  347,7345° = 347,7345°; 348,1468° = 348,1468°; 348,6387° = 348,6387°…),
  lo que confirma que el corte es radial.
- **Largo:** `L = R · ext` difiere entre los dos archivos en ≤ 0,021 mm
  (≤ 0,010 %), y esa diferencia es la del redondeo a 0,01 mm del archivo
  viejo.
- **Espesor:** `w` coincide con diferencia **≤ 7 · 10⁻¹⁵ mm** (idéntico bit a
  bit: es el mismo `strokeWidthMm` del motor).
- **Radio exterior / interior:** la banda se abre exactamente `w/2` a cada
  lado de la línea media (`R ± w/2`), que es la región barrida por el trazo
  centrado.

## 7. Determinismo

`node samples/e5-2/generate.mjs` se ejecutó **dos veces** seguidas: los 6 SVG,
`fisico/index.txt` y `metricas.json` salen **idénticos byte a byte** (mismo
sha256). La comprobación:

```
sha256sum samples/e5-2/fisico/*.svg samples/e5-2/fisico/index.txt samples/e5-2/metricas.json > /tmp/run1.txt
node samples/e5-2/generate.mjs
sha256sum samples/e5-2/fisico/*.svg samples/e5-2/fisico/index.txt samples/e5-2/metricas.json > /tmp/run2.txt
diff /tmp/run1.txt /tmp/run2.txt      # sin salida => idénticos
```

| Archivo | Bytes | sha256 (16) |
|---|---|---|
| `antes-85-50.svg` | 1024 | `8f1d58e543ba211a` |
| `despues-85-50.svg` | 1357 | `7504946f36bf8270` |
| `antes-80-60.svg` | 1004 | `2bf6af2216f9e62d` |
| `despues-80-60.svg` | 1343 | `1e75a4a8a98ee5bf` |
| `antes-75-65.svg` | 1045 | `d7dbdefb8b21ee2e` |
| `despues-75-65.svg` | 1381 | `0b2877d7ef235e7a` |

## 8. Verificaciones estáticas sobre los archivos

Sobre los **seis** archivos (antes y después):

- Sin `<text>`, sin `<image>`, sin `data:image`, sin `@font-face`, sin
  `font-family`, sin `<filter>`/`fe*`: **no hay texto, ni imágenes, ni
  rasterización en ninguna parte**.
- Grupos `lab-ring-reference` (hermano, **fuera**) y `lab-engraving`
  presentes; la referencia azul es `fill="none" stroke="#0000FF"
  stroke-width="1.5"` con los dos círculos y **no** está anidada en el grupo
  de grabado.
- `despues`: las dos líneas decorativas son `<path … fill="#000000"
  fill-rule="evenodd" transform="translate(…)"/>` **sin `stroke` ni
  `stroke-width`**; en el archivo no queda ningún `stroke="#000000"`. Los
  únicos `stroke-width` que quedan son el 1,5 de la referencia azul y el 1,7
  del **ícono** (`stroke="#171717"`), que es un contorno del producto y no
  forma parte de este cambio.
- `antes`: las dos líneas decorativas son `<path … fill="none"
  stroke="#000000" stroke-width="…"/>` — el trazo que la versión nueva
  reemplaza por la superficie rellena.

## 9. Qué cambió en esta etapa (y qué no)

- **Antes** (etapa previa) estas muestras se generaban con la estrategia
  `band-thickness`, con anchos de banda de 0,2672 / 0,1527 / 0,0763 mm: **no
  comparables** con los archivos de E5.1.
- **Ahora** se generan con **`outer-diameter`**, la **misma** estrategia que
  `samples/e5-1/generate.mjs`: anchos de banda 0,200946 / 0,189125 /
  0,177305 mm y `data-size-factor` 0,10047281 / 0,09456265 / 0,08865248,
  idénticos a los de E5.1.
- La **única diferencia introducida en esta etapa** entre `antes` y `despues`
  es la **serialización de las líneas decorativas**: trazos con `stroke-width`
  → superficies cerradas rellenas. Todo lo demás (lienzo, referencias, ícono,
  posición) es byte a byte igual dentro de cada par.
