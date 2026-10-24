# Ejemplos y métricas del spike de tipografías (Etapa 4)

Copia de revisión de los artefactos que el runner escribe en
`test-results/spike-typography/` (ignorado por Git). Se regeneran con:

```
node node_modules/@playwright/test/cli.js test tests/spike-typography.spec.ts tests/spike-typography-kerning.spec.ts
```

## SVG de ejemplo (contornos reales en mm)

| Archivo | Qué es |
|---|---|
| `spike-poppins-semibold-{85x50,80x60,75x65}-B.svg` | Poppins SemiBold, estrategia B (espesor de banda), 3 virolas. Sin `<text>`, sin fuentes, sin referencias externas. |
| `spike-lato-semibold-{85x50,80x60,75x65}-B.svg` | Lato SemiBold (con kerning real), misma estrategia y mismos tamaños. |
| `hashes.txt` / `hashes-lato.txt` | SHA-256 de cada SVG: la salida es determinista byte a byte. |

## Métricas contra el navegador (Chromium/HarfBuzz)

| Archivo | Qué mide |
|---|---|
| `browser-compare-*.txt` | Poppins: longitud del texto y posición/rotación por glifo frente al `<textPath>` del navegador. |
| `visual-*.txt` | Poppins: comparación rasterizada (IoU, desviación tinta-tinta en mm, divergencia con tolerancia de 0,2 mm). |
| `lato-curved-*.txt` | Lato: longitud y posición/rotación por glifo, con y sin kerning. |
| `lato-pairs-browser.txt` | Lato: 961 pares de caracteres, avance del navegador vs `avance + kern + letter-spacing`. |
| `lato-visual-*.txt` | Lato: comparación rasterizada con y sin kerning real (control de sensibilidad). |

Los SVG de ejemplo **no cambian** al corregir el método de medición: sus hashes
son los mismos antes y después (el cambio afecta solo a cómo se *compara*, no a
lo que se genera).
