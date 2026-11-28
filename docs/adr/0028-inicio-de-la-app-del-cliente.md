# 0028 — Inicio de la app del cliente: platos, volver a pedir y una sola lista

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
El inicio giraba alrededor de los comercios: un carrusel de estadísticas («1 comercio abierto ahora»), una fila de comercios, «Abiertos ahora» y «Todos los comercios», que mostraban los mismos comercios tres veces. La comida (los productos con foto) solo se veía al entrar a un menú, y no había nada para quien vuelve. No existen todavía calificaciones, tiempos de preparación ni promos.

## Decisión
- **Orden:** dirección y avisos → buscador → «¿Qué tenés ganas de pedir?» → (promo de Pedilo, cuando existan) → «Volver a pedir» → «Platos para probar» → «Comercios». Las secciones sin datos no se muestran.
- **Platos para probar** (`GET /public/cities/{slug}/dishes`): productos con foto, activos y no pausados, de comercios de la ciudad; abiertos primero y repartidos entre comercios (una vuelta por comercio). Tocar uno abre el producto.
- **Volver a pedir:** el último pedido entregado o retirado de cada comercio, con el resumen de lo pedido (`GET /customer/orders` suma `merchantSlug` e `itemsSummary`). Abre el menú del comercio; repetir el carrito queda para después.
- **Una sola lista de comercios** con una fila deslizable de orden y filtros:
  - Ordenar: Sugeridos (abiertos primero), Envío más barato, Más económicos.
  - Filtros: Tipo de local (rubro), Precio ($, $$, $$$), Abiertos, Envío gratis, Retiro, y «Limpiar» cuando hay alguno activo.
  - **Nivel de precio** del comercio (`priceLevel`): mediana de sus precios de lista; hasta $8.000 = $, hasta $15.000 = $$, más = $$$ (umbrales en `PRICE_LEVEL_LIMITS_MINOR`, a revisar con la inflación).
- **No se muestran opciones sin datos:** «Mejor puntuados», «4,5 o más» (requieren calificaciones), «Más rápidos» (tiempo de preparación) y «Descuentos» (promos) se suman cuando exista lo que las alimenta.
- **Pestaña «Cuenta»** en la barra: datos, dirección, ciudad, avisos y salir.

## Consecuencias
- Sin fotos de producto, «Platos para probar» no aparece: conviene pedirles a los comercios del piloto que suban fotos.
- Siguientes pasos: tiempo de preparación por comercio («25–35 min» y «Más rápidos»), promos (banner de Pedilo debajo de los tipos de comida, «Descuentos»), calificaciones y «Lo más pedido» con volumen.
