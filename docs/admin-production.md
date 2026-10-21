# Panel administrativo en producción (`/admin` + Cloudflare Access)

Estado: preparación. **Todavía no hay backend de biblioteca ni despliegue.**
Este documento define el contrato de puesta en producción del panel administrativo.

## Modelo de autorización

- Mate&Co tiene **un solo administrador** (el dueño). No hay tabla de usuarios,
  registro, roles, contraseñas propias, JWT propio ni autenticación en
  `localStorage` — y **no se van a implementar**.
- En producción, el panel en `/admin` se publica **siempre detrás de
  Cloudflare Access**. Cloudflare autentica al dueño **antes** de entregar la
  aplicación. La protección real **no depende del React frontend**: el frontend
  es contenido que Access ya filtró.
- Prohibido introducir autorización exclusivamente cliente (por ejemplo
  `localStorage.isAdmin = true`). Cualquier endpoint administrativo futuro debe
  validar autorización del lado del servidor además de Access.

## Desarrollo local

- En localhost (`http://localhost:5173/admin`) el panel funciona **directamente,
  sin Cloudflare Access**. No se autentica contra Cloudflare en desarrollo.
- No existen contraseñas falsas ni bypass secrets: en local simplemente no hay
  capa de autenticación; en producción la pone Access adelante.
- `/admin-lab` sigue existiendo como **alias de desarrollo** de la misma
  implementación (no hay dos paneles).

## Política de Cloudflare Access (manual, cuando se despliegue)

1. La aplicación `/admin` debe publicarse detrás de Cloudflare (por ejemplo
   Cloudflare Pages) con fallback SPA para que `/admin` sirva `index.html`.
2. Crear una aplicación **self-hosted** de Cloudflare Access cuyo dominio/path
   cubra **únicamente** la ruta administrativa (p. ej. `mateco.ejemplo/admin`).
   **No proteger el dominio entero** si solo queremos proteger `/admin`, salvo
   que más adelante se decida usar un subdominio administrativo dedicado
   (p. ej. `admin.ejemplo`).
3. Política: **deny-by-default** (Access ya lo es) con una única regla `Allow`
   que incluya **únicamente el email del dueño**. No incluir el email real ni
   secretos en este repositorio: se cargan en el dashboard de Cloudflare.
4. Método de login recomendado: **One-Time PIN por email**. No requiere
   identidad adicional del dueño y no exige integrar un IdP.
5. Verificar que sin sesión válida, `GET /admin` responde con la página de
   login de Access (no con la aplicación) y que los assets del panel no se
   sirven fuera del path protegido.

## Pasos manuales del dueño en Cloudflare (checklist)

1. Conectar el dominio a Cloudflare y desplegar la app (Pages).
2. Zero Trust → Access → Applications → **Add a self-hosted application**.
3. Domain/path: solo la ruta administrativa (p. ej. `mateco.ejemplo/admin`).
4. Add a policy: `Allow`, Include → Emails → **email del dueño** (solo ese).
5. Login methods: **One-time PIN**.
6. (Opcional, recomendado) Session duration corto y WAF rate-limit en `/admin*`.
7. Probar: incógnito → `/admin` debe pedir OTP; con el email del dueño → entra
   al panel; cualquier otro email → denegado.
8. Repetir la protección cuando existan endpoints administrativos (ver abajo).

## Futura API administrativa (NO implementada todavía)

Cuando exista backend para la biblioteca (listar diseños, subir SVG, editar
metadata, activar/desactivar, borrar, preparar SVG de producción), los
endpoints (p. ej. `/api/admin/*`) deberán:

- quedar cubiertos por la **misma política de Cloudflare Access** (mismo
  application/path o subdominio administrativo), y
- validar autorización del lado del servidor en cada request (Access header
  firmado por Cloudflare, p. ej. `Cf-Access-Jwt-Assertion`, verificado contra
  el team domain y la audiencia) — Access delante **no reemplaza** la
  validación server-side de cada endpoint.

Mientras no exista backend, la biblioteca sigue siendo local
(`localStorage`, clave `mateco.admin-lab.designs.v1`, modelo v3 sanitizado).

## Resumen

| Contexto | Entrada | Autenticación |
| --- | --- | --- |
| Desarrollo local | `http://localhost:5173/admin` (o `/admin-lab`) | ninguna (sin Access) |
| Producción | `https://<dominio>/admin` | Cloudflare Access, deny-by-default, OTP, solo email del dueño |
| Backend futuro | `/api/admin/*` | Access + verificación JWT server-side |
