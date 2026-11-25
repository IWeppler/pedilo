# 0013 — Liquidación semanal de comisiones

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
Con el ledger de comisiones (ADR 0012) cada comercio acumula deuda por pedidos en efectivo o transferencia. SPEC §8.4 pide liquidación semanal con cortes por zona horaria, vencimiento configurable, pagos parciales, conciliación y asientos correctivos inmutables, y una mora escalonada (aviso → gracia → recargo → límite de deuda → restricción del efectivo → suspensión) que requiere validación legal.

## Opciones consideradas
- **Estado guardado en la liquidación** (PENDING/PAID… actualizado con cada pago) — simple de consultar, pero obliga a editar filas y puede desincronizarse.
- **Estado derivado** de total, pagos y vencimiento — sin updates; todo append-only.
- **Corte por zona de cada sucursal** vs **una zona de liquidación** — todas las sucursales del piloto están en Argentina; una zona configurable alcanza.
- **Cobro automático** (débito, split) — no existe para efectivo/transferencia; el comercio le paga a Pedilo por fuera y el admin lo registra.

## Decisión
- **Corte:** lunes 00:00 en `SETTLEMENT_TIMEZONE` (Argentina por defecto). `lastWeeklyCutoff` en `@pedilo/domain`.
- **Cierre:** un worker (`SETTLEMENT_SWEEP_MINUTES`, 60) llama a `closeSettlementWeek`: por comercio, los asientos **todavía no liquidados** creados antes del corte forman una liquidación (`settlements`) y quedan vinculados en `settlement_allocations` (un asiento, una sola liquidación). Idempotente: una por comercio y corte, con lock por comercio. El admin puede correrlo a mano (`POST /v1/admin/settlements/close`).
- **Saldo a favor:** si los asientos pendientes suman ≤ 0 no se emite liquidación; pasan a la semana siguiente y compensan.
- **Vencimiento:** corte + `SETTLEMENT_DUE_DAYS` (7).
- **Pagos:** el admin los registra (`POST /v1/admin/settlements/{id}/payments`): monto, medio, referencia y fecha. Parciales permitidos; nunca más que lo pendiente (`OVERPAYMENT`).
- **Estado derivado:** `PENDING`, `PARTIALLY_PAID`, `PAID`, `OVERDUE` (venció con saldo). Liquidaciones, asignaciones y pagos son **append-only** (trigger).
- **Saldo del comercio** = asientos − pagos; `unsettledMinor` = lo que todavía no entró en una liquidación.
- **Pantallas:** admin «Liquidaciones» (filtro por estado, vencidas primero, cierre manual) y detalle con pagos y asientos; en el panel del comercio, la lista en «Plan y comisiones» y el detalle de cada liquidación.

## Consecuencias
- Se puede reconstruir cualquier liquidación y su estado desde los movimientos; nada se edita.
- Un pago cargado por error no se puede borrar. **Pendiente:** anulación de pagos con un asiento compensatorio (p. ej. un pago negativo con motivo).
- **Pendiente (mora, SPEC §8.4):** avisos al comercio, gracia, recargo, límite de deuda, restricción del efectivo y suspensión; requieren validación legal antes de automatizarse. Hoy solo se marca `OVERDUE`.
- **Pendiente:** cobro de la mensualidad (entraría como asiento mensual en el mismo ledger), datos de la cuenta de Pedilo para pagar y conciliación con el extracto bancario.
- Supone que la zona de liquidación no cambia de horario dentro de la semana (Argentina no tiene horario de verano).
