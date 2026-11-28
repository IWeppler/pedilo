# 0034 — Varias direcciones del cliente y «¿Desde dónde pedís?»

- **Estado:** Aceptada (amplía el ADR 0026, que guardaba una sola dirección en el perfil)
- **Fecha:** 2026-11-28

## Contexto
Con una sola dirección guardada, el que pide desde el trabajo tiene que reescribir la dirección o se arriesga a que el cadete vaya a su casa. La planilla de decisiones pide guardar casa y trabajo en el registro, confirmar en cada pedido desde dónde se pide y avisar si el GPS está lejos de la dirección elegida.

## Opciones consideradas
- **Columnas en el perfil (casa y trabajo)** vs **tabla de direcciones**. Tabla: permite sumar otras (hasta 5) sin cambiar el esquema de nuevo.
- **Dirección elegida en la base** vs **en el teléfono**. En el teléfono: es una preferencia del momento (puede pedir desde el trabajo en un celular y desde casa en otro), y el pedido igual guarda una copia de la dirección.
- **Pedir el permiso de ubicación en el checkout** vs **solo al tocar «Usar mi ubicación»**. Solo al tocar: el aviso de «estás lejos» usa el GPS únicamente si el permiso ya estaba dado.

## Decisión
- **Tabla `customer_addresses`** (migración 0030):
  - etiqueta Casa, Trabajo u Otra; una Otra puede tener nombre («Casa de mamá»)
  - calle y número, indicaciones y el punto en el mapa (ADR 0023)
  - hasta 5 por cliente, y una sola Casa y un solo Trabajo (índice único parcial)
  - la dirección que tenía cada cliente pasó a ser su Casa, y las columnas de dirección salieron del perfil
- **API**: `GET /customer/me` trae `addresses` (Casa, Trabajo y después las otras por antigüedad). `POST`, `PUT` y `DELETE /customer/me/addresses[/{id}]` responden 409 con PROFILE_REQUIRED, ADDRESS_LIMIT o ADDRESS_LABEL_TAKEN. `PUT /customer/me` ya no lleva dirección.
- **Pedidos**: sin cambios. El checkout manda la dirección elegida y el pedido guarda su copia, así que editar o borrar una dirección no cambia pedidos hechos.
- **App**:
  - **Registro**: nombre, teléfono y Casa y/o Trabajo (se puede saltear una, no las dos).
  - **«¿Desde dónde pedís?»** se abre desde el encabezado del inicio y desde el checkout. Permite elegir una dirección guardada, usar la ubicación actual (el GPS sugiere la calle y el punto para guardarla como dirección nueva), agregar o editar direcciones, y cambiar la ciudad. La elegida se recuerda en el teléfono.
  - **Checkout**: muestra la dirección elegida con «Cambiar». Si el GPS (con permiso ya dado) ubica al cliente a más de 300 m, avisa «Estás a 1,2 km de casa. ¿Pedís desde otro lado?».
  - **«Tus datos»** edita solo nombre y teléfono, con un acceso a «Tus direcciones».

## Consecuencias
- En web no hay geocodificación inversa: «Usar mi ubicación» marca el punto, pero la calle hay que escribirla.
- La planilla pide el selector también «arriba del inicio»: es el encabezado del inicio, que ahora muestra «Casa · Belgrano 456».
- Pendiente: ordenar las otras direcciones por uso reciente, y avisar al guardar una dirección que queda fuera de las zonas de envío del comercio (tarea 4.9 de la planilla).
