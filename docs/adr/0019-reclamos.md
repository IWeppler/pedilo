# 0019 — Reclamos

- **Estado:** Aceptada
- **Fecha:** 2026-11-26

## Contexto
SPEC §11.2: reclamo vinculado al pedido con motivo, fotos opcionales, plazo visible y evidencias; primero propone solución el comercio, Pedilo facilita, supervisa el SLA y escala; resoluciones de reembolso total, parcial, reenvío, reemplazo o rechazo motivado, sin decisiones automáticas irreversibles; salud, seguridad o fraude suspenden automatismos. SPEC §8.2.3 y §8.2.7: en efectivo la devolución es entre comercio y comprador y Pedilo ajusta la comisión con un asiento compensatorio. El cliente todavía no tiene cuenta (ADR 0007): se identifica con el token de seguimiento.

## Opciones consideradas
- **Chat libre** vs **reclamo estructurado con línea de tiempo**. Estructurado: motivo, propuesta con tipo y monto, aceptación explícita; los mensajes son parte del historial del reclamo (el chat por pedido es otra pieza, SPEC §11.1).
- **Escalar a mano** vs **escalar solo si el comercio no responde**. Se escala solo (lo único automático): no mueve dinero ni decide por nadie.
- **Pedilo ejecuta devoluciones** vs **las registra**. Con efectivo y transferencia Pedilo no custodia fondos: el comercio devuelve y lo registra; Pedilo corrige su comisión.

## Decisión
- **Módulo `claims`** (`claims`, `claim_events`, `claim_evidence`); usa `claimStateMachine` de `@pedilo/domain`. Un reclamo por pedido.
- **Cliente** (token de seguimiento): reclama hasta **48 h** después de entregado, retirado o fallido; motivo, descripción, hasta 3 fotos (reprocesadas sin metadatos, ADR 0017). Marca «salud o seguridad» → `ESCALATED` directo y el comercio no puede proponer. Acepta o rechaza la propuesta; si rechaza (`DISPUTED`) puede escalar.
- **Comercio**: tiene **24 h** para proponer (`REFUND_FULL` = total del pedido, `REFUND_PARTIAL` > 0 y < total, `RESEND`, `REPLACE`, `REJECT` con motivo). Puede volver a proponer tras una disputa. Aceptada una devolución (`AGREED_REFUND`), registra «ya le devolví» → `RESOLVED`.
- **Comisión**: al registrar la devolución, si la comisión ya se había devengado, se recalcula con la **misma** versión de pricing, plan y rubro del pedido sobre la base reducida y se asienta la diferencia como `ADJUSTMENT` (ADR 0012).
- **Pedilo (admin)**: lista con los sensibles primero; resuelve o cierra con nota visible para cliente y comercio; puede escribir. No mueve dinero.
- **Vencimiento**: worker `claim-escalation` (cada 5 min) pasa a `ESCALATED` los `OPEN` vencidos.
- **Pantallas**: en el seguimiento del pedido de la app («¿Tuviste un problema?», propuesta con aceptar/no aceptar, historial, fotos con `expo-image-picker`, pedir ayuda a Pedilo); «Reclamos» en el panel del comercio y en el admin.

## Consecuencias
- Todo queda en la línea de tiempo y auditado; nada irreversible es automático.
- **Pendiente:** avisos (push al comercio cuando llega un reclamo y al cliente cuando hay propuesta), devoluciones de pagos digitales (`PAYMENT_REFUND_PENDING`, cuando exista Mercado Pago), plazos y ventana configurables, métricas de reclamos por comercio, revisión jurídica del circuito antes del piloto pago (SPEC §11.2).
