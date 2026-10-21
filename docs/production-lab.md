# Laboratorio de preparación física (`/production-lab`)

Ruta aislada y perezosa: muestra la composición original del editor
(`MatePreview`, `editing=false`, fixture inmutable, callbacks noop) junto a
la transformación física pura en milímetros. No lee ni escribe estado de la
app, el editor, el admin, el exportador ni `localStorage`.

## Política de escala elegida

Se compararon cuatro alternativas y el usuario eligió
**«Escalar según el diámetro exterior»**:

1. Semejanza global (descartada: el interior no coincide).
2. Tamaños derivados de la banda (descartada: deforma la correspondencia
   con el editor).
3. Deformación radial/warp (descartada: deforma el arte).
4. **Tamaños por diámetro exterior + anclas anulares (elegida).**

Matemática de unidades fuente, Modo A — Diámetro exterior (política
original del laboratorio, ver `src/production-lab/geometry.ts`):
`Ro = Do/2`, `Ri = Di/2`, `kPosición = (Ro−Ri)/131`,
`kTamaño = Ro/423`, `mapRadio(r) = Ri + (r−292)·kPosición`, centro físico
`(0,0)`, ángulo 0 arriba, horario, y hacia abajo. Ambos bordes de referencia
salen exactos; el arte que invade la banda se reporta, nunca se autoachica.
El laboratorio hoy abre por defecto en Modo B — Espesor de banda
(`kTamaño = (Ro−Ri)/131 = kPosición`, mismas anclas; ver la sección
«Estrategia de espesor de banda — Modo B» más abajo).

## Procedencia de lo renderizado

- Referencias, posiciones y anclas: geometría calculada exacta.
- Envolventes: conservadoras (la tinta real puede ser menor); efectos SVG
  completos no certificados, en especial filtros/sombras de diseños
  aprobados v3 (ver `APPROVED_ENVELOPE_PROVENANCE` en el reporte JSON).
  Cada holgura del reporte lleva su `envelopeProvenance`.
- Glifos de texto: apariencia simulada dependiente de la fuente y del
  navegador. El avance medido (`getComputedTextLength` sobre texto recto a
  unidades fuente, luego `scaleToPhysical`) **no** es caja de tinta; la
  tinta queda marcada `text-ink-unmeasured` hasta una etapa con `getBBox`.
- Advertencias: invasión de envolvente conservadora y solapes potenciales
  son cotas inferiores firmadas, **no** colisiones de tinta probadas. Sin
  afirmaciones de «listo para producción», sin holguras mínimas inventadas.
- Pares: solo discos con envolvente (íconos y diseños aprobados). Texto y
  anillos quedan fuera de la lógica de pares: colisiones de tinta
  texto↔diseño y línea↔diseño no medidas ni afirmadas.

## Líneas decorativas: trazo subyacente vs recorte visual

Las líneas se dibujan con el recorte visual de la composición original: la
máscara `lab-physical-lines-knockout` replica las reglas exactas de
`decorative-lines-knockout` (banda de arco con trazo `35*scale+10` para
texto, disco `25*scale*sqrt2+4` para íconos, helper `approvedKnockoutRadius`
para aprobados) bajo anclas anulares + el factor de tamaño vigente de la
estrategia activa (`sizeFactor`: `Ro/423` en Modo A, `(Ro−Ri)/131` en
Modo B), con
ids propios que nunca colisionan con los originales. Los círculos de
referencia interior/exterior nunca se recortan. Fuente: regla visual
original; no margen de fabricación: el `+4` artístico vive solo en la
máscara y jamás en envolventes, holguras ni reportes.

La geometría matemática del anillo vive en `lineClearances` del reporte:
holguras firmadas `Ro−(r+trazo/2)`, `(r−trazo/2)−Ri` sobre el trazo circular
subyacente ANTES del recorte visual, con avisos `line-boundary-spill` (p. ej.
100/99.5: la línea 367 invade el exterior por 0.01 mm y la 347 el interior
por 0.01 mm, sin autoajuste). Los anillos son trazos, no discos rellenos.

