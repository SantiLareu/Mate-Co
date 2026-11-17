# E5.3 — Comparación antes/después de las líneas decorativas (trazos → superficies rellenas)

Conjunto de **6 SVG** (3 pares) generados con el **código real** del producto
(laboratorio físico en milímetros + exportador del cliente) para comprobar, en
forma vectorial, el único cambio de la serialización de las líneas
decorativas: antes se pintaban como **trazos** (`<circle>` / `<path>` con
`stroke-width`) y ahora se pintan como **superficies cerradas rellenas**
(anillo completo o banda cerrada con extremos rectos, `fill="#000000"`,
`fill-rule="evenodd"`, **sin `stroke-width`**).

**Estrategia de tamaño: `outer-diameter` — la MISMA que `samples/e5-1/generate.mjs`.**
Estas muestras son **directamente comparables** con las que ya se enviaron al
grabador: mismo `data-size-factor`, mismos radios de línea y **mismo ancho de
banda** que los archivos de E5.1 (ver "Comparabilidad con samples/e5-1").

**No son archivos aptos para producción**: son muestras. Este conjunto **no
reemplaza a `samples/e5-1`** (ver "Limitaciones").

## Carpetas y archivos

- `fisico/antes-<medida>.svg`: serialización vieja (la de git HEAD `818cfbd`:
  líneas decorativas trazadas).
- `fisico/despues-<medida>.svg`: serialización nueva (líneas decorativas como
  superficies cerradas rellenas).
- `fisico/index.txt`: índice con el largo en bytes y el sha256 (16 hex) de
  cada archivo.
- `metricas.json`: las medidas que se leen de los dos archivos de cada par
  (radios, extensión angular, largo de arco, áreas) — es la base numérica de
  `comparacion.md` — más el control de comparabilidad con E5.1.
- `generate.mjs`: generador reproducible (`node samples/e5-2/generate.mjs`).
- `comparacion.md`: informe de equivalencia cuantitativa antes/después.

Todos los archivos están en **milímetros reales** (`width="85mm"`,
`viewBox="0 0 85 85"`): 1 unidad de usuario = 1 mm. Excepción: el par de
**75/65** mide **76,02 × 76,02 mm** (ver "El lienzo de 75/65").

## Qué hay adentro (y qué NO)

Cada archivo tiene sólo dos grupos, igual que en E5.1:

- `lab-ring-reference`: los **dos círculos azules** (`fill="none"`,
  `stroke="#0000FF"`, `stroke-width="1.5"`) con el radio exterior y el
  interior de la virola. Son **referencias de medición**: un grupo hermano,
  **fuera** de `lab-engraving`, y **no se graban**. Sirven para encajar el
  archivo sobre la pieza.
- `lab-engraving`: lo que se graba — las dos líneas decorativas y el ícono de
  guitarra.

Contenido por medida (85/50, 80/60, 75/65), igual en el par antes/después:

| Medida | Líneas decorativas | Ícono | Ancho de banda `w` | `data-size-factor` |
|---|---|---|---|---|
| 85/50 | 2 (interrumpidas) | guitarra (ángulo 90°, radio 360) | **0,200946 mm** | 0,10047281 |
| 80/60 | 2 (interrumpidas) | ídem | **0,189125 mm** | 0,09456265 |
| 75/65 | 2 (interrumpidas) | ídem | **0,177305 mm** | 0,08865248 |

El ícono está a propósito: su disco de *knockout* abre el hueco de las dos
líneas, que es justo el caso donde la geometría se puede medir.

## Comparabilidad con samples/e5-1

`generate.mjs` **comprueba** (y falla si no se cumple) que estas muestras y
las de E5.1 usan la misma estrategia y las mismas magnitudes:

