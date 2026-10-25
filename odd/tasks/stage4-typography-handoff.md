# Continuación — Etapa 4 (tipografías vectoriales)

**Estado al apagar el equipo (2026-10-24).** Documento de traspaso: retomar
exactamente desde aquí. **No hay trabajo a medias en el código**: la única
tarea deliberadamente pendiente es la habilitación de la exportación con texto
(que es la siguiente tarea y requiere autorización).

## 1. Git

```
Rama:      experiment/illustration-stencil
Sincronía: origin/experiment/illustration-stencil == 8f9683c (0/0, sin divergencia)
HEAD:      8f9683c feat(typography): add the shared vector typography engine and prepare the lab
```

Commits de la etapa (todos locales, el push de `8f9683c` lo hizo el usuario
desde PowerShell; este entorno **no tiene credenciales** de GitHub):

| Commit | Contenido |
|---|---|
| `679e1dc` | Etapa 3: admin de diseños, trabajos confirmados, laboratorio físico, export vectorial |
| `0eeadfc` | Spike de tipografías Poppins + Lato (motor propio, fuentes, ejemplos) |
| `bbd5177` | Documentación: evaluación de Dancing Script y hueco de GSUB |
| `6fcf928` | Spike de HarfBuzz validado (motor, harness, 14 tests) |
| `8f9683c` | Motor compartido `src/typography/` + adaptador de laboratorio aislado (22 archivos) |

**Commiteado** (Fase 3: catálogo de tipografías en el personalizador) —
commit local `feat(design): bundle the three OFL fonts as the personalizer
catalogue` (10 modificados + 3 nuevos; ver `git log`). El push lo hace el
usuario (este entorno no tiene credenciales). Contenido:

```
 M docs/production-lab.md
 M odd/tasks/stage4-typography.md
 M src/App.tsx                      (fuente por defecto de un texto nuevo)
 M src/components/DesignPanel.tsx   (el selector deriva del catálogo del motor)
 M src/export/textOutlines.ts       (sin fallback del sistema; espera a la fuente real)
 M src/main.tsx                     (importa styles/typography.css)
 M src/production-lab/exportTextOutlines.ts (evidencia del gate actualizada; CÓDIGO intacto)
 M src/production-lab/fixture.ts    (la demo usa una fuente del catálogo)
 M src/production-lab/typographyOutlines.ts  (comentario de paridad actualizado)
 M src/typography/README.md
?? src/styles/typography.css        (@font-face de las tres fuentes)
?? tests/typography-catalogue.spec.ts (9 tests)
```

`references/typography/` (captura) sigue **sin seguimiento y fuera de todo** ✓.
El commit es local: **no hacer push ni merge sin autorización**.

## 2. Qué está implementado

### 2.1 Motor vectorial (`src/typography/`, commiteado en `8f9683c`)

- `harfbuzz.ts`: shaping HarfBuzz (GSUB, GPOS, ejes variables) + contornos por
  glifo (`glyphToJson`) → glifos y contornos no pueden discrepar.
- `curved.ts`: geometría en el arco y serialización canónica en mm (1 µm).
  Las tres funciones son **byte-idénticas** a las del spike validado.
- `fonts.ts`: catálogo (Poppins SemiBold, Lato SemiBold, Dancing Script) con
  licencia y procedencia; binarios servidos desde `public/typography/`.
- `index.ts`: API `renderCurvedText()`; fallos explícitos, nunca sustitución.
- Carga diferida del WASM; `vite.config.ts` lo sirve en dev y lo emite como
  asset en build. El **bundle inicial no cambia** (357.603 B) y no menciona
  harfbuzz.

### 2.2 Laboratorio preparado y AISLADO (`8f9683c`)

- `src/production-lab/typographyOutlines.ts`: usa las medidas que el laboratorio
  ya calcula. **No está conectado al exportador**; el gate
  `FONT_OUTLINES_UNAVAILABLE` sigue bloqueando toda composición con texto.
- Mapeo de familia explícito (`catalogueFontForFamily`): sin sustitución.

### 2.3 Catálogo en el personalizador (sin commitear, Fase 3)

- `src/styles/typography.css`: `@font-face` de las tres fuentes con
  `font-display: block` (sin familia de reserva del sistema), importado desde
  `main.tsx`.
- El selector (`DesignPanel.tsx`) ofrece **exactamente** las tres fuentes
  aprobadas, derivadas de `TYPOGRAPHY_FONT_LIST` (editor y motor no pueden
  divergir).
- `App.tsx`: el texto nuevo nace con la primera familia del catálogo.
- `fixture.ts` (demo del laboratorio): usa una fuente del catálogo.
- `src/export/textOutlines.ts`: **sin sustitución silenciosa** (se quitó el
  `, sans-serif` y se espera a la fuente real antes de medir).
- `exportTextOutlines.ts`: el **código del gate no cambia**; sólo la evidencia
  (`LAB_FONT_BLOCK_EVIDENCE`) refleja que el bloqueo ya es deliberado, no técnico.
- Jobs, snapshots, admin y el resto del personalizador: **sin cambios**.

## 3. Pruebas ejecutadas (todas verdes)

