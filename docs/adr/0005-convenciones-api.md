# 0005 — Convenciones de la API

- **Estado:** Aceptada
- **Fecha:** 2026-11-23

## Contexto
Cuatro clientes consumen la misma API y el SPEC (§14.1, §16) pide contrato versionado, auditoría, aislamiento por tenant e idempotencia. Conviene fijar las convenciones antes de tener muchos endpoints.

## Decisión
- **Versionado:** todas las rutas bajo `/v1`. Un cambio incompatible crea `/v2` para ese recurso; nunca se rompe `/v1` en silencio.
- **Recursos y nombres:** rutas en inglés, plural y kebab-case (`/v1/cities`, `/v1/categories`); campos JSON en camelCase; columnas SQL en snake_case.
- **Lectura pública vs administración:** los listados públicos devuelven solo lo activo. La gestión vive en rutas `/v1/admin/...` que exigen rol `ADMIN`.
- **IDs:** UUID generados por la base. Nunca se confía en IDs del cliente para decidir pertenencia.
- **Errores:** siempre con la forma `{ "error": { "code": "NOT_FOUND", "message": "…", "details"?: … } }` y el status HTTP correspondiente. Los códigos son estables y los clientes pueden depender de ellos; los mensajes no.
- **Validación:** todo request se valida con Zod antes del handler; los errores de validación devuelven `400 VALIDATION_ERROR` con el detalle por campo.
- **Auditoría:** toda mutación administrativa escribe una fila en `audit_logs` (actor, acción, entidad, antes/después) dentro de la misma transacción.
- **Borrado:** las entidades de configuración (ciudades, categorías) se desactivan (`active = false`), no se borran, para no romper referencias históricas.
- **Idempotencia:** los endpoints que crean pedidos, pagos o reembolsos aceptarán `Idempotency-Key` (se implementa con esos módulos).
- **Contrato:** el OpenAPI generado (`services/api/openapi.json`) se commitea; un cambio de contrato se ve en el diff.

## Consecuencias
- Los clientes pueden manejar errores por `code` de forma uniforme.
- Las rutas `/v1/admin/*` son las que consume `apps/admin-web`.
