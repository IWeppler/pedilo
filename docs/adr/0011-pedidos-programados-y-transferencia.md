# 0011 — Pedidos programados y pago por transferencia

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
La SPEC pide pedidos programados con «zona horaria, ventana, capacidad, fecha de corte y política de cancelación» (§7.1), y transferencia como medio de pago con «comprobante opcional, verificación por el comercio y conciliación; nunca se marca cobrado automáticamente» (§8.3). Hasta ahora todo pedido era inmediato y en efectivo (ADR 0007).

## Opciones consideradas
**Programados**
- **Franjas fijas de 30 min derivadas del horario** — sin tablas nuevas de cupos; el comercio solo configura anticipación, días y cupo por franja. Menos flexible (no hay franjas distintas por día ni cupos por producto).
- **Tabla `scheduled_order_slots` cargada por el comercio** — total flexibilidad, pero mucha carga operativa para un comercio chico del piloto.

**Transferencia**
- **Alias/CBU del comercio + confirmación manual en el panel** — sin integración bancaria; depende de que el comercio mire su cuenta.
- **Conciliación automática con el banco o la billetera** — no hay API accesible para cuentas de comercios chicos; queda para después.
- **Subir comprobante** — la SPEC lo deja opcional y aclara que no prueba el pago; requiere storage de archivos. Se pospone.

## Decisión
**Programados (por sucursal):** `scheduling_enabled`, `schedule_lead_minutes` (anticipación mínima = fecha de corte, 15–2880, 60 por defecto), `schedule_max_days` (1–14, 3) y `slot_capacity` (pedidos por franja, null = sin límite).
- Las franjas son de 30 min, alineadas a la hora **local** de la sucursal, y tienen que caer enteras dentro del horario (`scheduleSlots` en `@pedilo/domain`). Se puede programar con la sucursal cerrada.
- `GET /v1/public/merchants/{slug}/branches/{branchId}/slots` lista las franjas con `available`. Al crear, la API revalida la franja (`SLOT_UNAVAILABLE`) y el cupo (`SLOT_FULL`) con un advisory lock por franja dentro de la transacción, así dos pedidos simultáneos no se pasan del cupo. Rechazados, cancelados y vencidos liberan su lugar.
- El pedido guarda `scheduled_for` (inicio de la franja). El comercio tiene hasta **30 min antes de la franja** para aceptar (nunca menos que el plazo normal): pasado eso vence solo, con el mismo worker de ADR 0008.
- Política de cancelación: la misma que los inmediatos (el cliente cancela mientras no fue aceptado).

**Medios de pago (por comercio):** `accepts_cash`, `accepts_transfer` y los datos `transfer_alias` / `transfer_cbu` (22 dígitos) / `transfer_holder`. Siempre al menos un medio, y transferencia exige titular y alias o CBU. Se configuran con `PUT /v1/merchants/{id}/payment-settings` (solo el dueño, también con el comercio aprobado).
- El menú público solo dice qué medios acepta. Los datos de la cuenta se **copian al pedido** (`transfer_details`) y el cliente los ve recién en el seguimiento.
- El comercio confirma con `POST /v1/merchants/{id}/orders/{orderId}/payment/confirm` («Ya cobré» / «Me llegó la transferencia»): `PENDING → APPROVED`, con `payment_confirmed_at/by` y auditoría. Idempotente. Vale para efectivo y transferencia; los pagos digitales los confirma el PSP.
- Si un pedido en **efectivo** termina rechazado, cancelado o vencido sin cobrar, el pago pasa a `CANCELLED`. Una **transferencia** queda `PENDING`: el cliente pudo haberla hecho igual, y el comercio tiene que poder registrarla para devolverla.

## Consecuencias
- Sin tablas nuevas de cupos: alcanza para restaurantes y comercios chicos. Supermercados con franjas propias o cupos por producto necesitarán un modelo más rico.
- Las franjas asumen que la zona horaria no cambia en la ventana; Argentina no tiene horario de verano, así que no afecta al piloto.
- Las devoluciones de transferencias son manuales, entre comercio y cliente (SPEC §8.2 punto 7). Pedilo no las registra todavía.
- Pendiente: comprobante opcional del cliente, conciliación y el devengamiento de comisiones (E9), que va a usar `payment_status` y el medio de pago.
