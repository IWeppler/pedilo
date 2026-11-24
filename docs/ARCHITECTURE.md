# Pedilo — Arquitectura

Cómo está organizado el código y qué reglas lo mantienen ordenado. El **qué** del producto está en [`SPEC.md`](SPEC.md) (§14 y §15 son la referencia técnica); este documento explica el **cómo** del repo.

## 1. Vista general

```text
 ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
 │ customer-mobile  │  │  courier-mobile  │  │   merchant-web   │  │    admin-web     │
 │ Android (Expo)   │  │  Android (Expo)  │  │  Next.js (web)   │  │  Next.js (web)   │
 │ Compradores      │  │  Repartidores    │  │  Comercios       │  │  Equipo Pedilo   │
 └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
          │      HTTPS REST (OpenAPI /api/v1) + realtime autenticado        │
          └─────────────────────┴──────────┬──────────┴─────────────────────┘
                                           ▼
                        ┌────────────────────────────────────┐
                        │            services/api            │
                        │  Node.js + TypeScript, monolito    │
                        │  modular (orders, deliveries, ...) │
                        └───┬──────────────┬─────────────┬───┘
                            ▼              ▼             ▼
                      PostgreSQL       Workers      Proveedores externos
                      (Supabase)       durables     (Mercado Pago, FCM,
                                                     storage, Sentry)
```

- **Una sola API** es dueña de los datos y de las reglas de negocio. Las apps solo muestran y piden; nunca deciden un cobro, una asignación ni un cambio de estado por su cuenta.
- **Ninguna app habla directo con la base de datos** ni con Mercado Pago con credenciales del servidor.
- Las webs de Next.js **no usan Server Actions como backend**: consumen la misma API que las apps móviles.

## 2. Estructura del monorepo

Un solo repositorio con **npm workspaces**. Cada app es independiente (su `package.json`, sus scripts, su deploy) pero comparten dependencias instaladas y código de `packages/`.

```text
pedilo/
  apps/
    customer-mobile/   Expo SDK 58 + Expo Router — app del comprador
    courier-mobile/    Expo SDK 58 + Expo Router — app del repartidor
    merchant-web/      Next.js 16 — panel del comercio (PC y celular)
    admin-web/         Next.js 16 + shadcn/ui — panel interno (ciudades y categorías)
  services/
    api/               Fastify + Drizzle + PostgreSQL — API única
  packages/
    domain/            Tipos, estados y reglas puras compartidas (con tests)
    api-client/        Cliente tipado generado desde OpenAPI
    web-utils/         Helpers de las webs Next: formularios, montos, textos y formatos
    config/            tsconfig, ESLint y Prettier base         [pendiente]
  docs/
    SPEC.md            Especificación (fuente de verdad)
    ARCHITECTURE.md    Este documento
    adr/               Decisiones de arquitectura numeradas
    archive/           Versiones anteriores del spec
  package.json         Raíz del workspace (scripts dev:*)
```

| Workspace | Paquete npm | Usuarios | Deploy | Puerto dev |
|---|---|---|---|---|
| `apps/customer-mobile` | `@pedilo/customer-mobile` | Compradores | Google Play (EAS Build) | 8081 (Metro) |
| `apps/courier-mobile` | `@pedilo/courier-mobile` | Repartidores | Google Play (EAS Build) | 8082 (Metro) |
| `apps/merchant-web` | `@pedilo/merchant-web` | Comercios | Vercel | 3000 |
| `apps/admin-web` | `@pedilo/admin-web` | Admin Pedilo | Vercel (acceso restringido) | 3001 |
| `services/api` | `@pedilo/api` | — | A definir (ADR) | 4000 |

## 3. Reglas de dependencia

1. **Las apps pueden importar de `packages/*`; nunca de otra app.** Si dos apps necesitan lo mismo, se mueve a un paquete.
2. **`packages/*` nunca importa de `apps/*` ni de `services/*`.**
3. **`packages/domain` es puro:** sin React, sin acceso a red ni a base de datos. Solo tipos, constantes y funciones deterministas (p. ej. transiciones de estado válidas, cálculo de comisión por tramos). Así lo pueden usar la API y las apps sin arrastrar dependencias.
4. **La API es la autoridad.** `packages/domain` permite mostrar en la app lo que *probablemente* pase (p. ej. el total estimado), pero el valor que vale es siempre el que devuelve el servidor.
5. **Versiones alineadas:** React es la misma versión en todas las apps (hoy 19.3.0) para que npm no instale copias duplicadas. En apps Expo, las dependencias se agregan con `npx expo install <paquete>` dentro de la app, que elige versiones compatibles con el SDK.
6. **Secretos solo en `services/api`.** Las apps solo tienen variables públicas (`EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`), como la URL de la API.

