# 0002 — Fastify para `services/api`

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
El SPEC (§14.1) pide una API Node.js + TypeScript independiente de los frontends, monolito modular, REST con OpenAPI 3.1, y elegir **NestJS o Fastify, no ambos**. El volumen inicial es chico (~30 comercios, <10 pedidos diarios cada uno), así que el rendimiento no decide; deciden la simplicidad, el contrato tipado y la facilidad de testear.

## Opciones consideradas
- **NestJS** — estructura impuesta (módulos, inyección de dependencias, decoradores); mucho boilerplate y una capa de abstracción grande para un equipo chico. Corre sobre Express o Fastify igual.
- **Fastify** — liviano, plugins encapsulados que encajan con módulos de dominio, validación por esquema nativa, `inject()` para tests sin abrir puertos, ecosistema oficial de OpenAPI.
- **Hono / Express** — Express sin tipado de esquemas ni OpenAPI integrado; Hono es bueno pero su fuerte es el edge, que no necesitamos.

## Decisión
**Fastify 5** con:
- **Zod** como fuente única de los esquemas de request/response (`fastify-type-provider-zod`): valida en runtime, tipa los handlers y genera el OpenAPI.
- **`@fastify/swagger`** para emitir OpenAPI 3.1 y `@fastify/swagger-ui` en desarrollo.
- Cada módulo de dominio es un plugin Fastify con prefijo propio (`/v1/cities`, `/v1/categories`, …).
- `buildApp(deps)` recibe sus dependencias (base de datos, verificador de tokens) para poder testear con `app.inject()` sin red.

## Consecuencias
- La estructura modular la sostenemos nosotros por convención (ARCHITECTURE §4), no el framework.
- El contrato OpenAPI se genera desde el código (`npm run openapi -w @pedilo/api`) y de ahí sale `packages/api-client`.
- Zod también puede usarse en las webs (React Hook Form + Zod) con las mismas reglas.
