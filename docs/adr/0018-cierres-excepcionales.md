# 0018 — Cierres excepcionales (feriados y vacaciones)

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
El horario de cada sucursal es semanal. SPEC §15 prevé `special_hours` para días distintos: feriados, vacaciones, inventario. Sin eso un comercio cerrado un feriado figura «abierto», recibe pedidos y ofrece franjas de programados para ese día.

## Opciones consideradas
- **Horarios especiales por fecha** (abrir otro horario ese día) vs **solo días completos de cierre**. El caso común en el piloto es «no abrimos»; horarios distintos por fecha se agregan después sin cambiar este modelo.
- **Fechas en UTC** vs **fechas locales de la sucursal**. Locales: «el 25 de diciembre» es en Tostado, no en UTC.

## Decisión
- Tabla `branch_closures` (sucursal, `starts_on`, `ends_on` inclusive, motivo que ve el cliente). Fechas `YYYY-MM-DD` en la zona horaria de la sucursal.
- Dominio: `localDateKey`, `closureOn`, `isOpenAtInstant` y `validateClosure` (no en el pasado, fin ≥ inicio, hasta 60 días). `scheduleSlots` acepta `closures` y no ofrece franjas esos días.
- «Abierto ahora», la creación de pedidos (inmediatos: `BRANCH_CLOSED`; programados: `SLOT_UNAVAILABLE`) y las franjas usan los cierres.
- La sucursal pública expone `closedToday` (motivo y hasta cuándo) y los próximos `closures`. La app muestra «Cerrado hoy · Feriado».
- Panel: tarjeta «Cierres excepcionales» en cada sucursal (agregar con desde/hasta/motivo, quitar). Solo el dueño, como el resto de la operación.

## Consecuencias
- Un cierre se borra (no es un registro contable); queda auditado.
- **Pendiente:** horarios especiales por fecha (abrir más tarde un día), feriados nacionales precargados para elegir con un toque.