### 3.1 `packages/domain`

Se consume como código TypeScript sin compilar (`"main": "./src/index.ts"`): Metro y Turbopack lo transpilan solos, así que no hay paso de build. Para que funcione en cualquier app: imports relativos sin extensión, sin literales BigInt (`BigInt(0)` en vez de `0n`) y sin APIs de DOM ni de Node.

| Archivo | Contenido |
|---|---|
| `state-machine.ts` | `defineStateMachine`: transiciones declarativas, `canTransition`, `assertTransition`, `isTerminal` |
| `money.ts` | Centavos enteros (`MinorUnits`), puntos básicos, redondeo half-up único, `formatARS` |
| `orders.ts` | `OrderStatus`, `FulfillmentType`, transiciones según retiro/envío, traducción de estados del delivery al pedido |
| `payments.ts` | `PaymentMethod`, `PaymentStatus` (incluye reembolsos), `CashCollector` |
| `deliveries.ts` | `DeliveryStatus`, `DeliverySource`, regla de no revelar la dirección antes de asignar. **No importa nada de `orders.ts`** |
| `claims.ts` | `ClaimStatus`, `ClaimReason` |
| `pricing.ts` | Comisión por tramos marginales con tope por rubro, planes y `LAUNCH_PRICING_HYPOTHESIS` (hipótesis v0.4, no precios aprobados) |

Tests con Vitest: `npm test` desde la raíz o `npm test -w @pedilo/domain`. Incluyen los casos de borde de comisión del SPEC §6.2 y chequeos de integridad de cada máquina de estados (todo estado llega a un terminal, sin transiciones a estados inexistentes).

### 3.2 `packages/api-client`

Tipos generados con `openapi-typescript` desde `services/api/openapi.json` (`src/schema.ts`, no se edita a mano) y cliente `openapi-fetch`: rutas, parámetros, bodies y respuestas se chequean al compilar.

```ts
const api = createApiClient({ baseUrl, getToken });
const cities = await unwrap(api.GET("/v1/cities"));          // City[] o lanza ApiError
const errors = fieldErrors(err);                              // { name: "…" } para formularios
```

Exporta además tipos de conveniencia (`City`, `Category`, `Me`, `CreateCityBody`, …) y `ApiError` con `status`, `code` y `details`.

**Cuando cambia la API:** `npm run api:contract` desde la raíz regenera `openapi.json` y los tipos del cliente; TypeScript marca en las apps lo que haya que ajustar. Usa TypeScript 5.9 porque `openapi-typescript` todavía no soporta la 6.

## 4. Backend: monolito modular

`services/api` es un único proceso desplegable, dividido en módulos con límites claros (lista completa en SPEC §14.1). Reglas:

- Cada módulo es dueño de sus tablas. **Ningún módulo lee ni escribe tablas de otro**; se comunica llamando a la interfaz pública del otro módulo o mediante eventos. Ejemplo: `merchants` valida el rubro con `catalog.getCategory()` y la ciudad con `geography.getCity()`, y obtiene el email del dueño con `identity.getUserSummaries()`.
  - **Única excepción:** un `schema.ts` puede importar la tabla de otro módulo solo para declarar una foreign key (`.references()`), nunca para consultarla.
- **Pertenencia a comercio:** las rutas de un comercio verifican que el usuario sea miembro (`merchant_members`). Si no lo es, responden **404** (no 403), para no revelar qué comercios existen.
- Módulos con lógica compleja (`orders`, `deliveries`, `payments`, `billing`) se dividen en capas `domain` / `application` / `infrastructure`.
- Los efectos hacia afuera (push, webhooks, emails) salen por **outbox** y los procesan **workers durables** con reintentos. Nada crítico queda solo en memoria.
- Los webhooks entrantes (Mercado Pago) pasan por `webhook_inbox` con deduplicación por `event_id`.

### 4.1 Pedido y reparto desacoplados

Es la decisión de arquitectura más importante del dominio (SPEC §9.0).

- **`orders`** sabe qué se compró, a quién, cuánto cuesta y cómo se paga.
- **`deliveries`** sabe qué se transporta, de dónde a dónde, quién lo lleva y cuánto se le paga. Tiene `order_id` **opcional** y guarda copias (snapshots) de direcciones y contacto.

