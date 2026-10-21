# Importador aislado de SVG (laboratorio)

Prueba técnica de importación directa de SVG como geometría vectorial, SIN
pasar por el pipeline raster (normalización, Canvas, máscaras, las 8
estrategias, VTracer, threshold, compresión ni re-vectorización).

Alcance estricto: laboratorio. No integra con `App`, `DesignPanel`,
`MatePreview`, `ImageUploadDialog`, `UploadedGraphicElement` ni con la
exportación de producción.

## Estructura

| Archivo            | Rol                                                        |
|--------------------|------------------------------------------------------------|
| `types.ts`         | Tipos públicos; `SvgImportOutcome` (ok / error con código) |
| `limits.ts`        | Límites defensivos documentados                            |
| `transforms.ts`    | Parseo estricto y composición de matrices 2D               |
| `geometry.ts`      | Conversión determinista primitiva → `d`                    |
| `measure.ts`       | Aplanado de curvas y bounding boxes reales                 |
| `parseSvgImport.ts`| Parser seguro con `DOMParser` + validación + herencia      |
| `safeRender.ts`    | Preview sanitizado del original (whitelist + `<img>`)      |
| `index.ts`         | API pública                                                |
| `fixtures/`        | SVG de prueba estilo PicSVG (ver abajo)                    |

## Whitelist (aceptado)

Geometría: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`,
`polygon` (+ contenedores `svg`, `g`).
Ignorados sin error (no aportan píxeles): `defs`, `title`, `desc`,
`metadata`. El contenido de `defs` se audita por seguridad pero su
geometría NO se incluye (no está renderizada en el original).

## Blacklist (rechazo con código y mensaje)

| Caso                          | Código                  |
|-------------------------------|-------------------------|
| `<script>`                    | `CONTAINS_SCRIPT`       |
| `<foreignObject>`             | `CONTAINS_FOREIGN_OBJECT` |
| `<iframe>`, `<object>`, `<embed>` | `CONTAINS_ACTIVE_CONTENT` |
| Atributos `on*`               | `CONTAINS_EVENT_HANDLER` |
| `<image>` (raster)            | `CONTAINS_RASTER_IMAGE` |
| `<text>`, `<textPath>`        | `CONTAINS_LIVE_TEXT` (pedir convertir a curvas) |
| URLs externas / remotas / `javascript:` / `data:` | `EXTERNAL_REFERENCE` |
| `<use>`                       | `UNSUPPORTED_USE`       |
| `<style>` / CSS inseguro      | `UNSUPPORTED_STYLE`     |
| Degradados / patrones         | `UNSUPPORTED_PAINT_SERVER` |
| `<clipPath>`, `<mask>`, `<filter>` | `UNSUPPORTED_ELEMENT` |
| Stroke visible                | `CONTAINS_VISIBLE_STROKE` (convertir a contornos) |
| `<!ENTITY` en DOCTYPE         | `UNSAFE_DOCTYPE`        |

El atributo `style="..."` inline solo admite declaraciones simples; `url()`
únicamente local (`url(#...)`, que igualmente se rechaza si define pintado).

## Transforms heredados (opción B: matriz compuesta)

Cada path sale con su CTM compuesto serializado como
`matrix(a b c d e f)` (6 decimales); identidad = sin `transform`.
Orden: `CTM_hijo = CTM_padre × local`, plegado por izquierda dentro de una
lista. Soporta `translate`, `scale`, `rotate` (con centro), `skewX`,
`skewY`, `matrix`. Cualquier función desconocida o resto sin consumir es
`INVALID_TRANSFORM` (nunca se ignora). Las escalas negativas
(`scale(0.1,-0.1)`) se preservan: la orientación NO se corrige. Los `d`
originales no se tocan.

## Estilos heredados

Se resuelven `fill`, `stroke`, `stroke-width`, `fill-rule`, `opacity`,
`display`, `visibility` (atributo o `style` inline; el inline gana, como en
CSS). El diagnóstico reporta los valores originales. El normalizado es
geometría para grabado: se renderiza en negro y aplana `fill-rule` a
`evenodd` (convención del producto: `UploadedGraphicElement` y VTracer usan
`evenodd`) y la opacidad a opaco (avisado en `warnings`).

## Normalización y bounding box

Se conserva el `viewBox` original y los `d` intactos; la consistencia entre
archivos con distintos viewBox/dimensiones/transforms sale del bounding box
REAL: cada `d` se aplana (líneas, cúbicas/cuadráticas muestreadas, arcos con
parameterización endpoint→center) y sus puntos se transforman con la matriz
compuesta antes de unir. Sin `viewBox` se deriva de `width`/`height` (con
conversión de unidades absolutas); sin ambos es `INVALID_DIMENSIONS`.

## Fixtures

`fixtures/picsvg-a-939.svg` (939 paths) y `fixtures/picsvg-b-408.svg`
(408 paths) son STAND-INS sintéticos con la estructura real descrita
(`<g transform="translate(...) scale(...)">` + `fill` heredado). Deben
reemplazarse/complementarse con los dos SVG reales de PicSVG; los tests
apuntan a estos nombres de archivo.

## Integración futura (no implementada)

1. En el diálogo de subida, aceptar `.svg` y llamar `parseSvgImport()`.
2. Adaptar el resultado: `paths: [{ d, transform }]` →
   `uploadedGraphicFromVectorized()`-equivalente usando
   `normalizedBoundingBox` como `artBounds` y `widthPx`/`heightPx` como
   `sourceWidth`/`sourceHeight` (requiere un constructor nuevo; NO tocar el
   actual de VTracer).
3. Reutilizar `artTransformForBounds()` para el encuadre: ya opera sobre
   `{ d, transform }` con `matrix()`, sin cambios.
4. El render del editor ya pinta `fill #171717` + `fillRule evenodd`: el
   normalizado encaja sin conversión.
5. El exportador de producción ya serializa `paths` con `transform`: sin
   cambios.
6. Política pendiente V1: texto (convertir a curvas fuera), strokes
   (convertir a contornos), degradados/patrones (aplanar), `<use>` (aplanar).

## Incompatibilidades conocidas V1

Ver tabla blacklist: texto vivo, raster, strokes visibles, paint servers,
recortes/máscaras/filtros, `<use>`, CSS y porcentajes en geometría se
rechazan con mensaje accionable en lugar de interpretarse en silencio.
