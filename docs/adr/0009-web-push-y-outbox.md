# 0009 — Web Push al comercio con outbox durable

- **Estado:** Aceptada
- **Fecha:** 2026-11-24

## Contexto
La ADR 0008 resolvió los avisos con el panel abierto (pulso, alarma, notificación desde la página). Falta que el comercio se entere con la pestaña cerrada o el teléfono bloqueado (SPEC §10: «push cuando esté soportado» + «outbox durable»). El hosting de la API sigue sin decidir y no hay app Android del comercio.

## Opciones consideradas
- **Web Push estándar (VAPID) con `web-push`** — sin cuentas de terceros, funciona en Chrome/Edge/Firefox de PC y Android; en iPhone solo con el panel instalado en la pantalla de inicio. Gratis.
- **Firebase Cloud Messaging** — también cubre apps nativas; suma una cuenta y SDK de Google sin ventaja para un panel web.
- **App Android de alertas** — la más confiable (SPEC §10 la deja como plan B si el piloto lo pide); mucho más trabajo y distribución.

## Decisión
- **Web Push con VAPID** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `npm run push:keys` las genera). Sin claves, todo sigue funcionando y los avisos quedan `SKIPPED`.
- **Suscripciones** en `push_subscriptions`, una por navegador (endpoint único), asociadas a comercio y usuario. El panel las registra con un service worker (`/sw.js`) desde el tablero de pedidos. Las que el servicio de push da por muertas (404/410) se borran solas.
- **Outbox** `notification_outbox`: el pedido nuevo deja su aviso **en la misma transacción** que lo crea. Un worker en la API (`PUSH_OUTBOX_SWEEP_SECONDS`, 5 s) toma tandas con `SKIP LOCKED`, las «alquila» 2 min y envía fuera de la transacción. Estados `PENDING → SENT | SKIPPED | FAILED`; errores transitorios se reintentan con espera creciente (30 s, 1, 2, 4 min) hasta 5 intentos. `delivered_count` registra a cuántos dispositivos llegó (el `notification_sent` de SPEC §10).
- Los avisos usan el mismo `tag` que la notificación de la página (`order-<id>`): no se duplican.
- TTL de 1 hora y urgencia alta: un aviso de pedido viejo no sirve, y uno nuevo tiene que despertar el teléfono.

## Consecuencias
- Con push activado en el dispositivo, el comercio recibe el pedido aunque haya cerrado la pestaña. El sonido es el de la notificación del sistema; la alarma repetida sigue necesitando el panel abierto.
- El push no garantiza entrega inmediata (SPEC §9.3/§14.2): el estado real siempre sale de la API, y el pulso + vencimiento siguen como respaldo.
- Queda pendiente `notification_seen` (registrar cuándo se abrió la notificación) y la prueba en campo de la puerta G3, en especial Android con la pantalla apagada y ahorro de batería.
- Las tablas nuevas llevan RLS activado sin políticas, como el resto (migración 0004).
- Si la API pasa a un entorno sin procesos persistentes, el worker se mueve a un cron que llame a `processOutbox`.
