# Pedilo — Especificación técnica integral (SPEC.md)

**Versión:** 0.4 · **Fecha:** 2026-11-16 · **Estado:** MVP consolidado y decisiones comerciales provisionales; sin código de producción.

## Control de versión — v0.4

Esta sección y el **Anexo v0.4** son la fuente de verdad para el MVP. Toda referencia previa a PWA como canal principal del cliente, directorio de repartidores sin asignación, ausencia de apps nativas, comisión que absorbe Mercado Pago, o planes anteriores queda **sustituida**. El material v0.2–v0.3 se conserva únicamente como historial de decisiones y contexto técnico; no implementarlo si contradice v0.4.

**Confirmado por producto:** Android cliente y Android repartidor desde lanzamiento; web responsive comercio; backend Node/TypeScript modular; un pedido = un comercio; comercio paga repartidor; tarifa híbrida sugerida/ajustada/aceptada; chat por pedido; reclamos estructurados; pagos directos al comercio; sin tarifa de servicio Pedilo al comprador; procesamiento Mercado Pago separado de comisión Pedilo; comisión de efectivo igual a la de pago digital; topes por rubro y comisión marginal decreciente; planes con mensualidad y comisión; pedidos ilimitados; emprendedores con cumplimiento aplicable.

**Pendiente de verificación antes de dinero real:** términos y disponibilidad de split 1:1 + Checkout API, tratamiento exacto de tarifas, comisiones y reembolsos, obligaciones fiscales, protección al consumidor, habilitaciones alimentarias, seguro/responsabilidades de reparto y precio final de planes.

## 1. Visión y decisiones vinculantes

Pedilo es un marketplace **multirrubro y multiciudad** para localidades del interior argentino. Permite descubrir comercios, comprar productos, pagar y gestionar entregas/retiros. El comercio puede operar exclusivamente desde el panel de Pedilo. **Pedilo es una marca y un sistema independiente de Comerz y CheCancha durante el MVP**. Las integraciones quedan explícitamente fuera de alcance, aunque se diseñan límites de dominio y eventos para habilitarlas posteriormente.

Decisiones confirmadas:
- Marketplace, panel de comercios y panel administrador.
- Promociones, analíticas básicas y directorio de repartidores independientes dentro del MVP.
- Aceptación manual, seguimiento de estados y cancelaciones.
- Mercado Pago, efectivo y transferencia manual.
- Suscripciones, comisiones variables por plan y **pedidos ilimitados**.
- Identidad propia de Pedilo, sin SSO ni vinculación con Comerz en MVP.
- Catálogo multirrubro con variantes, modificadores y horarios.
- Retiro en local, reparto del comercio con zonas y tarifas; directorio independiente para contacto/solicitud, **sin despacho centralizado ni flota propia**.
- Futuro: API versionada, webhooks y módulo nativo en Comerz; no implementar integración en MVP.
- Descubrimiento: búsqueda unificada de comercios y productos, ranking orgánico y filtros; agrupación de productos equivalentes solo cuando la identificación sea confiable.
- Monetización publicitaria: destacados por período como experimento opcional del piloto; pujas CPC y subasta inteligente fuera del MVP.
- No desarrollar una plataforma independiente de courier, encomiendas o logística interurbana dentro de Pedilo.

### Decisiones actualizadas v0.3 (prevalecen sobre hipótesis anteriores)

- **Clientes:** app Android React Native + Expo publicada en Google Play desde el lanzamiento; exploración por web pública como canal de adquisición, sin requerir instalación para descubrir.
- **Comercios:** panel web responsive utilizable en computadora y celular; notificaciones confiables y opción de comanda térmica manual primero, automática después.
- **Backend:** API independiente, monolito modular TypeScript/Node.js con PostgreSQL; Java/Spring Boot queda como alternativa válida por aprendizaje, no por necesidad de rendimiento. No depender de Server Actions para la app.
- **Conectividad:** lectura de catálogos en caché y operaciones locales pendientes; **nunca confirmar pagos, aceptación de reparto o pedido sin confirmación autoritativa del servidor**.
- **Pedidos:** un pedido pertenece a un único comercio. Pedidos inmediatos y programados; retiro o entrega.
- **Cobros:** Mercado Pago Checkout API, OAuth y split 1:1 sujeto a validación real; el comercio es el vendedor y receptor del cobro. Sin tarifa de servicio Pedilo al comprador. Comisión al comercio; tasa ilustrativa 10%, no aprobada. El procesamiento reduce margen Pedilo según el arreglo comercial realmente disponible; no presumir que el PSP descuenta el costo de la comisión de plataforma.
- **Efectivo:** misma comisión contractual que online, devengada al completar y registrada como deuda; conciliación semanal, recordatorios, mora y suspensiones proporcionales revisadas legalmente.
- **Reparto:** comercio responsable de pagar al repartidor; tarifa sugerida por distancia/zona, ajustable por comercio, mínimo aceptado por repartidor, ofertas con aceptar/rechazar y asignación atómica; propina separada. No hay flota Pedilo.
- **Comunicaciones:** chat privado y acotado al pedido por pares cliente/comercio, cliente/repartidor, comercio/repartidor; modificaciones estructuradas y reclamos separados.
- **Reputación:** comercio y repartidor calificables; historial privado de incidentes de cliente, con revisión y apelación, sin estrellas públicas del cliente.
- **Emprendedores:** incorporación posible, pero ventas reguladas solo con documentación habilitante verificada; distintivo «Documentación verificada» con alcance y vigencia.
- **Catálogo:** productos canónicos precargados, ofertas por comercio, productos artesanales, código de barras, fotos con derechos de uso, y búsqueda sin duplicaciones engañosas.
- **Marketing:** promociones con financiación atribuible, límites y prevención de abuso; bienvenida, envío bonificado, ofertas, recompra y referidos por etapas. Publicidad con subasta fuera del MVP.
- **Integraciones Comerz:** fuera del MVP, interfaces preparadas para el futuro.

**Regla de precedencia:** las decisiones de esta subsección y del Anexo v0.3 reemplazan toda afirmación incompatible heredada de v0.2 (incluidos directorio sin ofertas, PWA como canal principal, exclusión de apps nativas y separación obligatoria del costo PSP). Los precios y condiciones de proveedor requieren verificación antes del lanzamiento.

## 2. Alcance y exclusiones

### MVP incluido
1. Marketplace Android React Native + Expo, acompañado de catálogo web público responsive: búsqueda unificada por ciudad, rubro, comercio y producto; resultados diferenciados según intención, catálogo, carrito de **un comercio por pedido**, checkout y consulta de estado.
2. Cuenta de comprador opcional al navegar; para comprar, contacto verificable y dirección si corresponde. Pedidos como invitado con token de seguimiento de alcance limitado.
3. Onboarding y aprobación de comercio; sucursales, horario comercial y de recepción de pedidos, cierres excepcionales, zonas de entrega, tarifas y pedido mínimo.
4. Catálogo: categorías, productos, precios, imágenes, variantes, grupos de modificadores, disponibilidad, límites por opción y notas del cliente.
5. Pedidos: aceptación/rechazo manual, preparación, listo, en reparto, entregado, retirado, cancelado; historial, notificaciones y auditoría.
6. Pagos: Mercado Pago con OAuth/split 1:1 **sujeto a habilitación real del proveedor**, efectivo y transferencia con comprobante opcional y validación manual; conciliación, reembolsos y contracargos.
7. Monetización: planes y comisiones configurables; ledger de comisiones adeudadas para efectivo/transferencia; cobro y conciliación administrativa, facturación conforme asesoramiento fiscal.
8. Promociones básicas: cupón por porcentaje/monto, fechas, cupo, gasto mínimo, comercio y elegibilidad; uso atómico.
9. Red de repartidores independientes: registro, disponibilidad, tarifa mínima, ofertas de reparto, aceptación/rechazo atómicos, asignación y seguimiento por eventos; sin pagos automáticos de Pedilo al repartidor ni GPS continuo obligatorio.
10. Reportes básicos: pedidos, ventas brutas, ticket promedio, cancelaciones, pagos y comisiones por período.
11. Admin: ciudades, categorías, comercios, moderación de repartidores, incidencias, planes, saldos y métricas.
12. Descubrimiento: búsqueda textual tolerante a nombres parciales, filtros por rubro/precio/disponibilidad/retiro/entrega, ranking orgánico auditable, deduplicación confiable de productos estandarizados y comparación de ofertas por sucursal.
13. Destacados patrocinados por período **solo si se habilitan en piloto**, con rotación equitativa, elegibilidad, etiquetado explícito y métricas básicas de impresiones/clics; no son requisito bloqueante del primer pedido real.

### Fuera del MVP
- Integración/SSO con Comerz o CheCancha; POS, cocina/KDS, mesas, comandas presenciales, inventario complejo, contabilidad general.
- Carrito multi-comercio, split 1:N, pagos automáticos a repartidores, tracking GPS, asignación automática, optimización de rutas.
- App iOS al lanzamiento, suscripciones del consumidor, programa de puntos avanzado, **subastas CPC/RTB y personalización con ML**, IA operativa; tampoco se implementa logística interurbana o una plataforma courier independiente.

