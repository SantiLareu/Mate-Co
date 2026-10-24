# Procedencia — Lato SemiBold (spike Etapa 4, prueba de kerning)

| Campo | Valor |
|---|---|
| Familia / variante | Lato SemiBold (static TTF, peso 600), PostScript `Lato-SemiBold` |
| Versión del binario | 2.015 (name table: `Version 2.015`) |
| Unidades por em | 2000 |
| Origen oficial de distribución | https://github.com/google/fonts/tree/main/ofl/lato (Google Fonts) |
| Proyecto upstream | LatoGFVersion (tyPoland / Łukasz Dziedzic) |
| Commit de google/fonts que **agregó** el archivo | `f3b885d5590e307e02542f1a724cec55d567fdaa` (2016-12-02, "lato: v2.015 added (#479)") |
| Estado del path en google/fonts | `ofl/lato/Lato-SemiBold.ttf` tiene **un solo commit** en todo el historial del repositorio: el archivo no fue modificado desde 2016 |
| Blob git del archivo | `3b1bcccc3384aef84a68242e331e1018c8e141e0` (idéntico al introducido por ese commit) |
| Tamaño | 668 548 bytes |
| SHA-256 | `71B8B7DECBE75A881ED267BE539D402BD1E9420B799658AADA4E0D1BD5AF803C` |
| Licencia | SIL Open Font License 1.1 (`OFL.txt`, copia de google/fonts) |
| Copyright | Copyright (c) 2010-2014 by tyPoland Łukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato" |
| Reserved Font Name | **Sí: "Lato"** (primera línea de `OFL.txt`) |

## Verificación realizada (2026-10-24)

- **SHA-256 por comparación byte a byte contra la distribución oficial**: el archivo local
  y el descargado de `raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-SemiBold.ttf`
  (668 548 bytes) producen el mismo SHA-256
  `71B8B7DECBE75A881ED267BE539D402BD1E9420B799658AADA4E0D1BD5AF803C`. El hash ya estaba
  pineado por test en `tests/spike-typography-kerning.spec.ts`.
- **Blob git**: `git hash-object` del archivo local = `3b1bcccc3384aef84a68242e331e1018c8e141e0`,
  igual al blob que agregó `f3b885d5590e…` → el binario no fue alterado.
- **`OFL.txt` y `METADATA.pb`**: hashes idénticos a los oficiales
  (`74ba064d03f1f1c4a952da936c3eb71866c34404916734de3cae73b34357e59e` y
  `b01e6d38725c22f991321800baf7a71af2dca3a381184eb80557c5308d5e34c5`).
- **Commit**: el commit que introduce el archivo **sí** está identificado y es
  `f3b885d5590e…`. Esto **corrige** `upstream_info.md` (nota de onboarding de
  google/fonts) que declaraba `missing_commit` / confianza `MEDIUM` e infería por
  correlación de fechas el commit `080cb69…` del repo de fuentes: ese commit es el
  HEAD del repo de fuentes, no el del archivo binario distribuido. El archivo local
  conserva `upstream_info.md` y `FONTLOG.txt` tal como llegaron, sin modificarlos.

## Obligaciones OFL a respetar si se integra

- La licencia exige conservar `OFL.txt` y el copyright junto a la fuente.
- **Reserved Font Name "Lato"**: cualquier versión modificada, recortada (subset) o
  renombrada **debe usar un nombre distinto** de "Lato". Un subset o una conversión
  no puede seguir llamándose Lato.
- Lato es marca registrada de tyPoland; no se distribuye la fuente por separado.
- Los derivados siguen bajo OFL 1.1.

## Pendiente

- El commit upstream de las **fuentes** (LatoGFVersion `080cb69…`) sigue inferido por
  correlación de fechas. No afecta a la redistribución de esta copia —que es la de
  google/fonts, con commit y hash verificados— pero queda documentado como no verificado.
- No se contrastó byte a byte contra el release original de tyPoland/LatoGFVersion.
