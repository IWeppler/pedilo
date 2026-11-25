# 0015 — App del repartidor

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
SPEC §9.3 pide una app Android para repartidores: registro, disponibilidad, tarifa mínima, bandeja de ofertas, aceptar/rechazar, navegación externa, estados de retiro y entrega, historial. Y «condiciones hostiles»: reconexión con `event_id`, colas persistentes y deduplicación en servidor; no aceptar ni confirmar entregas offline como si estuvieran confirmadas; consulta periódica además del push; estados y tiempos definitivos siempre en backend. El backend ya existe (ADR 0014).

## Opciones consideradas
- **Login con magic link** (como los paneles) vs **código de 6 dígitos por email**. En el teléfono el link obliga a deep links y abre el navegador; el código se tipea en la app.
- **Cola de acciones en memoria** vs **persistida en el teléfono**. Persistida: sobrevive a cerrar la app o a que Android la mate.
- **Push FCM ya** vs **consulta periódica primero**. FCM requiere proyecto de Firebase y build de desarrollo (no corre en Expo Go); la consulta cada 8 s con la app abierta funciona hoy y la SPEC la pide igual como respaldo.

## Decisión
- **App Expo** `apps/courier-mobile` (Expo Router, TanStack Query, tema claro), misma base que la del cliente.
- **Sesión:** Supabase Auth con `signInWithOtp` + `verifyOtp` (código por email); sesión guardada en el teléfono (`expo-sqlite` kv) y renovada con la app en primer plano. En desarrollo, login pegando un token de `dev:token`.
- **Flujo:** sin perfil → registro (nombre, teléfono, vehículo, ciudad, pago mínimo); en revisión → pantalla de espera que se actualiza sola; aprobado → pestañas **Ofertas**, **En curso** y **Perfil**.
- **Ofertas:** interruptor «Disponible»; lista cada 8 s con pago, comercio, zona de destino (sin dirección), contenido y efectivo a cobrar; vencimiento mostrado como hora del servidor. Aceptar requiere conexión; `OFFER_TAKEN` / `OFFER_EXPIRED` se explican.
- **En curso:** retiro y destino con llamar y abrir en Google Maps (navegación externa), efectivo a cobrar, pago, y las acciones de `courierDeliveryActions` (las que piden motivo, con motivo).
- **Cola persistente** (`lib/outbox.tsx`): cada acción se guarda con un `eventId` y se manda en orden; sin señal queda «pendiente de enviar» (nunca como confirmada) y se reintenta cada 10 s, al volver a primer plano y al abrir la app. Un 4xx descarta la acción y avisa; el servidor deduplica por `eventId`.
- **Perfil:** pago mínimo editable, historial de entregas y total cobrado (informativo: lo paga el comercio).

## Consecuencias
- Corre en Expo Go sin build propio. Probado: typecheck, lint y bundle de Android. **Falta** probarla en dispositivos reales con las pruebas de §9.3 (batería, pantalla bloqueada, cambio de red, 2G/3G, doble toque, reloj incorrecto, permisos) → puerta G2 completa.
- Con la app cerrada no llegan ofertas. **Pendiente:** push FCM (build de desarrollo con `expo-notifications` y proyecto de Firebase), chat e incidencias, prueba de entrega con PIN, saldos comercio↔repartidor.
- El login por código requiere que la plantilla de email de Supabase incluya `{{ .Token }}` (configuración del proyecto).
