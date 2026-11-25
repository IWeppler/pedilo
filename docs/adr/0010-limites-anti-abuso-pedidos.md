# 0010 — Límites anti-abuso para pedidos anónimos

- **Estado:** Aceptada
- **Fecha:** 2026-11-25

## Contexto
Los pedidos se hacen como invitado y sin pago (ADR 0007): cualquiera puede mandarle a un comercio decenas de pedidos falsos, y cada uno hace sonar la alarma (ADR 0008/0009). Todavía no hay verificación de teléfono (OTP) ni hosting decidido.

## Opciones consideradas
- **Límite por IP en memoria** (`@fastify/rate-limit`) — corta ráfagas al instante y sin base; pero cada instancia cuenta aparte, y detrás de un NAT (redes móviles, wifi de un comercio) muchos clientes comparten IP.
- **Límite por IP en Redis** — compartido entre instancias; suma infraestructura que el piloto no necesita.
- **Límite por teléfono contado en la base** — durable y compartido entre instancias, no depende de la IP; se puede eludir cambiando el número (hasta que haya OTP).
- **OTP obligatorio** — el control real, pero requiere el login del cliente (pendiente).

## Decisión
Dos capas, configurables por variables de entorno (0 desactiva cada una):

1. **Por IP, en memoria:** `ORDER_RATE_LIMIT_PER_IP` pedidos cada 10 minutos (6 por defecto) en `POST /v1/public/orders`, y 120 por minuto en el seguimiento. Corre antes de validar el body. Responde `429 RATE_LIMITED` con `details.reason = IP_RATE_LIMIT`, `retryAfterSeconds` y el header `Retry-After`.
2. **Por teléfono, en la base** (solo dígitos, así «3491 555-123» y «3491555123» cuentan igual):
   - `ORDER_MAX_ACTIVE_PER_PHONE` pedidos en curso a la vez en el mismo comercio (3) → `TOO_MANY_ACTIVE_ORDERS`.
   - `ORDER_MAX_DAILY_PER_PHONE` pedidos en 24 h en todos los comercios (12) → `DAILY_LIMIT`.
   - Un reintento con la misma `Idempotency-Key` devuelve el pedido existente y no cuenta.
- **IP real detrás de un proxy:** `TRUST_PROXY_HOPS` (0 por defecto). Solo se confía en `x-forwarded-for` si se configura; si no, cualquiera podría falsear su IP.

## Consecuencias
- Un ataque simple desde una IP se corta a los 6 pedidos; uno que rota IPs pero repite teléfono, a los 3 pedidos en curso.
- Rotar IP **y** teléfono todavía pasa: el control de fondo es el OTP del cliente (siguiente paso) y, en el panel, poder rechazar con motivo.
- El límite por IP no se comparte entre instancias: con N instancias el máximo real es N × 6. Si se escala, mover el store a Redis.
- La consulta por teléfono usa `regexp_replace` sin índice: alcanza para el volumen del piloto. Con más volumen, guardar los dígitos en una columna indexada.
- Al desplegar detrás de un balanceador hay que configurar `TRUST_PROXY_HOPS`; si no, todos los clientes comparten la IP del balanceador y el límite por IP los frena juntos.
