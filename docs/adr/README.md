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
| [0008](0008-avisos-comercio-y-vencimientos.md) | Avisos al comercio y vencimiento de pedidos (primera etapa) | Aceptada |
| [0009](0009-web-push-y-outbox.md) | Web Push al comercio con outbox durable | Aceptada |
| [0010](0010-limites-anti-abuso-pedidos.md) | Límites anti-abuso para pedidos anónimos | Aceptada |
| [0011](0011-pedidos-programados-y-transferencia.md) | Pedidos programados y pago por transferencia | Aceptada |
| [0012](0012-planes-comisiones-y-ledger.md) | Planes, comisiones y ledger | Aceptada |
| [0013](0013-liquidacion-semanal.md) | Liquidación semanal de comisiones | Aceptada |
| [0014](0014-reparto-desacoplado-y-ofertas.md) | Reparto desacoplado y ofertas con aceptación atómica | Aceptada |
| [0015](0015-app-repartidor.md) | App del repartidor | Aceptada |
| [0016](0016-pin-de-entrega-y-cuenta-con-repartidores.md) | PIN de entrega y cuenta comercio ↔ repartidor | Aceptada |
| [0017](0017-fotos-y-almacenamiento.md) | Fotos y almacenamiento de imágenes | Aceptada |

Pendientes (SPEC §17): realtime (SSE), hosting de `services/api`, storage de imágenes.

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