## Entradas, medición y serialización

- Diámetros: vacío real → estado en blanco sin errores; texto ingresado
  inválido o no finito (`abc`, `1e400`, `Infinity`) → error de campo
  explícito con `aria-invalid`, sin geometría física rancia. `badInput`
  nativo se captura en el evento `input` antes del re-render controlado.
- Avances de texto: la sonda publica siempre una medición completada (mapa
  quizá vacío) una vez por composición; el 0, el `throw` y lo no finito
  quedan como avance no disponible etiquetado, distinto de tinta sin medir.
  Sin longitudes inventadas ni reintentos.
- `textArcPathMm` dibuja el camino base de círculo completo de la fuente: el
  medio-arco medido solo alimenta recorte/hit/clamp (`text-span-clamped`),
  nunca recorta el camino.
- Si `serializeReport` falla (guardia pura, normalmente inalcanzable), la UI
  muestra «serialización no disponible» en vez de ocultar el detalle.

## Límites residuales

Sin máximo de fabricación inventado: diámetros finitos enormes (p. ej. `e300`)
pueden exceder lo que el renderizador del navegador representa; la geometría
pura sigue finita y el reporte lo refleja, pero la vista no certifica
pintado fuera de los límites numéricos del navegador.

## Exportación vectorial física — E1 núcleo puro (experimental, Stage 3)

Estado: experimental, pendiente de validación con grabador real. No marca
diseños aptos para grabado. El flujo productivo (pedidos/exportador actual)
sigue intacto; `src/export/productionSvg.ts` no se tocó.

### Contrato de medidas (mm)

- El núcleo `buildLabPhysicalSvg({ report, iconPaths, assetFlags?, fileName? })`
  (en `src/production-lab/exportSvg.ts`) es síncrono, puro y sin DOM: lee el
  MISMO `PhysicalReport` que renderiza la vista, sin cálculos divergentes.
  Sin `Date`/azar/`Blob`/DOM. Retorna `{ ok: true, svg, meta }` con
  `meta = { outerDiameterMm, innerDiameterMm, strategy, sizeFactor, fileName }`
  o `{ ok: false, code, reason }` con códigos máquina-estables.
- Los radios del reporte YA están en mm (⌀ = 2R). La raíz declara solo
  `xmlns`, `width`/`height` en mm (`"{2h}mm"`) y `viewBox "0 0 {2h} {2h}"`
  (mm = 1 unidad). `h` = extensión máxima sobre anillos, radios de línea y
  `centro+envolvente` colocados (misma familia que el ajuste de la vista,
  SIN el pad 10% de pantalla ni etiquetas: una composición vacía exporta
  exactamente `2h` = diámetro exterior). La escena se dibuja alrededor del
  (0,0) físico y se traslada `(h,h)` a coordenadas no negativas.
- Grupo de anillos `id="lab-ring-reference"`: dos círculos `r` = radio
  exterior/interior, sin relleno, trazo `#0000FF` 1.5 (convención del
  producto). Son REFERENCIAS DE MEDICIÓN, no rutas de grabado. El grupo es
  HERMANO del grupo de grabado `id="lab-engraving"`, nunca anidado en él.
  Límite documentado (R1): el semi-extent no incluye la mitad del trazo, así
  que un anillo de referencia (o una línea decorativa cuyo radio caiga
  exactamente en el borde del lienzo) recorta ~0.75 mm de su propio trazo
  en el archivo exportado. La vista previa no lo muestra (`overflow:
  visible`); el arte grabable nunca se recorta por esto, pero al inspeccionar
  el archivo tenerlo presente.
