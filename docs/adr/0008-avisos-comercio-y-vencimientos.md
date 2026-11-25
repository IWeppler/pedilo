# 0008 — Avisos al comercio y vencimiento de pedidos (primera etapa)

- **Estado:** Aceptada
- **Fecha:** 2026-11-24

## Contexto
SPEC §10 pide avisos redundantes para que el comercio no pierda pedidos: realtime, sonido, push, polling de respaldo, outbox durable y alarma de pedidos sin reconocer. SPEC §7.1 pide que un pedido no aceptado dentro de un plazo venza solo, y §14.1 pide workers durables («nada crítico solo en memoria»).

Restricciones actuales:
- El hosting de `services/api` no está decidido (SPEC §17). Un proceso Node siempre encendido no está garantizado (en serverless no hay conexiones largas ni timers).
- El token del panel vive en una cookie httpOnly: el navegador no puede hablar directo con la API.
- El piloto es chico (~30 comercios, menos de 10 pedidos diarios cada uno).

## Opciones consideradas
- **Realtime con SSE/WebSocket desde la API** — aviso instantáneo; necesita un proceso con conexiones largas y un proxy en el panel. Depende del hosting.
- **Supabase Realtime** — sin infraestructura propia; pero los roles y permisos viven en nuestra base y RLS está cerrado sin políticas (migración 0004), habría que duplicar reglas de acceso.
- **Polling liviano + alarma en el navegador** — funciona en cualquier hosting y con la pestaña abierta; con la pestaña en segundo plano el navegador puede espaciar el pulso a 1 por minuto.
- **Workers:** cola en Postgres con un barrido periódico vs. una librería de colas (pg-boss, BullMQ) vs. cron externo.

## Decisión
Primera etapa, sin depender del hosting:

1. **Plazo de aceptación:** cada pedido guarda `accept_deadline_at` al crearse (`ORDER_ACCEPT_TIMEOUT_MINUTES`, 15 por defecto).
2. **Vencimiento:** un worker dentro del proceso de la API barre cada `ORDER_EXPIRY_SWEEP_SECONDS` (30) los pedidos `PLACED` vencidos y los pasa a `EXPIRED` (actor `SYSTEM`, motivo visible para el cliente). Es durable porque el estado está en la base: si el proceso se cae, el siguiente barrido recupera lo pendiente. `SELECT … FOR UPDATE SKIP LOCKED` evita duplicados con varias instancias. Con `ORDER_EXPIRY_SWEEP_SECONDS=0` se apaga (para correrlo en otro proceso o con un cron que llame a `expireOverdueOrders`).
3. **Reconocimiento:** `acknowledged_at` en el pedido. Lo marca `POST /v1/merchants/{id}/orders/ack` («Visto») o aceptar/rechazar. Equivale al `order_acknowledged` de SPEC §10.
4. **Pulso:** `GET /v1/merchants/{id}/orders/pulse` devuelve una `version` (cambia con cualquier pedido) y los pedidos esperando. El panel lo consulta cada 5 s por un route handler propio (adjunta el token de la cookie) y recarga solo si cambió la versión.
5. **Alarma en el panel**, en todas las páginas del comercio: banner, título que parpadea, sonido repetido (Web Audio, se activa con un toque: consentimiento explícito) y una notificación del sistema por pedido (si el comercio da permiso). Suena hasta que el pedido se ve, se acepta, se rechaza o vence.

## Consecuencias
- El cliente ve «Vencido» con el motivo si el comercio no responde; el pedido no queda colgado.
- Con el panel abierto (aunque sea en otra pestaña), el comercio se entera en ≤ 5 s, o ≤ 1 min si el navegador frenó la pestaña.
- **No cubre la pestaña cerrada ni el teléfono bloqueado.** Para eso falta la segunda etapa: Web Push (service worker + VAPID) con outbox de notificaciones y registro `notification_sent/seen`; o una app Android de alertas si el piloto lo muestra necesario (SPEC §10). Realtime por SSE se suma cuando se decida el hosting.
- La puerta **G3** (comercio recibe y reconoce pedidos en PC y Android) requiere probar esto en campo, incluido Android con la pantalla apagada.
- Si la API se despliega en un entorno sin procesos persistentes, el barrido debe moverse a un cron (misma función).
