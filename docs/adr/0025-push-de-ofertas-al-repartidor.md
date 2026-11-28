# 0025 — Push de ofertas al repartidor

- **Estado:** Aceptada
- **Fecha:** 2026-11-27

## Contexto
Hasta ahora el repartidor veía las ofertas solo con la app abierta (consulta cada 8 s, ADR 0015). Una oferta dura 10 minutos; con la app cerrada o el celular bloqueado, se pierde. Para el piloto esto es imprescindible (SPEC §9.3: push además de la consulta periódica). La API ya manda Expo Push al cliente con la outbox de avisos (ADR 0009/0020).

## Opciones consideradas
- **Expo Push** vs **FCM directo desde la API**. Expo Push ya está en la API, unifica Android e iOS y usa FCM por debajo; FCM directo suma credenciales de Google en la API sin ventaja para el piloto.
- **Elegir destinatarios al encolar** vs **al enviar**. Al encolar, dentro de la transacción de la oferta: la outbox no lee tablas de `deliveries` (ARCHITECTURE §4) y queda una fila por repartidor, con su propio estado y reintentos.
- **Avisar a todos los de la ciudad** vs **solo a quienes pueden tomarla**. Lo segundo: el mismo criterio que la bandeja; un aviso que no se puede tomar entrena a ignorarlos.

## Decisión
- **Destinatario nuevo** `notification_outbox.audience = COURIER` con `courier_id` (una fila por repartidor), tipo `DELIVERY_OFFERED`.
- **Celulares**: `courier_push_tokens` (repartidor + token de Expo, token único: si otro repartidor entra en ese celular, pasa a ser suyo). `POST /courier/push-token` al entrar a la app aprobado y `POST /courier/push-token/remove` al cerrar sesión. Tokens dados de baja (`DeviceNotRegistered`) se borran solos.
- **Cuándo se avisa**: al publicar la oferta y al volver a ofertar (también si el comercio sube el pago de una oferta abierta). A quiénes: aprobados y disponibles de la ciudad, que cobran al menos su mínimo y que no la rechazaron.
- **Qué dice**: «Envío por $ X» · comercio de retiro, zona de destino y efectivo a cobrar. Sin dirección exacta ni destinatario, como la bandeja. Tocarlo abre Ofertas.
- **Que no llegue tarde**: el aviso lleva el vencimiento de la oferta (`expiresAt`): el worker no lo manda si ya pasó y Expo recibe ese `ttl`. Cuando la oferta deja de estar abierta (tomada, vencida, cancelada) o cambia, los avisos sin mandar quedan `SKIPPED`.
- **App**: `expo-notifications`, canal de Android `offers` con importancia máxima, sonido y vibración. Con la app abierta también se muestra y refresca la bandeja. Si el permiso está negado, la bandeja lo avisa y ofrece activarlo (o abre los ajustes del sistema).

## Consecuencias
- La consulta cada 8 s sigue: el push no garantiza entrega inmediata y el estado real siempre sale de la API.
- **Pendiente para que llegue de verdad**: proyecto de Firebase con la app `ar.pedilo.courier`, `google-services.json` en la app (`android.googleServicesFile`), la clave de cuenta de servicio de FCM V1 cargada en EAS (`eas credentials`) y un build propio (Expo Go no recibe push). Probarlo con pantalla bloqueada y ahorro de batería → puerta G2.
- Un repartidor con un reparto en curso también recibe ofertas (igual que en la bandeja).
- El mismo canal sirve para avisarle al repartidor otras cosas (el comercio canceló, chat, incidencias).
