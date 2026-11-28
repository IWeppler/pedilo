# 0027 — Tipos de comida en el inicio de la app

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
El inicio de la app del cliente filtraba comercios por rubro (Gastronomía, Kioscos, Supermercados…). Es la clasificación que necesita Pedilo para la comisión (ADR 0012), pero no es como piensa quien tiene hambre: las apps de delivery muestran tipos de comida (hamburguesas, pizzas, bebidas…). Además, los nombres largos de rubro se cortaban en dos renglones.

Los productos ya pueden tener una categoría global (`products.category_id`, taxonomía del admin), pero el panel del comercio no permitía elegirla.

## Opciones consideradas
- **Etiquetas en el comercio** («vende hamburguesas») vs **categoría de cada producto**. El producto: un comercio aparece en «Bebidas» porque vende bebidas, sin que nadie lo marque a mano, y deja de aparecer si las pausa.
- **Lista fija en la app** vs **elegida por el admin**. Por el admin: puede sumar «Helados» en verano sin publicar una versión nueva.
- **Marcar sí/no** vs **posición**. Posición (`featured_order`): define también el orden de izquierda a derecha, que no coincide con el orden de la categoría dentro de su grupo.

## Decisión
- `categories.featured_order` (solo categorías de producto; null = no aparece). `GET /categories?kind=PRODUCT&featured=true` las devuelve en ese orden. El admin la edita como «Posición en el inicio de la app».
- `GET /public/cities/{slug}/merchants?productCategoryId=…` filtra por comercios con al menos un producto activo y no pausado de esa categoría **o de su rama** (elegir «Bebidas» incluye «Cervezas»). El módulo `menu` resuelve qué comercios venden (`merchantIdsSellingCategory`); `merchants` solo filtra por esos ids.
- El panel del comercio pide «Tipo de producto» al cargar cada producto (agrupado por grupo de catálogo).
- La migración `0024` marca, en este orden: Hamburguesas, Pizzas, Snacks, Bebidas, Postres y Saludable (la crea dentro de «Comidas»).
- En la app: «¿Qué tenés ganas de comer?» con un emoji por tipo y el nombre en una línea, en lugar de los rubros. El rubro sigue en la tarjeta del comercio.

## Consecuencias
- Un comercio aparece en un tipo de comida recién cuando carga productos con esa categoría: hay que pedírselo a los comercios del piloto (o cargarlo al hacer su menú).
- Los emojis salen de un mapa en la app por slug; uno nuevo sin emoji usa 🍽️. Si se quieren ilustraciones propias, el admin tendría que subir un ícono por categoría.
- Los rubros siguen igual para comisiones y para el admin.
