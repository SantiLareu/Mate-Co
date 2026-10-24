# Procedencia — Poppins SemiBold (spike Etapa 4)

| Campo | Valor |
|---|---|
| Familia / variante | Poppins SemiBold (static TTF, peso 600), PostScript `Poppins-SemiBold` |
| Versión | 4.004 (hotfix sobre 4.003) |
| Origen oficial de distribución | https://github.com/google/fonts/tree/main/ofl/poppins (Google Fonts) |
| Proyecto upstream | https://github.com/itfoundry/Poppins (Indian Type Foundry) |
| Commit de google/fonts que introdujo el archivo | `7dc16b7de42db624b902f2292b68ed9e489e5053` (2020-06-23, "Poppins: 4.004 Added") |
| Descarga | `https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-SemiBold.ttf` (157 312 bytes), 2026-10-23 |
| SHA-256 | `D3BF1BDAF0550E83DA9AC0B1D1D9FE6DB086835A83AA28578E609A394B9A0286` |
| Licencia | SIL Open Font License 1.1 (`OFL.txt`, copia de google/fonts) |
| Copyright | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins) |
| Reserved Font Name | Ninguno declarado en la línea de copyright de `OFL.txt` |
| Subconjuntos (METADATA.pb) | devanagari, latin, latin-ext, menu |

## Verificación

- Hash fijado y comprobado por test (`tests/spike-typography.spec.ts`).
- El `OFL.txt` y `METADATA.pb` se descargaron del mismo árbol de google/fonts.
- El archivo no se modificó (ni subconjunto ni conversión).
- Verificación realizada contra el repositorio oficial por descarga directa;
  no se contrastó byte a byte con el release de itfoundry/Poppins.
- Cobertura probada por test: `áéíóúüñÁÉÍÓÚÜÑ¿¡&.,-:;!?()`, dígitos y A–Z/a–z, más `·` y espacio.

## Obligaciones OFL a respetar si se integra

Conservar `OFL.txt` y el copyright junto a la fuente; no vender la fuente sola;
derivados bajo OFL y sin el Reserved Font Name si existiera.
