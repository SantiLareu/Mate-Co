# Procedencia — Dancing Script (variable) — spike Etapa 4

Fuente **variable** usada para evaluar el eje de peso (`wght`) y la sustitución
contextual. El estático `DancingScript-Bold.ttf` **ya no se distribuye** en
google/fonts (se retiró en 2019); queda sólo en el historial del repositorio.

| Campo | Valor |
|---|---|
| Familia / variante | Dancing Script (variable), eje `wght` 400–700 (por defecto 400) |
| Arte | Impallari Type |
| Fuente upstream | https://github.com/googlefonts/DancingScript @ `291f87c05206179b6bfd53735a5638b5cc84e3b3` |
| Distribución oficial | https://github.com/google/fonts/tree/main/ofl/dancingscript |
| Fichero | `DancingScript[wght].ttf` (133 636 bytes) |
| SHA-256 | `21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c` |
| Licencia | SIL Open Font License 1.1 (`OFL.txt`) |
| Copyright | Copyright 2016 The Dancing Script Project Authors (https://github.com/googlefonts/DancingScript), with Reserved Font Name 'Dancing Script'. |
| **Reserved Font Name** | **Sí: "Dancing Script"** (primera línea de `OFL.txt` y del `METADATA.pb`) |
| Glifos / upm | 643 glifos, 1000 unidades por em |
| Subsets declarados | latin, latin-ext, vietnamese, menu |
| Eje variable | `wght` 400–700 |

## Verificación realizada (2026-10-24)

- **SHA-256 verificado byte a byte** contra la distribución oficial de
  google/fonts (`main`): el fichero descargado y el versionado aquí producen
  `21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c`.
- **Historial**: la ruta `ofl/dancingscript/DancingScript[wght].ttf` se añadió en
  google/fonts dentro del commit que introduce la fuente variable; el estático
  `DancingScript-Bold.ttf` existe en el historial (`1b408cfce4dd`, 2016-12-02,
  122 748 bytes, SHA-256 `16ccbad9c1534d114efc2d3317f9f489ec853a233b6ffefd67261d9aeeb96ab6`)
  pero **no se usa aquí**: no es la distribución vigente.
- **Cobertura del español**: 100 % (áéíóúüñÁÉÍÓÚÜÑ¿¡ y ASCII presentes,
  medido con `nominalGlyph` sobre el binario).
- **Comportamiento medido contra Chromium**: la sustitución contextual de `or`
  (+4,013 px = 4,0 % del em) y el eje `wght` (400/600/700) se reproducen con
  HarfBuzz; el `kern` de esta fuente usa `lookupFlag 8` con GDEF presente, que el
  lector GPOS propio del spike rechaza (`KERNING_UNSUPPORTED`) y HarfBuzz aplica.

## Obligaciones OFL a respetar si se integra

- Conservar `OFL.txt` y el copyright junto a la fuente.
- **Reserved Font Name "Dancing Script"**: cualquier versión modificada,
  recortada o renombrada **debe usar otro nombre**.
- Lato es marca de tyPoland; Dancing Script pertenece a The Dancing Script
  Project Authors.
- Los derivados siguen bajo OFL 1.1.

## Pendiente

- El commit exacto de google/fonts que introdujo el fichero **variable** no
  quedó identificado con el mismo rigor que el de Lato (se comprobó el
  `repository_url` y el `commit` de las fuentes en `METADATA.pb`, que es la
  fuente de verdad del binario). Documentado como pendiente.
