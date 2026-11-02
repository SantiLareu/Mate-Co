# E5.1b — Bloqueos previos a la validación física (banda grabable + imágenes)

Resuelve lo que se puede resolver con seguridad antes de mandar archivos al
grabador, y deja por escrito lo que no. Base: E5.1 (muestras en
`samples/e5-1/`), commit `2c864b3`.

## Specs (resumen de la petición)

S1: "Identificar la causa exacta del desborde y distinguir geometría de referencia de geometría grabable."
S2: "Determinar si el desborde afecta solamente a la muestra o también al exportador físico."
S3: "Incorporar validación geométrica que impida generar un archivo físico aparentemente válido cuando el grabado excede la banda permitida."
S4: "No recortar, escalar ni desplazar automáticamente elementos sin autorización."
S5: "Investigar cómo se representan las imágenes subidas y vectorizadas en el modelo de diseño."
S6: "Determinar qué hace falta para llevarlas al exportador físico mediante contornos SVG reales."
S7: "Implementar ese soporte sólo si el modelo existente permite hacerlo sin introducir transformaciones ambiguas ni alterar los diseños confirmados. Si no, dejar un plan técnico concreto y mantener el bloqueo."
S8: "Agregar pruebas de regresión para los cambios implementados."

## Diagnóstico (S1, S2)

- **Geometría de referencia (exacta):** los radios de la virola (Ro/Ri) y el
  anillo decorativo son geometría EXACTA; el archivo los exporta como
  `lab-ring-reference`.
- **Geometría grabable (conservadora):** los elementos (íconos, diseños
  aprobados) usan una envolvente CONSERVADORA (caja completa de arte + margen
  de trazo), no la tinta real. El laboratorio **no inventa** medidas de tinta
  (`text-ink-unmeasured`): por eso un "desborde" de envolvente NO prueba que la
  tinta se salga.
- El reporte ya distingue los dos casos: `definitely-outside` (ancla/centro
  fuera de la banda: violación DEMOSTRADA) y `boundary-spill` (envolvente que
  "puede" cruzar un borde: no probado).
- **Causa del caso 75/65 (E):** el diseño aprobado queda con su centro en
  35,0 mm (dentro de la banda 32,5–37,5) y su envolvente conservadora en
  3,55 mm ⇒ toca ±1,05 mm. El archivo sale de 77,1 mm porque el lienzo se
  dimensiona con esa envolvente (decisión E3: el arte desbordado se agranda,
  nunca se recorta). La silueta real puede entrar: **no está probado que la
  tinta se salga**.
- **Alcance:** no es sólo la muestra. Cualquier composición con un elemento
  anclado fuera de la banda producía un archivo "válido" con el grabado sobre
  la abertura o fuera de la pieza. Eso es lo que se corrigió.

## Cambio implementado (S3, S4, S8)

- **Puerta `GEOMETRY_OUT_OF_BAND`** en `buildLabPhysicalSvg`: si el reporte
  trae un `definitely-outside`, la exportación se BLOQUEA con código explícito
  y **no** se genera archivo. No se recorta, escala ni desplaza nada.
- **Holguras conservadoras publicadas, no bloqueantes:** `meta.clearanceWarnings`
  lleva los `boundary-spill` (elemento, lado, holgura firmada) para que quien
  grabe las compruebe. Bloquear por una envolvente conservadora rechazaría
  diseños físicamente válidos.
- **Regresión:** `tests/production-lab-band-geometry.spec.ts` (4 pruebas):
  bloqueo con código, el bloqueo no altera el reporte, la holgura conservadora
  se publica y no bloquea, y una composición que entra sigue exportando igual.

## Imágenes subidas/vectorizadas (S5–S7): plan técnico

- **Modelo (S5):** `UploadedGraphicElement` = `paths[]` ({d, transform?}) +
  `artBounds` + pose (angle, radius, scale, rotation, mirrored, inverted). El
  snapshot del trabajo confirmado (`JobGraphicSnapshot`) guarda esa geometría
  **desacoplada**: los datos para llevarla al archivo físico YA existen.
- **Qué falta (S6):** (1) `PlacedGraphic` en el reporte físico, con la
  colocación en mm (radio/ángulo/escala mapeados por el frame) y el ajuste
  `artBounds → caja de 64 unidades` que ya usa el cliente
  (`artTransformForBounds`); (2) serialización de paths con matriz en el
  exportador físico (hoy el serializador consume `ImportedGeometry`, no
  `{d, transform}`); (3) envolvente conservadora y holguras firmadas, como
  íconos y aprobados; (4) el disco de knockout contra las líneas decorativas,
  como en el exportador del cliente; (5) el gate `GRAPHICS_NOT_EXPORTED` que
  hoy bloquea.
- **Por qué NO se implementa aquí (S7):** el modelo de datos lo permite, pero
  las reglas FÍSICAS de una imagen raster-derived (en qué banda se coloca, qué
  envolvente se le atribuye y cómo interactúa con el knockout) no están
  definidas en el motor físico: definirlas ahora cambiaría lo que significa
  "el archivo físico" sin validación del grabador (E5). El bloqueo explícito
  se mantiene: es preferible a emitir un archivo con la imagen omitida.
- **Siguiente paso sugerido:** una etapa propia con el owner decidiendo la
  colocación física, el fixture vectorizado autorizado y la comparación
  cliente↔físico antes de tocar el motor.

## Log

L1 Petición original: "Mate&Co — E5.1b: resolver bloqueos previos a la validación física" — "Investigar ambos bloqueos y corregir únicamente lo que podamos resolver de forma segura, sin degradar ni modificar silenciosamente el diseño."

L2 Verificación: typecheck OK; build OK (362,16 kB); focalizadas del laboratorio (bandas + export + texto + geometría + trabajos + UI + paridad) **110/110** (1,3 min); regresión completa **622/622** (7,4 min) = las 618 de E4 + las 4 nuevas de la banda.

L3 Muestras: regeneradas con `samples/e5-1/generate.mjs`; el generador ahora registra los bloqueos en vez de escribir archivo. No hay bloqueos en el conjunto actual: el caso 75/65/E se exporta y publica su holgura conservadora (±1,05 mm) — con la advertencia de que el lienzo (77,1 mm) es mayor que la pieza (75 mm) y hay que comprobarlo en el software de grabado.
