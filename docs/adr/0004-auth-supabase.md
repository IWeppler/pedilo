# 0004 — Autenticación con Supabase Auth, roles en nuestra base

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
Hay cuatro clientes (dos apps Android, dos webs) contra una sola API. Compradores y repartidores entran desde el celular (teléfono verificable, SPEC §4.1); comercios y admins desde la web. La base ya es Supabase Postgres (ADR 0003). La autorización debe resolverse siempre en el servidor y por pertenencia a comercio/sucursal (SPEC §5).

## Opciones consideradas
- **Supabase Auth** — login por OTP al teléfono, email/magic link y OAuth; SDK para Expo y web; emite JWT firmados con claves asimétricas verificables vía JWKS. Misma plataforma que la base.
- **Auth.js / Better Auth** — muy buenos dentro de una app Next.js, pero aquí la API es independiente y los clientes móviles necesitan tokens propios; habría que construir más piezas.
- **Auth propio** — control total, pero OTP, rotación de claves y seguridad de sesiones son trabajo y riesgo innecesarios.

## Decisión
- **Supabase Auth autentica** (quién sos). Los clientes obtienen el token con el SDK de Supabase y lo mandan como `Authorization: Bearer <token>`.
- **La API verifica** la firma con el JWKS del proyecto (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`), el emisor y la audiencia `authenticated`. No usa el secreto compartido legado.
- **Nuestra base autoriza** (qué podés hacer). Los roles viven en tablas propias (`users.platform_role`, y más adelante `merchant_members`), **no** en claims del token: un cambio de permisos rige en el próximo request, sin esperar a que el token expire.
- El usuario se crea en nuestra tabla `users` la primera vez que llega un token válido (`id` = `sub` de Supabase).
- **Desarrollo sin Supabase:** la API puede usar un par de claves local (`npm run dev:token -w @pedilo/api`) para firmar tokens de prueba. Ese modo está **prohibido en producción** por validación de configuración.

## Consecuencias
- Ningún cliente necesita secretos: solo la URL y la clave pública (`anon`) de Supabase.
- Hay que crear el proyecto Supabase antes de conectar las apps reales; mientras tanto se desarrolla con tokens locales.
- Verificar en la documentación vigente de Supabase la ruta exacta del JWKS y el formato de claims antes de producción.
