# Pedilo Repartidor

App Android (Expo) para repartidores independientes: registro, disponibilidad, ofertas, aceptación y estados de retiro y entrega. Decisiones en `docs/adr/0014` (reparto) y `docs/adr/0015` (app).

## Correr en desarrollo

```bash
npm run dev:api          # la API en :4000
npm run dev:courier      # Expo en :8082 (abrir con Expo Go)
```

La app usa la API del mismo host que sirve Metro (puerto 4000). Para otra URL, `EXPO_PUBLIC_API_URL`.

## Login

Solo con Supabase Auth (`EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ver `.env.example`): email → código por email, sin contraseña.

- La plantilla «Magic Link» de Supabase tiene que incluir `{{ .Token }}` (requiere SMTP propio).
- El largo del código («Email OTP Length» en Supabase) tiene que coincidir con `EXPO_PUBLIC_OTP_LENGTH` (por defecto, 6).
- Ya no hay ingreso con token de desarrollo.

Después del login: registrarse como repartidor, aprobarlo en el admin (Repartidores) y ponerse «Disponible».

## Sin señal

Los cambios de estado se guardan en el teléfono y se mandan en orden cuando vuelve la conexión; el servidor los deduplica por `eventId`. Aceptar una oferta requiere conexión.