```text
 orders                         deliveries                     courier-mobile
   │                                │                                │
   │ pedido ACCEPTED / READY        │                                │
   │── RequestDelivery(snapshot) ──▶│ DELIVERY_NEEDED → OFFERED      │
   │                                │──── oferta (sin dirección) ───▶│
   │                                │◀──────── acepta ───────────────│
   │                                │ ASSIGNED (atómico)             │
   │◀── DeliveryAssigned ───────────│                                │
   │                                │◀── retiró / entregó ───────────│
   │◀── DeliveryPickedUp ───────────│ PICKED_UP → DELIVERED          │
   │◀── DeliveryDelivered ──────────│                                │
   │ pedido DELIVERED               │                                │
```

- `orders` traduce los eventos de `deliveries` a su propio estado; nunca consulta las tablas de reparto.
- Cancelar un pedido envía `CancelDelivery`; `deliveries` decide según su estado (sin asignar → cancela; en curso → compensación).
- En el MVP solo `orders` crea deliveries. En el futuro un comercio podrá crear deliveries sin pedido (`source = MERCHANT_REQUEST`) sin cambiar el modelo.

### 4.2 Estructura de `services/api`

Stack: Fastify 5 + Zod (ADR 0002), Drizzle + PostgreSQL (ADR 0003), Supabase Auth (ADR 0004), convenciones de ADR 0005.

```text
services/api/
  src/
    app.ts              buildApp(deps): plugins, errores, auth y registro de módulos (sin abrir puertos)
    server.ts           arranque real: config, base, verificador de tokens, listen
    config.ts           variables de entorno validadas con Zod
    auth.ts             elige verificador de tokens: Supabase (JWKS) o claves locales de dev
    db/
      client.ts         tipos Db / Tx y conexión postgres.js
      schema.ts         agregador de las tablas de todos los módulos (para drizzle-kit)
      migrate.ts        aplica las migraciones de drizzle/
      seed.ts           datos iniciales de dev (Tostado + 5 rubros), idempotente
    lib/                errores con forma estable, slugs, esquemas Zod comunes, timestamps
    modules/
      identity/         users, verificación de tokens, plugin de auth, GET /v1/me
      audit/            audit_logs y recordAudit()
      geography/        cities: público + /v1/admin/cities
      catalog/          categories: público + /v1/admin/categories
      merchants/        comercios, miembros, sucursales, horarios, zonas; alta y revisión (/v1/merchants, /v1/admin/merchants)
      menu/             secciones, productos, variantes, modificadores (/v1/merchants/:id/menu) y menú público (/v1/public/merchants/:slug)
      orders/           pedidos (ADR 0007): crear como invitado, seguimiento con token, cancelar; tablero y estados del comercio
    scripts/            dev-token, grant-admin, openapi
  drizzle/              migraciones SQL generadas (se commitean)
  test/                 tests de integración con PGlite + app.inject()
  openapi.json          contrato generado (se commitea)
  docker-compose.yml    Postgres 17 local en el puerto 5433
```

**Cada módulo** tiene `schema.ts` (sus tablas), `service.ts` (reglas y acceso a datos, recibe `Db` y un `Actor`) y `routes.ts` (plugin Fastify con esquemas Zod, sin lógica de negocio).

**Recorrido de un request:**
1. Hook global `onRequest` del plugin de auth: si hay `Authorization: Bearer`, verifica el token, crea o carga el usuario y deja `request.auth`. Token inválido → 401 aunque la ruta sea pública.
2. Hook `onRequest` de la ruta (`requireAuth` / `requireAdmin`): corta con 401/403 **antes** de leer el body, así un anónimo no aprende la forma de los endpoints de admin.
3. Validación Zod del body/query/params → 400 `VALIDATION_ERROR` con detalle por campo.
4. Handler → servicio. Las mutaciones de admin corren en una transacción que también escribe `audit_logs`.
5. La respuesta se valida contra su esquema; si no coincide es un bug nuestro y devuelve 500 (se loguea).

**Agregar un módulo nuevo:** crear `modules/<nombre>/{schema,service,routes}.ts`, exportar el schema en `db/schema.ts`, registrar las rutas en `app.ts`, correr `npm run db:generate -w @pedilo/api` y revisar el SQL generado, escribir tests en `test/` y regenerar `openapi.json`.

**Pendiente para producción:** empaquetar la API (hoy corre con `tsx`) y elegir hosting (ADR pendiente).

