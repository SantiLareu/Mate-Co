# E4.4 — Activación controlada del exportador vectorial (HarfBuzz)

Deja el exportador **vectorial** como predeterminado **en esta rama
experimental**, con el raster como **reversión explícita** (nunca *fallback*
automático). No se despliega. Base: `stage4-client-export-E4.3.md`
(commit `005a4cc`, 617/617).

## Specs

S1: "Preparar el cambio a HarfBuzz como exportador predeterminado únicamente en la rama experimental, manteniendo reversión explícita. No desplegar a producción."
S2: "Unificar los errores FONT_UNAVAILABLE del exportador vectorial para mostrar mensajes accionables en español, sin exponer errores internos de red."
S3: "Cambiar DEFAULT_CLIENT_TEXT_EXPORT_MODE de raster a vector."
S4: "Mantener el raster únicamente como mecanismo explícito de reversión, nunca como fallback automático."
S5: "Verificar que un fallo de HarfBuzz no produzca un archivo incompleto ni active silenciosamente VTracer."
S6: "Comprobar que el cambio funciona en un build real de producción, no solamente en Vite DEV."
S7: "Adaptar las pruebas del modo predeterminado al nuevo comportamiento, conservando cobertura del modo raster."
S8: "Verificar el flujo completo con las tres tipografías, autoajuste, textos invertidos, íconos, imágenes y líneas."
S9: "Comprobar que los trabajos confirmados, snapshots, administrador y laboratorio permanecen intactos."
S10: "Documentar el procedimiento exacto de reversión y probarlo en una compilación aislada, sin modificar el estado final esperado del proyecto."
S11: "No modificar main. No hacer merge. No desplegar el proyecto. No cambiar el catálogo de tipografías. No modificar trabajos confirmados ni snapshots. No instalar dependencias. No incluir references/typography/. No hacer commit ni push todavía. No empezar E5 ni declarar los SVG aptos para grabado real."
S12: "Typecheck, build, focalizadas y una regresión completa sobre el árbol final. No alterar aserciones sólo para conseguir resultados positivos."

## Tasks

- [x] T1 (S3, S4) — `DEFAULT_CLIENT_TEXT_EXPORT_MODE = "vector"`. La reversión al raster es **explícita**: override de compilación (`VITE_TEXT_EXPORT_MODE=raster`) y, sólo en desarrollo, `?textExport=raster`. Se elimina el flag `VECTOR_EXPORT_EXPERIMENTAL_ENABLED` (ya no es experimental: es el predeterminado).
- [x] T2 (S2) — Mensajes únicos y accionables: `fontUnavailableMessage()` (en `textOutlines.ts`) la usan los **dos** caminos; `SHAPER_UNAVAILABLE` deja de filtrar el error interno del WASM. Ningún camino expone `Failed to fetch` ni códigos HTTP.
- [x] T3 (S5, S6) — El camino vectorial falla **sin** archivo: el pre-flight aborta antes de generar el SVG y nunca cae al raster (el módulo vectorial ni siquiera importa el trazador raster).
- [x] T4 (S6, S10) — Prueba de build real: el build de producción descarga el SVG **vectorial**; una **compilación aislada** con `VITE_TEXT_EXPORT_MODE=raster` (outDir aparte, en `test-results/`) descarga el SVG **raster** y no pide el módulo vectorial. El estado final del proyecto no cambia.
- [x] T5 (S7) — Pruebas adaptadas al nuevo predeterminado, conservando la cobertura del modo raster (byte a byte) y sin debilitar aserciones.
- [x] T6 (S8, S9) — Flujo completo verificado (tres tipografías × normal/invertido/rotado/largo, autoajuste, íconos, imágenes, líneas) y `git diff` vacío en `src/jobs`, `src/admin-lab`, `src/production-lab`.

## Log

L1 Petición original (verbatim): "Mate&Co — E4.4: activación controlada del exportador vectorial" — "Preparar el cambio a HarfBuzz como exportador predeterminado únicamente en la rama experimental, manteniendo reversión explícita. No desplegar a producción." — alcance S1–S12.

L2 Decisión de diseño (reversión): la reversión **no** es un parámetro de URL en producción (el cliente final no debe ver una opción técnica, decisión de E3.1). Es una decisión **de compilación**: `VITE_TEXT_EXPORT_MODE=raster` compila el cliente con el camino raster. En desarrollo conviven las dos vías (URL + override).

L3 Lo que NO cambió: el catálogo de tipografías, el motor (HarfBuzz), el trazador raster, el exportador de producción (`buildProductionSvg` conserva el raster como su propio predeterminado interno), `main`, los snapshots, los trabajos confirmados y el laboratorio. `references/typography/` sigue fuera.

L4 Verificación (árbol final): typecheck OK; build OK (362,16 kB); focalizadas (E4.4 + E4.3 + E4.2 + E4.1 + los 5 specs vectoriales + `export-production-svg` + `typography` ×2 + `confirm-design` + `direct-manipulation` + `jobs-*` ×3) **163/163** antes del arreglo final y **89/90** con un fallo de texto de la prueba; regresión completa **618/618** (8,7 min) = las 617 de E4.3 + la nueva de reversión.

L5 PROCEDIMIENTO DE REVERSIÓN (exacto): `VITE_TEXT_EXPORT_MODE=raster npm run build` (en Windows: `set VITE_TEXT_EXPORT_MODE=raster`) produce un build donde el cliente exporta el SVG **raster** y el módulo vectorial ni se descarga. Para volver al vectorial: recompilar sin esa variable. La reversión es de **compilación**, no de runtime: en un build ya publicado el raster no se activa (ni por URL ni por error).

L6 Evidencia de la reversión, comprobada: (a) build de producción normal → el bundle principal **no** contiene `textExport` (la rama de desarrollo se elimina) y sólo el literal `"vector"`; (b) compilación aislada con `VITE_TEXT_EXPORT_MODE=raster` (outDir aparte en `test-results/`) → el cliente descarga el SVG **raster** (`scale(0.33…`) y **no** pide el chunk `vectorProductionExport`; (c) el build normal descarga el SVG **vectorial** (`translate(450 450) scale(1)`) y sí lo pide. El proyecto no se modifica: la reversión se compila aparte.

L7 Dos defectos reales encontrados y corregidos durante E4.4: (a) el módulo del modo leía `import.meta.env` **en el ámbito del módulo**, y `import.meta.env` no existe en Node (las pruebas importan `ConfirmPanel`): la importación reventaba y abortaba toda la suite. Ahora la lectura del override va en un `try/catch`; (b) al meter `import.meta.env.DEV` dentro de una función auxiliar, el optimizador **no** pudo eliminar la rama de desarrollo y el string `textExport` volvió al bundle de producción. La lectura tiene que quedar **literal y en línea** para que Vite la sustituya por `false` y el bloque se borre.

L8 Riesgo asumido y anotado: con el vectorial como predeterminado, **toda** exportación carga el motor de HarfBuzz (WASM) y compone el texto; si el motor o la fuente no están disponibles, la exportación **falla** (no hay archivo incompleto ni reserva al raster). Es el comportamiento pedido, y E5 sigue siendo la etapa que valida el resultado con el grabador real.
