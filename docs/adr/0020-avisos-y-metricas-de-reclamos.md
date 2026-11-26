# 0020 — Avisos y métricas de reclamos

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
Los reclamos (ADR 0019) dependen de que cada parte se entere a tiempo: el comercio tiene 24 h para proponer y el cliente tiene que ver la propuesta para aceptarla. Hasta ahora solo se veían entrando a la pantalla. Además, Pedilo necesita ver qué comercios generan reclamos y cómo responden (SPEC §16: reclamos por entrega, tiempos).

## Opciones consideradas
- **Avisos al cliente por SMS/WhatsApp** vs **push a la app**. El push no cuesta por mensaje y el cliente ya tiene la app; SMS queda para cuando exista verificación de teléfono (OTP).
- **Expo Push** vs **FCM directo**. Expo Push unifica Android e iOS y no necesita credenciales en la API; FCM igual hay que configurarlo en el build (EAS).
- **Una outbox por canal** vs **una sola con destinatario**. Una sola (`notification_outbox.audience`): mismos reintentos, misma garantía transaccional (ADR 0009).

## Decisión
- `notification_outbox.audience`: `MERCHANT` (Web Push a los navegadores del comercio, como los pedidos) o `CUSTOMER` (Expo Push a los celulares registrados para el pedido). Tipos nuevos: `CLAIM_OPENED` y `CLAIM_UPDATE`.
- **Celular del cliente**: `customer_push_tokens` (pedido + token de Expo), registrado con `POST /public/orders/{id}/push-token` y el token de seguimiento (el cliente no tiene cuenta, ADR 0007). Tokens dados de baja (`DeviceNotRegistered`) se borran solos. Sin token → `SKIPPED`, sin trabar la cola.
- **Qué se avisa** (en la misma transacción del hecho):
  - al comercio: reclamo nuevo (con el plazo), el cliente aceptó/no aceptó, escribió o lo escaló, y que se escaló por falta de respuesta;
  - al cliente: propuesta del comercio, devolución registrada, mensajes del comercio, y que lo revisa Pedilo;
  - a ambos: resolución y mensajes de Pedilo.
- Al tocar el aviso: el panel abre el reclamo; la app abre el seguimiento del pedido.
- **App**: `expo-notifications` pide permiso y registra el token al ver el pedido. Necesita un build propio con `extra.eas.projectId` (Expo Go no recibe push en Android desde el SDK 53): en Expo Go no hace nada.
- **API**: `EXPO_PUSH_ENABLED` (por defecto `true`) y `EXPO_ACCESS_TOKEN` opcional.
- **Métricas** (`GET /merchants/{id}/claims/metrics`, `GET /admin/claims/metrics`, últimos N días): pedidos completados, reclamos, reclamos cada 100 pedidos, abiertos, escalados, vencidos sin respuesta (sin contar los de salud o seguridad), mediana de minutos hasta la primera propuesta, monto devuelto y motivos. En el panel, resumen en «Reclamos»; en el admin, tabla por comercio con la mayor tasa primero.

## Consecuencias
- **Pendiente para que los avisos al cliente lleguen de verdad**: `eas init` (projectId), credenciales de FCM en EAS y un build de desarrollo o producción. Probarlo en un dispositivo real.
- Los avisos al cliente cubren reclamos; extenderlos al estado del pedido (aceptado, en camino) es directo con el mismo canal.
- Las métricas se calculan al pedirlas (volumen del piloto). Con más volumen, materializarlas.
