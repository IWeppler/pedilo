# 0012 — Planes, comisiones y ledger

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
La SPEC §6 define planes con mensualidad y comisión por venta concluida, con tramos marginales y tope por rubro, y pide que todo sea **parámetro versionado**, nunca retroactivo, con `pricing_version_id` inmutable por pedido. §6.3: en efectivo y transferencia la comisión se registra como asiento `ACCRUED` al completar el pedido, en una cuenta de comisiones por cobrar (no una billetera), con asientos compensatorios y sin borrar movimientos. El cálculo ya existía en `@pedilo/domain` (`calculateCommission`) con una hipótesis de precios hardcodeada.

## Opciones consideradas
- **Pricing en código (constante del dominio)** — simple, pero cambiar precios requiere un deploy y no deja historia consultable.
- **Pricing en la base como versiones inmutables** — un cambio es una versión nueva con fecha de inicio futura; los pedidos guardan con cuál se calcularon.
- **Calcular la comisión al completar el pedido** vs **al crearlo** — al completar usaría el plan de ese momento, que puede haber cambiado; la SPEC pide congelarla.

## Decisión
- **`pricing_versions`**: tramos, topes por rubro y términos de cada plan (mensualidad, tasa base, sucursales, usuarios). Inmutables. Rige la de mayor `effective_from` ya alcanzada. La migración siembra `v0.4-hypothesis` (los precios de la SPEC, **a validar**). El admin crea versiones nuevas solo con fecha futura (`POST /v1/admin/pricing-versions`), validadas con el mismo código que calcula.
- **`merchant_plans`**: plan de cada comercio con historial (`starts_at`/`ends_at`). Sin fila = **Emprendedor** ($0). El admin lo cambia desde ahora (`PUT /v1/admin/merchants/{id}/plan`); nunca hacia atrás.
- **Comisión por pedido**: se calcula al **crear** el pedido con el plan y el pricing vigentes y queda en el pedido (`pricing_version_id`, plan, rubro, base, monto y detalle por tramos). Base = subtotal de productos (sin envío; todavía no hay descuentos ni propinas). Rubro sin categoría de comisión → tope de emprendedores. La ven el comercio y el admin; el cliente no.
- **`commission_entries`** (ledger): `ACCRUED` al pasar a retirado/entregado, en la misma transacción, una sola vez por pedido (índice único); `ADJUSTMENT` del admin con motivo, positivo o negativo. **Append-only** con un trigger que rechaza UPDATE/DELETE. El saldo es la suma.
- **Pantallas**: «Plan y comisiones» en el panel (plan, saldo, movimientos y simulador por plan con el mismo cálculo de la API); en admin, plan, saldo, ajustes y movimientos en el detalle del comercio.

## Consecuencias
- Cambiar precios no requiere deploy y nunca altera pedidos existentes.
- Pedidos rechazados, cancelados o vencidos no devengan. Los anteriores a esta migración no tienen comisión.
- **Pendiente**: mora (la liquidación semanal ya está, ADR 0013); cobro de la mensualidad; reversas por devoluciones (asiento compensatorio cuando existan reembolsos); límites del plan (sucursales y usuarios) todavía no se aplican; pagos digitales (la comisión la retiene el split, no se devenga como deuda).
- Como el ledger es append-only, la futura liquidación tiene que vincular asientos en una tabla aparte (`settlement_allocations`), no actualizando filas.