## 5. Apps móviles

- **Expo Router** con rutas en `src/app/`; componentes, hooks y utilidades fuera de esa carpeta.
- **TanStack Query** para datos del servidor (caché, reintentos, sincronización al volver la conexión).
- **Offline:** se puede *consultar* lo cacheado (catálogo, carrito, viaje asignado) con indicación de antigüedad. Las acciones críticas se encolan con `idempotency_key` y se muestran como **pendientes de confirmación** hasta que la API responde. Nunca se muestra como confirmado un pago, una aceptación de oferta ni una entrega sin respuesta del servidor.
- **Push** (FCM) es un aviso, no la fuente de verdad: al abrir la app siempre se resincroniza con la API.
- **Expo Go vs development build:** durante el desarrollo inicial se usa Expo Go. Al agregar push notifications o módulos nativos fuera de Expo Go, se pasa a una development build con EAS Build.

### 5.1 `apps/customer-mobile`

Pantallas (Expo Router, `src/app/`):

| Ruta | Qué hace |
|---|---|
| `/city` | Elegir ciudad; queda guardada en el teléfono |
| `/` | Comercios de la ciudad (`GET /v1/public/cities/:slug/merchants`): abiertos primero, búsqueda por nombre y filtro por rubro |
| `/merchant/[slug]` | Menú del comercio (`GET /v1/public/merchants/:slug`): estado abierto/cerrado, dirección, envío, secciones y búsqueda |
| `/product/[slug]/[productId]` | Modal del producto: variante, opciones, aclaraciones, cantidad y precio en vivo con `priceSelection`; agrega al carrito |
| `/cart` | Checkout: líneas editables, retiro o envío (zona, dirección), datos de contacto, total y «Confirmar pedido» (`POST /v1/public/orders` con `Idempotency-Key`) |
| `/order/[id]` | Seguimiento con el token guardado: estado, pasos, motivo de rechazo, cancelar antes de la aceptación. Se refresca cada 10 s |
| `/orders` | Pedidos hechos desde este teléfono |

- **Carrito** (`src/lib/cart.tsx`): un solo comercio (agregar de otro pide reemplazarlo), guardado en el teléfono. Los precios son estimados; la API los recalcula.
- **Mis pedidos** (`src/lib/my-orders.tsx`): id + token de seguimiento de cada pedido (ADR 0007) y los datos de contacto/dirección para no retipearlos.

- **URL de la API** (`src/lib/config.ts`): `EXPO_PUBLIC_API_URL` si está definida; si no, el mismo host desde donde Expo sirve la app (`Constants.expoConfig.hostUri`) con el puerto 4000. Así Expo Go en el celular llega a la API de la notebook sin configurar nada.
- **Datos:** TanStack Query (`src/lib/api.ts`), con `staleTime` corto para «abierto ahora».
- **Almacenamiento:** `src/lib/storage.ts` usa `expo-sqlite/kv-store` (incluido en Expo Go); `storage.web.ts` usa `localStorage` para probar en el navegador sin configurar WebAssembly.
- **Web solo para probar:** `npx expo start --web` (salida `single`, sin SSR). La app objetivo es Android.
- **Pendiente:** login del comprador (Supabase), pedidos programados, push. En web el seguimiento no refresca con la pestaña oculta (TanStack Query pausa el polling); en el celular refresca mientras la app está abierta.

## 6. Webs (Next.js)

- `merchant-web` y `admin-web` son apps separadas: distinto público, distinto nivel de acceso y deploy independiente.
- Consumen la API vía `packages/api-client`; la sesión se valida en la API.

### 6.1 `apps/admin-web`

- **Datos y mutaciones del lado del servidor.** Server Components leen con `adminCall()` (`lib/api.ts`) y los formularios llaman Server Actions que hacen el `POST`/`PATCH` a la API. Las Server Actions son una capa fina: arman el body y traducen errores; la validación y los permisos los decide la API.
- **Sesión:** el token vive en una cookie `httpOnly` (`pedilo_admin_token`), nunca en el JS del navegador. `proxy.ts` hace un chequeo optimista (sin cookie → `/login`); la validación real la hace la API en cada llamada. Si la API responde 401/403, `adminCall` redirige a `/login?reason=expired|forbidden`.
- **Login:** hoy se pega un token de desarrollo (`npm run dev:token -w @pedilo/api -- --admin`). Con Supabase se reemplaza por login con email y hay que sumar el refresh del access token.
- **Cache Components (Next 16):** todo lo que lee cookies, `searchParams`, `params` o `usePathname` va dentro de un `<Suspense>`; `adminCall` llama a `connection()` porque los datos del panel siempre son de tiempo de request.
- **Formularios:** `useActionState` + `<select>` nativos (entran directo en `FormData`). Al volver con errores, el `<form>` se remonta con `key` para que selects y checkboxes muestren lo enviado (React 19 resetea el form tras la acción).
- **UI:** shadcn/ui (estilo base-nova sobre Base UI) en `components/ui/`; se agregan con `npx shadcn@latest add <componente>` dentro de la app.
- Variables: `API_URL` (solo servidor), ver `.env.example`.
- Secciones: **Comercios** (cola de revisión, detalle, aprobar/rechazar con motivo), **Ciudades**, **Categorías**.

