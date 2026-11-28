# 0024 — Hosting de la API y los paneles

- **Estado:** Aceptada (API en Fly.io; paneles en Vercel todavía sin armar)
- **Fecha:** 2026-11-27

## Contexto
Hoy todo corre en la compu de desarrollo, salvo la base y el login, que ya están en Supabase. Para el piloto (G1–G4) hace falta una dirección pública con https: Mercado Pago no acepta `http` ni para el OAuth ni para los webhooks (ADR 0021), y las apps de prueba (EAS) tienen que hablar con una API que no dependa de esta compu.

Lo que pide la API (`services/api`):
- **Proceso siempre prendido.** Los workers corren dentro del proceso (vencimientos, outbox de push, reembolsos, ofertas, ubicaciones, reclamos, liquidación). Si el servidor se duerme por falta de tráfico, un pedido no vence a tiempo y un push no sale. Descarta los planes gratis que apagan el servicio y las funciones serverless.
- **Conexiones largas.** El realtime pendiente (SSE, SPEC §17) necesita conexiones abiertas de minutos, otra razón contra serverless.
- **Cerca de la base.** Cada request hace varias consultas a Postgres. Con la API en EE. UU. y la base en São Paulo, cada consulta suma unos 120 ms de ida y vuelta; un pedido con 10 consultas tardaría más de un segundo solo en red.
- **Varias instancias no son un problema.** Los workers toman filas con `SKIP LOCKED` y son idempotentes, así que una segunda máquina no duplica trabajo. Para el piloto alcanza con una.
- **Disco efímero alcanza.** En producción las fotos van a Supabase Storage (la config lo exige) y los tokens son de Supabase; la API no guarda nada en disco.
- **Cierre ordenado.** Ya maneja `SIGTERM`/`SIGINT`: frena los workers, cierra Fastify y la base.

Los paneles (`merchant-web`, `admin-web`) son Next 16 con server actions: cualquier host de Next sirve.

## Opciones consideradas (API)
Precios de noviembre de 2026 según fuentes de terceros; confirmarlos en la página de cada proveedor antes de pagar.

| | Fly.io | Railway | Render |
|---|---|---|---|
| Región en Sudamérica | **Sí, São Paulo (`gru`)** | No (EE. UU., Europa, Asia) | No (EE. UU., Frankfurt, Singapur) |
| Costo para 1 máquina chica siempre prendida | ~US$ 4–5/mes (shared-cpu-1x, 512 MB) | US$ 5 mínimo; ~US$ 10–15 con 0,5 vCPU y 512 MB todo el mes | US$ 7 (Starter, 0,5 CPU, 512 MB) |
| Plan gratis útil | No | No | Se duerme a los 15 min: no sirve |
| Deploy | `fly deploy` con Dockerfile; o desde GitHub Actions | Desde GitHub, muy simple | Desde GitHub, muy simple |
| Migraciones antes de arrancar | `release_command` | Comando de pre-deploy | Comando de pre-deploy |
| Contras | Más configuración (`fly.toml`, CLI); tuvo cortes de red en `gru` (nov. 2025, ago. 2026) | Lejos de la base; precio por uso, menos predecible | Lejos de la base; no se puede cambiar de región después |

Otras descartadas: Vercel Functions o Cloudflare Workers para la API (serverless, sin workers de fondo ni SSE cómodo); un VPS propio (más barato, pero parches, https y reinicios a mano).

## Decisión propuesta
- **API en Fly.io, región `gru` (São Paulo)**, siempre que el proyecto de Supabase esté en `sa-east-1` (São Paulo). Se ve en Supabase → Project Settings → General. Si estuviera en EE. UU., Railway o Render quedan a la par y conviene Railway por simpleza.
  - Una máquina `shared-cpu-1x` de 512 MB con `auto_stop_machines = "off"` y `min_machines_running = 1`.
  - `Dockerfile` en `services/api` que instala el workspace y arranca con `tsx` (como hoy en `npm start`). Empaquetar con esbuild queda para cuando el arranque o la memoria lo pidan.
  - `release_command = "npm run db:migrate -w @pedilo/api"`: las migraciones corren antes de cada versión nueva y, si fallan, no se publica.
  - Chequeo de salud en `/health`.
  - Base por el **pooler de Supabase en modo sesión** (puerto 5432), con `max` del cliente bajo (5) para no repetir el «max clients reached».
  - Variables como secrets de Fly: `NODE_ENV=production`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `MEDIA_STORAGE=supabase`, `ORDER_TOKEN_SECRET`, `VAPID_*`, `EXPO_ACCESS_TOKEN`, `MP_*`, `API_PUBLIC_URL`, `CORS_ORIGINS` (los dominios de los paneles), `TRUST_PROXY_HOPS=1`.
- **Paneles en Vercel**, dos proyectos (`merchant-web`, `admin-web`) con raíz en su carpeta del monorepo. El plan Hobby no permite uso comercial, así que con comercios reales hace falta Pro (US$ 20/mes). Alternativa si se quiere ahorrar: los dos paneles también en Fly (otra máquina chica cada uno).
- **Entornos:** uno solo, «staging», hasta el piloto. Usa el proyecto de Supabase actual, Mercado Pago en modo prueba y las apps apuntando a `https://<app>.fly.dev`. Producción (otro proyecto de Supabase, MP real, dominio propio) se arma antes de G4.
- **Deploy:** a mano con `fly deploy` al principio; después, desde GitHub Actions cuando el CI de `main` pasa.

## Consecuencias
- Hay una URL https fija: destraba la prueba real de Mercado Pago (G1) sin túnel, y los builds de EAS (G2) pueden probarse en la calle.
- Costo estimado del piloto: ~US$ 5/mes la API, más Vercel Pro si se usa con comercios reales; Supabase sigue en su plan actual.
- **Falta, del lado del usuario:** cuenta en Fly.io con tarjeta, confirmar la región de Supabase, y cargar los secrets (no pasan por el repo ni por el chat).
- **Hecho en el código:** `services/api/Dockerfile` (se construye desde la raíz del monorepo, corre con `node --import tsx`), `fly.toml` en la raíz (región `gru`, siempre prendida, migraciones como `release_command`, chequeo en `/health`) y `DB_POOL_MAX` para el tamaño del pool. `tsx` pasó a dependencia de la API porque se usa para arrancar. La imagen recorta el lockfile a los workspaces de la API (`services/api/scripts/prune-lockfile.mjs`) antes de `npm ci`: sin eso npm instalaba Expo y React Native (1,3 GB); así pesa ~500 MB.
- **Falta, del lado del código:** `EXPO_PUBLIC_API_URL` de las apps apuntando a la URL nueva en los perfiles de EAS.
- Monitoreo y backups probados siguen pendientes para G4.
