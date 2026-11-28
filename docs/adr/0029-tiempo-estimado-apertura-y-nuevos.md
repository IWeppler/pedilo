# 0029 — Tiempo estimado, próxima apertura y comercios nuevos

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
En la lista de comercios faltaba lo que más pesa al elegir después de la comida: cuánto tarda. Además, un comercio cerrado decía solo «Cerrado», cuando en Tostado (siesta, pocos comercios) muchas veces hay más cerrados que abiertos y se puede programar. Y no había forma de destacar a los que recién se suman.

## Opciones consideradas
- **Tiempo calculado con el historial** vs **cargado por el comercio**. Sin pedidos todavía, el historial no existe: el comercio carga su tiempo de preparación y más adelante se ajusta con datos reales.
- **Un rango cargado (mín–máx)** vs **un número**. Un número es más fácil de mantener; la app arma el rango sumando el viaje.
- **Próxima apertura como instante UTC** vs **día relativo + hora local**. Día relativo + hora local (`inDays`, `weekday`, `time`): la app arma «hoy», «mañana» o el día sin convertir zonas horarias.

## Decisión
- `merchants.prep_minutes` (5–120, opcional), editable desde «Local y entregas» también con el comercio aprobado.
- La app muestra con envío `preparación + 10` a `preparación + 20` min (viaje típico en una ciudad chica) y, solo retiro, «Listo en X min». Con algún tiempo cargado aparece el orden «Más rápidos».
- `nextOpening` (dominio): próxima apertura en los próximos 7 días, salteando cierres excepcionales. El listado devuelve `opensNext` (la más próxima entre sus sucursales) y `schedulingEnabled`. Un cerrado dice «Abre 20:00», «Abre mañana 11:00» o «Abre el lunes 11:00», con «· Programá tu pedido» si acepta programados.
- `isNew`: aprobado en los últimos 30 días (`NEW_MERCHANT_DAYS`, por `reviewed_at`). Etiqueta «Nuevo».

## Consecuencias
- El tiempo es una estimación declarada: si un comercio pone 10 min y tarda 40, el cliente se queja. Cuando haya historial, calcularlo con pedidos reales (aceptado → listo, y retirado → entregado) y avisar al comercio si su número se aleja.
- Los 10–20 min de viaje son fijos para la ciudad; con más ciudades, que dependan de la ciudad o de la zona.