| Corrida | Resultado |
|---|---|
| Catálogo (nuevo) | 9/9 |
| Motor (`typography.spec.ts`) | 5/5 |
| Paridad laboratorio (`production-lab-typography-parity.spec.ts`) | 4/4 |
| Focalizadas (catálogo + motor + paridad + manipulación + confirmación + 4 specs del laboratorio + export del producto) | **161/161** (2,2 min) |
| Typecheck (`tsc --noEmit`) | OK |
| Build del producto | OK (1,38 s): `@font-face` y las tres fuentes presentes en `dist/` |
| **Regresión completa** | **544/544** (6,2 min, 0 fallos) |

El entorno de pruebas es móvil por configuración (390×844, táctil) ✓ y hay un
test que lo comprueba.

## 4. Problemas pendientes / riesgos

1. **Exportación con texto real: NO habilitada (por decisión).** El gate
   `FONT_OUTLINES_UNAVAILABLE` bloquea las composiciones con texto. Es la
   siguiente tarea y necesita autorización.
2. **La paridad ya no está bloqueada por las fuentes**: con el catálogo
   empaquetado, editor, vista previa, laboratorio y confirmación pintan la
   misma fuente real; el motor compone sobre esa misma fuente. El test de
   paridad lo demuestra (desviación ≤ 0,2 mm; avance normalizado idéntico
   dentro del 0,1 %, que es la cuantización 1/64 px del navegador).
3. Sin `mark`/`mkmk`: el texto no NFC se rechaza con error explícito.
4. La paridad está medida para las **tres fuentes del catálogo**, no garantizada
   para cualquier fuente.
5. `public/typography/` no se versiona con hash: la invalidación de caché usa
   la query `?v1` (el CSS y `fonts.ts` deben coincidir; lo verifica un test).
6. Sin validación con el grabador real.
7. Este entorno **no puede hacer push** (sin credenciales): lo hace el usuario.

## 5. Trampas del entorno (no volver a pisarlas)

- **Finales de línea**: `package.json`, `package-lock.json` y `.gitignore` usan
  **CRLF**. Editarlos con Python (`write_text`) los convierte a LF y el diff
  muestra el archivo entero. Reconstruir desde `git show HEAD:<archivo>` (bytes)
  y aplicar el cambio mínimo.
- **Vite y binarios**: importar un `.ttf` como módulo hace que Vite intente
  transformarlo (y un `.ttf` no es JavaScript). Las fuentes van en
  `public/typography/`, no como imports.
- **`harfbuzzjs` y top-level await**: su entrypoint usa `await` a nivel de
  módulo, así que el optimizador de Vite (target por defecto) no lo puede
  reconstruir. Se importa dinámicamente con un especificador calculado en
  runtime y se sirve como asset con `optimizeDeps.exclude`.
- **Plugin de Vite**: capturar `config.command` en `configResolved` (en
  `buildStart` no existe `this.environment`) y emitir los assets con nombre
  estable junto al glue.
- **Playwright en WSL no funciona**: Vite necesita el binario nativo de rollup
  de Windows. Ejecutar con `cmd.exe /c 'cd /d C:\Mate^&Co && node
  node_modules\@playwright\test\cli.js test ...'` (con barras forward en los
  filtros de archivo; en `-g` evitar espacios).
- **El servidor de pruebas queda vivo** si se interrumpe una corrida:占用 el
  puerto 4175. Comprobar y cerrar (`netstat`/`taskkill`).

## 6. Próximos pasos (en orden)

1. ~~**Revisar y commitear la Fase 3** (catálogo)~~ → **hecho**: commit local
   con `git add` de rutas explícitas (nunca `git add .`); `references/typography/`
   excluida.
2. **Push** (lo hace el usuario).
3. **Siguiente tarea — habilitación de la exportación con texto** (requiere
   autorización explícita):
   - el motor es asíncrono y el exportador del laboratorio es **síncrono**:
     pasar los paths como datos (sin cambiar la firma) o pedir autorización
     para hacerlo asíncrono;
   - `exportTextOutlines.ts`: sustituir el veredicto por el resultado del
     motor, conservando el **fallo explícito** (glifo ausente, texto no NFC,
     fuente fuera de catálogo) y el bloqueo `FONT_OUTLINES_UNAVAILABLE` para lo
     que no se pueda reproducir;
   - `exportSvg.ts`: insertar los paths de texto en el grupo de grabado (sin
     `<text>`, sin raster, sin fuentes ni referencias externas);
   - tests: paridad preview↔export, determinismo (2 exports → bytes
     idénticos), medida en mm, bloqueo explícito, y el caso "texto en un
     trabajo real".
4. Sólo después, evaluating `CurvedText`/`JobSnapshotPreview` para una paridad
   completa del preview, y por último la validación con el grabador real.

## 7. Referencias

- `odd/tasks/stage4-typography.md`: specs, evidencia y log de las fases 0-3.
- `src/typography/README.md`: contrato del motor y coste de integración con Vite.
- `docs/production-lab.md`: estado del laboratorio frente al motor vectorial.
- `spikes/typography/README.md`: spike validado (Poppins, Lato, Dancing Script).
