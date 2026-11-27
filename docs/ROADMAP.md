# Pedilo — Roadmap y avance

Seguimiento del roadmap del [SPEC §13](SPEC.md#13-roadmap-hitos-y-puertas-de-salida). Se actualiza al cerrar cada tanda de trabajo.
Leyenda: ✅ hecho · 🟡 parcial · ⬜ pendiente · ⛔ bloqueado.

**Última actualización:** 2026-11-26

## Resumen

| Fase | Estado | Puerta |
|---|---|---|
| 0 — Viabilidad | ✅ Dada por cerrada (2026-11-26) | G0 ✅ |
| 1 — Plataforma y catálogo | 🟡 Casi completa | — |
| 2 — Primer pedido real | 🟡 Pedido sin dinero funcionando | G1 ⬜ · G3 ⬜ |
| 3 — Reparto | 🟡 backend y app listos, falta probar en dispositivos | G2 🟡 (probado en API) |
| 4 — Piloto Tostado | ⬜ | G4 ⬜ |
| 5 — Lanzamiento público | ⬜ | G5 ⬜ |

## Fase 0 — Viabilidad

Dada por cerrada el 2026-11-26: no se sigue como tarea pendiente. La prueba real de Mercado Pago pasó a la Fase 2 y el ADR de hosting a la Fase 4.

- ✅ ADRs técnicos iniciales: [0001](adr/0001-monorepo-npm-workspaces.md)–[0007](adr/0007-pedidos-invitado-sin-dinero.md).

## Fase 1 — Plataforma y catálogo (E1, E2)

Hecho:
- ✅ Monorepo (npm workspaces), API Fastify + Drizzle + Postgres, contrato OpenAPI y cliente tipado.
- ✅ Auth con verificación de JWT (tokens locales de desarrollo), roles en nuestra base, auditoría de acciones.
- ✅ Admin: ciudades, categorías (rubros con tope de comisión, árbol de productos), cola de revisión de comercios.
- ✅ Alta de comercio: datos con CUIT, sucursales, horario semanal, zonas de envío, envío a revisión, aprobación/rechazo con motivo.
- ✅ Catálogo: secciones, productos, variantes, grupos de opciones, pausar/archivar; menú público.
- ✅ Datos de demo para desarrollar la UI ([DESARROLLO-UI.md](DESARROLLO-UI.md)).
- ✅ Proyecto Supabase creado (`btezhwbhgttfbmtccqvd`) y conectado al MCP de Claude Code (`.mcp.json`).

Falta:
- ✅ Supabase como base: migraciones `0000`–`0004` aplicadas (18 tablas, RLS activado sin políticas para cerrar la Data API), `DATABASE_URL` por el session pooler (`aws-1-us-west-2`) y seed base cargado (Tostado + 5 rubros).
- 🟡 Supabase Auth en los paneles de comercio y admin: login con link al email (PKCE), sesión refrescada en `proxy.ts`, API verificando tokens por JWKS (`SUPABASE_URL` activa). Sin las variables de Supabase los paneles siguen con token de desarrollo. Falta probarlo de punta a punta con un email real y cargar las Redirect URLs en Supabase.
- ✅ CI en GitHub Actions (`.github/workflows/ci.yml`): typecheck, lint, contrato de la API al día, tests y build de los paneles en cada push a main y cada PR.
- ✅ Fotos de productos, logo y portada: subida desde el panel, reprocesadas a WebP sin metadatos, disco local en desarrollo y Supabase Storage en producción ([ADR 0017](adr/0017-fotos-y-almacenamiento.md)). Falta crear el bucket en Supabase.
- ✅ Cierres excepcionales por sucursal: feriados y vacaciones ([ADR 0018](adr/0018-cierres-excepcionales.md)). ✅ Suspender y reactivar comercios desde el admin.
- Fuera del MVP: invitar operadores al comercio (un solo usuario por comercio en el MVP).
- ⬜ Asignar categoría global a productos desde el panel (la API ya lo soporta).

## Fase 2 — Primer pedido real (E3, E4, E5, E7)

Hecho:
- ✅ App del cliente: ciudad, comercios abiertos por rubro, búsqueda, menú, producto con precio en vivo, carrito, checkout (retiro/envío) y seguimiento.
- ✅ Pedidos como invitado en efectivo ([ADR 0007](adr/0007-pedidos-invitado-sin-dinero.md)): precios recalculados en el servidor, idempotencia, snapshots, estados con historial.
- ✅ Tablero de pedidos del comercio: aceptar/rechazar con motivo, preparar, listo, en camino, entregado/retirado; refresco cada 10 s.

Falta:
- ⬜ Probar la app en un celular real con Expo Go.
- ⬜ Login del cliente con verificación de teléfono (OTP) — requiere Supabase.
- 🟡 Avisos al comercio ([ADR 0008](adr/0008-avisos-comercio-y-vencimientos.md)): pulso cada 5 s, alarma con sonido, notificación del sistema y «Visto» en todas las páginas del comercio. Web Push con la pestaña cerrada y outbox durable ([ADR 0009](adr/0009-web-push-y-outbox.md)). Falta: prueba en campo (PC y Android con pantalla apagada), `notification_seen` y realtime → puerta **G3**.
- ✅ Vencimiento automático de pedidos no aceptados: plazo por pedido (15 min por defecto) y worker en la API ([ADR 0008](adr/0008-avisos-comercio-y-vencimientos.md)).
- ✅ Rate limiting de pedidos anónimos: por IP (en memoria) y por teléfono (en la base) ([ADR 0010](adr/0010-limites-anti-abuso-pedidos.md)).
- ✅ Pedidos programados: franjas de 30 min dentro del horario, anticipación mínima, días hacia adelante y cupo por franja ([ADR 0011](adr/0011-pedidos-programados-y-transferencia.md)).
- ✅ Transferencia como medio de pago: alias/CBU del comercio copiado al pedido y confirmación manual del cobro en el panel ([ADR 0011](adr/0011-pedidos-programados-y-transferencia.md)). Pendiente: comprobante opcional del cliente.
- 🟡 Pago con Mercado Pago y reembolsos (E5): Split 1:1 con OAuth, cobro, webhook y reembolsos en la API, Card Payment Brick en la app y conexión en el panel ([ADR 0021](adr/0021-mercado-pago-split.md)). Falta la prueba real con túnel https: liquidación, reembolso total/parcial y saldo insuficiente → puerta **G1**.
- ✅ Planes, comisiones y ledger (E9): pricing versionado en la base, plan por comercio con historial, comisión por tramos y tope congelada en cada pedido, devengo al completar, ajustes del admin, simulador ([ADR 0012](adr/0012-planes-comisiones-y-ledger.md)).
- ✅ Liquidación semanal: corte los lunes, vencimiento, pagos parciales registrados por el admin, estado derivado y todo append-only ([ADR 0013](adr/0013-liquidacion-semanal.md)).
- ⬜ Mora escalonada (SPEC §8.4, requiere validación legal), anulación de pagos, cobro de la mensualidad.

## Fase 3 — Reparto (E6)

- ✅ Módulo `deliveries` desacoplado de pedidos (SPEC §9.0): comandos y eventos en la misma transacción, ofertas con aceptación atómica, estados del repartidor con deduplicación, moderación de repartidores y pedir repartidor desde el panel ([ADR 0014](adr/0014-reparto-desacoplado-y-ofertas.md)).
- ✅ App del repartidor (`apps/courier-mobile`): login por código, registro, disponibilidad, ofertas, aceptación, estados de retiro/entrega con cola persistente sin señal ([ADR 0015](adr/0015-app-repartidor.md)).
- ⬜ Puerta **G2** en dispositivos reales: dos repartidores disputando una oferta, desconexión y recuperación (SPEC §9.3).
- ✅ PIN de entrega y cuenta comercio↔repartidor ([ADR 0016](adr/0016-pin-de-entrega-y-cuenta-con-repartidores.md)).
- ⬜ Push FCM de ofertas, chat e incidencias.

## Fase 4 — Piloto Tostado (E8, E9, E10, E11)

- ✅ Reclamos: el comercio propone, el cliente acepta o no, Pedilo interviene si se escala o vence el plazo; devolución registrada con ajuste de comisión ([ADR 0019](adr/0019-reclamos.md)).
- ✅ Avisos de reclamos (Web Push al comercio, Expo Push al cliente) y métricas por comercio ([ADR 0020](adr/0020-avisos-y-metricas-de-reclamos.md)). Falta build propio de la app (EAS) para que lleguen al cliente.
- ⬜ Chat por pedido (SPEC §11.1).
- ✅ Comisión por tramos aplicada a pedidos + simulador para el comercio (ADR 0012).
- ⬜ Cupones básicos.
- ⬜ ADR de hosting de la API (y realtime por SSE).
- ⬜ Builds de prueba de las apps (APK por EAS, distribución interna) hasta subirlas a Play Store.
- ⬜ Operación: monitoreo, backups probados, soporte → puerta **G4** (5–10 comercios piloto).

## Próximos pasos sugeridos (en orden)

1. ✅ ~~Versionar el proyecto en git~~ — en `github.com/IWeppler/pedilo`, rama `main`.
2. **Probar la app del cliente en Expo Go** y anotar lo que falle en el celular.
3. 🟡 **UI de la app del cliente:** rediseño hecho (naranja de marca, íconos `expo-symbols`, pestañas Inicio/Pedidos/Carrito, home con destacados y rubros, menú con portada y pestañas por sección, modal de producto, checkout, seguimiento con línea de tiempo, ciudad por GPS con `expo-location`). Falta: probarlo en Expo Go, tipografía e ícono de la app, fotos reales.
4. **Fotos:** ADR de storage y subida de imágenes de productos/logos.
5. 🟡 **Supabase Auth:** login de comercio/admin hecho (falta prueba con email real); pendiente login del cliente con OTP y asociar pedidos al usuario.
6. 🟡 **Avisos al comercio:** alarma, notificación, Web Push y vencimientos hechos. Sigue: prueba en campo con comercios reales → G3.
7. **CI.**
8. **Prueba real de Mercado Pago** con túnel https → G1.

## Detalles menores anotados

- Texto desactualizado en el inicio del comercio: «La carga del catálogo llega en el próximo paso» (el catálogo ya existe).
- Un comercio con varias sucursales muestra solo la primera en la app del cliente.
- En la versión web de la app, el seguimiento del pedido no se refresca con la pestaña oculta (en el celular sí, con la app abierta).
