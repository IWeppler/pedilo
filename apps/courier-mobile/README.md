# Pedilo Repartidor

App Android (Expo) para repartidores independientes: registro, disponibilidad, ofertas, aceptación y estados de retiro y entrega. Decisiones en `docs/adr/0014` (reparto) y `docs/adr/0015` (app).

## Correr en desarrollo

```bash
npm run dev:api          # la API en :4000
npm run dev:courier      # Expo en :8082 (abrir con Expo Go)
```

La app usa la API del mismo host que sirve Metro (puerto 4000). Para otra URL, `EXPO_PUBLIC_API_URL`.

## Login

- **Con Supabase** (`EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, ver `.env.example`): código de 6 dígitos por email. La plantilla «Magic Link» de Supabase tiene que incluir `{{ .Token }}`.
- **Desarrollo**: «Entrar con token de desarrollo» y pegar el de `npm run dev:token -w @pedilo/api -- --name Juan` (API en modo local).

Después del login: registrarse como repartidor, aprobarlo en el admin (Repartidores) y ponerse «Disponible».

## Sin señal

Los cambios de estado se guardan en el teléfono y se mandan en orden cuando vuelve la conexión; el servidor los deduplica por `eventId`. Aceptar una oferta requiere conexión.
