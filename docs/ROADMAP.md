# Pedilo — Roadmap y avance

Seguimiento del roadmap del [SPEC §13](SPEC.md#13-roadmap-hitos-y-puertas-de-salida). Se actualiza al cerrar cada tanda de trabajo.
Leyenda: ✅ hecho · 🟡 parcial · ⬜ pendiente · ⛔ bloqueado.

**Última actualización:** 2026-11-23

## Resumen

| Fase | Estado | Puerta |
|---|---|---|
| 0 — Viabilidad | ⬜ No empezada (es trabajo fuera del código) | G0 ⛔ bloquea pagos reales |
| 1 — Plataforma y catálogo | 🟡 Casi completa | — |
| 2 — Primer pedido real | 🟡 Pedido sin dinero funcionando | G1 ⬜ · G3 ⬜ |
| 3 — Reparto | ⬜ | G2 ⬜ |
| 4 — Piloto Tostado | ⬜ | G4 ⬜ |
| 5 — Lanzamiento público | ⬜ | G5 ⬜ |

## Fase 0 — Viabilidad (bloqueante para dinero real)

- ⬜ Prueba real de Mercado Pago Checkout API + Split 1:1: liquidación, reembolso total/parcial, saldo insuficiente.
- ⬜ Revisión legal y fiscal puntual (términos, privacidad, rol del marketplace, reclamos, repartidores).
- ⬜ Entrevistas con 3–5 comercios y repartidores de Tostado; simulación de pricing por rubro.
- ✅ ADRs técnicos iniciales: [0001](adr/0001-monorepo-npm-workspaces.md)–[0007](adr/0007-pedidos-invitado-sin-dinero.md).
- ⬜ ADRs pendientes: realtime/push/workers durables, hosting de la API, storage de imágenes.

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
- ⬜ CI (lint, typecheck, tests y build en cada cambio).
- ⬜ Fotos de productos y logos (requiere ADR de storage).
- ⬜ Cierres excepcionales (feriados), invitar operadores al comercio, suspender comercio desde el admin.
- ⬜ Asignar categoría global a productos desde el panel (la API ya lo soporta).

## Fase 2 — Primer pedido real (E3, E4, E5, E7)

Hecho:
- ✅ App del cliente: ciudad, comercios abiertos por rubro, búsqueda, menú, producto con precio en vivo, carrito, checkout (retiro/envío) y seguimiento.
- ✅ Pedidos como invitado en efectivo ([ADR 0007](adr/0007-pedidos-invitado-sin-dinero.md)): precios recalculados en el servidor, idempotencia, snapshots, estados con historial.
- ✅ Tablero de pedidos del comercio: aceptar/rechazar con motivo, preparar, listo, en camino, entregado/retirado; refresco cada 10 s.

Falta:
- ⬜ Probar la app en un celular real con Expo Go.
- ⬜ Login del cliente con verificación de teléfono (OTP) — requiere Supabase.
- ⬜ Avisos robustos al comercio: realtime, sonido, push, alarma de pedidos sin aceptar (SPEC §10) → puerta **G3**.
- ⬜ Vencimiento automático de pedidos no aceptados (requiere workers).
- ⬜ Rate limiting de pedidos anónimos.
- ⬜ Pedidos programados.
- ⬜ Transferencia como medio de pago.
- ⛔ Pago con Mercado Pago y reembolsos (E5) — bloqueado por G0 → puerta **G1**.
- ⬜ Planes, comisiones y ledger (E9) — los comercios todavía no tienen plan asignado.

## Fase 3 — Reparto (E6)

- ⬜ Módulo `deliveries` desacoplado de pedidos (SPEC §9.0).
- ⬜ App del repartidor: registro, disponibilidad, ofertas, aceptación atómica, estados de retiro/entrega → puerta **G2**.

## Fase 4 — Piloto Tostado (E8, E9, E10, E11)

- ⬜ Chat por pedido y reclamos.
- ⬜ Comisión por tramos aplicada a pedidos + simulador para el comercio (las reglas ya están en `@pedilo/domain`).
- ⬜ Cupones básicos.
- ⬜ Operación: monitoreo, backups probados, soporte → puerta **G4** (5–10 comercios piloto).

## Próximos pasos sugeridos (en orden)

1. ✅ ~~Versionar el proyecto en git~~ — en `github.com/IWeppler/pedilo`, rama `main`.
2. **Probar la app del cliente en Expo Go** y anotar lo que falle en el celular.
3. 🟡 **UI de la app del cliente:** rediseño hecho (naranja de marca, íconos `expo-symbols`, pestañas Inicio/Pedidos/Carrito, home con destacados y rubros, menú con portada y pestañas por sección, modal de producto, checkout, seguimiento con línea de tiempo, ciudad por GPS con `expo-location`). Falta: probarlo en Expo Go, tipografía e ícono de la app, fotos reales.
4. **Fotos:** ADR de storage y subida de imágenes de productos/logos.
5. 🟡 **Supabase Auth:** login de comercio/admin hecho (falta prueba con email real); pendiente login del cliente con OTP y asociar pedidos al usuario.
6. **Avisos robustos al comercio + workers** (vencimiento de pedidos) → G3.
7. **CI.**
8. En paralelo, fuera del código: **Fase 0** (prueba de Mercado Pago, legal, entrevistas).

## Detalles menores anotados

- Texto desactualizado en el inicio del comercio: «La carga del catálogo llega en el próximo paso» (el catálogo ya existe).
- Un comercio con varias sucursales muestra solo la primera en la app del cliente.
- En la versión web de la app, el seguimiento del pedido no se refresca con la pestaña oculta (en el celular sí, con la app abierta).
