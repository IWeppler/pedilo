# 0006 — Catálogo por comercio, precio único; variantes con precio propio

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
El SPEC (§12.1, §15, §17) deja abierta la fuente única de precio: `products` como oferta del comercio o una tabla `product_offers` separada, ligada a productos canónicos con GTIN. También pide variantes, grupos de modificadores con mínimo/máximo, límites por opción y pausar productos (US-201, US-203). La mayoría de los comercios del piloto tienen una sola sucursal (plan Emprendedor/Negocio).

## Opciones consideradas
- **Catálogo por sucursal** — máxima flexibilidad, pero un comercio con 3 sucursales carga y mantiene 3 menús.
- **Catálogo por comercio con overrides por sucursal** — un menú, y excepciones de precio/stock por sucursal cuando hagan falta.
- **Productos canónicos + ofertas desde el inicio** — habilita comparar precios entre comercios, pero agrega complejidad que el piloto gastronómico no necesita.

## Decisión
- **`products` es la oferta y la única fuente de precio**, a nivel **comercio**: todas las sucursales comparten productos y precios. Pausar un producto lo pausa en todas.
- **Overrides por sucursal** (precio/disponibilidad) y **vínculo a productos canónicos** (`canonical_products`, GTIN) quedan para después; el modelo lo admite agregando tablas sin cambiar `products`.
- **Variantes con precio absoluto** ("Chica $6.000 / Grande $9.000"): si un producto tiene variantes, el cliente elige una y su precio reemplaza al del producto. Es como los comercios piensan sus precios.
- **Modificadores con recargo** (≥ 0) agrupados con `minSelect`/`maxSelect` y `maxQuantity` por opción; cada unidad cuenta como una elección.
- Las reglas viven en `@pedilo/domain` (`validateMenuProduct`, `priceSelection`): la API las usa al guardar y al recalcular precios en el checkout.
- Cada producto puede asociarse opcionalmente a una **categoría global de producto** (taxonomía del admin) para búsqueda futura; el menú del comercio se organiza en **secciones propias**.
- El catálogo se puede editar en borrador, en revisión y aprobado (no forma parte de la revisión); se bloquea con el comercio suspendido.

## Consecuencias
- Un comercio multisucursal con precios distintos por local deberá esperar los overrides.
- Las fotos de producto requieren storage (pendiente); el modelo no las incluye todavía.
- Los pedidos guardarán snapshot de nombre y precio, así que editar o borrar variantes no rompe el historial.
