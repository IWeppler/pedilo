# 0023 — Punto exacto de entrega

- **Estado:** Aceptada
- **Fecha:** 2026-11-27

## Contexto
El pedido con envío guarda solo la dirección escrita y la zona (ADR 0007). En pueblos y barrios sin numeración clara eso no alcanza para que el repartidor llegue a la puerta. Además, el mapa del seguimiento (ADR 0022) no tenía dónde mostrar el destino.

## Opciones consideradas
- **Geocodificar en el servidor** (API de Geocoding paga) vs **que el cliente confirme el punto en el mapa**. La geocodificación sola falla justo donde más falta hace; el cliente sabe dónde vive. Se usa el geocodificador del teléfono (`expo-location`, sin clave) solo para centrar el mapa.
- **Arrastrar un marcador** vs **pin fijo en el centro y se mueve el mapa**. El pin fijo es más preciso con el dedo y es el patrón que la gente ya conoce.
- **Obligatorio** vs **opcional**. Opcional para no frenar el pedido; la app lo sugiere al lado de la dirección.

## Decisión
- **Pedido:** `delivery_lat`/`delivery_lng` opcionales. `deliveryAddress.location` en `POST /v1/public/orders`; si la sucursal tiene ubicación, el punto no puede quedar a más de 30 km (`MAX_DROPOFF_DISTANCE_M`) para evitar un pin soltado en otra ciudad. Se devuelve en `delivery.location` al cliente y al comercio.
- **Reparto:** se copia como snapshot (`dropoff_lat`/`dropoff_lng`) y, como la dirección, el repartidor lo ve recién asignado. «Abrir en el mapa» navega a las coordenadas en vez de buscar la dirección.
- **App del cliente:** en el carrito, «Marcar en el mapa» abre `LocationPicker`. Arranca en el punto ya marcado, si no en la dirección escrita (con la ciudad), si no en la ubicación del teléfono y si no en la sucursal. El punto se recuerda junto con la dirección y deja de valer si la dirección cambia. En web se ofrece usar la ubicación del navegador.
- **Seguimiento:** el mapa muestra la casa y al repartidor y encuadra los dos.
- **Panel:** «ver en el mapa» junto a la dirección del pedido.
- La API pública de sucursales ahora incluye `lat`/`lng` (centra el mapa).

## Consecuencias
- El repartidor llega con un punto exacto cuando el cliente lo marca; sin marcarlo, todo funciona como antes.
- El punto es un dato personal del pedido: se guarda con él (mismo trato que la dirección).
- **Pendiente:** cargar la ubicación de las sucursales en el panel con el mismo selector (hoy es opcional y sin mapa), distancia y tiempo estimado con el punto, y tarifa por distancia (SPEC §9.2).
