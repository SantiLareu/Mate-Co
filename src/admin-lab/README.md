# Biblioteca SVG del dueño (`/admin-lab`)

El dueño decide qué diseño usar. El software verifica seguridad web, carga
acotada y geometría editable representable; **no juzga aptitud para láser**.
El panel sigue aislado del editor, exportador, raster/VTracer y colocación en mm.

## Uso

1. Agregá un diseño, nombre y categoría libre.
2. Subí el SVG preparado en tu editor externo.
3. Revisá el preview y guardá. El éxito dice **Diseño cargado correctamente**.
   Un rechazo dice **No pudimos importar este SVG.** más un motivo breve, sin
   códigos internos ni checklist.

Texto editable: **Convertí el texto a curvas antes de subir este SVG.**
Imagen raster: **Este SVG contiene una imagen raster y no puede usarse como
geometría editable.** Las referencias externas inseguras tienen prioridad
sobre esos límites técnicos.

## Subconjunto técnico admitido

| Aspecto | Tratamiento |
|---|---|
| Estructura | Un `svg` en el namespace SVG estándar, grupos ordenados, paths originales y primitivas `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` convertidas a paths controlados. |
| Raíz realista | `version="1.0"`, dimensiones absolutas como `1920pt`/`1080pt`, `viewBox`, `preserveAspectRatio`, `xmlns`. No se deducen mm físicos ni se conserva el lienzo vacío del archivo. |
| Relleno | Colores concretos (nombres CSS, hex, rgb/rgba, hsl/hsla), `none`, reglas `nonzero`/`evenodd` por path, incluso mixtas. No se convierte a negro. |
| Trazo | Color, ancho, cap/join/miter, dasharray/dashoffset, opacidad de relleno/trazo. No se fuerza conversión a contornos. |
| Opacidad | Árbol ordenado de grupos y paths. La opacidad del grupo compone el conjunto, no se multiplica sobre paths superpuestos. |
| Transformaciones | Matriz compuesta de `translate`, `scale`, `rotate`, `skewX/Y`, `matrix` por path. El preview aplica esa matriz **solo al path**; los grupos llevan únicamente opacidad. |
| Geometría | `d` original intacto, gramática estricta y extremos analíticos. Los arcos con flags separados o compactados son representables por el medidor privado v2. |
| Datos inertes | `title`, `desc`, `metadata` y `defs` no renderizados se omiten de la proyección, pero se auditan por seguridad. IDs, atributos de editor/data/ARIA inertes no impiden importar. |
| Visibilidad | `display:none` se omite tras auditar; visibility oculta no representable se rechaza. Paths con pintura/opacidad cero se conservan y validan completos; no amplían la caja pintada. Un diseño totalmente invisible puede importarse. |

El preview se construye con React `svg`/`g`/`path` y props explícitas de pintura
concreta, matrices, `d` y opacidad. Nunca se inserta SVG original, DOM de origen,
HTML arbitrario, CSS remoto ni `innerHTML`. Sus proporciones derivan de
`artBounds`: envolvente conservadora pintada que incluye caps/joins y trazo bajo
transformaciones afines; `centerlineBounds` conserva la caja geométrica exacta.
No es una unión exacta de píxeles: puede incluir margen conservador.

El mismo medidor privado deriva las cajas al importar y al validar el modelo
persistido, después de validar el árbol ordenado. Para bounds solamente,
`none`, opacidades cero de grupo/path/relleno/trazo y colores concretos
inequívocamente transparentes (incluido alpha cero) no aportan pintura. Un
relleno invisible no elimina un trazo visible, ni viceversa. Nunca se aplana
la opacidad de grupo sobre los paths ni se borran sus `d`, matrices o nodos.
Toda geometría retenida, aunque inactiva, consume los mismos presupuestos y
controles de sintaxis, coordenadas y rango de envolvente que antes.

Si toda la pintura es invisible, `artBounds` usa `centerlineBounds` como
fallback estable: mantiene cada dimensión positiva exacta; una dimensión cero
usa 1 unidad centrada en la coordenada, limitada al rango ±1 M. Esto permite
recargar líneas/puntos con envolvente de trazo válida ya admitidos por v2.
La degeneración geométrica histórica sigue sin soporte: si tampoco existe
una envolvente geométrica/de trazo positiva en ambas dimensiones, se rechaza.
No se evalúa aptitud para grabado ni se exige pintura visible.

## Exclusiones explícitas

- Seguridad: scripts, eventos `on*`, javascript, `foreignObject`, recursos
  externos, CSS remoto, XML con entidades/DTD externos o instrucciones de
  stylesheet. El documento completo se audita, incluso contenido ignorado.
