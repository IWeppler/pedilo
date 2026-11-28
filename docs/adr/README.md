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
| [0007](0007-pedidos-invitado-sin-dinero.md) | Primeros pedidos: invitado con token de seguimiento, solo efectivo | Reemplazada en parte por 0026 |
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
| [0018](0018-cierres-excepcionales.md) | Cierres excepcionales (feriados y vacaciones) | Aceptada |
| [0019](0019-reclamos.md) | Reclamos | Aceptada |
| [0020](0020-avisos-y-metricas-de-reclamos.md) | Avisos y métricas de reclamos | Aceptada |
| [0021](0021-mercado-pago-split.md) | Pagos con tarjeta: Mercado Pago Split 1:1 | Aceptada |
| [0022](0022-seguimiento-en-vivo.md) | Seguimiento en vivo del repartidor | Aceptada |
| [0023](0023-punto-exacto-de-entrega.md) | Punto exacto de entrega | Aceptada |
| [0024](0024-hosting.md) | Hosting de la API y los paneles | Aceptada |
| [0025](0025-push-de-ofertas-al-repartidor.md) | Push de ofertas al repartidor | Aceptada |
| [0026](0026-cuenta-del-cliente-google-apple.md) | Cuenta del cliente (Google, Apple o email y contraseña) | Aceptada |
| [0027](0027-tipos-de-comida.md) | Tipos de comida en el inicio de la app | Aceptada |
| [0028](0028-inicio-de-la-app-del-cliente.md) | Inicio de la app del cliente: platos, volver a pedir y una sola lista | Aceptada |
| [0029](0029-tiempo-estimado-apertura-y-nuevos.md) | Tiempo estimado, próxima apertura y comercios nuevos | Aceptada |
| [0030](0030-promociones-del-comercio.md) | Promociones del comercio: ofertas y cupones | Aceptada |
| [0031](0031-calificaciones-de-comercios.md) | Calificaciones de comercios | Aceptada |

Pendientes (SPEC §17): realtime (SSE).

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