### 6.2 `apps/merchant-web`

Misma arquitectura que el admin (Server Components + Server Actions finas, token en cookie `httpOnly` `pedilo_merchant_token`, `proxy.ts`, Cache Components). Flujo de alta (SPEC US-101/102/401):

1. `/onboarding`: datos del comercio (nombre, rubro, razón social, CUIT con dígito verificador, contacto) → queda en **borrador**.
2. `/m/[id]`: estado, checklist que calcula la API (`onboarding.problems`) y botón **Enviar a revisión** cuando está completo.
3. `/m/[id]/branches/[branchId]`: horario semanal (horario cortado, cierre después de medianoche, "copiar lunes a…"), zonas de envío con tarifa y mínimo en pesos, y datos de la sucursal.
4. Revisión en el admin → **aprobado**, o **rechazado** con motivo visible para el comercio, que corrige y reenvía.

Reglas de edición (las aplica la API, la UI las refleja): en revisión o suspendido no se edita nada; aprobado solo nombre visible, contacto y la operación (sucursales, horarios, zonas).

**Catálogo** (`/m/[id]/menu`, ADR 0006): secciones propias, productos con variantes (precio propio) y grupos de opciones (mínimo/máximo, recargo, cantidad por opción), pausar/reanudar y archivar. Se puede armar desde el borrador; los clientes lo ven recién con el comercio aprobado. El editor de productos es un componente cliente controlado (`components/product-editor.tsx`) que envía el producto completo como JSON; los errores de reglas que devuelve la API se muestran con nombre («Grupo «Extras»: el grupo no tiene opciones»).

- El editor de horarios envía con `onSubmit` + `startTransition` en lugar de `<form action>`: el reseteo automático de formularios de React 19 desmarcaba los checkboxes controlados.
- Los componentes chicos de UI (`form-field`, `native-select`, `submit-button`, `page-header`…) están copiados en las dos webs, como es habitual con shadcn. Si crecen, pasarlos a un `packages/ui`.

**Pedidos** (`/m/[id]/orders`, ADR 0007): tablero «En curso» (nuevos arriba, resaltados) y «Finalizados». Cada pedido muestra cliente, teléfono, entrega, ítems con opciones y aclaraciones, total en efectivo, y las acciones válidas según `merchantOrderActions` (@pedilo/domain); rechazar/cancelar piden motivo, que ve el cliente. Se refresca cada 10 s con la pestaña visible y muestra los nuevos en el título. Realtime, sonido y push quedan para después (SPEC §10).

### 6.3 `packages/web-utils`

Código puro compartido por las dos webs: estado y helpers de formularios (`FormState`, `errorToFormState`, `formKey`), lectura de montos en pesos (`parsePesosToMinor` acepta `1.500,50`), etiquetas de estados y del checklist, horario agrupado por día y formato de fechas en hora de Argentina.
- UI con Tailwind CSS v4 + shadcn/ui; formularios con React Hook Form + Zod.
- El panel del comercio usa avisos redundantes (realtime + sonido + push + polling), ver SPEC §10.
- Antes de escribir código de Next.js, leer la guía de la versión instalada en `node_modules/next/dist/docs/` (ver `apps/merchant-web/AGENTS.md`).

## 7. Desarrollo local

Todo se instala una sola vez desde la raíz:

```bash
npm install
```

