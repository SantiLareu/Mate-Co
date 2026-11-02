# E5.1 — Muestras para validación física (grabador láser)

Conjunto pequeño y representativo de SVG generados con el **código real** del
producto (laboratorio físico en mm + exportador del cliente en unidades de
diseño), para comprobar compatibilidad con el flujo real de grabado. **No son
archivos aptos para producción**: son muestras. (E5.1b: el exportador físico
ya bloquea lo que no entra en la banda →
`odd/tasks/stage5-physical-validation-E5.1b.md`.)

## Carpetas (no son intercambiables)

- `fisico/fisico-<medida>-<diseño>.svg`: **milímetros** (`width="85mm"`,
  viewBox en mm) → el archivo que va al grabador.
- `cliente/cliente-<medida>-<diseño>.svg`: **unidades de diseño** (900×900) →
  referencia de lo que ve el cliente; no se graba.
- `muestras.json`: resumen por máquina. `generate.mjs`: generador
  reproducible (`node samples/e5-1/generate.mjs`). `analyze.mjs`: análisis
  read-only de la banda por medida y estrategia.

En el archivo físico: `lab-ring-reference` = círculos de referencia (azul, no
se graban) y `lab-engraving` = lo que se graba. En el del cliente:
`virola-reference` y `engraving-design`.

## Muestras (15 físicos = 3 medidas × 5 diseños)

| Medida | Diseño | Archivo | Lienzo | Contenido |
|---|---|---|---|---|
| 85/50 | A texto Poppins | `fisico-85-50-a-texto-poppins.svg` | 85 mm | 7 glifos + 2 líneas |
| 85/50 | B texto Dancing Script | `fisico-85-50-b-texto-dancing.svg` | 85 mm | 7 glifos + 2 líneas |
| 85/50 | C texto Lato invertido 180° | `fisico-85-50-c-texto-lato-invertido.svg` | 85 mm | 11 glifos + 2 líneas |
| 85/50 | D texto + ícono | `fisico-85-50-d-texto-y-icono.svg` | 85 mm | 7 glifos + ícono + 2 líneas |
| 85/50 | E diseño aprobado | `fisico-85-50-e-diseno-aprobado.svg` | 85 mm | 7 glifos + diseño anidado |
| 80/60 | A–E | `fisico-80-60-*.svg` | 80 mm | ídem, banda de 60 mm |
| 75/65 | A–E | `fisico-75-65-*.svg` | 75 mm | ídem, banda de 65 mm |
| 75/65 | D texto + ícono | `fisico-75-65-d-texto-y-icono.svg` | 75 mm | holgura publicada: −1,08 mm (borde interior) |
| 75/65 | E diseño aprobado | `fisico-75-65-e-diseno-aprobado.svg` | **77,1 mm** | holgura ±1,05 mm; lienzo MAYOR que la pieza |

Los 12 archivos de `cliente/` son **idénticos entre medidas** (el cliente no
depende de la medida): sirven los 4 diseños A–D. E no tiene archivo de cliente
porque el cliente bloquea exportar con diseños aprobados.

## Verificaciones (automáticas, al generar)

- Sin `<text>`, sin `<image>`/`data:image`, sin `@font-face`.
- `width`/`height` en mm = `viewBox`; grupos `lab-ring-reference` y
  `lab-engraving` presentes; el texto va como `<path>` de glifo (7/7/11).
- Escala = `data-size-factor` (0,1005 en 85/50; 0,0887 en 75/65).
- **Determinismo:** dos ejecuciones dan los 27 SVG y `muestras.json` idénticos.
- El diseño aprobado entra como `<svg>` anidado con su `viewBox` (sin raster ni
  filtros).

## Qué debe comprobar el operador

1. **Unidades:** que el software lea el `viewBox` en mm (no px ni 1/1000").
2. **Referencias:** que los círculos azules coincidan con la virola y **no se
   graben**.
3. **Escala y pieza:** que el diámetro exterior real sea 85/80/75 y que el
   software **no reescale**. Ojo en 75/65 + aprobado: el lienzo mide 77,1 mm
   (la envolvente conservadora del arte toca ±1,05 mm fuera de la banda) → si
   el software encaja el dibujo a la pieza, saldría un 2,8 % más pequeño; la
   silueta real puede entrar: hay que mirarlo en el software.
4. **Contornos:** letras como contornos cerrados (sin fuente), sin texto ni
   imágenes, con el grosor de línea esperado.
5. **Holguras:** que texto e ícono no invadan la abertura ni el borde
   exterior; el laboratorio no mide la tinta real (no inventa dimensiones).
6. **Invertido/rotado:** que el texto C salga con la orientación esperada.
7. **Líneas decorativas:** que el knockout se respete y el relleno sea
   `evenodd`.

## Limitaciones

- Son **muestras**, no archivos de producción (aptitud = E5).
- La **imagen subida/vectorizada del cliente no entra** en el archivo físico
  (`GRAPHICS_NOT_EXPORTED`); plan técnico en
  `odd/tasks/stage5-physical-validation-E5.1b.md`.
- Las medidas salen del texto medido en el navegador
  (`getComputedTextLength`); la tinta no se mide.
- Diseño aprobado: fixture autorizado `tests/fixtures/MESSI-SILHOUETTE.svg`,
  importado por el camino del administrador (sanitizado → catálogo).
- No se ejecutó ninguna prueba física ni se envió nada al grabador.
