# 0032 — Emails al cliente con Resend

- **Estado:** Aceptada
- **Fecha:** 2026-11-28

## Contexto
El cliente se entera del estado del pedido y de los reclamos por push (ADR 0020). El push solo llega si tiene la app instalada, con permiso y un build con FCM. Con la cuenta obligatoria (ADR 0026), todo cliente tiene un email verificado. Por otro lado, los emails de la cuenta (confirmación y recuperación de contraseña) los manda Supabase Auth por un SMTP de Gmail. Ese SMTP tiene límites bajos de envío y una entregabilidad pobre para un producto.

## Opciones consideradas
- **Resend** vs **Postmark** vs **SES**. Resend: API HTTP simple, SMTP para Supabase con el mismo dominio, plan gratis suficiente para el piloto e idempotencia nativa. Postmark entrega igual de bien pero cuesta desde el primer email. SES pide más configuración en AWS.
- **SDK** vs **`fetch`**. `fetch`: es una sola llamada y no suma dependencias. Es el mismo criterio que el sender de Expo Push.
- **Mensaje armado al encolar** vs **al mandar**. Al mandar: la outbox guarda un snapshot de los datos y el worker arma el texto con la URL de la app vigente. El destinatario también se resuelve al mandar, así se usa el email actual del usuario.
- **Misma outbox que el push** vs **una propia**. Una propia: la de push está atada a comercios y dispositivos y tiene su propio payload.

## Decisión
- **Tabla `email_outbox`** (módulo `notifications`): tipo, usuario, pedido, datos (jsonb), estado (PENDING / SENT / FAILED / SKIPPED), intentos, próximo intento, último error e id de Resend. Tiene RLS sin políticas.
- **Cuándo se encola**, siempre en la transacción del hecho:
  - pedido **aceptado**
  - pedido **rechazado** (con el motivo)
  - pedido **cancelado por el comercio** o el sistema (no cuando lo cancela el cliente)
  - pedido **vencido** sin respuesta
  - cada **novedad del reclamo** para el cliente, con el mismo texto que el push

  No se encola si el pedido nunca llegó al comercio (pago con tarjeta sin completar). Si hay que devolver una tarjeta, el email lo dice.
- **Worker `email-outbox`**, igual que el de push:
  - toma filas con SKIP LOCKED y las «alquila» antes del HTTP
  - si falla, espera cada vez más (de 1 a 30 minutos) y reintenta hasta 5 veces
  - un 4xx de Resend que no sea 429 se marca FAILED sin reintentar
  - se omite (SKIPPED) si no hay proveedor configurado o el usuario no tiene email
  - `Idempotency-Key: email-{id}` evita duplicados si un reintento sigue a un envío que sí salió
- **Plantilla** en texto y HTML simple, con tablas y estilos en línea para que se vea bien en todos los clientes de correo. Usa la paleta de la app y precios en pesos enteros. Todo el contenido se escapa. Con `CUSTOMER_APP_URL`, lleva un botón a `/order/{id}`.
- **Config**: `RESEND_API_KEY` y `EMAIL_FROM` (obligatorio si hay clave), `EMAIL_REPLY_TO` y `CUSTOMER_APP_URL` opcionales. Sin clave, la API funciona igual.
- **Supabase Auth** usa Resend como SMTP (`smtp.resend.com`, puerto 465, usuario `resend`, contraseña: la API key) con el mismo remitente. Así los emails de la cuenta salen del dominio verificado.

## Consecuencias
- Hace falta un dominio propio verificado en Resend (registros SPF y DKIM en el DNS) antes de mandar a clientes reales. Sin dominio, Resend solo manda a la dirección de la cuenta.
- La app web del cliente todavía no está publicada: hasta entonces, los emails van sin botón.
- Pendiente:
  - emails al comercio (pedido nuevo como respaldo del Web Push, liquidación semanal)
  - baja de emails no esenciales
  - registrar rebotes y quejas (webhook de Resend) para dejar de mandar a direcciones que no existen
