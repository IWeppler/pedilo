# 0022 — Seguimiento en vivo del repartidor

- **Estado:** Aceptada
- **Fecha:** 2026-11-27

## Contexto
El seguimiento del pedido (ADR 0007) muestra estados, el repartidor y el PIN, pero no dónde viene el envío. La SPEC pone el «GPS continuo» en P2 (§4.3) y pide que la ubicación del repartidor se use solo con consentimiento y retención limitada (§9.2). Este ADR adelanta una versión acotada: la ubicación se comparte solo durante un reparto, no se guarda historial y no se calculan rutas ni tiempos estimados.

## Opciones consideradas
- **Historial de puntos** (`courier_location_points`) vs **solo el último punto**. Para el mapa del cliente alcanza el último; un historial pide política de retención y crece con cada reparto. Se guarda solo el último.
- **Ubicación en `deliveries`** vs **tabla propia por repartidor**. En `deliveries` cada punto subiría `updated_at`, lo que dispara el pulso del tablero (ADR 0014) cada 15 s, y además un repartidor puede llevar varios repartos a la vez. Se usa una tabla propia por repartidor.
- **Solo con la app abierta** vs **también en segundo plano**. Un repartidor anda con la pantalla apagada, así que el primer plano solo no sirve en la calle. El segundo plano necesita build propio (en Expo Go no existe) y el permiso «todo el tiempo», que en Play Store pide una declaración. Se hacen los dos: segundo plano cuando se puede y primer plano como respaldo.
- **Mapa:** `react-native-maps` vs `expo-maps`. `react-native-maps` viene en Expo Go, así que se prueba sin build; `expo-maps` no viene. Ninguno corre en web.
- **Realtime** (SSE/WebSocket) vs **consulta periódica**. El realtime sigue pendiente (ROADMAP, hosting de la API). La consulta periódica cada 5 s con el repartidor en camino alcanza, porque él manda un punto cada 15 s.

## Decisión
- **API (`deliveries`):** tabla `courier_locations`, una fila por repartidor con lat, lng, precisión, `recorded_at` y `received_at`.
  - `PUT /v1/courier/location` solo guarda si el repartidor está aprobado y tiene un reparto en `ACTIVE_COURIER_STATUSES`. Si no tiene ninguno, borra lo que hubiera y responde `sharing: false`.
  - El teléfono manda la **antigüedad** del punto (`ageMs`), no su hora, así un reloj mal puesto no afecta (SPEC §9.3). Un punto más viejo que el guardado no lo pisa, y uno de más de 5 min se ignora.
- **Retención:** el punto se borra en la misma transacción del cambio de estado que deja al repartidor sin repartos activos (entregado, fallido, cancelado o liberado). Además, el worker `courier-locations` borra cada 5 min los puntos de más de 10 min (`COURIER_LOCATION_MAX_AGE_MS`), y esos puntos tampoco se muestran.
- **Quién ve qué:**
  - El **comercio** la ve en el panel durante todo el reparto, con «ver dónde está» en Google Maps y la antigüedad del punto.
  - El **cliente** la ve solo con el paquete retirado (`CUSTOMER_TRACKING_STATUSES`: `PICKED_UP`, `ARRIVING_DROPOFF`) en `tracking.courierLocation`. Su app la refresca cada 5 s en ese tramo.
  - El repartidor no recibe ubicaciones.
- **App del repartidor (`lib/location.tsx`):**
  - Con algún reparto en curso pide el permiso de ubicación en uso.
  - Con build propio y permiso «todo el tiempo» usa una tarea de `expo-location` en segundo plano, con el servicio en primer plano de Android y su notificación fija «Envío en curso».
  - Si no (Expo Go o sin ese permiso), usa `watchPositionAsync` solo con la app abierta.
  - Manda un punto cada 15 s o cada 10 m. Un punto que no se pudo mandar no se reintenta, porque el siguiente lo reemplaza.
  - La tarea se apaga sola cuando la API responde `sharing: false` o 401/403/404, y también al cerrar sesión.
  - El token para la API se resuelve fuera de React, así la tarea funciona aunque Android haya cerrado las pantallas.
  - «En curso» muestra si se comparte y qué hacer si no: «Permitir siempre», «Abrir ajustes» o prender el GPS.
- **App del cliente:** mapa (`components/courier-map.tsx`) con el marcador del repartidor, que sigue al repartidor cuando se mueve. Muestra al cliente solo si ya dio permiso de ubicación, sin pedirlo. En web (`courier-map.web.tsx`) abre Google Maps.

## Consecuencias
- El cliente y el comercio ven por dónde viene el envío sin que Pedilo acumule recorridos.
- **Configuración:** `GOOGLE_MAPS_ANDROID_API_KEY` (Maps SDK for Android, restringida al paquete `ar.pedilo.customer` y al SHA-1 de EAS) como variable de entorno de EAS. `app.config.js` la pasa al plugin de `react-native-maps`. En Expo Go no hace falta; sin ella, el mapa de un build propio se ve gris.
- **Play Store:** el permiso de ubicación en segundo plano de la app del repartidor exige completar la declaración de permisos de ubicación con un video del uso. Sin aprobación, se puede publicar sin ese permiso y queda el modo de primer plano.
- **Falta probar en dispositivos reales**, dentro de la puerta G2 (SPEC §9.3): pantalla apagada, ahorro de batería, GPS deshabilitado, permisos revocados y app terminada por Android.
- **Pendiente:** tiempo estimado de llegada, punto exacto de entrega (hoy el pedido no guarda coordenadas del destino), realtime en lugar de consulta periódica, y avisar al cliente con push cuando el repartidor está cerca.
