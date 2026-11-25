# 0014 — Reparto desacoplado y ofertas con aceptación atómica

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
SPEC §9: el reparto es un agregado propio, no depende de `Order`, guarda snapshots y se comunica con pedidos por comandos y eventos; ningún módulo escribe en las tablas del otro. Modelo híbrido (§9.2): el comercio propone una tarifa, repartidores independientes con tarifa mínima aceptan o rechazan; la oferta no muestra la dirección exacta; la aceptación es atómica. La puerta **G2** exige dos repartidores disputando una oferta y recuperación tras desconexión.

## Opciones consideradas
- **Tabla de ofertas por repartidor** (`delivery_offers`, una fila por candidato) vs **la oferta es el delivery en `OFFERED`** visible a los candidatos de la ciudad. La segunda alcanza para el piloto (pocos repartidores, una ciudad) y simplifica la atomicidad.
- **Aceptación con lock pesimista** vs **UPDATE condicional** (`WHERE status = 'OFFERED' AND offer_expires_at > now()`). El UPDATE condicional es atómico en una sola sentencia y no depende del reloj del teléfono.
- **Eventos por outbox** vs **listener en proceso, misma transacción**. Con un solo proceso de API, el listener mantiene pedido y reparto consistentes sin infraestructura extra.

## Decisión
- **Módulo `deliveries`** (`courier_profiles`, `deliveries`, `delivery_events`, `delivery_declines`). `deliveries.order_id` es un dato, no una FK. No importa nada del módulo `orders`.
- **Comandos de pedidos → reparto:** `requestDelivery` (al pedir repartidor: snapshot de retiro, destino, destinatario, contenido y efectivo a cobrar) y `cancelDeliveriesForOrder` (pedido cancelado o rechazado).
- **Eventos de reparto → pedidos:** `onDeliveryStatusChange`, conectado en `app.ts` a `applyDeliveryEvent`, que traduce con `orderStatusForDeliveryStatus`: retirado → «salió el envío» (si el pedido no estaba listo, se lo marca listo antes), entregado → entregado (devenga la comisión, ADR 0012), fallido → fallido con el motivo.
- **Pedir repartidor:** el comercio lo hace en pedidos con envío, entre aceptado y listo (`POST /merchants/{id}/orders/{orderId}/delivery`). Tarifa sugerida: el envío que pagó el cliente; el comercio la ajusta. Oferta de 10 minutos. Un reparto activo por pedido (índice único).
- **Repartidores:** se registran (`POST /courier/profile`), un admin los aprueba, rechaza o suspende con motivo. Solo aprobados y disponibles ven ofertas de su ciudad que pagan al menos su mínimo y que no rechazaron. La oferta no incluye dirección ni destinatario (`canRevealDropoffAddress`).
- **Aceptar:** UPDATE condicional con hora del servidor → `OFFER_TAKEN` u `OFFER_EXPIRED` para el que pierde. Rechazar no penaliza.
- **Estados del repartidor:** `courierDeliveryActions` (voy al comercio, retirado, llegando, entregado, no se pudo entregar, no puedo hacerlo). Cada acción lleva un `eventId` generado por la app: un reintento tras perder señal no duplica nada. Cancelar o fallar exigen motivo. Si cancela antes de retirar, deja de ser suyo y el comercio vuelve a ofertar.
- **El comercio no marca a mano** la salida, la entrega ni la falla mientras haya un reparto de Pedilo (`DELIVERY_IN_PROGRESS`); puede cancelar la búsqueda y mandarlo por su cuenta. Con el paquete retirado no se cancela.
- **Vencimiento de ofertas:** worker `offer-expiry` → `OFFER_EXPIRED`; el comercio sube la tarifa o vuelve a ofertar (quienes la rechazaron la vuelven a ver).
- **El pulso del tablero** incluye los cambios de repartos, así el panel se actualiza cuando un repartidor acepta.

## Consecuencias
- G2 en la API: probado con dos aceptaciones simultáneas (gana una) y reintentos con el mismo `eventId`. Falta probarlo con la app en dispositivos reales.
- El comercio le paga al repartidor por fuera; Pedilo registra tarifa y efectivo a cobrar, sin custodiar fondos (SPEC §9.2). **Pendiente:** saldos comercio↔repartidor (`courier_merchant_ledger`).
- **Pendiente:** app del repartidor (siguiente paso), push FCM de ofertas, repartidores propios del comercio (asignación directa), prueba de entrega con PIN, chat e incidencias, métricas y valoraciones, deliveries sin pedido (`MERCHANT_REQUEST`).
- Si la API pasa a varias instancias o a workers separados, el listener en proceso sigue siendo correcto (misma transacción); un outbox sería necesario solo para efectos externos (push).
