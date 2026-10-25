# Motor tipográfico vectorial (`src/typography`)

Convierte texto curvo en **contornos SVG reales, en milímetros**, con la misma
geometría y las mismas fuentes que el laboratorio físico.

## Qué hace

| Pieza | Función |
|---|---|
| `harfbuzz.ts` | Shaper HarfBuzz (WASM): GSUB (ligaduras y sustituciones contextuales), GPOS (kerning real, incluidos lookups con `lookupFlag` y GDEF), ejes variables y contornos por glifo. |
| `curved.ts` | Geometría: colocación sobre el círculo base (ángulo 0 arriba, horario), transformada rígida del contorno a mm y serialización canónica (3 decimales = 1 µm). |
| `fonts.ts` | Catálogo: Poppins SemiBold, Lato SemiBold y Dancing Script (variable), con licencia y procedencia. |
| `index.ts` | API pública: `renderCurvedText(spec)` → glifos con su path en mm. |

## Reglas de diseño

- **Fallo explícito**: glifo ausente → `GLYPH_MISSING`; texto no NFC →
  `TEXT_NOT_NFC`; fuente no disponible → `FONT_UNAVAILABLE`; motor no cargado →
  `SHAPER_UNAVAILABLE`. **Nunca se sustituye una fuente ni un glifo.**
- **Determinista**: la misma entrada produce siempre los mismos bytes.
- **Carga diferida**: el WASM se carga la primera vez que se compone un texto;
  el bundle inicial no lo incluye (verificado: el chunk inicial no lo menciona).
- **Independiente**: este módulo no sabe nada del editor, del admin, de los
  trabajos ni de los exportadores.

## Por qué HarfBuzz

El motor anterior (opentype.js + lector GPOS propio) no implementa GSUB, así que
no reproducía lo que el navegador sí aplica: en Lato divergían 12 secuencias
(`fi`, `ti`, `ff`, `tt`…) hasta un 3,7 % del em, y en Dancing Script el par `or`
sufre una sustitución contextual (+4,0 % del em). HarfBuzz es el motor que usa
Chromium, y además entrega el contorno de los glifos que acaba de componer
(`glyphToJson`), de modo que glifos y contornos no pueden discrepar.

## Integración con Vite

`harfbuzzjs` trae el WASM con `new URL("harfbuzz.wasm", import.meta.url)` y su
entrypoint inicializa el módulo con un **top-level await**. Por eso:

1. el plugin `harfbuzz-assets` de `vite.config.ts` sirve los ficheros del paquete
   en desarrollo (middleware) y los emite como assets en el build, siempre con
   el `.wasm` junto al glue;
2. el motor lo importa **dinámicamente con un especificador calculado en tiempo
   de ejecución**: ni el bundle inicial ni el escáner de dependencias lo ven (si
   lo vieran, el optimizador de Vite lo reconstruiría con el target por defecto y
   el build fallaría);
3. `optimizeDeps.exclude: ["harfbuzzjs"]` evita cualquier pre-empaquetado.

## Verificación

`tests/typography.spec.ts` (5 tests) y
`tests/production-lab-typography-parity.spec.ts` (4 tests) comparan el motor con
el navegador en las mismas condiciones del reporte de la Etapa 4: avance ≤ 1 %,
posición ≤ 0,2 mm, rotación ≤ 0,5°, desviación de tinta ≤ 0,2 mm y el avance
dentro de la cuantización del propio navegador (1/64 px).

## Pendiente

El motor **no está conectado al exportador**: el gate
`FONT_OUTLINES_UNAVAILABLE` sigue vigente para el uso real. Ver
`odd/tasks/stage4-typography.md` (Fase 2) para el impacto pendiente de
autorización.
