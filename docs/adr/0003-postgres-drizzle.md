# 0003 — PostgreSQL + Drizzle ORM

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
El SPEC (§14.1) fija PostgreSQL gestionado (Supabase inicialmente), migraciones versionadas, transacciones y constraints fuertes (asignación atómica de repartidores, cupones sin doble canje, ledger inmutable). Necesitamos un acceso a datos tipado que no esconda el SQL, porque buena parte de la corrección del sistema vive en constraints y transacciones.

## Opciones consideradas
- **Prisma** — muy popular y cómodo; pero su propio lenguaje de esquema, un motor aparte y menos control sobre SQL avanzado (locks, `ON CONFLICT`, constraints parciales).
- **Drizzle** — esquema en TypeScript, SQL visible y predecible, migraciones SQL generadas y revisables, sin motor aparte; funciona igual con Postgres real y con PGlite.
- **SQL a mano (postgres.js)** — control total, sin tipado de resultados ni migraciones gestionadas.

## Decisión
- **Drizzle ORM** con el driver **postgres.js** contra PostgreSQL.
- **drizzle-kit** genera migraciones SQL en `services/api/drizzle/`; se revisan y se commitean. Nunca se edita una migración ya aplicada.
- **Desarrollo local:** PostgreSQL en Docker (`services/api/docker-compose.yml`).
- **Tests:** **PGlite** (Postgres compilado a WASM, en memoria) aplicando las mismas migraciones; no hace falta Docker para correrlos.
- **Producción:** Supabase Postgres; migrable a otro Postgres gestionado sin rediseño.

## Consecuencias
- Cada módulo define sus tablas en su carpeta (`modules/<módulo>/schema.ts`); ningún módulo importa las tablas de otro.
- Dinero en enteros (centavos), IDs UUID, timestamps con zona horaria.
- PGlite es Postgres real (no un mock), pero es una sola conexión: las pruebas de concurrencia (asignación atómica, cupones) se hacen además contra el Postgres de Docker.