| Medida | Archivo de E5.1 | Estrategia | `data-size-factor` (E5.1 = E5.2) | Ancho de banda | Radios de línea |
|---|---|---|---|---|---|
| 85/50 | `fisico-85-50-d-texto-y-icono.svg` | outer-diameter | 0,10047281 | 0,200946 mm | 32,35 / 35,02 mm |
| 80/60 | `fisico-80-60-d-texto-y-icono.svg` | outer-diameter | 0,09456265 | 0,189125 mm | 34,20 / 35,73 mm |
| 75/65 | `fisico-75-65-d-texto-y-icono.svg` | outer-diameter | 0,08865248 | 0,177305 mm | 34,60 / 35,36 mm |

(En E5.1 esos radios se leen redondeados a 0,01 mm porque el exportador viejo
redondeaba las coordenadas; el valor exacto del motor es 32,347328 / 35,019084
· 34,198473 / 35,725191 · 34,599237 / 35,362595 mm.)

**Consecuencia para el grabador:** el `despues-<medida>.svg` se puede poner al
lado del archivo de E5.1 de la misma medida y las dos líneas decorativas
coinciden en **posición, radio y grosor**: el ancho de banda de E5.2 es
exactamente el `stroke-width` de E5.1 (0,200946 / 0,189125 / 0,177305 mm).
El grabador puede superponer ambos archivos y medir la misma banda.

Lo que **no** coincide (y es esperable):

- E5.2 es un set **enfocado en líneas**: sin texto y sin diseño aprobado (no
  hay navegador; ver "Limitaciones"). E5.1 sí tiene texto y, en el diseño D,
  una línea interrumpida además por el *knockout* del texto.
- Por eso los **huecos angulares** no son los mismos que en E5.1: en E5.2 la
  única interrupción es el disco del ícono, que está a radio 360; en E5.1 el
  diseño D usa el ícono a radio 340 **y** además el corte del texto.
- El **lienzo** de 75/65 es 76,02 mm (ver abajo), no 75 mm como en E5.1.

### La única diferencia entre `antes` y `despues`

Es la serialización de las dos líneas decorativas:

- **antes**: `<path d="M32.16 3.46 A32.35 32.35 0 1 1 32.16 -3.46"
  fill="none" stroke="#000000" stroke-width="0.20094562647754138" …/>`
  (trazo de ancho constante, extremos rectos por defecto).
- **después**: `<path d="M32.26210511483649 3.4664631870569096 A32.44780105751358
  32.44780105751358 0 1 1 32.26210511483649 -3.4664631870568927 L32.06230948269814
  -3.444995765719162 A32.24685543103603 32.24685543103603 0 1 0 32.06230948269814
  3.4449957657191788 Z" fill="#000000" fill-rule="evenodd" …/>` (banda cerrada
  entre el arco exterior R+w/2 y el interior R−w/2, cerrada por segmentos
  radiales = extremos rectos).

Todo lo demás —el lienzo, los círculos de referencia, la posición del ícono,
su knockout— es **byte a byte igual** en los dos archivos del par.
`comparacion.md` lo demuestra numéricamente.

### Lo que las líneas ya NO dependen

En `despues` **no queda ningún `stroke-width` en las líneas decorativas**: el
grabado depende de superficies rellenas, no del grosor de trazo del software.
Los únicos `stroke-width` que quedan en el archivo son los de la referencia
azul (1,5 mm) y el del **ícono** (1,7 mm, `stroke="#171717"`): el ícono es
un contorno del producto y no forma parte de este cambio.

## El lienzo de 75/65 (76,02 mm, no 75 mm)

Con `outer-diameter` el ícono de guitarra se dibuja **más grande** que con
`band-thickness` (su escala es el `data-size-factor`: 0,08865 en vez de
0,03817), y para 75/65 su envolvente conservadora **cruza el borde exterior**
(holgura firmada **−0,51 mm**) y el borde interior (**−0,32 mm**). El
laboratorio no recorta ni reescala: **agranda el lienzo a 76,02 × 76,02 mm**
para que nada quede cortado, y publica las holguras en `meta` /
`metricas.json` (`clearanceWarnings`).

