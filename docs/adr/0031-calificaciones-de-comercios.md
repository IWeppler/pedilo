# 0031 — Calificaciones de comercios

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
SPEC §11.3 pide valoración de comercios por compradores verificados, solo sobre pedidos reales. El inicio de la app (ADR 0028) ya reservaba el orden «Mejor puntuados» y el filtro «4,5 o más» para cuando hubiera calificaciones. La SPEC también pide valorar repartidores y la experiencia de retiro, y prohíbe calificaciones públicas de compradores. Con pocos comercios y pocos pedidos en el piloto, una o dos opiniones pueden decidir el promedio de un local.

## Opciones consideradas
- **Calificar comercio, repartidor y retiro ahora** vs **solo el comercio**. Solo el comercio: es lo que el cliente ve al elegir. El repartidor y el retiro quedan para cuando haya volumen de reparto propio.
- **Promedio público desde la primera** vs **con un mínimo**. Con un mínimo (5): evita que un local nuevo quede marcado por una sola mala experiencia.
- **Comentarios públicos** vs **solo para el comercio y Pedilo**. Solo para el comercio y Pedilo: publicarlos exige moderación, que todavía no existe.
- **Editar la calificación** vs **una sola vez**. Una sola vez: más simple de auditar. Un reclamo va por el flujo de reclamos.

## Decisión
- **Módulo `ratings`** con la tabla `merchant_ratings`: pedido (único), código del pedido, comercio, cliente, estrellas 1–5 y comentario opcional de hasta 500 caracteres. Tiene RLS sin políticas, como el resto (migración 0004).
- **Reglas en el dominio** (`ratings.ts`): plazo de 14 días desde la entrega o el retiro (`RATING_WINDOW_DAYS`), mínimo público de 5 (`MIN_RATINGS_PUBLIC`) y promedio con un decimal, redondeo half-up (`summarizeRatings`).
- **Calificar**: `POST /customer/orders/{orderId}/rating`. Solo quien hizo el pedido, con el pedido entregado o retirado. Responde 409 con `reason` ORDER_NOT_COMPLETED, RATING_EXISTS (garantizado por el índice único, sin carreras) o RATING_WINDOW_CLOSED.
- **Público**: el listado de comercios trae `rating` (`{ average, count }`), que es `null` mientras haya menos de 5. Con eso funcionan «Mejor puntuados» y «4,5 o más», que solo aparecen si algún comercio tiene promedio público.
- **App**: tarjeta para calificar en la pantalla del pedido terminado, aviso en el inicio para el pedido más reciente sin calificar y promedio en el comercio.
- **Panel**: sección «Calificaciones» (`GET /merchants/{merchantId}/ratings`) con el promedio, la distribución por estrellas, si ya es público y las últimas 50 con comentarios.

## Consecuencias
- El promedio se calcula al pedirlo. Con mucho volumen va a convenir guardar un agregado por comercio.
- Las calificaciones no caducan ni se ponderan por antigüedad.
- Pendiente: calificar repartidores (por clientes y comercios) y el retiro (por repartidores), respuesta del comercio a un comentario, moderación y denuncia de comentarios, y cuidar que al comercio no se le impute la demora del reparto (SPEC §11.3).
