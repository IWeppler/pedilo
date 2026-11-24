# Pedilo

Marketplace multirrubro para localidades del interior argentino. La especificación vigente está en [`docs/SPEC.md`](docs/SPEC.md).

## Estructura

```text
apps/
  merchant-web/     # Panel del comercio (Next.js 16): alta, sucursales, horarios, zonas, catálogo y pedidos
  customer-mobile/  # App Android cliente (Expo SDK 58): comercios, menú, carrito, pedido y seguimiento
  courier-mobile/   # App Android repartidor (Expo SDK 58, Expo Router)
  admin-web/        # Panel admin (Next.js 16 + shadcn/ui): revisión de comercios, ciudades y categorías
services/
  api/              # API Fastify + Drizzle + PostgreSQL (con tests)
packages/
  domain/           # Estados, dinero y comisiones compartidos (con tests)
  api-client/       # Cliente tipado generado desde el OpenAPI de la API
  web-utils/        # Helpers compartidos por las webs (formularios, montos, formatos)
docs/
  SPEC.md           # Fuente de verdad (v0.4 consolidada)
  ROADMAP.md        # Qué está hecho, qué falta y qué sigue
  ARCHITECTURE.md   # Organización del código y reglas del monorepo
  DESARROLLO-UI.md  # Levantar todo con datos de demo para trabajar en la UI
  adr/              # Decisiones de arquitectura
  archive/          # Versiones anteriores del spec, solo historial
```

Monorepo con npm workspaces. Instalar todo desde la raíz:

```bash
npm install
npm run dev:api        # http://localhost:4000 (requiere Postgres: ver ARCHITECTURE §7)
npm run dev:admin      # http://localhost:3001 (panel admin)
npm run dev:merchant   # http://localhost:3000
npm run dev:customer   # QR para abrir en Expo Go (puerto 8081)
npm run dev:courier    # QR para abrir en Expo Go (puerto 8082)
npm test               # tests de todos los paquetes
```

Para trabajar en la UI con datos de demo (comercios, menús, dueños y pedidos): [`docs/DESARROLLO-UI.md`](docs/DESARROLLO-UI.md).

Más detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
