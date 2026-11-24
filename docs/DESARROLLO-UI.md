# Desarrollar la UI con datos de demo

Guía corta para levantar todo y trabajar en las pantallas (sobre todo la app del cliente) con datos realistas.

## 1. Levantar todo

```bash
# Una sola vez (o cuando quieras empezar de cero)
cd services/api && cp .env.example .env     # si no existe
npm run db:up -w @pedilo/api                # Postgres en Docker (Docker Desktop abierto)
npm run db:migrate -w @pedilo/api
npm run db:seed -w @pedilo/api              # Tostado + rubros
npm run db:demo                             # comercios, menús, dueños y pedidos de demo

# Cada vez que trabajás
npm run dev:api                              # API en :4000 (dejala corriendo)
npm run dev:customer                         # app del cliente: QR para Expo Go
npm run dev:merchant                         # panel del comercio en :3000 (opcional)
npm run dev:admin                            # panel admin en :3001 (opcional)
```

**Empezar de cero:** `npm run db:reset -w @pedilo/api` borra la base local, la vuelve a migrar y carga seed + demo. Solo funciona contra una base en localhost.

## 2. Qué hay en la demo

Definido en `services/api/src/db/demo-data.ts` (editalo y volvé a correr `npm run db:demo`; los comercios que ya existen se saltean).

| Comercio | Rubro | Estado | Para ver… | Dueño (`--name`) |
|---|---|---|---|---|
| La Esquina de Tostado | Gastronomía | Aprobado | Pizzas con variantes y extras, empanadas por unidad/docena, 3 zonas, un producto sin stock, **4 pedidos de ejemplo** | `esquina` |
| Burger Club | Gastronomía | Aprobado | Grupos obligatorios (punto de la carne), extras con cantidad; abre mar–dom 19–01 | `burger` |
| Heladería Polo Norte | Gastronomía | Aprobado | Variantes por peso + hasta 4 gustos | `polonorte` |
| Kiosco 24 hs El Sol | Kioscos | Aprobado | **Siempre abierto** (útil para probar pedidos a cualquier hora) | `kiosco` |
| Súper Don Luis | Supermercados | Aprobado | Pedido mínimo alto ($20.000), horario cortado, cerrado domingos | `donluis` |
| Panadería La Espiga | Gastronomía | Aprobado | Solo retiro en el local | `espiga` |
| Tortas de Marta | Emprendedores | Aprobado | Solo fines de semana (se ve **cerrado** entre semana) | `marta` |
| Rotisería El Gaucho | Gastronomía | En revisión | Cola de revisión del admin | `gaucho` |
| Verdulería Doña Rosa | Supermercados | Borrador | Onboarding incompleto | `rosa` |
| Café Central Gálvez | Gastronomía | Aprobado | Otra ciudad (cambiá a Gálvez en la app) | `cafecentral` |

**Entrar a los paneles:** `npm run dev:token -w @pedilo/api -- --name esquina` y pegás el token en http://localhost:3000. Para el admin: `--name ignacio --admin` en http://localhost:3001.

**Abierto/cerrado:** depende de la hora real. Si querés ver un comercio abierto a cualquier hora, usá el Kiosco 24 hs o cambiá horarios desde el panel del comercio.

## 3. Iterar la UI de la app

- **En el celular (Expo Go):** misma Wi-Fi, escaneá el QR. Guardás un archivo y se actualiza al instante. La app busca la API en la IP de tu notebook, puerto 4000 (permitir Node en el firewall de Windows, redes privadas).
- **En el navegador:** `cd apps/customer-mobile && npx expo start --web` y abrí la ventana angosta (o las herramientas de desarrollador en modo celular). Sirve para iterar rápido; lo que cuenta es cómo se ve en Android.
- **Dónde está cada cosa:**
  - Pantallas: `apps/customer-mobile/src/app/` (ver tabla en ARCHITECTURE §5.1).
  - Colores y espaciados: `src/lib/theme.ts` (modo claro y oscuro según el sistema).
  - Componentes base (Badge, Chip, Button, estados de carga/error): `src/components/ui.tsx`.
  - Barra del carrito: `src/components/cart-bar.tsx`.
- **Volver a la pantalla de elegir ciudad:** desde el inicio, tocá el nombre de la ciudad.
- **Vaciar carrito / pedidos guardados en el teléfono:** borrar los datos de Expo Go (Ajustes de Android → Apps → Expo Go → Almacenamiento) o, en web, limpiar el localStorage del sitio.