- Íconos: envoltorio PhysicalIcon exacto (`translate` + `rotate`/`scale` +
  `scale(1.4) translate(-16 -16)`, trazo `#171717` 1.7 redondo). El núcleo no
  resuelve el catálogo: `iconPaths` (id colocado → `d`s) lo provee quien
  llama (E2 lo cablea a `iconById`); sin entrada, fallo cerrado.
- Aprobados v1/v2: envoltorio PhysicalApproved + serialización equivalente a
  `ControlledGeometry` (`d` + matriz + estilo completo, orden estable).
  v3 (asset SVG completo) se BLOQUEA en E1 (`UNSUPPORTED_ASSET_FEATURE`):
  el inline con namespacing DOM es alcance de E2.
- Líneas Simple/Doble: arcos interrumpidos explícitos vía helpers de
  `src/export/geometry.ts` a centro 0 (discos: `distance = hypot(cx,cy)` en
  mm, `angleDegrees = atan2(y,x)` normalizado; bandas: `radius = anchor`,
  `halfWidth = stroke/2 + 1·sizeFactor`, `angleOffset` = ángulo diseño según
  contrato `bandToCoveredInterval` — arco 270 = arriba = diseño 0). Círculo
  superviviente intacto sigue `<circle>`; anillo totalmente cubierto no emite
  nada. Delta de cap redondo documentado: el preview enmascara con caps
  redondos, los helpers emiten límites analíticos exactos (butt-end); un pase
  con cap redondo repintaría ~`strokeWidthMm`/2 — no se "corrige" en silencio.
- Serialización determinista: misma entrada → bytes idénticos. Orden de
  atributos fijo; números vía `String()` con snap canónico a cero
  (`|v| < 1e-9` → `0`, tres órdenes bajo 0.001 mm) que absorbe ruido trig
  (`cos(-π/2)`) y normaliza `-0`; sin notación científica, sin timestamps.
- Extensión de exportación `h` con granularidad de 0.01 mm (10 µm, E3):
  se redondea HACIA ARRIBA (`ceil`), así los múltiplos exactos quedan
  exactos (solo-anillos 80 → 80) y el arte desbordado nunca se recorta
  contra el borde del viewBox.
- Composición vacía: VÁLIDA (solo anillos); no existe código
  `EMPTY_COMPOSITION`.
- Consecuencia de máscaras para el grabador (E3): `mask`/`clipPath` viajan
  en el archivo porque son vectoriales con refs locales verificables, pero
  el software CAM puede ignorarlas ⇒ MÁS tinta que la vista previa (la
  vista enmascara visualmente; la máquina podría grabar el trazo completo).
  Verificar con el grabador real antes de producción; los anillos de
  referencia son medición, no rutas de grabado.

### Bloqueo de fuentes (evidencia L2)

Decisión de usuario L2: «A: Bloqueo claro para textos (recomendado)».
Cualquier composición con textos falla con `FONT_OUTLINES_UNAVAILABLE`.
Evidencia: el editor pinta texto solo con fuentes propietarias del sistema
(Georgia/Arial/Times New Roman/Trebuchet MS/Verdana, sin `@font-face` ni
archivos de fuente ni parser en el proyecto); el navegador no expone
contornos de glifos; la única vía existente (raster→VTracer) es no
determinista y está prohibida. Sin sustitución silenciosa ni equivalencia
fingida. Futura vía segura propuesta (no implementada): fuente OFL
empaquetada + parser de contornos (Stage 4, decisión de licencia).

### Escaneo fail-closed de activos (contrato E2)

El núcleo NO husmea bytes (un scan de strings no es fiable): acepta
`assetFlags = { hasRaster, hasUnsupportedFeature, hasText }` calculadas por
quien llama y rechaza con `RASTER_ASSET_BLOCKED` /
`UNSUPPORTED_ASSET_FEATURE` / `FONT_OUTLINES_UNAVAILABLE`. E2 debe computarlas
con el pase DOM real (payloads raster `data:image`, `filter`/`fe*`,
`<text>`/`<font-family>` dentro de aprobados). Códigos defensivos propios:
`TEXT_SPAN_UNMEASURED` (banda huérfana sin texto: inalcanzable tras el
bloqueo, se conserva) e `INVALID_MEASURES` (números no finitos).

