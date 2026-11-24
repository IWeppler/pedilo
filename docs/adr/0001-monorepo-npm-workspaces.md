# 0001 — Monorepo con npm workspaces

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
Pedilo tiene cinco piezas desplegables (app cliente, app repartidor, panel comercio, panel admin y API) que comparten tipos, estados y reglas de negocio (SPEC §14.1). El equipo es chico.

## Opciones consideradas
- **Un repo por pieza** — despliegues totalmente aislados; pero compartir código exige publicar paquetes y un cambio transversal se reparte en varios PRs.
- **Monorepo con npm workspaces** — un solo repo, un `npm install`, código compartido en `packages/` sin publicar. Sin herramientas extra.
- **Monorepo con Turborepo/Nx** — caché de builds y orquestación de tareas; complejidad que todavía no hace falta.

## Decisión
Monorepo con **npm workspaces**: `apps/*`, `services/*`, `packages/*`.

## Consecuencias
- Un cambio que toca dominio, API y apps entra en un solo commit, y TypeScript avisa en todos los consumidores.
- React tiene que estar en la misma versión en todas las apps para evitar copias duplicadas.
- Los paquetes compartidos se consumen como TypeScript sin compilar (ver ARCHITECTURE §3.1).
- Si los tiempos de CI crecen, se puede sumar Turborepo encima sin reestructurar.