| Comando (desde la raíz) | Qué hace |
|---|---|
| `npm run dev:customer` | Metro de la app cliente; QR para Expo Go (puerto 8081) |
| `npm run dev:courier` | Metro de la app repartidor; QR para Expo Go (puerto 8082) |
| `npm run dev:merchant` | Panel del comercio en http://localhost:3000 |
| `npm run dev:api` | API en http://localhost:4000 (docs interactivas en `/docs`) |
| `npm run dev:admin` | Panel admin en http://localhost:3001 (necesita la API corriendo) |
| `npm run api:contract` | Regenera `openapi.json` y los tipos de `packages/api-client` |
| `npm run typecheck` | Typecheck de todos los workspaces que lo tengan |
| `npm run build:merchant` | Build de producción del panel |
| `npm run lint` | Lint de todos los workspaces |
| `npm test` | Tests de todos los workspaces que tengan (hoy: `packages/domain`) |

**API: primera vez** (con Docker Desktop abierto):

```bash
cd services/api
cp .env.example .env
npm run db:up          # Postgres en Docker (puerto 5433)
npm run db:migrate     # aplica drizzle/
npm run db:seed        # Tostado + 5 rubros
npm run dev            # API en :4000
```

**Datos de demo:** `npm run db:demo` carga 10 comercios con menús, dueños y pedidos de ejemplo (`services/api/src/db/demo-data.ts`); `npm run db:reset -w @pedilo/api` deja la base local limpia y la vuelve a cargar. Detalle en [DESARROLLO-UI.md](DESARROLLO-UI.md).

**Tokens de desarrollo:** sin `SUPABASE_URL` la API acepta tokens firmados con una clave local (`.dev-keys/`, fuera de git).

```bash
npm run dev:token -w @pedilo/api -- --name ignacio --admin   # imprime un token de un usuario ADMIN
npm run dev:token -w @pedilo/api -- --name cliente           # usuario sin rol
```

En http://localhost:4000/docs, botón **Authorize**, pegar el token. El mismo `--name` siempre da el mismo usuario.

**Cambios de base:** modificar el `schema.ts` del módulo → `npm run db:generate -w @pedilo/api` → revisar el SQL en `drizzle/` → `npm run db:migrate -w @pedilo/api`. Nunca editar una migración ya aplicada.

**Probar en el celular con Expo Go:** celular y notebook en la misma Wi-Fi, permitir Node en el firewall de Windows y escanear el QR. Si la red bloquea la conexión: `npx expo start --tunnel` dentro de la app. Las dos apps móviles pueden correr a la vez porque usan puertos distintos.

La app del cliente necesita la API corriendo (`npm run dev:api`) y que el celular llegue al **puerto 4000** de la notebook: si el firewall de Windows pregunta por Node, permitir en redes privadas. Con `--tunnel` el celular no ve la IP local: en ese caso definir `EXPO_PUBLIC_API_URL` con una URL accesible desde el teléfono.

**Agregar dependencias:**
- App Expo: `cd apps/customer-mobile && npx expo install <paquete>`
- Otro workspace: `npm install <paquete> -w @pedilo/merchant-web`

## 8. Decisiones de arquitectura (ADR)

Cada decisión técnica relevante se registra en `docs/adr/NNNN-titulo.md` con contexto, opciones, decisión y consecuencias. Índice y pendientes en [`docs/adr/README.md`](adr/README.md).

## 9. Estado actual

| Pieza | Estado |
|---|---|
| Monorepo con npm workspaces | Listo |
| `apps/customer-mobile` | Ciudad, comercios, menú, producto, carrito, checkout (retiro/envío, efectivo) y seguimiento. Probado en navegador (Expo web); falta probar en Expo Go |
| `apps/courier-mobile` | Vacía (una pantalla), lista para empezar |
| `apps/merchant-web` | Alta de comercio, catálogo y tablero de pedidos (aceptar/rechazar, preparar, listo, en camino, entregado). Probado en navegador |
| `apps/admin-web` | Login de desarrollo; cola de comercios con aprobar/rechazar; ciudades y categorías. Probado en navegador |
| `services/api` | Auth, usuarios, auditoría, ciudades, categorías, comercios, menú, comercios por ciudad con «abierto ahora» y pedidos (creación idempotente, seguimiento, estados). 82 tests de integración |
| `packages/domain` | Estados de pedido (con textos y acciones del comercio), pago, reparto, reclamo y comercio; checklist de alta; horarios y «abierto ahora»; CUIT; reglas del menú y precio de una selección; dinero; comisión por tramos. 78 tests |
| `packages/web-utils` | Helpers de formularios, montos, textos y formatos para las webs. 15 tests |
| `packages/api-client` | Cliente tipado desde OpenAPI. 6 tests |
| `packages/config` | Pendiente |