- Apariencia aún no representable: `use`, stylesheets, animaciones, pintura
  dinámica (`currentColor`, variables), servidores de pintura referenciados
  (gradientes/patrones), clip/mask/filter/markers, blend modes, vector-effect,
  lienzos SVG anidados y efectos CSS no controlados.
- Longitudes porcentuales y sintaxis/números inválidos no se reparan ni se
  interpretan parcialmente. Un namespace extranjero renderizado es un límite
  técnico. Las declaraciones de namespace de editor por sí solas son inertes.

Estas son restricciones técnicas, no reglas de grabado. Desaparecieron las
restricciones de solo paths, negro opaco, sin strokes, opacidad 1, regla global
uniforme y rechazo general de metadatos/atributos desconocidos.

## Fidelidad v3 (asset sanitizado, no geometría controlada)

Lo anterior describe al importador de geometría (v1/v2). El asset v3, en
cambio, preserva el documento externo tal cual tras sanitizar: `<style>`
auditado se conserva (solo selectores simples y propiedades inertes, sin
`@`-reglas ni `url()`), `<use>` interno se conserva, todos los primitivos
`fe*` de filtros se conservan (solo cae `feImage` con referencia externa),
las imágenes `data:` se conservan únicamente raster (`png/jpeg/gif/webp/
bmp/avif`, sin SVG ni HTML anidados), `metadata` se elimina por no renderizar
y los atributos desconocidos se recortan en silencio sin rechazar el archivo.
El cuerpo hostil se purga y el archivo igual se admite con su forma canónica;
solo el prólogo (entidades, PIs de stylesheet, DOCTYPE con subconjunto
interno, DTD no estándar) rechaza con `SECURITY`. Las referencias DTD SVG
estándar del W3C (SVG 1.0, SVG 1.1, SVG 1.1 Basic/Tiny y `<!DOCTYPE svg>`
solo) se toleran y se eliminan antes de parsear: son identificadores
inertes, no peticiones de red, y nunca llegan a la salida sanitizada.

## Admisión y límites

`admission.ts` es un adaptador delgado de `importTrustedSvg` y
`validateImportedGeometry`. Rechaza `File.size` > 2 MB **antes de File.text()**;
una lectura fallida tiene mensaje visible y la UI preserva la última selección
con su token de carrera. El importador acota texto UTF-8, estructura y trabajo
antes de analizar; la proyección se valida antes de entrar al estado de UI.

- Por diseño: 2000 paths, 1 M caracteres por `d`, 2 M totales, coordenadas
  ±1 M, costo ponderado 500 k, 200 k comandos por path, 10 k nodos, profundidad
  64, 256 valores dash por path.
- Biblioteca: 200 diseños y 4 M caracteres de escritura. Más de 5 M caracteres
  crudos no se parsean; hasta 5000 registros escaneados.
- Lectura acumulada: 2 M caracteres `d`, costo ponderado 500 k y 100 k unidades
  estructurales (paths, nodos, referencias de hijos y valores dash). Se cobra
  el trabajo de vecinos inválidos/duplicados también, antes de medir bounds.
  Al superar el presupuesto, el escaneo termina conservando el blob completo.
- La escritura verifica el mismo presupuesto agregado: nunca guarda una
  colección que su propio loader no pueda recargar.

## Modelo y compatibilidad

| Capa | Contrato |
|---|---|
| Sobre y clave | Se mantienen `{ version: 1, records }` y `mateco.admin-lab.designs.v1`. Un sobre puede mezclar versiones de registro. |
| Registro nuevo v2 | `version: 2`, `id/name/category/enabled/createdAt`, `geometry` v2 con paths (`d`, matrix, style), árbol de nodos indexados, root, centerlineBounds y artBounds. |
| Registro asset v3 | `version: 3`, mismos metadatos, `svg` (documento sanitizado canónico), `width`/`height`/`viewBox` derivados que replican `SvgAsset`. Es lo que persiste todo alta nueva desde asset sanitizado. |
| Registro legado v1 | Se preservan `paths(d/transform?)`, `artBounds` y `fillRule` global. Al leer se normaliza **solo en memoria** a árbol controlado: negro, sin trazo, opacidad 1, regla original y matrices parseadas. |
| Mutaciones v1 | Editar datos, activar/inactivar o guardar otros diseños no migra ni pierde los paths/transforms/regla del registro legado; su proyección runtime no se persiste. |
| Mutaciones v3 | Editar datos o activar/inactivar reescribe v3 (re-sanitizado) con misma clave y sobre. Las mutaciones de v1/v2 conservan su formato persistido exacto: ningún cambio migra de versión al escribir. |
| Validación | v1 usa su validador geométrico histórico y después valida su proyección v2. v2 usa `validateImportedGeometry`: pintura segura, refs/orden únicos, matrices finitas y ambas cajas derivadas. `centerlineBounds` debe coincidir; `artBounds` debe coincidir con la caja pintada actual o con la envolvente exacta del generador v2 anterior. v3 usa `sanitizeStoredSvgAsset` en cada lectura: re-parse + re-sanitize hasta punto fijo estable + derivados consistentes (sin igualdad de bytes: la seguridad viene de la re-sanitización, y lo que rinde es el asset canónico re-sanitizado); el svg guardado nunca se confía. Props extra nunca se renderizan/almacenan. |
| Claves crudas | `FORBIDDEN_RAW_KEYS` es consciente de versión: v1/v2 rechazan toda clave cruda como siempre (`svg`, `markup`, `rawSvg`, `raw`, `xml`, `html`, `href`, `src`). Un v3 solo puede traer `svg`, y únicamente por la vía de revalidación; cualquier otra clave cruda en v3 también se rechaza. Un v3 inválido cae al manejo de corruptos: un payload hostil con `version: 3` no gana nada. |

