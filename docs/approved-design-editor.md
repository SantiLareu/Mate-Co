# Diseños aprobados en el editor (E1/E2)

## Qué es

Los diseños activos que carga el administrador (`/admin`, biblioteca
`mateco.admin-lab.designs.v1`) aparecen en el editor del cliente como una
biblioteca seleccionable aparte: botón **+ Agregar diseño** junto a
**+ Agregar ícono**, sin borrar ni renombrar los íconos demo y sin tocar la
subida rasterizada.

El cliente **NO** puede subir SVG arbitrario desde este flujo: el drawer no
tiene ningún `input[type="file"]` ni controles de administración
(activar/editar/eliminar).

## Consumo de solo lectura (S1)

- `src/approved-designs/catalog.ts` (`useApprovedDesignCatalog`) es el único
  consumidor del lado cliente. Crea **una sola** instancia compartida del
  repositorio existente (`createAdminDesignStore`) y solo usa
  `load` + `subscribe`: sin métodos de escritura y sin duplicar la
  biblioteca en otro archivo.
- Solo se exponen diseños `enabled`. Búsqueda por nombre, categorías libres
  con grupos y filtro, preview seguro y dos vacíos distintos: biblioteca sin
  diseños disponibles **"Todavía no hay diseños disponibles."** vs filtros
  sin coincidencia **"No encontramos diseños con esos filtros."** con
  acción **"Limpiar filtros"** (restablece búsqueda y categoría).

## Limitación mismo navegador/origen (no es catálogo remoto)

La biblioteca vive en `localStorage` del mismo navegador y origen. En otro
dispositivo la lista se verá vacía hasta contar con un backend remoto: esto
es esperable y el drawer lo avisa, nunca se presenta como catálogo público
remoto.

## Instancias inmutables (S3)

Cada instancia guarda `id`, `type: "approved-design"`, `approvedDesignId` y
una **foto** del `RenderableDesign` validado por el
repositorio al momento de elegirlo, más la pose
(`angle/radius/scale/rotation/mirrored/inverted`) con los mismos rangos del
modelo de íconos.

- Actualizar, eliminar o desactivar un diseño en el admin afecta solo al
  selector futuro: las instancias ya colocadas conservan su arte, su pose y
  su referencia (`data-design-id`).
- Solo el envoltorio externo transforma el asset como unidad; no se editan
  paths internos, no se aplana y no se re-sanitiza.
- La foto evita el clonado profundo del asset: v3 comparte la referencia del
  string SVG inmutable con copia superficial de metadatos; solo los árboles
  mutables v1/v2 (paths/nodos/bordes) se copian elemento por elemento. La
  foto se congela (`Object.freeze`) para que la reutilización de objetos del
  catálogo no mute instancias colocadas.
- v1/v2 (si el repositorio los devuelve) se dibujan con serialización
  controlada existente (matriz + pintura explícita), sin props arbitrarias
  nuevas, y conviven con v3. Se prefiere el asset SVG fuente v3.

## Render aislado e IDs (S4)

- v3 se dibuja como `<image>` cuya fuente es un documento SVG aislado vía
  Blob (`useApprovedAssetUrl`, contraparte reutilizable del patrón de
  preview del admin, sin editar el alcance admin). El contenido sigue siendo
  vectorial en el navegador: sin Canvas, sin vectorización, sin raster.
- El hook es source-tagged: ante un cambio de fuente devuelve `null` hasta
  que llega la URL nueva, nunca la URL anterior ya revocada; la URL se
  revoca al cambiar la fuente o desmontar (también al eliminar el diseño).
- v1/v2 previsualizan en el drawer (`ApprovedSnapshotThumb`) y en el lienzo
  el mismo árbol controlado seguro (matriz + pintura explícita). El drawer
  pinta en coordenadas crudas del arte con un viewBox crudo coincidente
  (como AdminLab, sin ajuste de normalización); el lienzo conserva su
  propio ajuste centrado a coordenadas locales 0: sin glifo sustituto.
- Tamaño y viewport: el editor preserva la proporción del viewport raíz
  almacenado (`width`/`height` explícitos, si no `viewBox`); el navegador
  decodifica el mismo tamaño intrínseco (verificado con `Image` natural,
  incluso con fuentes cuyo `width`/`height` difieren del `viewBox`).
- El aislamiento mantiene CSS, IDs y refs locales (`url(#…)`, `href`)
  dentro de su propio documento: no hace falta renombrar IDs entre
  documentos y lo repetido (p. ej. dos assets con `g1`) no colisiona ni
  cambia la apariencia del vecino.
- Nunca se inserta CSS sin alcance de v3 ni `innerHTML` crudo. La URL se
  revoca al cambiar la fuente o desmontar; no hay contenido blob remoto
  arbitrario.
- El envoltorio preserva viewBox, aspecto y pintura interna
  (fills/strokes/opacity/refs). El calado decorativo usa el círculo
  circunscrito del arte encajado real (mitad de la diagonal a escala + 4 de
  margen, invariante ante rotación/espejo/inversión): coincide con la huella
  sin invertir pintura ni recortar.
- La selección es exclusiva entre texto/ícono/gráfico/aprobado; borrar y la
  barra (espejo/invertir/ángulo inicial) actúan sobre la instancia
  seleccionada.

## Interacción reutilizada (S4)

Arrastre directo con matriz capturada (`useDirectDrag`), snapping
angular/radial, controles `ElementHandle`, `usePreventManipulationScroll` y
`artTransformForBounds`: invocación estrecha de los helpers existentes, sin
copiar un motor nuevo ni tocar sus fuentes. El panel conserva sus espacios
en móvil (sin saltos); `touch-action: none` solo en elementos y controles,
afuera el scroll sigue permitido.

## Confirmar y exportación (S5)

Diseño → Confirmar → volver conserva el mismo estado fuente en App
(pose y referencia exactas). El resumen cuenta `Diseños: N`.

Elección del usuario: **integrar hasta Confirmar y bloquear esa
exportación**. `buildProductionSvg` y el resto del exportador quedan
intactos: el botón se deshabilita con mensaje claro **SOLO** cuando hay
instancias aprobadas ("La exportación está bloqueada mientras haya diseños
aprobados en el mate…"). Sin aprobados, la exportación funciona como antes:
sin omisiones ni exportaciones parciales.
