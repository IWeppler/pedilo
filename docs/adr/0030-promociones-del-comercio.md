# 0030 — Promociones del comercio: ofertas y cupones

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
SPEC §12.4 pide un motor de promociones; el P0 son cupones básicos (porcentaje o monto, fechas, cupo, mínimo, elegibilidad) con canje transaccional, sin doble uso bajo concurrencia y con reversa en cancelaciones. El inicio de la app necesita además algo visible (banner, filtro «Descuentos», precios tachados), que un cupón con código no da. Pedilo no custodia la plata del pedido (la cobra el comercio), así que una promo pagada por Pedilo exige un mecanismo de compensación que todavía no existe.

## Opciones consideradas
- **Solo cupones** vs **solo ofertas automáticas** vs **las dos**. Las dos: las ofertas alimentan el inicio y el menú; los cupones sirven para campañas por fuera (redes, volantes).
- **Acumulables** vs **la mejor**. La mejor: más simple de explicar y de auditar, y evita descuentos que se apilan sin control.
- **Promos pagadas por Pedilo ahora** vs **después**. Después: en esta etapa todas las paga el comercio.
- **Cupo con lock de aplicación** vs **UPDATE condicional**. UPDATE condicional (`redemptions_count < max_redemptions`), como la aceptación de ofertas de reparto (ADR 0014).

## Decisión
- **Módulo `promotions`**: `promotions` (OFFER o COUPON; porcentaje 1–90 o monto; todo el menú o productos; mínimo; tope; desde/hasta; cupo total; usos por cliente; activa), `promotion_products` y `promotion_redemptions` (APPLIED / REVERSED, uno por pedido).
- **Cálculo** en el dominio (`evaluatePromotion`, `bestPromotion`, `offerUnitPrice`): porcentaje con redondeo half-up, nunca más que lo que suman los productos alcanzados ni que el tope; el mínimo se mira sobre el subtotal antes del descuento.
- **El pedido** lleva la mejor oferta vigente o el cupón si descuenta más. Un cupón que no sirve corta el pedido con 409 y `reason` COUPON_* (INVALID, EXPIRED, EXHAUSTED, ALREADY_USED, MIN_NOT_MET, NOT_APPLICABLE). Se guarda `discount_minor`, la promo, su texto y el código; `total = subtotal − descuento + envío`.
- **Comisión** sobre `subtotal − descuento` (la paga el comercio: SPEC §6.2, base comisionable).
- **Canje** en la transacción del pedido: promo bloqueada, límite por cliente y cupo con UPDATE condicional. Si el pedido se cancela, se rechaza o vence, el uso se revierte y vuelve al cupo.
- **Cotización** `POST /public/orders/quote`: mismas reglas sin crear nada; un cupón inválido vuelve en `couponError` y, si la oferta descuenta más, `couponOutdone`.
- **Público**: ofertas en el menú (`offers`), la más llamativa en el listado de la ciudad (`offer`) y `GET /public/cities/{slug}/offers` para el banner. Los cupones nunca se publican.
- **Panel**: «Promociones» (solo el dueño crea y edita), con estado (vigente, programada, pausada, agotada, terminada) y usos. **App**: banner de ofertas debajo de «¿Qué tenés ganas de pedir?», filtro «Descuentos», etiqueta en el comercio, precio tachado en el menú, cupón y descuento en el checkout y en el pedido.

## Consecuencias
- Promos pagadas por Pedilo (bienvenida, envío gratis): requieren definir la compensación (crédito en la comisión o pago aparte) antes de construirlas.
- Fechas del panel en hora de Argentina (UTC−3, sin horario de verano).
- Pendiente: BOGO y combos (P1 de la SPEC), presupuesto por promo, antifraude de autocuentas, y precio con oferta en la pantalla del producto.