Los v2 anteriores podían incluir geometría invisible en `artBounds`. Se acepta
solo esa envolvente anterior **recalculada exactamente**, no una caja mayor
arbitraria. La proyección runtime devuelve siempre la caja pintada nueva;
leer no modifica el blob. Una mutación normal persiste la proyección saneada
v2, sin migración masiva ni cambios de clave/sobre. El comportamiento y formato
legado v1 permanecen intactos.

Los registros v1, v2 y v3 cargan juntos del mismo sobre y se distinguen por `version`. Leer un v3 nunca lo reescribe: solo la revalidación lo acepta o lo aísla, y el blob se conserva intacto en ambos casos. El comportamiento y formato v1/v2 no cambian.

No se almacena SVG crudo sin sanitizar: v1/v2 guardan solo geometría validada y v3 guarda únicamente el documento sanitizado canónico (salida del sanitizador: cada lectura lo re-sanitiza hasta punto fijo y verifica derivados; la seguridad viene de la re-sanitización, no de la igualdad de bytes). Nombres/categorías conservan sus topes 120/60;
IDs/fechas tienen cotas 200/64, estado booleano y fecha interpretable.
Los registros corruptos se aíslan sin ocultar vecinos válidos, salvo que se
agote el presupuesto global de escaneo.

**Datos corruptos o versión desconocida = solo lectura.** Ninguna mutación
reescribe, migra ni borra ese blob automáticamente. Se necesita recuperación
humana fuera del panel; no hay botón de reseteo. Un cliente histórico sin
soporte v2 no puede interpretar esos registros nuevos.

**Daño genuino vs. saltos de presupuesto/duplicado.** El sobre distingue
`damaged` (registro ilegible, validación v3 fallida, payload inseguro) de
saltos por tope (overflow de 200 registros, truncamiento de escaneo,
ids duplicados). El daño bloquea TODA escritura incluido el borrado: borrar
un registro sano reescribiría el sobre y perdería el blob dañado en silencio,
por eso ni siquiera el borrado del propio registro dañado (que no está
listado ni direccionable) limpia el bloqueo; la recuperación sigue siendo
humana fuera del panel. En cambio, con saltos solo de presupuesto/duplicado
el borrado sigue permitido: es la vía del dueño para volver bajo el tope y,
tras borrar hasta el estado limpio, las escrituras normales retoman. La
reescritura por borrado suelta los omitidos de forma explícita y visible
(borrar por un id duplicado elimina el conservado y descarta al gemelo
omitido). Altas, ediciones y toggles siguen bloqueados mientras haya
omitidos, hasta el estado limpio.

La interfaz asíncrona completa `AdminDesignRepository` es la costura de un
futuro backend; `StorageBackend` solo inyecta E/S local para tests. Cada
mutación relee lo fresco. La concurrencia es última-escritura, **no atómica**.
Las suscripciones notifican en la pestaña de origen y vía evento `storage` en
otras. Cuota agotada, almacenamiento lleno o no disponible nunca afirman un
guardado falso.

## Verificación focalizada

`tests/admin-lab-admission.spec.ts`, `tests/admin-lab-repository.spec.ts` y
`tests/admin-lab.spec.ts` cubren seguridad y límites, carga realista,
colores/trazos/reglas mixtas, opacidad de grupos superpuestos, primitivas,
preview/recarga, compatibilidad mixta v1/v2, corrupción de pintura/matrices/
árbol/cajas, blob intacto, CRUD, cuota y carreras de archivo. La unidad privada
A1 tiene sus casos en `tests/admin-lab-trusted-import.spec.ts`. La batería de
fidelidad v3 (punto fijo + consistencia de derivados) vive en
`tests/admin-lab-regression.spec.ts` y la matriz de sanitización del asset en
`tests/admin-lab-svg-asset.spec.ts`.