## 3. Usuarios y permisos

- **Visitante/comprador:** explora, compra, consulta sus propios pedidos; no ve datos internos.
- **Propietario del comercio:** configura negocio, personal, catálogo, pedidos, pagos, promociones y reportes.
- **Operador de comercio:** gestiona pedidos; permisos granulares para catálogo/promociones, sin acceso automático a facturación.
- **Repartidor independiente:** gestiona su ficha, zona y datos de contacto; no accede a pedidos salvo los explícitamente compartidos por el comercio y con consentimiento.
- **Administrador Pedilo:** modera y configura; acciones sensibles auditadas y con mínimo privilegio.

Autorización en servidor por pertenencia a comercio/sucursal; aislamiento por tenant en cada consulta y comando. Nunca confiar en IDs enviados por el cliente.

## 4. Flujos principales

### 4.1 Pedido
1. Comprador selecciona ciudad y sucursal; consulta disponibilidad.
2. Configura variantes/modificadores y carrito de una sucursal.
3. Selecciona retiro o entrega; valida dirección/zona, tarifa, horario y total.
4. Backend crea cotización temporal, revalida precios, promoción y disponibilidad; genera pedido `PENDING_PAYMENT` para pago digital o `PLACED` para efectivo/transferencia según reglas.
5. Pago digital: esperar **confirmación servidor a servidor** del proveedor; no considerar suficiente la redirección del navegador.
6. Comercio acepta o rechaza manualmente dentro de plazo configurable; aceptación produce `ACCEPTED`.
7. Preparación `PREPARING` → `READY` → `OUT_FOR_DELIVERY` o `READY_FOR_PICKUP` → `DELIVERED`/`PICKED_UP`.
8. Cancelaciones, reembolsos y ajustes siguen políticas por etapa, motivo y actor; eventos auditados.

### 4.2 Entrega
- **Retiro:** sin tarifa de envío.
- **Reparto propio:** sucursal define polígonos o zonas simples y precio fijo por zona; operador asigna un repartidor propio o registra entrega sin asignación nominativa.
- **Directorio independiente:** comercio consulta perfiles verificados/moderados y contacta o solicita servicio; acuerdo, pago y responsabilidad logística entre comercio y repartidor. No prometer disponibilidad ni tiempos que Pedilo no controla. Consentimiento y términos legales antes del piloto.

### 4.3 Descubrimiento, productos equivalentes y publicidad
- La barra de búsqueda interpreta la intención: consulta de comercio → resultados de comercios; producto estandarizado → ficha agrupada y ofertas por sucursal; plato artesanal → platos y restaurantes sin fusión automática.
- Los resultados de productos estandarizados se agrupan **solo con identidad confiable** (GTIN/EAN cuando exista y coincidan marca, variante, tamaño, unidad y presentación). No fusionar por similitud textual o IA sin verificación; ofrecer resultados separados cuando haya incertidumbre.
- La ficha de producto canónico presenta ofertas comparables, precio, disponibilidad, costo de entrega y posibilidad de retiro; no mezclar precios de sucursales con condiciones incompatibles. El precio «desde» debe corresponder a una oferta elegible y actual.
- Ranking orgánico: filtrar primero por ciudad, cobertura, estado, disponibilidad y cumplimiento de la consulta; ordenar después por relevancia textual, costo total estimado, cercanía, calidad de servicio y tiempo estimado **solo cuando haya datos confiables**. Pesos configurables, sin fórmulas ocultas no auditables.
- Comercios nuevos: mecanismo controlado de exploración que no supere reglas de disponibilidad y seguridad. Evitar monopolización visual por un solo comercio.
- Si el cliente tiene carrito activo, facilitar «buscar dentro de este comercio» para no provocar múltiples pedidos por accidente.
- Publicidad opcional del piloto: destacados por período, rotación entre anunciantes elegibles y etiqueta visible «Patrocinado». Los anuncios no reemplazan todos los resultados orgánicos ni muestran productos fuera de cobertura. Pujas CPC, atribución sofisticada y subastas quedan para después de validar tráfico y demanda.

### 4.4 Comisiones
- Comisión Pedilo por **pedido completado**, porcentaje según plan y base contractual definida (recomendación: subtotal de productos neto de descuentos atribuibles al comercio, sin envío, propina ni impuestos excluidos por contrato).
- Pedido digital: retención mediante split si está habilitado y conciliado; comisión real registrada según confirmación del proveedor.
- Efectivo/transferencia: asiento de comisión pendiente al completar; liquidación periódica y pago externo conciliado.
- Cancelaciones y reembolsos: reversión/ajuste contable mediante asientos compensatorios; no borrar movimientos.
- Planes y porcentajes **configurables, no hardcodeados**; el precio final y porcentajes definitivos quedan pendientes de validación comercial, fiscal y de pagos.

## 5. Política de precios — hipótesis para piloto

Modelo elegido: **comisión al comercio como única tarifa transaccional al comprador, pedidos ilimitados; suscripciones por plan sujetas a validación**, sin cobrar por pedido excedente. Propuesta experimental, **no aprobación de precios definitivos**:

| Plan | Suscripción ARS/mes | Comisión Pedilo | Pedidos |
|---|---:|---:|---|
| Piloto fundador | $0 por período promocional definido | 4% | Ilimitados |
| Inicial | A definir | 6% | Ilimitados |
| Crecimiento | A definir | 4% | Ilimitados |
| Plus | A definir | 2,5% | Ilimitados |

La intención comercial es que el comercio soporte una tarifa Pedilo total y que Pedilo absorba el costo del procesador dentro de su margen, pero el split real puede descontar cargos al vendedor de manera distinta. Validar contractual y contablemente antes de prometer un 10% total; informar por separado tarifa real del PSP, IVA y retenciones según cuenta, plazo y medio. El costo de Mercado Pago y disponibilidad de split se verifican contractualmente antes de producción. Evaluar Naranja X, NAVE, Ualá y Mobbex por **split/marketplace real, OAuth/onboarding, webhooks, conciliación, reembolsos, costos y SLA**; ofrecer QR/link no equivale a split.

**Decisión de cobro:** pagos digitales con retención automática cuando sea posible; efectivo/transferencia crean cuenta de comisiones por cobrar, no una billetera custodial. Definir calendario de vencimiento, notificaciones, disputas y suspensión gradual con asesoría legal. Pedix es referencia de planes y funcionalidades, no se copian sus precios ni se asumen tarifas negociadas.

## 6. Modelo de datos lógico

Entidades y campos mínimos (nombres ilustrativos; se detallarán en migraciones):

- `users(id, email, phone, status, created_at)`
- `cities(id, name, province, country, active)`
- `merchants(id, legal_name, display_name, slug, category_id, status, owner_id)`
- `merchant_members(id, merchant_id, user_id, role, permissions)`
- `branches(id, merchant_id, city_id, address, lat, lng, timezone, status)`
- `business_hours(id, branch_id, weekday, opens_at, closes_at, accepts_orders)`; `special_hours`
- `delivery_zones(id, branch_id, geometry_or_rule, fee_minor, min_order_minor, enabled)`
- `categories(id, parent_id, name, kind)`; `products(id, branch_id, category_id, name, description, price_minor, available)`
- `canonical_products(id, gtin_nullable, brand, normalized_name, variant, net_content, unit, package_type, verification_status)`; `product_canonical_links(id, product_id, canonical_product_id, match_source, confidence, reviewed_at)`; GTIN único solo donde aplique y normalización sin fusiones automáticas dudosas.
- `product_offers(id, branch_id, product_id, canonical_product_id_nullable, price_minor, available, updated_at)` si la oferta no se representa directamente por `products` (elegir un solo origen de precio en ADR de catálogo; evitar doble fuente de verdad).
- `search_events(id, city_id, session_id_pseudonymous, query_normalized, result_type, selected_entity_id_nullable, occurred_at)` con minimización y retención limitada.
- `sponsored_campaigns(id, merchant_id, city_id, placement, starts_at, ends_at, status, budget_minor_nullable)`; `sponsored_impressions` y `sponsored_clicks` agregados o pseudónimos, solo si se activa el experimento.
- `product_variants(id, product_id, label, price_delta_minor, available)`
- `modifier_groups(id, product_id, min_select, max_select, required)`; `modifiers(id, group_id, name, price_delta_minor)`
- `orders(id, branch_id, customer_id_nullable, customer_snapshot, delivery_address_snapshot, fulfillment_type, order_status, payment_status, currency, subtotal_minor, discount_minor, delivery_fee_minor, total_minor, commission_basis_minor, commission_rate_snapshot, created_at, completed_at)`
- `order_items(id, order_id, product_id_nullable, name_snapshot, unit_price_minor, quantity, total_minor)`; `order_item_options(id, order_item_id, label_snapshot, price_delta_minor)`
- `order_events(id, order_id, from_status, to_status, actor_id, reason, created_at)`
- `courier_profiles(id, user_id, city_id, availability, verified_status, contact_visibility)`; `courier_requests(id, merchant_id, courier_id, status, created_at)`
- `payments(id, order_id, provider, provider_payment_id, status, amount_minor, fee_minor, confirmed_at)`; `payment_attempts`, `refunds`, `provider_connections`
- `plans(id, name, active)`; `plan_versions(id, plan_id, monthly_fee_minor, commission_bps, effective_from)`; `subscriptions(id, merchant_id, plan_version_id, status, period_start, period_end)`
- `commission_ledger(id, merchant_id, order_id, kind, amount_minor, currency, source_id, created_at)`; `settlements`, `settlement_allocations`
- `promotions(id, merchant_id, type, value, starts_at, ends_at, usage_limit, active)`; `promotion_redemptions`
- `webhook_inbox(id, provider, event_id, payload_hash, status, received_at)`; `outbox_events(id, aggregate_type, aggregate_id, event_type, payload, published_at)`; `audit_logs`