Es el mismo fenómeno que el archivo de 75/65 con diseño aprobado de E5.1
(77,1 mm). **Colocar por posición, sin reescalar**: si el software encaja el
dibujo a la pieza de 75 mm, el grabado sale más pequeño.

## Limitaciones (importantes)

- Son **muestras**, no archivos de producción (aptitud = E5).
- **No tienen texto**: las medidas de los glifos salen del navegador
  (`getComputedTextLength`) y el exportador bloquea la exportación si hay texto
  sin contornos (`FONT_OUTLINES_UNAVAILABLE`). Por eso este conjunto es
  **enfocado en líneas** a propósito.
- **No tienen diseño aprobado**: el activo aprobado llega como `<svg>`
  anidado con *namespacing* de DOM (E2), que también necesita el navegador.
- Por lo anterior, este conjunto **NO reemplaza a `samples/e5-1`**: E5.1 sigue
  siendo el juego de muestras con texto y diseño aprobado. Lo que se comparte
  con E5.1 es la **estrategia de tamaño** (`outer-diameter`) y, por lo tanto,
  el `data-size-factor`, el ancho de banda y los radios de línea.
- No se ejecutó ninguna prueba física ni se envió nada al grabador.

## Checklist para el grabador (por cada par antes/después)

1. **Abrir `despues-<medida>.svg` en una herramienta vectorial** (Illustrator,
   Inkscape, Affinity…) y comprobar que abre **sin aviso de error**: los
   `<path>` de las líneas son trazados cerrados y rellenos.
2. **Unidades**: que el `viewBox` se lea en **milímetros** (85 × 85,
   80 × 80, **76,02 × 76,02** mm) y que el software **no reescale** el dibujo a
   la pieza. No activar "ajustar al medio" ni "escalar al material". Los
   círculos azules marcan el tamaño real de la virola (Ø 85/80/75).
3. **Las dos líneas son superficies rellenas**: al seleccionarlas tienen que
   aparecer como **áreas rellenas** (relleno negro, `evenodd`), **no** como
   líneas con grosor de trazo. Medir la banda con la herramienta de ancho:
   0,200946 mm (85/50), 0,189125 mm (80/60), 0,177305 mm (75/65).
4. **El hueco (knockout) detrás del ícono**: tiene que estar ahí, con los
   mismos extremos rectos que en `antes-<medida>.svg` (12,27° / 12,75° para
   85/50; 11,85° / 11,91° para 80/60; 11,36° / 11,32° para 75/65). Superponer
   `antes` y `despues` y comprobar que el hueco cae en el mismo lugar.
5. **Las referencias azules** (`lab-ring-reference`, `#0000FF`, 1,5 mm) tienen
   que seguir **separadas** del grupo de grabado: **no se graban**. Si el
   software no distingue colores, borrar ese grupo antes de generar la
   trayectoria.
6. **El ícono** (guitarra) se dibuja como contorno trazado (1,7 mm): es el
   comportamiento del producto, no de las líneas decorativas.
7. **Ni texto ni imágenes**: el archivo no tiene `<text>`, `<image>`,
   `data:image` ni fuentes. Si el software muestra glifos o imágenes, está
   interpretando otra cosa.

## Reproducibilidad

```
node samples/e5-2/generate.mjs
```

El generador compila dos veces el TypeScript real con el compilador del repo
(`node_modules/typescript`) en `test-results/e53-compare/e52-scratch/`: una
con el `src/` actual y otra con una copia de `src/` cuyo
`src/production-lab/exportSvg.ts` es el de `git show 818cfbd:…`. Después arma
el reporte con `buildPhysicalReport` (estrategia **`outer-diameter`**,
`circularLines: "double"`, ícono "guitar") y exporta con
`buildLabPhysicalSvg`. **Sin navegador, sin rasterizar, sin instalar nada.**

**Determinismo**: dos ejecuciones producen los 6 SVG, `index.txt` y
`metricas.json` **idénticos byte a byte** (mismo sha256).
