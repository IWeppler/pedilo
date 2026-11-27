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

- **Pantalla de pago**: la API sirve `/pay/{orderId}#t={token}` (Card Payment Brick, 1 cuota). El token de seguimiento va en el fragmento; la public key (la de la app de Pedilo, como indica la guía de marketplace) se pide sin caché a `/v1/payments/config`. La app la abre con `expo-web-browser` y la página vuelve a `pedilo://order/{id}`.
- **Panel**: «Tarjeta con Mercado Pago» en Perfil (conectar/desconectar; solo el dueño). Los pedidos con tarjeta nunca pagados no aparecen en la lista del comercio.

## Consecuencias
- **Pendiente: túnel https para desarrollo** (p. ej. ngrok o Cloudflare Tunnel hacia `localhost:4000`). Mercado Pago no acepta URLs `http`, así que sin túnel no se puede ni conectar un comercio por OAuth ni recibir webhooks. Con la URL del túnel: `MP_OAUTH_REDIRECT_URI=https://<túnel>/v1/payments/mercadopago/oauth/callback` (la misma cargada en el panel de la app), `API_PUBLIC_URL=https://<túnel>` y `MP_WEBHOOK_SECRET` al registrar el webhook.
- Pendiente: prueba de punta a punta con el vendedor de prueba (conecta la cuenta) y el comprador de prueba (paga desde la app).
- La comisión de un reembolso la reparte Mercado Pago en proporción; si el comercio no tiene saldo, el reembolso falla y va a revisión.