Reglas: dinero en enteros de menor unidad monetaria o decimal exacto; UUID/ULID; FK e índices por `branch_id`, `merchant_id`, `city_id`, `created_at`; unicidad de eventos externos; snapshots históricos; PII mínima y política de retención. `order_status` y `payment_status` son máquinas de estado independientes.

## 7. Arquitectura y stack

- **Next.js App Router + React + TypeScript**: marketplace, panel comercio y admin en una app.
- **Tailwind CSS v4 + shadcn/ui**; formularios React Hook Form + Zod.
- **PostgreSQL administrado por Supabase + Prisma** (migraciones versionadas, transacciones, índices). Supabase Storage para imágenes; elegir una única estrategia principal de auth (Supabase Auth o Auth.js) antes de implementación.
- **TanStack Query** para estado remoto en paneles; evitar duplicar estado de servidor en Zustand.
- **Mercado Pago** detrás de interfaz `PaymentProvider`; webhook verificado y conciliación; posibilidad futura de adaptadores PSP adicionales.
- **OpenAPI 3.1** para contratos internos versionados `/api/v1`; webhooks de dominio con firma HMAC, outbox y reintentos en etapa futura de integraciones.
- **Jobs durables** para expiración de pedidos, conciliación, avisos y cierre de comisiones (proveedor gestionado a elegir).
- **Sentry + logs estructurados + métricas**; Vitest, pruebas de integración PostgreSQL y Playwright.
- Deploy: Vercel + Supabase inicialmente; secretos solo servidor, entornos dev/staging/prod, backups y recuperación documentada.

No microservicios, Redis ni Kubernetes para el MVP. Sí aplicación Android nativa mediante React Native/Expo; app iOS diferida.

### Estructura propuesta

```text
pedilo/
  src/
    app/
      (marketplace)/
      (merchant)/
      (admin)/
      api/v1/
      api/webhooks/
    modules/
      identity/
      geography/
      merchants/
      catalog/
      checkout/
      orders/
      fulfillment/
      couriers/
      payments/
      billing/
      promotions/
      analytics/
      discovery/
      search/
      advertising/ # opcional piloto; CPC posterior
    components/
    lib/
  prisma/
  tests/{unit,integration,e2e}/
  docs/{specs,adr,api}/
  .github/workflows/
```

Separar `domain`, `application`, `infrastructure` y `ui` dentro de módulos complejos; evitar imports directos entre persistencias de dominios. Mantener contratos internos claros **sin crear integración con Comerz**.

## 8. Requisitos no funcionales

- **Seguridad:** RBAC servidor, aislamiento por tenant, validación de inputs, rate limiting, protección contra enumeración de pedidos, CSRF donde aplique, secretos cifrados, webhooks verificados, idempotencia en creación de pedidos/cobros y registro de auditoría.
- **Pagos:** nunca confiar en montos del frontend; conciliación por ID de proveedor, estados transaccionales, manejo de webhooks duplicados/desordenados, reembolsos parciales/totales y contracargos.
- **Concurrencia:** inventario/disponibilidad y uso de cupones con transacciones/constraints; expiración de cotizaciones y órdenes pendientes.
- **Privacidad:** protección de teléfonos/direcciones, consentimiento explícito para compartir datos con repartidores, permisos por rol, borrado/retención conforme normativa argentina aplicable.
- **Observabilidad:** logs con correlation IDs, alertas de pagos fallidos, pedidos sin aceptar, discrepancias de comisiones y fallas de jobs.
- **Accesibilidad y rendimiento:** móvil primero, WCAG 2.2 AA como objetivo, imágenes optimizadas, navegación teclado, metas Core Web Vitals; presupuestos de rendimiento medibles en staging.
- **Operación:** backup y restauración probada; plan de incidentes y soporte; términos, políticas de cancelación y responsabilidades logísticas revisados legalmente.

## 9. Plan de implementación: épicas, historias y aceptación

### E0 — Fundaciones, CI y seguridad [P0]
- **US-001** Como desarrollador quiero entornos aislados y migraciones reproducibles. **CA:** `dev`, `staging`, `prod` separados; migración desde cero en CI; sin secretos en cliente ni repo.
- **US-002** Como administrador quiero permisos por rol y comercio. **CA:** un operador de A no puede consultar ni mutar datos de B; pruebas negativas automáticas.
- **US-003** Como equipo quiero CI confiable. **CA:** typecheck, lint, unit/integration, build; e2e críticos en PR o pipeline apropiado; sin duplicación innecesaria.

### E1 — Comercios, ciudades y sucursales [P0]
- **US-101** Como comercio quiero registrarme y solicitar alta. **CA:** estado pendiente hasta aprobación; datos obligatorios y validación.
- **US-102** Como propietario quiero configurar sucursal, horarios y cierres. **CA:** checkout bloqueado fuera de disponibilidad salvo programación explícita.
- **US-103** Como comprador quiero filtrar por ciudad y rubro. **CA:** no aparecen sucursales inactivas ni fuera de ciudad seleccionada.

### E2 — Catálogo y carrito [P0]
- **US-201** Como comercio quiero publicar productos con variantes y modificadores. **CA:** restricciones min/max validadas en servidor; precios recalculados.
- **US-202** Como comprador quiero un carrito por comercio. **CA:** agregar producto de otra sucursal solicita vaciar/reemplazar; nunca se mezclan vendedores.
- **US-203** Como comercio quiero pausar productos. **CA:** productos pausados no pueden confirmarse aunque estén en carrito antiguo.

### E3 — Pedidos y estados [P0]
- **US-301** Como comprador quiero crear un pedido y consultar su estado. **CA:** cotización validada; token privado de seguimiento; pedidos duplicados prevenidos por clave idempotente.
- **US-302** Como operador quiero aceptar/rechazar pedidos. **CA:** solo transiciones permitidas; motivo de rechazo; registro de actor y tiempo.
- **US-303** Como comprador quiero cancelar según política. **CA:** autorización por etapa; reembolso o ajuste cuando corresponda; historial consistente.

### E4 — Retiro, zonas y repartidores [P0/P1]
- **US-401** Como comercio quiero definir retiro y zonas/tarifas. **CA:** checkout valida cobertura y muestra costo final antes de confirmar.
- **US-402** Como comercio quiero administrar repartidores propios. **CA:** asignación manual solo a pedidos válidos y sin promesa de GPS.
- **US-403** Como repartidor independiente quiero publicar mi perfil. **CA:** consentimiento, moderación y controles de visibilidad.
- **US-404** Como comercio quiero solicitar contacto con un independiente. **CA:** registro de solicitud, no se genera obligación de reparto por parte de Pedilo.

### E5 — Pagos y conciliación [P0, bloqueante para piloto pago]
- **US-501** Como comprador quiero pagar con Mercado Pago. **CA:** confirmación exclusivamente por webhook/API verificada; estados duplicados no duplican pedido ni comisión.
- **US-502** Como comprador quiero pagar en efectivo o transferencia. **CA:** método visible; comercio confirma recepción cuando corresponda; no se marca automáticamente como cobrado.
- **US-503** Como administrador quiero conciliar cobros y devoluciones. **CA:** diferencias visibles y reintentables; auditoría; pruebas de contracargos y reembolsos.
- **US-504** Como comercio quiero conectar mi cuenta PSP. **CA:** OAuth, credenciales seguras, desconexión y manejo de permisos; split probado en sandbox y habilitado por proveedor antes de producción.

### E6 — Planes y comisiones [P0]
- **US-601** Como admin quiero crear versiones de planes. **CA:** los pedidos conservan la tarifa aplicada al momento del hecho imponible; cambios no alteran historial.
- **US-602** Como comercio quiero ver comisiones pendientes y pagadas. **CA:** ledger conciliable por pedido y medio; ajustes compensatorios, no borrado.
- **US-603** Como admin quiero liquidar deuda de efectivo/transferencia. **CA:** cierres reproducibles, pagos parciales, vencimientos y disputa documentada.

