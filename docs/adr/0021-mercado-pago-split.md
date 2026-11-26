# 0021 — Pagos con tarjeta: Mercado Pago Split 1:1

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
SPEC §8: el cliente paga con tarjeta, el dinero va al comercio y Pedilo cobra su comisión. Los reembolsos (rechazo, reclamos) no pueden dar éxito falso.

## Decisión
- **Split 1:1 con Checkout API (Payments API)**: el comercio conecta su cuenta por OAuth; se cobra con SU token y la comisión del pedido (snapshot, ADR 0012) va como `application_fee`. Monto, comisión y comercio salen siempre del servidor.
- **Tokens** del comercio cifrados (AES-256-GCM, `MP_TOKEN_ENCRYPTION_KEY`), renovados antes de vencer; si la renovación falla, `NEEDS_REAUTH` y deja de ofrecerse tarjeta. `state` del OAuth aleatorio, de un uso y con vencimiento.
- **Pedido con tarjeta** nace `PENDING_PAYMENT`, invisible al comercio; con el pago aprobado pasa a `PLACED` y corre el plazo de aceptación. Sin pagar a los 30 min, vence.
- **Confirmación**: respuesta del cobro, consulta del estado (los pagos de prueba no mandan webhooks) y webhook firmado (`x-signature`, deduplicado por `x-request-id`, siempre se vuelve a consultar el pago).
- **Reembolsos** encolados en la transacción del hecho (`refunds`) y enviados por un worker con idempotencia y reintentos. Error permanente → `FAILED`, pago `REFUND_BLOCKED` y el reclamo escala a Pedilo.
- Con tarjeta la comisión **no** se devenga como deuda del comercio (ya la retuvo el split).
- Módulos sin ciclos: pedidos emite «pedido pagado que no sigue» y pagos emite «reembolso resuelto»; `app.ts` conecta los listeners.

## Consecuencias
- Pendiente: pantalla de pago (Card Payment Brick), conexión en el panel, verificar si el token de tarjeta debe generarse con la public key del comercio, webhook con URL pública https, prueba real con usuarios de prueba.
