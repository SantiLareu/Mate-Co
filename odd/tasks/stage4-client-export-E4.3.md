# E4.3 — Verificación de integración de E4 y reversión

Verifica que las mejoras de E4.1–E4.2 (autoajuste del texto, catálogo real y
fuentes embebidas en el trazador raster) conviven con el camino vectorial
experimental **sin activarlo**, y que el producto se puede volver atrás sin
tocar los datos. Base: `stage4-client-export-E4.2.md` (commit `d1b039a`).

## Specs

S1: "Comprobar el flujo completo: edición → autoajuste → confirmación → exportación raster/vectorial experimental."
S2: "Verificar las tres fuentes: Poppins, Lato y Dancing Script."
S3: "Probar textos normales, invertidos, rotados y largos."
S4: "Confirmar que las imágenes subidas, íconos y líneas decorativas se conservan."
S5: "Verificar que una fuente antigua genera un error accionable."
S6: "Verificar que una fuente no disponible no produce sustitución silenciosa."
S7: "Comprobar que el vectorial nunca cae automáticamente al raster."
S8: "Comprobar la reversión entre modos sin modificar snapshots ni pedidos."
S9: "Verificar el comportamiento en móvil y en un build de producción."
S10: "Revisar el coste de memoria de las fuentes embebidas en el raster e informar si aparece un problema real."
S11: "No cambiar DEFAULT_CLIENT_TEXT_EXPORT_MODE. No activar HarfBuzz por defecto. No modificar main. No alterar trabajos confirmados ni snapshots. No instalar dependencias. No hacer commit, push ni merge. No incluir references/typography/. No comenzar E4.4 ni E5."
S12: "Usar gentle-ai-worker sólo si es necesario implementar una corrección. Preferir verificaciones directas para lo que ya funciona. No lanzar auditorías ni jueces redundantes."

## Tasks

- [x] T1 (S1–S4, S9) — Spec nuevo `tests/export-e4-integration.spec.ts`: flujo real de la interfaz (`.add-text` → `.design-confirm` → `.export-svg`) en móvil, en modo raster y vectorial; las tres tipografías × cuatro variantes de texto en los dos caminos; imagen subida, ícono y líneas decorativas conservados.
- [x] T2 (S5, S6) — Tipografía antigua y tipografía no disponible en los dos caminos: código explícito, mensaje accionable y **ningún** SVG generado.
- [x] T3 (S7) — El camino vectorial falla de forma explícita y **no** descarga ningún SVG (no hay caída automática al raster).
- [x] T4 (S8) — Reversión raster → vectorial → raster **sin recargar** (el modo se resuelve en cada exportación): los pedidos guardados (IndexedDB) quedan idénticos.
- [x] T5 (S10) — Coste de memoria: la fuente se descarga y se embebe una sola vez por tipografía; el archivo exportado no lleva la fuente.
- [x] T6 (S5) — **Defecto corregido**: el mensaje `FONT_NOT_IN_CATALOGUE` del camino vectorial no decía qué tipografías elegir. Ahora lista las tres (fuente única: `catalogueFamilyList()` en `src/typography/catalogue.ts`).

## Log

L1 Petición original (verbatim): "Mate&Co — E4.3: verificación de integración y reversión" — "Verificar la integración completa de las mejoras de E4 sin activar todavía el exportador vectorial como predeterminado." — alcance S1–S12.

L2 Mapa del alcance: la mayoría de los puntos ya tenían cobertura (E4.1 autoajuste, E4.2 paridad raster, E3.1 integración opt-in, E3.1 build de producción). Los huecos reales eran la **reversión entre modos**, la **no-caída al raster**, la **conservación de assets** en los dos caminos y la **memoria**: se cubren con un spec nuevo (9 pruebas).

L3 Lo que NO se cambió: `DEFAULT_CLIENT_TEXT_EXPORT_MODE = "raster"`, `VECTOR_EXPORT_EXPERIMENTAL_ENABLED = false`, `main`, los snapshots, los trabajos confirmados y el laboratorio. `references/typography/` sigue fuera.

L4 Verificación: typecheck OK; build OK (362,02 kB); spec nuevo **9/9**; focalizadas (E4.3 + E4.2 + E4.1 + los 5 specs vectoriales + `export-production-svg` + `typography` ×2 + `confirm-design` + `direct-manipulation` + `jobs-*` ×3) **163/163** (3,7 min); regresión completa **617/617** (9,0 min) = las 608 anteriores + las 9 nuevas de E4.3.

L5 Memoria: binarios Poppins 154 kB, Lato 653 kB, Dancing Script 131 kB; embebidos en base64 ≈ 205 kB / 871 kB / 175 kB. La data URI se cachea por fuente y el binario se descarga una sola vez: el coste es **por tipografía**, no por texto trazado. Medido en el navegador: tres trazados seguidos de la misma tipografía no mueven el heap (delta reported por Chromium = 0 kB, por debajo de su resolución) y el SVG exportado no lleva la fuente dentro (< 200 kB de archivo). **No aparece un problema real**; queda medido para E5.

L6 Observación (no es defecto): el camino vectorial propaga el motivo crudo del motor ("Failed to fetch") en `FONT_UNAVAILABLE`, mientras el raster lo dice en español ("no se pudo cargar la tipografía…"). Ambos son explícitos y no sustituyen; unificar el texto queda fuera del alcance de E4.3.