### E7 — Promociones [P1]
- **US-701** Como comercio quiero crear cupones. **CA:** fechas, límites, mínimos y elegibilidad validados en servidor; no hay doble canje bajo concurrencia.
- **US-702** Como comprador quiero ver descuento antes de pagar. **CA:** total y base de comisión consistentes en checkout y orden final.

### E8 — Analíticas y administración [P1]
- **US-801** Como comercio quiero métricas por período. **CA:** pedidos, ventas, ticket y cancelaciones reconciliados con órdenes; zona horaria de sucursal.
- **US-802** Como admin quiero moderar comercios/repartidores. **CA:** acciones registradas y reversibles cuando proceda.
- **US-803** Como admin quiero observar salud operativa. **CA:** tablero de pagos pendientes, errores de webhook, deuda vencida y pedidos sin atención.

### E11 — Descubrimiento, búsqueda y posicionamiento [P0/P1]
- **US-1101 [P0]** Como comprador quiero buscar comercios y productos desde una sola barra. **CA:** búsqueda parcial y normalizada; identifica intención básica, presenta resultados de comercios y productos en secciones diferenciadas; respeta ciudad, disponibilidad y permisos.
- **US-1102 [P0]** Como comprador quiero resultados orgánicos útiles. **CA:** elegibilidad por cobertura/horario/stock antes del ordenamiento; ranking determinístico y auditable; anuncios no afectan el puntaje orgánico.
- **US-1103 [P0]** Como comprador quiero filtrar y ordenar. **CA:** filtros por categoría, precio, retiro y entrega; precio total de envío solo cuando es calculable con dirección/zona; no se anuncian tiempos sin datos confiables.
- **US-1104 [P1]** Como comprador quiero comparar ofertas del mismo producto. **CA:** solo se agrupan artículos con identidad confiable; tamaños/presentaciones distintas permanecen separados; se puede acceder a cada oferta y su comercio; coincidencias inciertas no se fusionan.
- **US-1105 [P1, piloto opcional]** Como comercio quiero contratar un destacado por período. **CA:** ubicación y período definidos, rotación entre elegibles, etiquetado «Patrocinado», métricas de impresión/clic y suspensión de campañas fuera de vigencia.
- **US-1106 [POST-MVP]** Como anunciante quiero campañas CPC. **CA futuro:** presupuesto, puja, registro de clic válido, prevención de fraude y facturación reconciliable.
- **US-1107 [POST-MVP]** Como comprador quiero recomendaciones personalizadas. **CA futuro:** evaluación de relevancia, consentimiento y métricas de impacto sin comprometer privacidad.

### E9 — Piloto y salida a producción [P0]
- **US-901** Como equipo quiero ejecutar un pedido real de extremo a extremo. **CA:** prueba de retiro, entrega, digital, efectivo y transferencia; cancelación y devolución.
- **US-902** Como equipo quiero resiliencia ante fallas. **CA:** pruebas de webhooks duplicados, timeout, reintento, pérdida de conexión y recuperación sin cobro doble.
- **US-903** Como comercio piloto quiero operar sin asistencia continua. **CA:** documentación mínima, alertas y canal de soporte; incidencias críticas resueltas antes de expansión.

### E10 — Integraciones futuras [POST-MVP, no implementar]
- **US-1001** Como comercio con Comerz quiero habilitar Pedilo en el sidebar. **CA futuro:** autorización vinculada, módulo nativo, sincronización idempotente y permisos separados.
- **US-1002** Como operador de CheCancha quiero usar capacidades de Comerz. **CA futuro:** contratos versionados, mapeo de entidades y trazabilidad de operaciones.

## 10. Secuencia de entregas y puertas de calidad

1. **Vertical slice A:** E0 + E1 + E2 mínimo + E11-01/02 básicos → comercio aprobado, catálogo navegable y búsqueda funcional.
2. **Vertical slice B:** E3 + E4 retiro/entrega → pedido completo de prueba sin dinero real.
3. **Vertical slice C:** E5 + E6 → pago y comisión conciliados, casos de falla cubiertos.
4. **Vertical slice D:** E4 directorio + E7 + E8 + E11-03/04 → MVP funcional acordado; E11-05 destacado es opcional y no bloqueante.
5. **Piloto:** E9 con 3–5 comercios y usuarios reales, luego expansión por ciudad.

**Definition of Done por historia:** criterios de aceptación probados; autorización tenant revisada; validación de entradas; estados de error/carga; logging; migración reversible o plan de rollback; documentación OpenAPI cuando aplique; tests unitarios/integración/e2e proporcionales al riesgo; revisión de accesibilidad móvil.

## 11. Decisiones abiertas antes del primer sprint

1. Nombre y dominio: validar marca **Pedilo**, disponibilidad de dominio, redes y riesgo marcario.
2. Auth: Supabase Auth vs Auth.js; método de verificación de teléfono/email y guest checkout.
3. Checkout: política exacta de aceptación antes/después del pago, reservas, timeout y reembolso por rechazo.
4. PSP: confirmar elegibilidad comercial para split 1:1, tarifas, IVA, retenciones, responsabilidad de reembolsos y restricciones contractuales.
5. Tarifas: mensualidades definitivas, comisión por plan, base de cálculo y quién paga la tarifa del PSP.
6. Repartidores independientes: condiciones legales, verificación, contacto, responsabilidad y consentimiento.
7. Delivery: zonas por polígonos vs radios/barrios, y política de costos y pedidos mínimos.
8. Datos: retención de PII, facturación de comisiones y política de disputas.
9. Catálogo: categorías iniciales y variantes comunes a rubros no gastronómicos; decidir si `products` representa la oferta o si existe `product_offers` como única fuente de precio.
10. Búsqueda: reglas de equivalencia canónica, GTIN, política de productos sin código, datos mínimos de stock/disponibilidad y retención de eventos.
11. Publicidad: confirmar si destacados por período se habilitan en el piloto; definir precio, rotación, límite de posiciones, transparencia y facturación antes de cobrar anuncios.

Estas decisiones **no impiden iniciar E0/E1**, pero los puntos 3–6 deben cerrarse antes de activar pagos y repartidores en producción.

## 12. Métricas de validación

- Comercios aprobados, activos semanales y retención por ciudad.
- Usuarios que buscan → ven resultados → abren comercio/producto → agregan carrito → crean pedido → pedido completado.
- Tiempo medio de aceptación, tasa de rechazo/cancelación, pedidos por comercio.
- Ticket promedio, GMV, ingresos Pedilo por comisión, costo PSP, deuda pendiente y recuperada.
- Porcentaje de efectivo, transferencia y pago digital.
- Reclamos por entrega, tiempos y tasa de repetición de compra.
- Búsquedas sin resultados, tasa de clic orgánico, productos canónicos vinculados con confianza y conversión por consulta.
- Si hay destacados: impresiones, clics válidos, tasa de clic y concentración de exposición, separados de resultados orgánicos.

**Criterio de producto:** validar demanda y cobranza en un piloto local antes de invertir en logística centralizada, POS gastronómico o integraciones con otras marcas.


---

# ANEXO V0.3 — Especificación operativa, técnica y plan revisado

Este anexo es **normativo** y prevalece sobre el texto v0.2 anterior cuando haya contradicciones. Los escenarios son hipótesis de diseño, no compromisos legales ni tarifas verificadas.

## A. Arquitectura recomendada y decisión tecnológica

**Topología inicial:**
- `apps/customer-mobile`: React Native + Expo (Android Google Play), TypeScript, Expo Router; TanStack Query para caché/sincronización, almacenamiento persistente seguro para sesión y SQLite/almacenamiento local para datos no sensibles seleccionados.
- `apps/merchant-web`: Next.js 16 (PC y móvil); vistas de pedidos, catálogo, cobros, promociones, chat y repartos. Considerar PWA para instalación opcional, pero no depender de push web como único aviso.
- `apps/admin-web`: Next.js 16, acceso restringido y auditoría.
- `apps/courier-mobile`: React Native + Expo como **objetivo de fase piloto de reparto**; evaluar una interfaz móvil web transitoria solo si notificaciones y asignación funcionan de manera comprobable.
- `services/api`: Node.js + TypeScript, API HTTP REST/OpenAPI 3.1 y eventos en tiempo real autenticados; monolito modular desplegable independientemente del frontend. NestJS o Fastify a elegir en ADR, no ambos.
- `postgres`: PostgreSQL gestionado (Supabase inicialmente o proveedor equivalente), transacciones, índices y constraints; migración a AWS RDS posible sin rediseño de dominio.
- `workers`: procesamiento durable de webhooks, expiraciones, ofertas, notificaciones, conciliación y reintentos; **no** ejecutar procesos críticos solo en memoria del servidor.
- `storage`: imágenes optimizadas y autorizadas, CDN y URLs firmadas cuando corresponda.
- `observability`: Sentry, logs estructurados, métricas, trazas y alarmas de negocio.

