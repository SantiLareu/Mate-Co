# Spike Etapa 4 — texto curvo a contornos SVG (Poppins + Lato)

Prototipo **aislado**: no lo importa el personalizador, el admin, los snapshots
ni el exportador productivo. `tsconfig.json` raíz solo incluye `src/`.

Dos fuentes: **Poppins SemiBold** (sin kerning) y **Lato SemiBold** (con kerning
GPOS real). La segunda fuente existe para probar el camino de kerning, que la
build oficial de Poppins no ejercita.

## Contenido

| Ruta | Rol |
|---|---|
| `curvedTextOutlines.ts` | Núcleo puro: layout de texto sobre arco + contornos de glifo → paths SVG en mm. |
| `gposKerning.ts` | Lector GPOS propio de pair kerning; **falla cerrado** ante lo no soportado. |
| `opentype.d.ts` | Tipos mínimos de opentype.js 2.0.0 (el paquete no trae tipos). |
| `harness.html` | Página en blanco para las comparaciones en navegador (no es la app). |
| `fonts/poppins/` | `Poppins-SemiBold.ttf`, `OFL.txt`, `METADATA.pb`, `PROVENANCE.md`. |
| `fonts/lato/` | `Lato-SemiBold.ttf`, `OFL.txt`, `METADATA.pb`, `FONTLOG.txt`, `upstream_info.md`, `PROVENANCE.md`. |
| `../../tests/spike-typography.spec.ts` | 19 tests (11 sin navegador, 8 con Chromium) — Poppins. |
| `../../tests/spike-typography-kerning.spec.ts` | 18 tests — Lato: kerning real contra Chromium. |
| `examples/` | Ejemplos SVG y métricas de revisión (ver `examples/README.md`). |

## Modelo geométrico (idéntico a `CurvedText` / `PhysicalComposition`)

- Ángulo 0 arriba, horario, y hacia abajo, centro (0,0) en mm.
- Texto centrado en el arco (`text-anchor: middle`, `startOffset: 50%`); el
  `letter-spacing` se suma tras cada glifo (incluido el último, como el navegador).
- Cada glifo es un cuerpo rígido: el punto medio de su avance cae sobre el
  círculo de línea base, rotado a la tangente allí.
- Invertido: progresión antihoraria, tope del glifo hacia el centro, `dy`
  (hacia afuera) en el eje local del glifo.
- Medidas físicas (estrategia B): `createPhysicalFrame(..., "band-thickness")` y
  `resolveText` del propio laboratorio (solo lectura) → `fontSizeMm`,
  `letterSpacingMm`, `baselineRadiusMm`, `invertedDyMm`.
- Salida: un `<path>` por glifo con coordenadas absolutas en mm (3 decimales =
  1 µm), curvas Q/C exactas, sin `<text>`, `<image>`, estilos ni referencias.

## Kerning real: por qué el spike trae su propio lector GPOS

`opentype.js` 2.0.0 **no parsea GPOS lookup type 9 (Extension Positioning)**:
`parseLookup9` devuelve `{ error: "GPOS Lookup 9 not supported" }` y
`getKerningValue` **devuelve 0 en silencio**. Lato guarda *todo* su kerning
dentro de lookups Extension, así que depender de opentype.js perdería el
kerning real sin ningún error.

`gposKerning.ts` parsea los bytes GPOS en crudo y cubre exactamente lo que el
spike necesita:

- lookup type 2 (PairPos) formatos 1 y 2, directo o envuelto en type 9;
- `valueFormat1` con `xAdvance` (los bits de device table se toleran e ignoran:
  solo afectan al hinted rendering, no a la geometría del contorno);
- `valueFormat2 == 0` (sin ajuste del segundo glifo);
- `lookupFlag` de solo ignore-bits y únicamente si la fuente **no** tiene GDEF.

Semántica alineada con HarfBuzz para glifos adyacentes de texto latino: script
`latn` (fallback `DFLT`), langsys `ESP ` si existe si no el default; lookups de
la feature `kern` en orden de `LookupList` y sus `xAdvance` acumulan; dentro de
un lookup decide el primer subtable cuya coverage contiene el glifo izquierdo.

**Falla cerrado**: cualquier otra construcción bajo la feature `kern` devuelve
`KERNING_UNSUPPORTED` con el motivo exacto (mark filtering, GDEF, tipos de
lookup no soportados, tabla `kern` heredada sin GPOS). Nunca se sustituye ni se
aproxima en silencio.

Verificado contra Chromium: 961 pares, 490 con kerning, error máximo 0.16
unidades de fuente (0.008 % em) y longitud de texto recto idéntica a
`avance + kern + letter-spacing`.

## Método de medición (corregido el 2026-10-24)

Dos correcciones de medición, ambas verificadas contra Chromium y aplicadas por
igual a los dos specs (`spike-typography.spec.ts` y
`spike-typography-kerning.spec.ts`):