### Correcciones E3 de revisión independiente (Stage 3)

- v3 sin `viewBox` (raíz solo con `width`/`height`): el inline SINTETIZA
  `viewBox="0 0 <displayW> <displayH>"` desde las mismas dimensiones del
  ajuste fit-64 (espejo documentado de `approvedDisplaySize`): el espacio
  de usuario anidado == caja de exhibición, sin sobredimensión ni recorte
  frente a la vista previa. Con `viewBox` válido se conserva textual.
- Paridad de vista previa (fail-closed, `UNSUPPORTED_ASSET_FEATURE`): un
  `preserveAspectRatio` de raíz presente pero distinto de `xMidYMid meet`
  (`none`/`slice`/encuadres) o un atributo `transform` en la raíz divergen
  del `<image xMidYMid meet>` sin transform de la vista previa y bloquean;
  `xMidYMid meet` explícito o ausente siguen permitidos. Nada se despoja
  ni se reinterpreta en silencio.
- Alcance de gráficos (J3): `graphicsCount > 0` bloquea con código explícito
  `GRAPHICS_NOT_EXPORTED` (el motor cubre textos/íconos/aprobados); el
  estado nunca declara la composición exportable en ese caso. Cableado UI
  (auditoría #3): `ProductionLab.tsx` pasa `graphicsCount` al núcleo
  (`computeLabExportState` → `buildLabPhysicalSvg`; demo 0 — el fixture no
  trae gráficos; trabajo `composition.graphics.length`) y el panel muestra
  `Exportación bloqueada (GRAPHICS_NOT_EXPORTED)` con la redacción de la
  nota `lab-job-graphics-note`; la puerta de fuentes conserva precedencia
  (`FONT_OUTLINES_UNAVAILABLE` primero).
- Puerta nula primero: reporte nulo/faltante → `INVALID_MEASURES`, nunca
  `TypeError` por `report.texts`.
- Defensa en profundidad documentada: el scan busca `font-family` literal y
  `filter`/`fe*` a nivel de elemento; las formas abreviadas (`font:` en
  `style=""`, `filter:` en shorthand) son inalcanzables porque el
  sanitizador solo conserva la allowlist `STYLE_PROPERTIES` (el shorthand
  `font` se despoja) y el `embed` bloquea referencias colgantes si un
  `url()` sobreviviera sin destino.
- Nota informativa de ambigüedad de prefijos: el namespacing
  `lab-x-<placedId>-` no puede colisionar con los ids del repositorio
  vigente (juego de caracteres restringido de ids colocados); si futuros
  ids admitieran `-` arbitrarios, re-auditar la unicidad del prefijo.

Cableado UI completado (auditoría #3): el panel `ProductionLab.tsx` provee
`graphicsCount` (`computeLabExportState` → `buildLabPhysicalSvg`; demo 0,
trabajo `composition.graphics.length`). Un trabajo con imágenes muestra
`Exportación bloqueada (GRAPHICS_NOT_EXPORTED)`, nunca «Composición
exportable»; el núcleo además bloquea cuando recibe el conteo (defensa en
profundidad).

Fixture dentro de los clamps del editor (comprobado contra los helpers
reales `clampTextRadius`/`clampTextScale`/`clampIconScaleAtRadius`): el lab
no aplica clamps sobre mm ni modifica el editor.

## Exportación vectorial física — E2 inline v3 + panel (experimental, Stage 3)

### Decisión de escaneo (mask/clipPath/pattern/marker/use: SE CONSERVAN)

`scanApprovedAssetFlags` (`src/production-lab/exportApprovedAsset.ts`,
módulo DOM aislado solo para navegador: el núcleo puro jamás lo importa)
clasifica cada activo v3 con tres banderas exactas según el contrato E1:

- `hasRaster`: `<image>`/`<feImage>` con `href`/`src` `data:image/` raster
  (`png|jpeg|jpg|gif|webp|bmp|avif`) o URL externa `http(s)`/`//`.
  Bloquea como `RASTER_ASSET_BLOCKED`: el grabado nunca convierte
  aprobados a PNG/JPEG/canvas y los bytes externos no son verificables
  sin red. (El sanitizador ya despoja hrefs no locales; el scan re-verifica
  el string exacto que se incrusta: defensa en profundidad.)
- `hasUnsupportedFeature`: cualquier elemento `<filter>` o primitiva `fe*`
  distinta de `feImage` (`feGaussianBlur`, `feOffset`, …), más cualquier
  `href`/`src` externo en elementos no-imagen. Bloquea como
  `UNSUPPORTED_ASSET_FEATURE`: los pipelines de filtro son efectos de
  píxel, no geometría de grabado, y no hay forma de verificar que se
  transfieran con fidelidad. `feImage` es fuente de imagen, así que sigue
  la regla raster en vez de esta.
- `hasText`: cualquier `<text>`/`<tspan>`/`<textPath>`, atributo
  `font-family`, `style="…font-family…"` o bloque `<style>` que mencione
  `font-family`. Bloquea como `FONT_OUTLINES_UNAVAILABLE`: rige el mismo
  bloqueo de fuentes L2 (sin contornos, sin sustitución).
- `hasUnsupportedFeature` (E3, paridad de vista previa): además de lo
  anterior, `preserveAspectRatio` de raíz presente pero distinto de
  `xMidYMid meet`, o atributo `transform` en la raíz (la vista previa usa
  `<image xMidYMid meet>` sin transform).
- SE CONSERVAN con namespacing + verificación: `linearGradient`/
  `radialGradient`/`stop`, `clipPath`, `mask`, `pattern`, `marker`, `use` y
  `<style>` con selectores simples de clase/id. Fundamento: referenciado
  vectorial puro con refs solo-locales impuestas por el sanitizador; el
  prefijo por instancia elimina colisiones entre activos y la verificación
  de referencias colgantes demuestra que cada `url(#ref)`/`href="#ref"`
  resuelve dentro de su propio activo. Conforme a la regla «si hay duda,
  enumerar y bloquear»: los filtros son la duda documentada y se bloquean.
- Entrada no parseable: nunca se declara limpia (`hasUnsupportedFeature`).

### Garantías del inline (`embedApprovedAsset`)

- Reescritura DOM (DOMParser/XMLSerializer), nunca regex sobre el marcado:
  `id`, `href`/`src`/`xlink:href`, refs `url(#)` en atributos de pintura y
  `style=""`, cuerpos y selectores `<style>`, y atributos `class` junto a
  sus selectores (endurecimiento anti-colisión: dos activos con la misma
  clase y distinto estilo pintarían mal sin este paso), todo con el prefijo
  `lab-x-<placedId>-`.
- Devuelve el `<svg>` anidado autocontenido, centrado en su caja de
  exhibición fit-64 (`x`/`y` = `−w/2`/`−h/2`, espejo documentado de
  `approvedDisplaySize` + `APPROVED_ART_SIZE`) y conservando su propio
  `viewBox` textual cuando es válido; si falta o es inválido se SINTETIZA
  `viewBox="0 0 <displayW> <displayH>"` (E3: espacio de usuario == caja
  de exhibición, sin sobredimensión). Quien llama lo anida bajo
  el envoltorio de pose `<g transform=translate/rotate/scale>` con
  `localScale` (caja fuente × escala local, exactamente como la caja
  `PhysicalApproved`/`<image>`), así la matemática de pose sigue en una
  sola fuente. v1/v2 no usan este módulo: siguen la ruta de geometría E1.
- Bloquea (nunca degrada) ante: parseo fallido, `url()` no local,
  `href`/`src` `data:` o externos, cualquier `url(#ref)`/`href="#ref"` sin
  destino tras la reescritura (referencia colgante), y reglas `<style>` con
  selectores de tipo desnudos (`rect{…}`), que tras el inline pintarían todo
  el archivo y no admiten namespacing seguro.
- Determinista: recorrido en orden de documento, serialización canónica del
  mismo árbol (redondeo a 6 decimales con snap a cero en la caja).

### Panel «Exportar SVG físico»

En la rama con reporte válido, junto a la lectura de estrategia (y una
variante deshabilitada tras errores de diámetro): archivo
`physical-virola-{Do}x{Di}-{strategy}.svg` + medidas + etiqueta experimental
«pendiente de validación con el grabador»; botón deshabilitado con motivo
exacto cuando hay textos (`FONT_OUTLINES_UNAVAILABLE`), imágenes trazadas
(`GRAPHICS_NOT_EXPORTED`), avances en medición,
reporte inválido, definición de ícono ausente o bloqueo de activo (nombrando
qué diseño: `RASTER_ASSET_BLOCKED` / `UNSUPPORTED_ASSET_FEATURE` /
`FONT_OUTLINES_UNAVAILABLE` / referencia colgante). Íconos: demo resuelve por
catálogo vivo (`iconById`); modo trabajo usa las definiciones incorporadas
del snapshot guardado (incluye íconos fantasma con definición válida).
Descarga por Blob + `URL.createObjectURL` + revoke (helper lab-local en
`ProductionLab.tsx`, sin módulo compartido). Región de estado
`role=status` (listo/descargado) o `role=alert` (bloqueo); jamás declara
aptitud para grabado. Funciona en demo y `?jobId`; alternar estrategia o
medidas re-deriva el reporte; el trabajo solo se lee (`get`).

## Limitaciones vigentes del exportador

El flujo de pedidos/exportación **no** se implementa aquí: el bloque de
diseños aprobados y el texto rasterizado del exportador actual siguen
intactos. A futuro: preservar vectores (contornos de texto) y activos SVG
con namespaces propios; hoy el laboratorio solo calcula y visualiza.

## Reproducibilidad

El panel físico ofrece el reporte JSON puro colapsable (`serializeReport`);
la huella de la composición original demuestra que el editor no se tocó.

## Estrategia de espesor de banda — Modo B (solo laboratorio, C1)

El marco físico lleva `strategy: 'outer-diameter' | 'band-thickness'`
(`PhysicalFrame.strategy`, `ReportInput.strategy?`). El valor omitido es
`'outer-diameter'`: toda llamada existente produce resultados byte-idénticos.

Fórmulas (anclas idénticas en ambos modos):
`Ro = Do/2`, `Ri = Di/2`, `kPosición = (Ro−Ri)/131`,
`mapRadio(r) = Ri + (r−292)·kPosición`.
Solo cambia el factor de tamaño: `kTamaño = Ro/423` (A) frente a
`kTamaño = (Ro−Ri)/131 = kPosición` (B). Todos los consumidores de tamaño
(`scaleToPhysical`, envolventes/knockouts de ícono y aprobado, fuente,
espaciado, dy, desplazamiento de línea base y relleno de arco de texto,
trazo de línea) multiplican `sizeFactor` exactamente una vez, así que siguen
automáticamente el factor vigente sin doble escalado (verificado por
inspección: no existe otra fuente de tamaño).

Valores ilustrativos:
| Caso | Exterior | Interior | kA = Ro/423 | kB = (Ro−Ri)/131 |
|---|---:|---:|---:|---:|
| Virola amplia | 85 mm | 50 mm | ≈ 0.1004728132 | ≈ 0.1335877863 |
| Virola intermedia | 80 mm | 60 mm | ≈ 0.0945626478 | ≈ 0.0763358779 |
| Virola angosta | 75 mm | 65 mm | ≈ 0.0886524823 | ≈ 0.0381679389 |

Referencia geométrica de B: al escalar envolventes radiales con el mismo
factor que las anclas, un elemento en contacto con el borde fuente
(`r ± envolvente = 292/423`) cae exactamente sobre `Ri/Ro`. La métrica
tangencial `ρ(r)/r ≠ k`: el espaciado de arco cambia, no las formas internas
(escala local uniforme, aspecto preservado, rotación/espejo/inversión
intactos).

Garantía sin acumulación: cada colocación deriva de unidades fuente
inmutables + el marco vigente; alternar A↔B o cambiar medidas reconstruye
desde la fuente, nunca reescala una salida previa (probado: A↔B↔A desde la
misma fuente da salidas idénticas por estrategia).

Limitaciones de B: no garantiza encaje (solapes/desbordes/densidad siguen
visibles, sin clipping); banda plana imposible (`Di < Do` estricto ya
exigido); `NaN`/`Inf`/desborde se tratan como hoy. B es solo de laboratorio,
no el valor productivo por defecto. Las cadenas de procedencia nombran la
estrategia activa (`outer-diameter-size` / `band-thickness-size`,
`outer-size scaled` / `band-size scaled`, `uniform … size`).

## C2 — Selector de estrategia en el laboratorio (S2/S3)

El laboratorio ofrece un selector por radios (`lab-strategy-selector`):
Modo A Diámetro exterior frente a Modo B Espesor de banda, con B como
valor inicial solo aquí (el producto y toda llamada sin `strategy`
siguen en A, byte-idénticos). Alternar es estado React puro: instantáneo,
sin recarga, sin perder trabajo, medidas ni composición; cada vista se
rederiva de las unidades fuente inmutables + el marco vigente, sin
escalado acumulativo.

La lectura aplicada (`lab-strategy-readout`, distinta de la leyenda
geométrica `lab-geometry-legend`) muestra la estrategia activa, ⌀
exterior/interior en mm, espesor de banda en mm (`Ro−Ri`) y el factor de
escala aplicado exacto del marco del reporte (`data-size-factor`). El SVG
físico declara `data-strategy`/`data-size-factor` coherentes con la escala
local de cada ícono. El nodo físico de cada diseño aprobado expone
`data-display-base-w-mm`/`data-display-base-h-mm` (base a escala 1:
display × `sizeFactor`) y `data-w-mm`/`data-h-mm` (huella colocada:
display × escala fuente × `sizeFactor`). El modo trabajo (`?jobId`) usa
el mismo selector en solo lectura: alternar o cambiar medidas nunca muta
el snapshot guardado (única llamada: `get`).

## J3 — Fuente seleccionable: fixture demo vs trabajo guardado (S5)

- Sin `?jobId`: el fixture de demostración histórico, sin cambios.
- Con `?jobId=<attemptKey>`: el laboratorio carga el trabajo en solo
  lectura (`loadLabJob` sobre el repositorio existente) y lo adapta sin
  mutarlo (`adaptJobCompositionForLab`, ver `JobComposition.tsx`). El
  original usa `JobSnapshotPreview` con la misma semántica del editor;
  la vista física usa el mismo reporte puro y la misma política (sin
  cambios de ecuaciones). Los diámetros se siguen ingresando a mano;
  no hay diámetros físicos almacenados en esta etapa.
- Fuente siempre visible (`lab-source-kind`); errores nombrados
  (`lab-job-error` con `data-code`) para inexistente/dañado/no
  disponible, con retorno explícito a la demostración.
- Medición determinista: `labSourceMeasureKey` (composición + ids de
  texto + fuentes almacenadas) como clave de remontaje y de cierre de
  completitud; el avance por texto se escala a mm con `textMetrics` y
  su procedencia declarada (avance medido, nunca caja de tinta).