**Java/Spring Boot** es alternativa razonable si el objetivo adicional es formación backend; para 30 comercios y menos de 10 pedidos diarios por comercio no hay argumento de escala que obligue a Java o AWS. La fluidez depende principalmente de arquitectura, caché, UX, tolerancia a fallos y observabilidad.

**Sin Wi-Fi:** soportar datos móviles y reconexión; ninguna aplicación puede garantizar operación online si no existe conectividad de ningún tipo. Catálogo, carrito, borradores, instrucciones e historial reciente pueden consultarse offline con marca de antigüedad. Acciones críticas se encolan con idempotency key y estado `PENDING_SYNC`, pero **no se presentan como confirmadas** hasta recibir ACK del backend. Nunca cobrar, asignar un repartidor o entregar un pedido basándose únicamente en estado local. Los comercios deben tener mecanismo de contingencia ante corte total de internet.

**Metas iniciales a validar con pruebas:** p95 de API de lectura < 500 ms en condiciones nominales regionales; p95 de transición de estado < 1 s excluyendo latencia de push; 99,9% de procesamiento de eventos críticos con reintentos durables (objetivo, no garantía); 0 pedidos cobrados duplicados en pruebas de idempotencia. Push es aviso auxiliar: estado real por API y sincronización al reabrir.

## B. Ciclo de pedido, pagos y responsabilidad

### B.1 Pedido
`DRAFT → QUOTED → PENDING_PAYMENT/PLACED → ACCEPTED → PREPARING → READY → PICKED_UP_BY_COURIER → DELIVERED` o `READY_FOR_PICKUP → PICKED_UP`; ramas explícitas `REJECTED`, `CANCELLED`, `EXPIRED`, `DELIVERY_FAILED`, `REFUND_PENDING`, `REFUNDED` y `PARTIALLY_REFUNDED`. Separar estados de **pedido**, **pago**, **reparto** y **reclamo** para evitar combinaciones imposibles.

El cliente confirma una cotización de duración limitada, con precios y tarifa de reparto versionados. Un pedido = una sucursal. Para pedidos programados guardar zona horaria, ventana, capacidad, fecha de corte y política de cancelación. El backend revalida disponibilidad, stock, promociones y monto al crear orden. Estados monotónicos cuando aplique y cambios con actor, motivo y timestamps del servidor.

### B.2 Pago digital (Checkout API)
1. Comercio vincula cuenta Mercado Pago mediante OAuth y autorización adecuada.
2. Backend genera intento de pago, registra `idempotency_key`, referencia de orden y desglose inmutable.
3. Cliente paga en Checkout API; la app puede mostrar «verificando pago».
4. Webhook validado + consulta de estado al PSP confirman el pago. La respuesta del cliente **no** constituye prueba definitiva.
5. Split 1:1 y `application_fee` sujetos a acceso y condiciones efectivas del proveedor. Probar tasas, IVA, reversas, contracargos, parcialidades, conciliación y qué cuenta soporta cada cargo.
6. Comercio recibe su liquidación conforme reglas del PSP; Pedilo recibe su participación. **No** recibir y redistribuir todos los fondos desde una cuenta propia.
7. Reembolso total/parcial: compensación contable, reversa de comisión según reglas de proveedor, reconciliación de diferencias y avisos a participantes.

**Política comercial elegida:** Pedilo no cobra tarifa de servicio propia al comprador; la comisión se pacta con el comercio. El porcentaje ilustrativo del 10% **no** es definitivo. El comercio decide sus precios públicos, sujeto a transparencia, normas aplicables y reglas de plataforma. Evitar presentar «subir precios para cubrir comisión» como obligación; mostrar simulador de margen, costo de procesamiento y rentabilidad por producto. No garantizar que Pedilo capture 4% neto si PSP cobra 6%: depende de la fórmula real de split, tasas e impuestos.

### B.3 Efectivo y transferencias
- Misma tasa contractual al comercio que pago digital, pero sin procesamiento PSP en el flujo en efectivo; no confundir comisión devengada con dinero cobrado.
- Al cerrar pedido, asiento de comisión `ACCRUED`; liquidación semanal con cortes por zona horaria; vencimiento configurable, pago, conciliación y asientos correctivos inmutables.
- Registro explícito de **quién cobra** el efectivo (`MERCHANT` o `COURIER`) y de cuánto corresponde a cada parte; si cobra repartidor, deuda del repartidor al comercio o compensación acordada. Nunca asumir que lo cobrado es propina o remuneración.
- Mora escalonada: aviso, período de gracia, recargo contractual validado legalmente, límite de deuda, restricción del efectivo, suspensión comercial con derecho a consultar historial y comprobantes. Registro de notificaciones, disputa y regularización.
- Transferencia manual: evidencia opcional, verificación por comercio y reconciliación; comprobante subido no prueba de pago por sí solo.

### B.4 Desglose monetario
Guardar `items_subtotal`, `merchant_discount`, `platform_discount`, `delivery_fee_customer`, `courier_offer`, `merchant_delivery_subsidy`, `tip`, `taxes`, `merchant_commission_basis`, `commission_due`, `psp_fee_actual`, `platform_net_margin_estimate`, `refund_amount`. **Propinas y remuneración del repartidor no integran automáticamente la base comisionable**; definirlo contractualmente. Usar importes en unidades menores y operaciones enteras; reglas de redondeo documentadas.

## C. Mercado de repartos — modelo híbrido

**Modelo:** Pedilo sugiere tarifa por distancia/zona, comercio puede ajustarla, repartidor configura tarifa mínima y zonas. Comercio contrata/paga al repartidor; Pedilo registra la asignación y el estado, sin custodiar fondos ni operar flota propia.

`DELIVERY_NEEDED → OFFERED → ASSIGNED → ARRIVING_PICKUP → PICKED_UP → ARRIVING_DROPOFF → DELIVERED`, con `OFFER_EXPIRED`, `COURIER_CANCELLED`, `DELIVERY_FAILED` y reasignación controlada.

- Oferta visible a repartidores elegibles con monto, zona aproximada, distancia estimada, ventana y requisitos; **no exponer dirección exacta del cliente antes de la asignación**.
- Repartidor acepta/rechaza; aceptación atómica con condición de estado/versionado en DB, para impedir dos ganadores.
- Rechazar una oferta previa a la aceptación no genera penalización. Cancelar después se registra y revisa en contexto.
- Si nadie acepta, comercio aumenta oferta, asigna repartidor propio o reprograma/cancela conforme política.
- Propina separada; si se cobra digitalmente para el repartidor, requiere mecanismo legal y de liquidación explícito. No prometer pago automático en MVP.
- Métricas: viajes realizados, porcentaje completados, tiempo de traslado, espera en local, espera del cliente, cancelaciones posteriores a aceptación y valoraciones verificadas.
- Prueba de entrega proporcional: confirmación del destinatario o código PIN opcional; ubicación continua y foto solo cuando sea necesario, con consentimiento y retención limitada.
- Validación de identidad, medios de transporte, seguros y clasificación contractual bajo revisión legal.

## D. Chat por pedido, cambios y reclamos

- Canales privados `CUSTOMER_MERCHANT`, `CUSTOMER_COURIER`, `MERCHANT_COURIER`; no chat grupal por defecto.
- Chat habilitado en etapas pertinentes, ventana posterior limitada, lectura/entrega, push y sincronización tras reconexión.
- Mensajes con `client_message_id` para idempotencia, timestamps servidor, permisos por pertenencia y moderación. Datos de contacto enmascarados donde sea apropiado; no prohibir canales alternativos necesarios para emergencia.
- Plantillas rápidas: «Estoy afuera», «No funciona el timbre», «Falta un ingrediente», «¿Aceptás sustitución?».
- Sustituciones **no** se resuelven únicamente en chat: `ORDER_ADJUSTMENT_PROPOSED → CUSTOMER_APPROVED/REJECTED → PAYMENT_ADJUSTED` con límites, reservas, devolución o cobro adicional según capacidad real del PSP. Si no hay respuesta, aplicar política de no sustitución por defecto.
- Reclamos separados: `OPEN → EVIDENCE_REQUESTED → UNDER_REVIEW → RESOLVED/REJECTED → APPEALED/CLOSED`. Motivos: faltante, producto incorrecto, calidad, demora, no entrega, cobro incorrecto.
- Evidencia mínima necesaria, plazos de atención, responsable por etapa y compensación/reembolso trazables. El registro operativo **no exime** de responsabilidades legales a Pedilo.

## E. Reputación y seguridad de clientes

- Valoración de comercios por compradores verificados, de repartidores por compradores/comercios y de experiencia de retiro por repartidores.
- No publicar calificaciones personales de compradores. Mantener incidentes verificables: ausente, dirección errónea, sin respuesta, espera excesiva, impago; derecho de revisión/apelación, caducidad de incidentes y prevención de reportes maliciosos.
- Restricciones progresivas solo tras revisión y con criterios consistentes; preferir exigir prepago sobre bloqueos automáticos.
- Reportes de calidad contextualizados: no imputar al repartidor demora de cocina ni al comercio la espera por destinatario.