1. **La referencia del navegador se encuadra en píxeles de dispositivo**
   (1 mm = 24 px). Encadrada en unidades de usuario en milímetros, Chromium
   compone el texto a un *em* de ~1,3 px (caso 75×65) y ajusta las rejillas de
   los glifos ahí, antes de magnificar con la CTM. Medido: contra el contorno,
   esa referencia solo llegaba a **IoU 0.77** (0.92 con el encuadre en píxeles)
   y su error de longitud total era hasta 9× mayor. Con el encuadre en píxeles
   el residual de posición por glifo bajó de **0.0986 mm a 0.0110 mm** (85×50)
   y de 0.0448 mm a 0.0046 mm (75×65): el layout del spike es exacto y lo que
   se medía era la cuantización del propio navegador.

2. **El criterio visual es una desviación física tinta-tinta (mm), no una razón
   de área de tinta.** La razón de área comparaba un raster de glifos *hint-eado*
   (el texto del navegador) contra un raster vectorial *sin hint* (el contorno):
   con los mismos contornos, a un *em* de 32 px las dos Areas difieren hasta un
   5 % (medido glifo a glifo: 'H' 0.00 %, 'O' 5.3 %, 'T' 39 % a 16 px), así que
   un umbral de 2 % de área **no podía cumplirse ni con un contorno perfecto**.
   La desviación mide geometría: 0.0007–0.0024 mm de media y ≤ 0.059 mm de
   máximo para contornos correctos; 0.10–0.30 mm de media y 0.57–0.94 mm de
   máximo cuando se descarta el kerning real (control de sensibilidad, que
   ahora forma parte del test).

El criterio de tolerancia del reporte (longitud ≤ 1 %, posición ≤ 0.2 mm,
rotación ≤ 0.5°, divergencia visual ≤ 0.2 mm) se mantiene sin cambios.

## Ejecutar

```
node node_modules/@playwright/test/cli.js test tests/spike-typography.spec.ts tests/spike-typography-kerning.spec.ts
```

En WSL el runner no arranca (Vite requiere el binario nativo de rollup de
Windows): ejecutar con el `node.exe` de Windows.

Los SVG de ejemplo y las métricas se escriben en `test-results/spike-typography/`
(ignorado por Git); copias de revisión en `examples/`.

## Límites conocidos

- **Sin GSUB**: el motor no implementa sustitución de glifos. Chromium sí
  aplica `liga`/`calt`, y hay fuentes donde eso cambia la forma del texto (ver
  "Cobertura de GSUB" abajo): el contorno exportado puede no coincidir con el
  preview del navegador.
- Sin shaping completo: sin ligaduras ni alternos contextuales (con
  `letter-spacing` ≠ 0 el navegador tampoco aplica ligaduras).
- Texto no NFC o con glifo ausente → error explícito (`TEXT_NOT_NFC`,
  `GLYPH_MISSING`); nunca se normaliza ni se sustituye en silencio.
- Solo se probaron 2 de las 5 tipografías candidatas (Lato, Playfair Display,
  Poppins, Merriweather, Dancing Script): no hay ninguna *serif display* ni
  *script* (Dancing Script cambia por completo las métricas).
- **Fuentes variables no soportadas**: el motor lee la instancia por defecto de
  un `fvar`; Chromium aplica el eje `wght` real. Playfair Display, Merriweather
  y Dancing Script se distribuyen hoy como fuentes variables.

## Cobertura de GSUB (medido contra Chromium, 2026-10-24)

Barrido de los 5625 pares de 2 caracteres sobre el alfabeto latino + dígitos +
acentos, comparando el avance del navegador con el del motor
(`avance(a) + avance(b) + kern(a,b)`):

| Fuente | Pares con desviación > 0,5 px | Desviación máxima | Causa |
|---|---|---|---|
| Poppins SemiBold | **0** | 0,000 px | — (paridad exacta) |
| Lato SemiBold | **12** (f/t: `ff fi fj fk fb fh ft tf ti tt fí`) | −3,741 px (3,7 % em) | GSUB `liga`/`calt` con lookups **tipo 7 (contextuales)**; el motor no hace GSUB |
| Dancing Script (variable) | **1** (`or`) | +4,013 px (4,0 % em) | GSUB contextual para `or` |

Los deltas no dependen del contexto circundante (medido con contexts `x X n A`),
y Lato no expone esas ligaduras en `getLigatures('liga')` de opentype.js porque
son **contextuales**, no sustituciones de ligadura directas.

**Impacto**: Lato con texto español que contenga `ti` o `fi` (p. ej. "tienda",
"fiesta") produce en el navegador un glifo distinto al que exporta el motor:
no es un desplazamiento, es una **forma** distinta. Lato y Poppins siguen
siendo seguros solo para textos sin esas secuencias.
- `fontWeight 600` del editor no tiene equivalente exacto en los clones
  métricos: el spike usa los binarios OFL tal cual (peso 600).
- Lato declara **Reserved Font Name "Lato"**: cualquier derivado, recorte o
  renombrado debe usar otro nombre (ver `fonts/lato/PROVENANCE.md`).
- Validación física con el grabador real pendiente.
- **El motor no está integrado en `src/`**: el gate productivo sigue devolviendo
  `FONT_OUTLINES_UNAVAILABLE` (`src/production-lab/exportTextOutlines.ts`).
