# 0007 — Primeros pedidos: invitado con token de seguimiento, solo efectivo

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
El roadmap (SPEC §13, fase 2) pide un pedido completo de prueba antes de mover dinero real. Todavía no hay proyecto de Supabase (login del comprador, ADR 0004), ni pagos (bloqueados por la puerta G0), ni repartidores, ni planes asignados a los comercios. El SPEC (§4.1) admite pedidos como invitado con un token de seguimiento de alcance limitado.

## Decisión
- **Pedido como invitado:** `POST /v1/public/orders` sin sesión. El cliente envía nombre y teléfono; la API devuelve el pedido y un **token de seguimiento**. Con ese token (y solo con él) se consulta y se cancela ese pedido.
  - El token es `HMAC-SHA256(ORDER_TOKEN_SECRET, orderId)`: no se guarda en la base, se recalcula para verificar, y un reintento idempotente devuelve el mismo token.
  - La app guarda los tokens en el teléfono. Cuando exista login, los pedidos quedarán asociados al usuario.
- **Idempotencia:** header `Idempotency-Key` obligatorio (ADR 0005). La misma clave devuelve el mismo pedido; un doble toque no crea dos.
- **La API recalcula todo:** precios con `priceSelection` (@pedilo/domain), disponibilidad, sucursal abierta ahora, forma de entrega, zona y pedido mínimo. El total del cliente es solo informativo.
- **Snapshots:** nombre, variante, opciones y precios se copian al pedido; editar el menú no cambia pedidos existentes.
- **Solo efectivo** (`payment_method = CASH`, `payment_status = PENDING`): no se marca cobrado automáticamente (SPEC §8.3).
- **Envío del propio comercio:** sin repartidores, el comercio marca «salió» y «entregado». El desacople con `deliveries` (SPEC §9.0) se agrega con el módulo de reparto.
- **Estados** con `orderStateMachine` de @pedilo/domain. El comercio acepta/rechaza (con motivo) y avanza; el cliente solo cancela antes de la aceptación. Cada cambio queda en `order_events`.

## Fuera de esta etapa
Pedidos programados, vencimiento automático de pedidos no aceptados (requiere workers), avisos push/sonido al comercio, comisiones (los comercios aún no tienen plan), rate limiting de pedidos anónimos y verificación del teléfono.

## Consecuencias
- Antes de abrir al público hace falta: verificación de teléfono (OTP), rate limiting, vencimiento automático y avisos robustos al comercio (SPEC §10).
- `ORDER_TOKEN_SECRET` es obligatorio en producción; en desarrollo hay un valor por defecto.