## F. Catálogo canónico, emprendedores y sectores regulados

- Catálogo global `canonical_products` con GTIN cuando aplique, marca, contenido neto, presentación y fotos con derechos de uso; cada comercio crea su `merchant_offer` con precio/stock/estado propios. No fusionar alimentos artesanales por similitud.
- Alta por búsqueda, escaneo EAN, selección masiva y duplicación de menú; edición rápida en PC y móvil.
- Perfiles de emprendimientos domiciliarios con estado de incorporación; para categorías reguladas **no habilitar pedidos/checkout** hasta verificar requisitos sanitarios y comerciales aplicables.
- «Documentación verificada» muestra alcance, fecha de verificación y vencimiento, sin prometer legalidad universal.
- Medicamentos de venta libre: **fuera del lanzamiento** hasta evaluación legal/sanitaria específica Argentina/Santa Fe y revisión del rol de marketplace; productos bajo receta excluidos. Perfumería/higiene sujetos a controles aplicables.
- Pedidos programados, cupos diarios, cierres, horarios por producto y supermercados con franjas de entrega y reglas de faltantes.

## G. Promociones, marketing y descubrimiento

- Motor de reglas: `PERCENT`, `FIXED`, `FREE_DELIVERY`, `BOGO`, `PRODUCT_BUNDLE`, con elegibilidad, fecha, mínimos, máximo, límite global/usuario, prioridad, acumulabilidad y financiación (`MERCHANT`, `PLATFORM`, `SHARED`).
- Redenciones transaccionales e idempotentes; presupuesto de campaña, atribución de subsidio, ajustes ante cancelación y protección contra autocuentas/fraude.
- Fases: (1) bienvenida y ofertas de comercios; (2) recompra y referidos; (3) destacados rotativos etiquetados; (4) pujas CPC y optimización avanzada tras tráfico suficiente.
- Eventos analíticos con consentimiento: `store_viewed`, `product_viewed`, `add_to_cart`, `checkout_started`, `payment_confirmed`, `order_delivered`, `coupon_redeemed`, `repeat_purchase`.
- Mantener búsqueda unificada por comercios y productos; agrupación canónica verificable y ranking orgánico auditable, sin prioridad comprada encubierta.
- Web pública compartible/SEO para descubrir productos y negocios sin instalar; CTA de descarga de Google Play, sin forzar instalación antes de explorar.

## H. Comandas y operación de comercios

- Panel web responsive PC y Android con tablero de pedidos de alta visibilidad, sonido, reintento de push y aviso por pedidos sin aceptar.
- Comanda imprimible de 58/80 mm **manual** en MVP; opción de impresión automática mediante agente local/impresora compatible en fase posterior. No enviar ESC/POS directamente desde servidor a cualquier impresora.
- Configuración de impresora, prueba de impresión, cola/reintento, estado `PRINT_PENDING/PRINTED/PRINT_FAILED` y reimpresión controlada; impresión no cambia estado de pago ni aceptación.
- Vistas de cocina/KDS avanzada, estaciones múltiples y POS Comerz fuera del MVP.

## I. Entidades adicionales de datos (v0.3)

Extender el modelo v0.2 con:
- `merchant_documents`, `verification_reviews`, `regulated_categories`, `merchant_category_permissions`.
- `courier_preferences`, `delivery_quotes`, `delivery_offers`, `delivery_assignments`, `delivery_events`, `delivery_proofs`, `courier_merchant_ledger`.
- `order_conversations`, `conversation_participants`, `messages`, `message_receipts`, `order_adjustments`, `claims`, `claim_evidence`, `claim_resolutions`, `customer_incidents`, `incident_appeals`.
- `payment_allocations`, `cash_collections`, `merchant_statements`, `late_fee_rules`, `debt_notices`, `account_restrictions`.
- `promotion_budgets`, `promotion_funders`, `referral_codes`, `referral_attributions`, `analytics_events`.
- `scheduled_order_slots`, `branch_capacity_rules`, `printer_devices`, `print_jobs`, `push_devices`, `notification_outbox`.
- `sync_commands` con `command_id` único, expiración y resultado del servidor; no persistir información sensible innecesaria en almacenamiento móvil.
- Índices por `(merchant_id, created_at)`, `(order_id, created_at)`, ofertas activas y estados; constraints para no asignar dos repartidores activos a un mismo reparto.

## J. Plan de implementación actualizado (épicas, historias, aceptación)

| Épica | Prioridad | Historia principal | Criterios de aceptación |
|---|---|---|---|
| E0 — Validación y cumplimiento | P0 | Como operador, quiero validar pagos, documentación y reparto | Prueba de split Checkout API, mapa de responsabilidades, categorías permitidas y contratos revisados antes de dinero real |
| E1 — API, identidad y seguridad | P0 | Como usuario, accedo con permisos correctos | OpenAPI, auth, RBAC por comercio, idempotencia y auditoría probados |
| E2 — App Android y web pública | P0 | Como comprador, descubro y compro desde Android | Build Play Store, catálogo offline de lectura, carrito persistente y confirmación solo online |
| E3 — Comercios web y catálogo | P0 | Como comercio, administro desde PC o celular | Catálogo canónico, precio propio, disponibilidad, horarios y permisos |
| E4 — Pedidos y programación | P0 | Como comercio, acepto pedidos inmediatos o programados | Transiciones válidas, vencimientos, capacidad, reintentos y no duplicados |
| E5 — Checkout API y ledger | P0 | Como comercio, cobro directamente y veo comisiones | Split probado, webhooks idempotentes, efectivo conciliable, devoluciones y cierre semanal |
| E6 — Repartos híbridos | P0 | Como repartidor, acepto una oferta que cumple mi mínimo | Asignación atómica, rechazos sin sanción, retiro/entrega auditados y pago externo registrado |
| E7 — Comunicación y reclamos | P0 | Como comprador, coordino o reclamo en la app | Chat por permisos, cambios confirmados, reclamos trazables y apelaciones |
| E8 — Promociones básicas | P1 | Como comercio, creo descuentos financiados y limitados | Cálculo servidor, presupuesto, usos atómicos, reversas y métricas |
| E9 — Reputación e incidentes | P1 | Como usuario, califico un servicio real | Solo pedido real, moderación, privacidad de cliente y apelación |
| E10 — Comandas y notificaciones | P0 | Como comercio, no pierdo un pedido | Alarmas, notificaciones persistentes, impresión manual y prueba de contingencia |
| E11 — Descubrimiento y anuncios | P1 | Como comprador, encuentro comercios y ofertas | Ranking orgánico auditable; patrocinio etiquetado solo si se activa |
| E12 — Operación y observabilidad | P0 | Como admin, detecto incidentes y concilio | Alertas, backups probados, métricas p95, soporte y pruebas de caos de conectividad |
| E13 — Crecimiento posterior | P2 | Como usuario, invito amigos y obtengo beneficios | Antifraude, atribución y presupuesto antes de activar |
| E14 — Integraciones posteriores | P3 | Como comercio, sincronizo con Comerz | API versionada y webhooks, sin implementación en MVP |

**Pruebas de aceptación transversales obligatorias:**
1. Dos repartidores aceptan simultáneamente: solo uno obtiene asignación.
2. Cliente pulsa pagar dos veces y webhook llega repetido/desordenado: una sola operación económica y pedido consistente.
3. Se corta internet durante aceptación o cobro: UI muestra «pendiente de confirmación», reconcilia al volver y no inventa éxito.
4. Comercio acepta pedido con producto agotado: backend bloquea o exige sustitución aprobada.
5. Pedido en efectivo cobrado por repartidor: ledger del comercio y del repartidor cuadran, sin sumar propina indebidamente.
6. Se cancela pedido con promoción: se revierte uso/subsidio conforme reglas.
7. Se pierde push: comercio ve pedido pendiente por polling/sincronización y alerta operativa.
8. Cliente reclama producto faltante: se crea caso, se solicita evidencia proporcional y se ejecuta resolución auditable.
9. Comercio sin habilitación requerida: puede gestionar incorporación, pero no publicar checkout regulado.
10. Pedido programado: no supera cupos, ventana ni horario de corte.
11. Impresora desconectada: pedido sigue visible y no cambia estado; reimpresión manual controlada.
12. Usuario sin rol de comercio intenta leer chats, direcciones o cobros ajenos: denegación y auditoría.

## K. Roadmap por hitos y puertas de salida

