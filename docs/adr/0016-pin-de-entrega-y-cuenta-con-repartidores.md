# 0016 — PIN de entrega y cuenta comercio ↔ repartidor

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
SPEC §9.2 pide prueba de entrega «proporcional al riesgo: confirmación del destinatario o PIN opcional». SPEC §8.3: si el repartidor cobra el efectivo, generar la deuda repartidor → comercio; §9.2: el comercio paga al repartidor por fuera y Pedilo registra sin custodiar fondos (`courier_merchant_ledger` en §15).

## Opciones consideradas
- **PIN siempre** vs **PIN opcional por reparto**. Opcional, elegido por el comercio al pedir el repartidor, con el valor por defecto en «sí».
- **PIN guardado con hash** vs **en claro**. Lo tienen que poder ver el cliente y el comercio (para dictárselo al repartidor si el cliente no lo encuentra), así que se guarda en claro y nunca se le envía al repartidor.
- **Cuenta en el ledger de comisiones** vs **cuenta propia por par comercio–repartidor**. Son deudas entre terceros que Pedilo no cobra: van separadas.

## Decisión
**PIN de entrega**
- Al pedir repartidor (`requirePin`, por defecto `true`) se genera un PIN de 4 dígitos. Lo ve el cliente en el seguimiento (`tracking.pin`, junto con el primer nombre y el vehículo del repartidor) y el comercio en el panel. El repartidor recibe solo `pinRequired`.
- Para pasar a `DELIVERED` el repartidor manda el `pin`. Cada error suma un intento (se guarda aunque la acción falle): `PIN_INVALID` con `attemptsLeft`; al quinto, `PIN_LOCKED`. El comercio lo desbloquea (`POST /merchants/{id}/deliveries/{id}/reset-pin`).
- Sin señal: el PIN viaja en la cola de la app; si es incorrecto, el servidor rechaza la acción y la app lo avisa.

**Cuenta comercio ↔ repartidor** (`courier_merchant_entries`, append-only)
- Convención: positivo = el comercio le debe al repartidor; negativo = el repartidor le debe al comercio.
- Al entregar, en la misma transacción: `DELIVERY_FEE` (+ pago + propina) y, si cobró efectivo, `CASH_COLLECTED` (− efectivo). Un asiento de cada tipo por reparto (índice único).
- Pagos: los registra el comercio (`PAYMENT`): «le pagué» (TO_COURIER, resta) o «me rindió el efectivo» (FROM_COURIER, suma). Solo con repartidores con los que ya trabajó. Un error se corrige con otro pago.
- Pantallas: «Repartidores» en el panel del comercio (saldo con cada uno, movimientos y registrar pago); «Cuentas con comercios» en el perfil de la app del repartidor.

## Consecuencias
- Pedilo no mueve dinero: registra y muestra. Si comercio y repartidor no coinciden, la cuenta es el punto de partida para conversarlo.
- **Pendiente:** que el repartidor también pueda registrar o confirmar pagos (hoy solo el comercio), qué pasa con el pago si el reparto falla después del retiro (hoy no se registra nada automático), y que el cobro del efectivo por el repartidor marque el pago del pedido (hoy el comercio confirma «Ya cobré» cuando le rinden).
