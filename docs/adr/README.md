# Decisiones de arquitectura (ADR)

Cada decisión técnica relevante queda registrada acá: qué se decidió, por qué y qué consecuencias tiene. Una ADR aceptada no se edita para cambiarla: se escribe una nueva que la reemplace y se marca la anterior como «Reemplazada por NNNN».

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-monorepo-npm-workspaces.md) | Monorepo con npm workspaces | Aceptada |
| [0002](0002-api-fastify.md) | Fastify para `services/api` | Aceptada |
| [0003](0003-postgres-drizzle.md) | PostgreSQL + Drizzle ORM | Aceptada |
| [0004](0004-auth-supabase.md) | Autenticación con Supabase Auth, roles en nuestra base | Aceptada |
| [0005](0005-convenciones-api.md) | Convenciones de la API (versionado, errores, IDs, contrato) | Aceptada |
| [0006](0006-catalogo-por-comercio.md) | Catálogo por comercio, precio único; variantes con precio propio | Aceptada |
| [0007](0007-pedidos-invitado-sin-dinero.md) | Primeros pedidos: invitado con token de seguimiento, solo efectivo | Aceptada |

Pendientes (SPEC §17): realtime/push/workers durables, hosting de `services/api`, storage de imágenes.

## Plantilla

```markdown
# NNNN — Título

- **Estado:** Propuesta | Aceptada | Reemplazada por NNNN
- **Fecha:** AAAA-MM-DD

## Contexto
Qué problema hay y qué restricciones aplican.

## Opciones consideradas
- Opción A — pros / contras
- Opción B — pros / contras

## Decisión
Qué se eligió.

## Consecuencias
Qué se gana, qué se pierde y qué hay que hacer a partir de ahora.
```