- **Hito 0 — Viabilidad (bloqueante):** prueba real Mercado Pago Checkout API/split, validación legal y fiscal, política de reparto y seguros, entrevistas con comercios y repartidores.
- **Hito 1 — Primer pedido real controlado:** Android cliente, web comercio, catálogo, pago/efectivo, aceptación, notificaciones y seguimiento básico; repartidor propio o asignación controlada.
- **Hito 2 — Piloto confiable Tostado:** ofertas de repartidores, chat, reclamos, liquidaciones semanales, monitoreo, programación y cupones básicos.
- **Hito 3 — Crecimiento:** catálogo precargado amplio, referidos, campañas compartidas, métricas de recompra, impresión automática compatible.
- **Hito 4 — Escala regional:** nuevas ciudades, optimización, reputación avanzada, publicidad, integración Comerz y potencial migración de infraestructura por métricas reales.

**Go/no-go:** no abrir a público hasta probar pagos, reembolsos, reintentos, asignación, caídas de red, soporte de reclamos, cumplimiento y operación con usuarios reales. El volumen objetivo inicial (~30 comercios, <10 pedidos/día cada uno) no justifica microservicios ni AWS completo.

## L. Decisiones abiertas, sin inventar

1. Tarifa de comisión final, planes/suscripciones y quién absorbe exactamente el PSP bajo contrato real.
2. Cómo se cobra al comprador el envío y la propina cuando el comercio es receptor del pago; flujo de compensación con repartidor.
3. Contratos, habilitaciones y responsabilidades de alimentos, farmacia, repartidores, consumidores y tratamiento de datos.
4. Política de devoluciones, tiempos de reclamo, cancelaciones, recargos y límites de deuda.
5. Stack de notificaciones, realtime y workers durables; soporte de push en dispositivos Android del comercio si opera solo vía navegador.
6. Compatibilidad inicial de impresoras y si se requiere app Android complementaria para comercios.
7. Precio sugerido de reparto por zona/distancia y fuente de rutas; reglas de espera y cancelación.
8. Si el programa de suscripciones del documento v0.2 se mantiene o se reemplaza por comisión pura.


---

# ANEXO V0.4 — MVP definitivo de producto (sujeto a validaciones externas)

## 1. Pricing y monetización — regla normativa

**El comprador no paga tarifa de servicio de Pedilo.** Sí puede pagar envío y productos; propina opcional claramente identificada. El comercio paga: (a) mensualidad según plan, (b) comisión Pedilo por venta concluida, (c) tarifa efectiva del procesador **solo si corresponde a su medio de pago**. El procesamiento es externo, no ingreso de Pedilo; se muestra separado en onboarding, simulador y liquidaciones. No se presupone que el split pueda forzar un único débito total al comercio sin verificarlo.

**Planes de lanzamiento propuestos (precios a validar):**

| Plan | Mensualidad ARS | Comisión base Pedilo | Pedidos | Sucursales | Usuarios | Beneficios |
|---|---:|---:|---|---|---|---|
| Emprendedor | $0 | 6% | Ilimitados | 1 | 1 | Catálogo, pedidos, reparto, chat, promociones básicas y reportes esenciales |
| Negocio | $25.000 | 4% | Ilimitados | 1 | 3 | Promociones avanzadas, analíticas completas y soporte prioritario |
| Pro | $60.000 | 2,5% | Ilimitados | Hasta 3 | 6 | Gestión multisucursal, reportes y promociones avanzadas, soporte prioritario |

Las funciones **críticas de seguridad y operación** (pagos, reclamos, reparto, alertas, devoluciones, programación, conciliación) no se bloquean por plan. Los pedidos son ilimitados en todos. No se altera ranking orgánico por plan. Mensualidades, comisiones, límites de usuarios/sucursales y beneficios son parámetros versionados; **no publicar precios como definitivos sin prueba de rentabilidad y validación con comercios**.

**Comisión marginal por tramos sobre base comisionable:**
- ARS 0–30.000: 100% de tasa base del plan.
- ARS 30.000–100.000: 70% de tasa base sobre **el tramo excedente**.
- Más de ARS 100.000: 40% de tasa base sobre **el tramo excedente**.
- Después, `commission = min(commission_by_brackets, cap_by_category)`. No aplicar tasa reducida retroactivamente al pedido completo.
- Topes ARS por pedido: gastronomía 5.000; kioscos 4.000; supermercados 5.000; electrónica 7.000; emprendedores 5.000. Definir categoría principal del comercio/sucursal, evitando arbitraje por etiquetado de producto; rubros mixtos requieren regla contractual y resolución administrativa.
- Base: subtotal de productos después de descuentos financiados por comercio, antes de envío, propina y descuentos financiados por Pedilo; revisar tratamiento de IVA, devoluciones y promociones con asesoramiento fiscal. No permitir división artificiosa de pedidos para evadir topes o manipular promociones.
- `pricing_version_id` inmutable por pedido. Redondeo en centavos, regla única de redondeo y pruebas de bordes: 29.999,99; 30.000; 30.000,01; 99.999,99; 100.000; 100.000,01; cap exacto.
- Cantidad de unidades y de SKUs distintos se registran **para estimar preparación, capacidad y métricas**, no para aumentar automáticamente la comisión. Supermercados pueden tener pedidos programados y tiempos estimados por cantidad de SKUs.

**Ejemplo plan Negocio, supermercado, pedido $120.000:** $30.000×4% + $70.000×2,8% + $20.000×1,6% = $3.480, inferior al tope $5.000. No incluye procesamiento, envío ni mensualidad.

**Principio de crecimiento:** mientras el pedido no alcance el tope, la comisión aumenta con el valor; incluso con tope, Pedilo crece con el número de pedidos. La tasa efectiva puede bajar en tickets grandes; medir contribución marginal por comercio/plan/categoría, descuentos, morosidad y coste de soporte. Revisión periódica sin cambios retroactivos.

## 2. Mercado Pago Checkout API: integración y devoluciones simples

**Proveedor elegido:** Mercado Pago Checkout API con OAuth vendedor y Split 1:1 **solo tras validar su disponibilidad real y el producto API exacto**. Referencia: https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace . La documentación indica que primero se descuenta tarifa del procesador del saldo vendedor y luego comisión marketplace; el reembolso afecta proporcionalmente a vendedor y marketplace y puede bloquearse si el vendedor carece de saldo. No prometer al comercio un débito global exacto sin pruebas.

**Política de MVP para devoluciones:**
1. Antes de pago aprobado: cancelar intento/orden si lo admite el estado; no llamar «reembolso» a una cancelación.
2. Pago aprobado y comercio rechaza pedido antes de preparación: solicitar **reembolso total** por vía oficial, registrar estado `REFUND_PENDING` hasta confirmación del PSP. No marcarlo como completado por el HTTP 2xx solamente; verificar estado final.
3. Producto faltante o incorrecto tras entrega: reclamo estructurado, comercio propone y autoriza **reembolso parcial**; importe no puede superar saldo reembolsable. Para simplificar, evitar modificaciones de cobro que requieran cobrar diferencias posteriores: si sustituto cuesta más, cliente debe hacer nuevo pedido o elegir alternativa igual/menor.
4. Incidente logístico: revisión operativa; separar precio de productos, tarifa de envío y propina. No devolver automáticamente la totalidad por un retraso sin evaluar circunstancias y normativa.
5. Reembolso online ejecutado desde backend con credenciales autorizadas, clave idempotente, referencia de pedido, solicitud/resultado/eventos, conciliación y auditoría. Endpoint exacto según familia de Checkout API efectivamente implementada (`/v1/payments/{id}/refunds` o `/v1/orders/{order_id}/refund`); **no mezclar APIs ni asumir que un endpoint de Orders funciona con un pago de Payments**.
6. Si falta saldo del comercio, la API falla o no se puede revertir comisión: `REFUND_BLOCKED`/`MANUAL_REVIEW`, aviso claro, reintento controlado y canal de resolución. No prometer devolución inmediata ni tomar dinero del comprador o de otro comercio para cubrirlo.
7. Efectivo: devolución entre comercio y comprador registrada con comprobante y confirmación; Pedilo ajusta comisión devengada por asiento compensatorio. Nunca declarar «dinero devuelto» sin evidencia.
8. Crédito promocional Pedilo no equivale a devolución de dinero: distinguir y ofrecer solo cuando corresponda y el comprador lo acepte, sin sustituir derechos legales.
9. Reembolsos de múltiples pagos, plazos, comisiones no recuperables y contracargos: escenarios de integración obligatorios. Según docs generales de Mercado Pago hay ventanas de reembolso de hasta 180 días para algunos productos, pero **confirmar específicamente el checkout, medio y contrato elegido**.

**Criterio de aceptación:** pedido rechazado pagado online puede solicitar devolución completa; pedido con ítem faltante puede solicitar devolución parcial; webhooks duplicados no duplican devolución; falta de saldo no oculta la deuda ni produce éxito falso; conciliación deja claro quién soporta la devolución y comisión.

## 3. Reclamos y soporte sin equipo jurídico interno

Pedilo implementa **soporte operativo de primer nivel**, no arbitraje jurídico profesional. Reglas claras y razonables para incidencias frecuentes; el comercio responde por productos, repartidor por hechos de entrega que controla y Pedilo por fallas propias, **sin asumir que estas etiquetas eliminan obligaciones legales solidarias o de consumo**.

