# 0035 — Carrito y perfil del comercio: «Lo más pedido», sugerencias y agregar con el «+»

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
El carrito era una pantalla larga de tarjetas grandes (cómo lo recibís, cuándo, cómo pagás) con los productos sin foto, y el botón de confirmar se apagaba sin decir por qué. El perfil del comercio no mostraba el logo ni destacaba productos, y para agregar cualquier cosa había que entrar a la ficha. Las apps grandes de delivery resuelven esto con patrones conocidos (productos destacados con foto grande, sugerencias en el carrito, filas con «Cambiar»). Queremos esos beneficios sin copiar su aspecto: Pedilo sigue con su paleta (tinta para lo principal, rojo tomate solo en señales chicas, sin sombras).

## Opciones consideradas
- **Checkout en dos pasos (carrito y pago)** vs **una sola pantalla más compacta**. Una sola pantalla: menos toques para un pedido chico. Se compacta con filas que se abren en el lugar.
- **«Lo más pedido» por unidades** vs **por pedidos**. Por pedidos: un solo pedido grande no debe poner un producto arriba.
- **Mostrar el ranking desde el primer pedido** vs **con un mínimo**. Con un mínimo (3 pedidos por producto): con pocos datos el ranking no dice nada.
- **Sugerencias calculadas en la API** vs **en la app con el menú ya cargado**. En la app: no hace falta un endpoint y la regla es simple.
- **Agregar con el «+» siempre** vs **solo si no hay nada que elegir**. Solo si no hay nada que elegir: lo decide `priceSelection` (@pedilo/domain), la misma regla de la ficha.

## Decisión
- **«Lo más pedido»**: el menú público (`GET /public/merchants/{slug}`) devuelve `popularProductIds`. Son los productos en más pedidos entregados o retirados de los últimos 30 días, con 3 pedidos como mínimo y 6 como tope (`POPULAR_PRODUCTS`, `popularProductIds` en el módulo `orders`). La app los cruza con el menú y muestra la fila si quedan al menos 2 disponibles.
- **«Con descuento»**: fila calculada en la app con las ofertas de precio fijo (porcentaje sin mínimo, `offerUnitPrice`), primero las que más ahorran, sin repetir los productos de «Lo más pedido».
- **Agregar con el «+»** (`useQuickAdd`): directo si el producto no pide variante ni opciones obligatorias, el comercio está abierto y el carrito está vacío o es del mismo comercio. Si no, abre la ficha, que es la que confirma reemplazar el pedido de otro comercio.
- **Carrito**: arriba el selector envío o retiro, porque cambia el costo y el mínimo. Después los productos con foto y «Editar», que abre la ficha con lo elegido y reemplaza la línea. Luego «¿Le sumás algo?» (hasta 8 productos fuera del pedido, primero los de secciones que el pedido no tiene) y «Entrega y pago» en filas con «Cambiar» que se abren en el lugar. El motivo del botón apagado y el ahorro van pegados al botón.
- **Perfil**: logo sobre la portada y búsqueda desde la barra compacta.

## Consecuencias
- «Lo más pedido» se calcula en cada pedido del menú. Con mucho volumen va a convenir guardarlo y recalcularlo cada tanto.
- Los comercios del piloto van a tardar en tener la fila: es esperado.
- Las ofertas con condiciones (mínimo de compra, monto fijo) no entran en «Con descuento» porque su precio depende del pedido; siguen como etiqueta en la lista.
- Pendiente: favoritos, opiniones con comentarios en el perfil y sugerencias por lo que suele pedir cada cliente.
