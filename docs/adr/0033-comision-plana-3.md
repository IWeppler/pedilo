# 0033 — Comisión plana del 3%

- **Estado:** Aceptada (reemplaza los precios de la v0.4 del ADR 0012; el mecanismo sigue igual)
- **Fecha:** 2026-11-28

## Contexto
El ADR 0012 armó la comisión como versiones de precios en la base, y sembró la hipótesis v0.4 de la SPEC §6. Esa hipótesis tiene tres planes (Emprendedor 6% sin mensualidad, Negocio 4% + $25.000 por mes, Pro 2,5% + $60.000 por mes), tramos que bajan la tasa en pedidos grandes y un tope por pedido según el rubro. La decisión de producto del 2026-11-28 es otra: 3% del subtotal, sin suscripción y sin tope. Así es fácil de explicar al comercio y deja poco incentivo para cobrar por fuera de la app. Además, 3% alcanza la meta de ingresos con un volumen razonable entre varias ciudades.

## Opciones consideradas
- **Borrar los planes del modelo** vs **una versión de precios nueva**. Versión nueva: el mecanismo del ADR 0012 ya cubre cambios de precio sin tocar pedidos viejos. Si más adelante vuelven los planes pagos, alcanza con otra versión.
- **Tope muy alto** vs **tope opcional**. Opcional (`null` = sin tope): un tope ficticio de millones se vería en el panel y confundiría.

## Decisión
- **Versión `v1-3pct`** (migración 0029, `FLAT_PRICING` en el dominio):
  - un solo tramo al 100% de la tasa base
  - los tres planes con 3% (300 bps) y sin mensualidad
  - sin tope en ningún rubro
  - rige desde que corre la migración
- **Pedidos anteriores**: conservan la comisión con la que se calcularon (v0.4). Lo ya devengado no cambia.
- **El tope de un rubro puede ser `null`** en el dominio, la base y la API (`capsByCategory`, `capMinor`).
- **Paneles**: cuando todos los planes cobran lo mismo (`hasSinglePlan`), no se muestra ni se compara el plan.
  - El comercio ve «Comisiones», con «3% · sin mensualidad · sin tope» y un simulador de una fila.
  - El admin no ve el formulario para cambiar de plan.
- **Mercado Pago**: el `application_fee` del split sale del mismo cálculo, así que pasa a ser el 3%.
- **Tests**: la mecánica de planes, tramos y topes se sigue probando con los precios de la v0.4, cargados como versión propia del test.

## Consecuencias
- Simulación de referencia: un pedido de $9.000 paga $270; uno de $450.000 paga $13.500 (antes tenía tope de $5.000).
- La planilla de decisiones menciona un período gratis al lanzar. Si se hace, será otra versión con 0% y fecha de fin, seguida de la v1.
- Los límites de sucursales y usuarios del plan siguen sin aplicarse (ADR 0012): los tres planes dicen 1 y 1.