- Reclamo vinculado a pedido con motivo y fotos opcionales, plazo visible y registro de evidencias. Primero propuesta de solución del comercio para productos faltantes/incorrectos; Pedilo puede facilitar la comunicación, supervisar SLA y escalar si no hay respuesta.
- Estados `OPEN`, `MERCHANT_REVIEW`, `AGREED_REFUND`, `PAYMENT_REFUND_PENDING`, `RESOLVED`, `DISPUTED`, `ESCALATED`, `CLOSED`.
- Plantillas operativas de resolución: reembolso total, parcial, reenvío acordado, reemplazo acordado o rechazo motivado; evitar decisiones automatizadas irreversibles.
- Disputas complejas, lesiones, intoxicaciones, denuncias, fraude, contracargos, requerimientos regulatorios o reclamos formales: suspender automatismos y derivar a asesoramiento profesional/autoridad competente. **Antes del piloto pago, obtener al menos revisión jurídica puntual de términos, privacidad, rol del marketplace y circuito de reclamos**, aunque no se contrate abogado permanente.
- Publicar canales de atención accesibles y no limitar derechos del consumidor por cláusula de exención. Datos mínimos, conservación razonable, revisión y apelación.

## 4. Android repartidores: condición de lanzamiento

`apps/courier-mobile`: **React Native + Expo para Android, publicada en Google Play desde el lanzamiento**, no PWA. Módulos: registro y verificación, disponibilidad, zonas, tarifa mínima, bandeja de ofertas, aceptar/rechazar, navegación externa opcional, estados de retiro/entrega, chat privado, incidencias, historial, métricas y saldos comercio-repartidor.

**Condiciones hostiles:**
- La app mantiene localmente viaje asignado, instrucciones y últimos datos permitidos; reconexión con sync incremental, `event_id`/`idempotency_key`, colas locales persistentes y deduplicación servidor. Datos sensibles cifrados y expiración de caché.
- No aceptar ofertas, confirmar entrega o cobrar offline como si se hubiera confirmado; acciones pendientes muestran estado explícito. Si el plazo de una oferta vence durante desconexión, al volver se muestra expirada.
- Push FCM/APNs según plataforma (Android desde inicio), canal realtime mientras app está abierta, recuperación al abrir y consulta periódica compatible con límites del sistema; **push no garantiza entrega inmediata ni despierta siempre la app**.
- Pruebas obligatorias: ahorro de batería, app terminada, pantalla bloqueada, cambio Wi-Fi/datos, señal 2G/3G/4G degradada, doble toque, 2 repartidores aceptando, reloj del teléfono incorrecto, GPS deshabilitado, reinicio, permisos revocados.
- Estados, timestamps y asignación definitivos siempre en backend; el cliente no estima unilateralmente un viaje entregado. PIN de entrega opcional y prueba proporcional al riesgo.
- Objetivo de confiabilidad medido en piloto: detectar oferta activa por canal disponible, recuperación sin duplicación y tiempo de aceptación registrado; medir percentiles reales antes de fijar SLA contractual.

## 5. Comercio: avisos robustos y contingencia

`apps/merchant-web`: Next.js responsive para PC/móvil, pedidos visibles con estados y contador de aceptación. Realtime + sonido con consentimiento + push cuando esté soportado + polling de respaldo + outbox durable y alarmas de pedidos sin reconocer. Distinguir `notification_sent`, `notification_seen`, `order_acknowledged`; enviar notificación no equivale a recepción humana.

En Android de comercios, validar navegadores, permisos y segundo plano. **Si el piloto demuestra avisos insuficientes, construir app Android de alertas/comandos críticos antes de apertura masiva**; no confiar solo en web push. Impresión manual 58/80 mm MVP, automática posterior. Ante caída completa de internet, modo contingencia documentado: no aceptar nuevos pedidos no recibidos, comunicar indisponibilidad y reconciliar al volver.

## 6. Repartos, dinero y operaciones

Tarifa híbrida: sugerencia por zona/distancia → comercio ajusta → repartidor acepta/rechaza con mínimo propio. Oferta con vencimiento, asignación atómica y reasignación auditable. Rechazo previo a aceptación sin penalidad. Si nadie acepta, aumentar tarifa, asignar propio o reprogramar/cancelar. El comercio **paga al repartidor** en el momento, cierre de jornada o período pactado; Pedilo no custodia ni reparte ese dinero. Propinas separadas; si repartidor cobra efectivo, registrar total recibido, obligación hacia comercio, remuneración y compensaciones autorizadas.

## 7. Alcance real del MVP v0.4 y fases

**P0, lanzamiento controlado:** Android cliente, Android repartidor, web comercio/admin, onboarding verificado, catálogo global y artesanal, un comercio/pedido, checkout API split validado + efectivo, órdenes inmediatas/programadas, ofertas híbridas de reparto, notificaciones redundantes, chat por pedido, reclamos básicos y reembolsos total/parcial, ledger semanal, pricing versionado por tramos/topes, cupones básicos, monitoreo, soporte y contingencia. El MVP es deliberadamente **más grande** que v0.2; lanzar por hitos con pilotos reducidos.

**P1, tras estabilizar:** referidos, promociones avanzadas, reportes completos, automatización de impresión, reputación detallada, publicidad de destacados etiquetados y mejora de capacidad programada.

**P2, fuera del MVP:** pujas CPC, carrito multicomercio, split 1:N, pago automático a repartidores, GPS continuo, optimización de rutas, IA operativa, integración Comerz, logística interurbana y app iOS.

**Orden de implementación por épicas e historias:**
| Épica | Historia de usuario | Criterio mínimo de aceptación |
|---|---|---|
| E0 Viabilidad | Como fundador valido el split, devoluciones, habilitaciones y márgenes | Pruebas reales de liquidación y reembolso total/parcial, escenarios de saldo insuficiente y revisión puntual legal/fiscal documentada |
| E1 Plataforma | Como operador gestiono identidades y comercios | Roles aislados, OpenAPI, migraciones, auditoría y logs trazables |
| E2 Catálogo | Como comercio publico productos y precios | Canónicos sin duplicados falsos, ofertas independientes y restricciones regulatorias |
| E3 Android cliente | Como comprador compro con red inestable | Caché y carrito local; no hay éxito falso sin confirmación servidor |
| E4 Pedidos | Como comercio acepto pedidos | Transiciones válidas, programación y vencimientos idempotentes |
| E5 Pagos | Como comercio cobro y concilio | Split real, efectivo, comisiones, liquidaciones y reembolsos trazables |
| E6 Android courier | Como repartidor acepto y entrego | Asignación atómica, tarifa mínima, reconexión, incidencias y saldo |
| E7 Alertas comercio | Como comercio no pierdo pedidos | Realtime + fallback + alarma y pruebas Android segundo plano |
| E8 Chat y reclamos | Como comprador coordino y reclamo | Chat por roles, ajustes aprobados, reclamo y reembolso auditados |
| E9 Pricing | Como comercio comparo planes y topes | Tramos marginales exactos, topes por rubro, pricing versionado y simulador |
| E10 Promociones | Como comercio creo una oferta | Presupuesto, elegibilidad, límites atómicos y reversa en cancelación |
| E11 Operación | Como administrador controlo el servicio | Alertas, backups restaurados, conciliación, soporte y pruebas de cortes de red |

**Puertas de salida:** (G0) contrato y prueba técnica de MP; (G1) primer pedido pago y devolución en sandbox/entorno habilitado; (G2) 2 repartidores disputando la misma oferta, desconexión y recuperación; (G3) comercio recibe y reconoce pedidos en PC y Android; (G4) 5–10 comercios piloto con métricas de incidentes, tiempos y margen; (G5) lanzamiento público.

## 8. Decisiones pendientes no bloqueantes de diseño y bloqueantes de lanzamiento

- **Bloqueantes:** tarifas y plazos reales Mercado Pago por medio/provincia, elegibilidad de split, soporte y autoridad de reembolso, saldo insuficiente, impuestos y documentación legal/sanitaria/seguros; prueba de notificaciones Android en campo.
- **Pendientes de producto configurables:** duración de ofertas, reglas de espera del cliente, precios sugeridos de reparto por zona, SLA de atención, ventana de reclamo, vencimiento de deuda, recargos contractuales, descuentos acumulables y financiación, tipología de comprobantes, cantidad de pedidos piloto por comercio.
- **Pendiente comercial:** confirmar precios finales de planes, mensualidades y topes mediante simulaciones por rubro y entrevistas. No modificar retroactivamente el precio de órdenes confirmadas.

## 9. Fuentes técnicas oficiales para validar antes de implementar

- Split 1:1 / Checkout API: https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Reembolsos Checkout API Orders: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/refunds-cancellations
- Reembolso de Orders API: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/refund-order/post
- Reembolso de Payments API: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-refund/post

**No desarrollar código de producción hasta completar G0; toda cifra de pricing es hipótesis comercial, no una cotización de Mercado Pago.**
