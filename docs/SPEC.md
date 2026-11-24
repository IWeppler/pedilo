# Pedilo — Especificación técnica (SPEC.md)

**Versión:** 0.4 consolidada · **Fecha:** 2026-11-23 · **Estado:** MVP definido; decisiones comerciales provisionales; sin código de producción.

Este documento es la **única fuente de verdad** del MVP. Integra el Anexo v0.4 con todo lo de v0.2 y v0.3 que sigue vigente; lo reemplazado se eliminó. El documento original con el historial de decisiones está en [`docs/archive/SPEC-v0.4-original.md`](archive/SPEC-v0.4-original.md) y no debe implementarse si contradice este archivo.

> **Regla de oro:** no desarrollar código de producción hasta pasar la puerta **G0** (§13). Toda cifra de pricing es hipótesis comercial, no una cotización de Mercado Pago.

---

## 1. Visión

Pedilo es un marketplace **multirrubro y multiciudad** para localidades del interior argentino (primera ciudad piloto: Tostado, Santa Fe). Permite descubrir comercios, comprar productos, pagar y gestionar entregas o retiros. El comercio puede operar exclusivamente desde el panel de Pedilo.

Pedilo es una **marca y un sistema independiente de Comerz y CheCancha** durante el MVP. Las integraciones quedan fuera de alcance, pero se diseñan límites de dominio y eventos para habilitarlas después.

**Criterio de producto:** validar demanda y cobranza en un piloto local antes de invertir en logística centralizada, POS gastronómico o integraciones con otras marcas.

## 2. Decisiones confirmadas

**Canales**
- **Cliente:** app Android (React Native + Expo) en Google Play desde el lanzamiento, más **web pública** responsive para descubrir sin instalar (SEO, enlaces compartibles, CTA a Google Play).
- **Repartidor:** app Android (React Native + Expo) en Google Play desde el lanzamiento. **No PWA.**
- **Comercio:** panel web responsive (PC y celular).
- **Admin:** panel web restringido y auditado.
- iOS diferido.

**Negocio**
- Un pedido = un comercio (una sucursal).
- Pedidos inmediatos y programados; retiro o entrega.
- El **comercio paga al repartidor**. No hay flota Pedilo ni custodia de fondos de reparto.
- Tarifa de reparto **híbrida**: Pedilo sugiere → el comercio ajusta → el repartidor acepta o rechaza según su mínimo.
- Chat privado por pedido; modificaciones estructuradas; reclamos estructurados.
- Pagos **directos al comercio** (split 1:1). Pedilo no recibe y redistribuye fondos.
- **Sin tarifa de servicio Pedilo al comprador.**
- El procesamiento de Mercado Pago se informa **separado** de la comisión Pedilo.
- La comisión en efectivo/transferencia es **igual** a la de pago digital.
- Comisión con **tramos marginales decrecientes y topes por rubro**.
- **Planes con mensualidad + comisión; pedidos ilimitados** en todos los planes.
- Emprendedores admitidos, con cumplimiento aplicable a su rubro.

**Técnica**
- Backend como **API independiente**: monolito modular Node.js + TypeScript con PostgreSQL. No depender de Server Actions para la app.
- Sin microservicios, Redis ni Kubernetes en el MVP.

## 3. Pendiente de verificación antes de manejar dinero real

- Términos y disponibilidad real de Split 1:1 + Checkout API de Mercado Pago.
- Tratamiento exacto de tarifas, comisiones, IVA, retenciones y reembolsos.
- Obligaciones fiscales y facturación de comisiones.
- Protección al consumidor y rol legal del marketplace.
- Habilitaciones alimentarias y de rubros regulados.
- Seguros, responsabilidades y clasificación contractual de repartidores.
- Precio final de planes, mensualidades y topes.

## 4. Alcance

### 4.1 P0 — lanzamiento controlado (MVP)
1. **App Android cliente + web pública:** búsqueda unificada, catálogo, carrito de un comercio, checkout, seguimiento, chat, reclamos. Catálogo en caché y carrito persistente; confirmaciones solo online.
2. **Cuenta de comprador** opcional para navegar; para comprar, contacto verificable y dirección si corresponde. Pedido como invitado con token de seguimiento de alcance limitado.
3. **Onboarding verificado de comercios:** aprobación, sucursales, horarios comerciales y de recepción, cierres excepcionales, zonas, tarifas y pedido mínimo.
4. **Catálogo global y artesanal:** productos canónicos precargados + ofertas propias del comercio; categorías, variantes, grupos de modificadores, disponibilidad, límites por opción, notas del cliente.
5. **Pedidos** inmediatos y programados con aceptación/rechazo manual, estados, historial y auditoría.
6. **Pagos:** Mercado Pago Checkout API con split validado + efectivo + transferencia manual; reembolsos total y parcial.
7. **App Android repartidor** con ofertas híbridas de reparto y asignación atómica.
8. **Notificaciones redundantes** al comercio (realtime + sonido + push + polling + alarmas) y comanda imprimible manual.
9. **Chat por pedido** y **reclamos básicos**.
10. **Ledger de comisiones** con liquidación semanal; **pricing versionado** por tramos y topes; simulador para el comercio.
11. **Cupones básicos.**
12. **Reportes esenciales:** pedidos, ventas brutas, ticket promedio, cancelaciones, pagos y comisiones por período.
13. **Admin:** ciudades, categorías, comercios, moderación de repartidores, incidencias, planes, saldos y métricas.
14. **Monitoreo, soporte y contingencia.**

El MVP v0.4 es deliberadamente grande: se lanza **por hitos con pilotos reducidos** (§13).

### 4.2 P1 — tras estabilizar
Referidos, promociones avanzadas, reportes completos, impresión automática, reputación detallada, destacados patrocinados etiquetados, comparación de ofertas de productos canónicos, mejora de capacidad programada.

### 4.3 P2 — fuera del MVP
Pujas CPC/RTB, personalización con ML, carrito multicomercio, split 1:N, pago automático a repartidores, GPS continuo, optimización de rutas, IA operativa, integración Comerz/CheCancha, POS/KDS/mesas, inventario complejo, contabilidad general, logística interurbana o plataforma courier, app iOS, suscripciones del consumidor, puntos avanzados.

Fuera del lanzamiento por razones regulatorias: **medicamentos** (venta libre hasta evaluación legal/sanitaria específica de Argentina/Santa Fe; bajo receta, excluidos).

## 5. Usuarios y permisos

- **Visitante/comprador:** explora, compra y consulta sus propios pedidos; no ve datos internos.
- **Propietario del comercio:** configura negocio, personal, catálogo, pedidos, pagos, promociones y reportes.
- **Operador de comercio:** gestiona pedidos; permisos granulares para catálogo/promociones; sin acceso automático a facturación.
- **Repartidor independiente:** gestiona su ficha, zonas, tarifa mínima y disponibilidad; ve ofertas sin dirección exacta hasta ser asignado.
- **Administrador Pedilo:** modera y configura; acciones sensibles auditadas y con mínimo privilegio.

Autorización siempre en servidor por pertenencia a comercio/sucursal; aislamiento por tenant en cada consulta y comando. Nunca confiar en IDs enviados por el cliente.

## 6. Pricing y monetización

**El comprador no paga tarifa de servicio de Pedilo.** Paga productos, envío y propina opcional claramente identificada.

El comercio paga:
- (a) mensualidad según plan,
- (b) comisión Pedilo por venta concluida,
- (c) tarifa efectiva del procesador **solo si corresponde a su medio de pago**.

El procesamiento es externo, no es ingreso de Pedilo, y se muestra separado en onboarding, simulador y liquidaciones. No se presupone que el split pueda forzar un único débito total al comercio sin verificarlo.

### 6.1 Planes de lanzamiento (precios a validar)

| Plan | Mensualidad ARS | Comisión base | Pedidos | Sucursales | Usuarios | Beneficios |
|---|---:|---:|---|---|---|---|
| Emprendedor | $0 | 6% | Ilimitados | 1 | 1 | Catálogo, pedidos, reparto, chat, promociones básicas, reportes esenciales |
| Negocio | $25.000 | 4% | Ilimitados | 1 | 3 | Promociones avanzadas, analíticas completas, soporte prioritario |
| Pro | $60.000 | 2,5% | Ilimitados | Hasta 3 | 6 | Multisucursal, reportes y promociones avanzadas, soporte prioritario |

- Las funciones **críticas de seguridad y operación** (pagos, reclamos, reparto, alertas, devoluciones, programación, conciliación) **no se bloquean por plan**.
- El plan **no altera el ranking orgánico**.
- Mensualidades, comisiones, límites y beneficios son **parámetros versionados**, nunca hardcodeados. No publicar precios como definitivos sin prueba de rentabilidad y validación con comercios.

### 6.2 Comisión marginal por tramos

Sobre la base comisionable:
- ARS 0–30.000: 100% de la tasa base del plan.
- ARS 30.000–100.000: 70% de la tasa base sobre **el tramo excedente**.
- Más de ARS 100.000: 40% de la tasa base sobre **el tramo excedente**.
- Luego `commission = min(commission_by_brackets, cap_by_category)`. La tasa reducida nunca se aplica retroactivamente al pedido completo.

**Topes por pedido (ARS):** gastronomía 5.000 · kioscos 4.000 · supermercados 5.000 · electrónica 7.000 · emprendedores 5.000. Se usa la categoría principal del comercio/sucursal, evitando arbitraje por etiquetado de producto; rubros mixtos requieren regla contractual y resolución administrativa.

**Base comisionable:** subtotal de productos después de descuentos financiados por el comercio, antes de envío, propina y descuentos financiados por Pedilo. Propinas y remuneración del repartidor no integran la base. Revisar IVA, devoluciones y promociones con asesoramiento fiscal. No permitir división artificiosa de pedidos para evadir topes.

**Reglas de cálculo:** `pricing_version_id` inmutable por pedido; redondeo en centavos con una única regla documentada; pruebas de borde en 29.999,99 · 30.000 · 30.000,01 · 99.999,99 · 100.000 · 100.000,01 · tope exacto. Unidades y SKUs se registran para estimar preparación y capacidad, **no** para aumentar la comisión.

**Ejemplo (plan Negocio, supermercado, pedido $120.000):** $30.000×4% + $70.000×2,8% + $20.000×1,6% = **$3.480**, inferior al tope de $5.000. No incluye procesamiento, envío ni mensualidad.

Medir contribución marginal por comercio/plan/categoría, descuentos, morosidad y costo de soporte. Revisión periódica sin cambios retroactivos.

### 6.3 Cobro de comisiones
- **Pago digital:** retención automática vía split cuando esté habilitado y conciliado; comisión real registrada según confirmación del proveedor.
- **Efectivo/transferencia:** asiento `ACCRUED` al completar el pedido; cuenta de comisiones por cobrar (no billetera custodial); liquidación semanal (§8.4).
- **Cancelaciones y reembolsos:** asientos compensatorios; nunca borrar movimientos.

## 7. Pedidos

### 7.1 Flujo
1. El comprador elige ciudad y sucursal y consulta disponibilidad.
2. Configura variantes/modificadores y arma el carrito de **una** sucursal. Agregar un producto de otra sucursal pide vaciar/reemplazar.
3. Elige retiro o entrega; se valida dirección/zona, tarifa, horario y total.
4. El backend crea una **cotización de duración limitada** con precios y tarifa de reparto versionados; revalida precios, promociones, stock y disponibilidad.
5. Se crea el pedido en `PENDING_PAYMENT` (digital) o `PLACED` (efectivo/transferencia).
6. Pago digital: se espera **confirmación servidor a servidor**; la redirección del cliente nunca es prueba.
7. El comercio acepta o rechaza manualmente dentro de un plazo configurable.
8. Preparación → listo → reparto o retiro → entregado/retirado.
9. Cancelaciones, reembolsos y ajustes siguen políticas por etapa, motivo y actor; todo auditado.

Para pedidos programados se guardan zona horaria, ventana, capacidad, fecha de corte y política de cancelación.

### 7.2 Estados
**Pedido:** `DRAFT → QUOTED → PENDING_PAYMENT → PLACED → ACCEPTED → PREPARING → READY → PICKED_UP_BY_COURIER → DELIVERED`, o `READY → READY_FOR_PICKUP → PICKED_UP`. Efectivo/transferencia van de `QUOTED` directo a `PLACED`; un pago digital pasa a `PLACED` solo con confirmación verificada del PSP. Ramas: `REJECTED`, `CANCELLED`, `EXPIRED`, `DELIVERY_FAILED`.

**Pago:** `PENDING → APPROVED | REJECTED | CANCELLED`; desde `APPROVED`: `REFUND_PENDING → REFUNDED | PARTIALLY_REFUNDED | REFUND_BLOCKED`, `REFUND_BLOCKED → REFUND_PENDING | MANUAL_REVIEW`, y `CHARGEBACK`. Los reembolsos viven en el estado de **pago**, no en el del pedido: un pedido entregado sigue figurando como `DELIVERED` aunque tenga un reembolso parcial.

Las transiciones completas están implementadas y testeadas en `packages/domain`.

Los estados de **pedido**, **pago**, **reparto** y **reclamo** son máquinas independientes para evitar combinaciones imposibles. Transiciones monotónicas cuando aplique, con actor, motivo y timestamp del servidor.

## 8. Pagos

### 8.1 Mercado Pago Checkout API + Split 1:1
Proveedor elegido **solo tras validar disponibilidad real y el producto API exacto**. Según la documentación, primero se descuenta la tarifa del procesador del saldo del vendedor y luego la comisión del marketplace; el reembolso afecta proporcionalmente a vendedor y marketplace y puede bloquearse si el vendedor no tiene saldo.

1. El comercio vincula su cuenta Mercado Pago por OAuth.
2. El backend genera el intento de pago con `idempotency_key`, referencia de orden y desglose inmutable.
3. El cliente paga en Checkout API; la app muestra «verificando pago».
4. Webhook validado + consulta de estado al PSP confirman el pago.
5. Split 1:1 y `application_fee` sujetos a las condiciones efectivas del proveedor; probar tasas, IVA, reversas, contracargos, parcialidades y conciliación.
6. El comercio recibe su liquidación según reglas del PSP; Pedilo recibe su participación.

Todo detrás de una interfaz `PaymentProvider` para permitir otros PSP. Alternativas a evaluar por **split/marketplace real, OAuth, webhooks, conciliación, reembolsos, costos y SLA**: Naranja X, NAVE, Ualá, Mobbex. Ofrecer QR/link no equivale a split.

### 8.2 Devoluciones (MVP)
1. **Antes de pago aprobado:** cancelar intento/orden si el estado lo admite; no llamarlo «reembolso».
2. **Pago aprobado y el comercio rechaza antes de preparar:** reembolso **total** por vía oficial; `REFUND_PENDING` hasta confirmación del PSP (un HTTP 2xx no alcanza).
3. **Faltante o incorrecto tras entrega:** reclamo estructurado; el comercio propone y autoriza reembolso **parcial** hasta el saldo reembolsable. Si un sustituto cuesta más, el cliente hace un pedido nuevo o elige alternativa igual/menor (no se cobran diferencias posteriores).
4. **Incidente logístico:** revisión operativa separando productos, envío y propina; sin devolución total automática por demora.
5. **Ejecución:** desde backend con credenciales autorizadas, clave idempotente, referencia de pedido, eventos, conciliación y auditoría. Usar el endpoint de la familia de API efectivamente implementada (`/v1/payments/{id}/refunds` o `/v1/orders/{order_id}/refund`); **no mezclar APIs**.
6. **Falta de saldo o falla:** `REFUND_BLOCKED` / `MANUAL_REVIEW`, aviso claro, reintento controlado y canal de resolución. Nunca éxito falso ni tomar dinero de otro participante.
7. **Efectivo:** devolución entre comercio y comprador con comprobante; Pedilo ajusta la comisión devengada con asiento compensatorio.
8. **Crédito promocional ≠ devolución de dinero:** solo si corresponde y el comprador lo acepta.
9. Escenarios obligatorios: múltiples pagos, plazos (hasta 180 días según producto, a confirmar), comisiones no recuperables y contracargos.

**Aceptación:** pedido pagado y rechazado → devolución completa; ítem faltante → devolución parcial; webhooks duplicados no duplican devolución; falta de saldo no oculta deuda ni produce éxito falso; la conciliación muestra quién soporta devolución y comisión.

### 8.3 Efectivo y transferencia
- Misma tasa contractual que el pago digital, sin procesamiento PSP. No confundir comisión devengada con dinero cobrado.
- Registrar **quién cobra** el efectivo (`MERCHANT` o `COURIER`) y cuánto corresponde a cada parte; si cobra el repartidor, generar deuda repartidor→comercio o compensación acordada. Nunca asumir que lo cobrado es propina.
- Transferencia: comprobante opcional, verificación por el comercio y conciliación; el comprobante solo no prueba el pago. Nunca se marca cobrado automáticamente.

### 8.4 Liquidación y mora
Liquidación semanal con cortes por zona horaria, vencimiento configurable, pagos parciales, conciliación y asientos correctivos inmutables. Mora escalonada: aviso → gracia → recargo contractual (validado legalmente) → límite de deuda → restricción del efectivo → suspensión, conservando acceso a historial y comprobantes. Registro de notificaciones, disputas y regularización.

### 8.5 Desglose monetario por pedido
`items_subtotal`, `merchant_discount`, `platform_discount`, `delivery_fee_customer`, `courier_offer`, `merchant_delivery_subsidy`, `tip`, `taxes`, `merchant_commission_basis`, `commission_due`, `psp_fee_actual`, `platform_net_margin_estimate`, `refund_amount`. Importes en unidades menores y aritmética entera.

## 9. Reparto

### 9.0 Principio: pedido y reparto desacoplados
El sistema de reparto **no depende de la entidad `Order`**. Son dos conceptos distintos:

- **Order (pedido comercial):** qué compra el cliente, en qué comercio, cuánto cuesta, cómo paga y qué productos contiene.
- **Delivery (servicio logístico):** qué se transporta, desde dónde, hacia dónde, quién lo transporta, cuánto se le paga al repartidor, estados y tiempos.

Reglas:
- `Delivery` es un agregado propio con origen, destino, descripción del paquete, contacto de entrega, tarifa al repartidor, propina, cobro en efectivo a recolectar (si aplica) y su propia máquina de estados (§9.2).
- `deliveries.order_id` es **opcional**. Un pedido puede generar un delivery, pero el modelo admite deliveries sin pedido del marketplace.
- El delivery guarda **snapshots** de lo que necesita (direcciones, contacto, monto a cobrar); no lee el pedido en tiempo real.
- Pedidos y reparto se comunican por **eventos/comandos explícitos**: el pedido solicita un delivery (p. ej. al pasar a `READY` o antes, según la política de anticipación) y el delivery informa sus cambios (`ASSIGNED`, `PICKED_UP`, `DELIVERED`, `DELIVERY_FAILED`), que el módulo de pedidos traduce a su propio estado. Ningún módulo escribe en las tablas del otro.
- Cancelar un pedido emite un comando de cancelación al delivery; el delivery aplica su política (sin repartidor asignado → se cancela; con repartidor en camino → compensación según reglas).

**Alcance:**
- **MVP:** los deliveries se crean **solo a partir de pedidos** de Pedilo.
- **Posterior:** deliveries sin pedido del marketplace, solicitados por un comercio registrado para ventas hechas por otros canales (teléfono, WhatsApp, local). Se habilitan sin cambiar el modelo, pero requieren definir cobro de la comisión, reclamos y responsabilidades (§17). Esto **no** convierte a Pedilo en una plataforma de courier abierta al público ni en logística interurbana (§4.3).

### 9.1 Modalidades
- **Retiro en local:** sin tarifa de envío.
- **Reparto propio del comercio:** zonas (polígonos o reglas simples) con tarifa y mínimo; asignación manual a repartidor propio o entrega sin asignación nominativa.
- **Repartidores independientes (modelo híbrido):** ofertas vía app Android.

### 9.2 Modelo híbrido
Pedilo sugiere tarifa por zona/distancia → el comercio la ajusta → el repartidor (con tarifa mínima y zonas propias) acepta o rechaza. El comercio contrata y paga al repartidor (en el momento, al cierre de jornada o período pactado). Pedilo registra asignación y estado sin custodiar fondos.

**Estados:** `DELIVERY_NEEDED → OFFERED → ASSIGNED → ARRIVING_PICKUP → PICKED_UP → ARRIVING_DROPOFF → DELIVERED`, con `OFFER_EXPIRED`, `COURIER_CANCELLED`, `DELIVERY_FAILED` y reasignación controlada.

- La oferta muestra monto, zona aproximada, distancia estimada, ventana y requisitos; **nunca la dirección exacta antes de la asignación**.
- Aceptación **atómica** (condición de estado/versionado en DB): imposible que haya dos ganadores.
- Rechazar antes de aceptar no penaliza; cancelar después se registra y revisa en contexto.
- Si nadie acepta: subir la oferta, asignar repartidor propio o reprogramar/cancelar.
- Propina separada; sin pago automático al repartidor en MVP.
- Prueba de entrega proporcional al riesgo: confirmación del destinatario o PIN opcional; ubicación/foto solo con consentimiento y retención limitada.
- Métricas: viajes, % completados, tiempos de traslado y espera, cancelaciones post-aceptación, valoraciones verificadas.
- Identidad, vehículo, seguros y clasificación contractual bajo revisión legal.

### 9.3 App Android repartidor
**Módulos:** registro y verificación, disponibilidad, zonas, tarifa mínima, bandeja de ofertas, aceptar/rechazar, navegación externa opcional, estados de retiro/entrega, chat, incidencias, historial, métricas y saldos comercio-repartidor.

**Condiciones hostiles:**
- Viaje asignado, instrucciones y datos permitidos guardados localmente; reconexión con sync incremental, `event_id`/`idempotency_key`, colas persistentes y deduplicación en servidor. Datos sensibles cifrados y caché con expiración.
- No aceptar ofertas, confirmar entregas ni cobrar offline como si estuviera confirmado. Una oferta vencida durante la desconexión aparece expirada al volver.
- Push FCM + realtime con la app abierta + recuperación al abrir + consulta periódica. **El push no garantiza entrega inmediata.**
- Estados, timestamps y asignación definitivos siempre en backend.
- **Pruebas obligatorias:** ahorro de batería, app terminada, pantalla bloqueada, cambio Wi-Fi/datos, señal 2G/3G/4G degradada, doble toque, dos repartidores aceptando, reloj del teléfono incorrecto, GPS deshabilitado, reinicio, permisos revocados.

## 10. Operación del comercio

- Panel web responsive con tablero de pedidos de alta visibilidad y contador de aceptación.
- **Avisos redundantes:** realtime + sonido (con consentimiento) + push cuando esté soportado + polling de respaldo + outbox durable + alarma de pedidos sin reconocer. Distinguir `notification_sent`, `notification_seen` y `order_acknowledged`.
- Validar navegadores Android, permisos y segundo plano. **Si el piloto muestra avisos insuficientes, construir una app Android de alertas antes de la apertura masiva.**
- **Comanda** 58/80 mm imprimible manual en MVP; automática (agente local) después. Estados `PRINT_PENDING/PRINTED/PRINT_FAILED` y reimpresión controlada; imprimir no cambia pago ni aceptación. No enviar ESC/POS desde el servidor.
- **Contingencia ante caída total de internet:** no aceptar pedidos no recibidos, comunicar indisponibilidad y reconciliar al volver.

## 11. Comunicación, reclamos y reputación

### 11.1 Chat por pedido
- Canales privados `CUSTOMER_MERCHANT`, `CUSTOMER_COURIER`, `MERCHANT_COURIER`; sin chat grupal por defecto.
- Habilitado en etapas pertinentes con ventana posterior limitada; lectura/entrega, push y sync tras reconexión.
- `client_message_id` para idempotencia, timestamps de servidor, permisos por pertenencia, moderación y contactos enmascarados donde corresponda.
- Plantillas rápidas: «Estoy afuera», «No funciona el timbre», «Falta un ingrediente», «¿Aceptás sustitución?».
- **Sustituciones fuera del chat:** `ORDER_ADJUSTMENT_PROPOSED → CUSTOMER_APPROVED/REJECTED → PAYMENT_ADJUSTED`. Sin respuesta → política de no sustitución.

### 11.2 Reclamos (soporte de primer nivel)
Pedilo da soporte operativo, no arbitraje jurídico. El comercio responde por productos, el repartidor por la entrega que controla y Pedilo por sus propias fallas, **sin que esto elimine obligaciones legales solidarias o de consumo**.

- Reclamo vinculado al pedido con motivo (faltante, incorrecto, calidad, demora, no entrega, cobro incorrecto), fotos opcionales, plazo visible y evidencias.
- Primero propone solución el comercio; Pedilo facilita, supervisa SLA y escala.
- **Estados:** `OPEN`, `MERCHANT_REVIEW`, `AGREED_REFUND`, `PAYMENT_REFUND_PENDING`, `RESOLVED`, `DISPUTED`, `ESCALATED`, `CLOSED`.
- Resoluciones: reembolso total, parcial, reenvío, reemplazo o rechazo motivado; sin decisiones automáticas irreversibles.
- Lesiones, intoxicaciones, fraude, contracargos, denuncias o requerimientos regulatorios: suspender automatismos y derivar a profesional/autoridad.
- **Antes del piloto pago:** revisión jurídica puntual de términos, privacidad, rol del marketplace y circuito de reclamos.
- Canales de atención accesibles; ninguna cláusula limita derechos del consumidor.

### 11.3 Reputación
- Valoración de comercios por compradores verificados; de repartidores por compradores y comercios; de la experiencia de retiro por repartidores. Solo sobre pedidos reales.
- **Sin calificaciones públicas de compradores.** Historial privado de incidentes verificables (ausente, dirección errónea, sin respuesta, espera excesiva, impago) con revisión, apelación y caducidad.
- Restricciones progresivas solo tras revisión; preferir exigir prepago antes que bloquear.
- No imputar al repartidor la demora de cocina ni al comercio la espera por el destinatario.

## 12. Catálogo, descubrimiento y promociones

### 12.1 Catálogo
- Catálogo global `canonical_products` (GTIN cuando aplique, marca, contenido neto, presentación, fotos con derechos de uso) + oferta propia del comercio con precio, stock y estado.
- Productos artesanales sin fusión por similitud.
- Alta por búsqueda, escaneo EAN, selección masiva y duplicación de menú; edición rápida en PC y celular.
- Productos pausados no se pueden confirmar aunque estén en un carrito viejo.
- Horarios por producto, cupos diarios, cierres; supermercados con franjas de entrega y reglas de faltantes.

### 12.2 Emprendedores y rubros regulados
- Perfiles de emprendimientos con estado de incorporación; en categorías reguladas **no se habilita checkout** hasta verificar requisitos sanitarios y comerciales.
- Distintivo «Documentación verificada» con alcance, fecha y vencimiento, sin prometer legalidad universal.
- Perfumería/higiene sujetas a controles aplicables.

### 12.3 Descubrimiento
- Una sola barra de búsqueda que interpreta intención: comercio → comercios; producto estandarizado → ficha agrupada con ofertas por sucursal; plato artesanal → platos y restaurantes sin fusión.
- Agrupación solo con identidad confiable (GTIN + marca, variante, tamaño, unidad, presentación). Ante duda, resultados separados.
- Ranking orgánico: primero filtrar por ciudad, cobertura, estado, disponibilidad; luego ordenar por relevancia, costo total estimado, cercanía, calidad y tiempo **solo con datos confiables**. Pesos configurables y auditables.
- Exploración controlada para comercios nuevos; evitar monopolización visual.
- Con carrito activo, ofrecer «buscar dentro de este comercio».
- **P0:** búsqueda unificada básica y filtros (rubro, precio, retiro, entrega). **P1:** comparación de ofertas canónicas.

### 12.4 Promociones
- Motor de reglas: `PERCENT`, `FIXED`, `FREE_DELIVERY`, `BOGO`, `PRODUCT_BUNDLE`, con elegibilidad, fechas, mínimos, límites global/usuario, prioridad, acumulabilidad y financiación (`MERCHANT`, `PLATFORM`, `SHARED`).
- **P0:** cupones básicos (porcentaje/monto, fechas, cupo, mínimo, elegibilidad). **P1:** resto del motor, referidos.
- Redenciones transaccionales e idempotentes; sin doble canje bajo concurrencia; reversa en cancelaciones; antifraude de autocuentas.
- Fases de marketing: (1) bienvenida y ofertas de comercios; (2) recompra y referidos; (3) destacados rotativos etiquetados; (4) CPC tras tráfico suficiente.

### 12.5 Publicidad (P1, opcional)
Destacados por período con rotación equitativa, elegibilidad, etiqueta visible «Patrocinado» y métricas de impresiones/clics. Nunca reemplazan todos los orgánicos ni muestran productos fuera de cobertura; no afectan el puntaje orgánico.

### 12.6 Analítica
Eventos con consentimiento: `store_viewed`, `product_viewed`, `add_to_cart`, `checkout_started`, `payment_confirmed`, `order_delivered`, `coupon_redeemed`, `repeat_purchase`. Métricas reconciliadas con órdenes y en zona horaria de la sucursal.

## 13. Roadmap: hitos y puertas de salida

> **Avance y próximos pasos:** ver [ROADMAP.md](ROADMAP.md).

| Fase | Contenido | Puerta |
|---|---|---|
| **0 — Viabilidad** (bloqueante) | Prueba real de Checkout API/split, reembolsos y saldo insuficiente; revisión legal/fiscal puntual; política de reparto y seguros; entrevistas a comercios y repartidores; simulación de pricing por rubro; ADRs técnicos pendientes | **G0** contrato y prueba técnica MP |
| **1 — Plataforma y catálogo** | E1 + E2: monorepo, API, auth, RBAC, OpenAPI, migraciones, auditoría, CI; onboarding de comercios, sucursales, horarios, zonas, catálogo | — |
| **2 — Primer pedido real** | E3 + E4 + E5 + E7: Android cliente y web pública, pedidos, pagos y ledger, avisos al comercio. Reparto propio o asignación controlada | **G1** primer pedido pago y devolución · **G3** comercio recibe y reconoce pedidos en PC y Android |
| **3 — Reparto** | E6: Android repartidor, ofertas híbridas, asignación atómica | **G2** dos repartidores disputando una oferta, desconexión y recuperación |
| **4 — Piloto Tostado** | E8 + E9 + E10 + E11: chat y reclamos, pricing por tramos y simulador, cupones, operación | **G4** 5–10 comercios piloto con métricas de incidentes, tiempos y margen |
| **5 — Lanzamiento público** | Pruebas transversales (§16) superadas | **G5** |
| **Crecimiento** | P1: catálogo precargado amplio, referidos, campañas compartidas, recompra, impresión automática | — |
| **Escala regional** | Nuevas ciudades, reputación avanzada, publicidad, integración Comerz, migración de infraestructura según métricas | — |

**Go/no-go:** no abrir al público hasta probar pagos, reembolsos, reintentos, asignación, caídas de red, soporte de reclamos, cumplimiento y operación con usuarios reales.

### 13.1 Épicas e historias

| Épica | Historia | Criterio mínimo de aceptación |
|---|---|---|
| E0 Viabilidad | Como fundador valido split, devoluciones, habilitaciones y márgenes | Pruebas reales de liquidación y reembolso total/parcial, saldo insuficiente, revisión legal/fiscal documentada |
| E1 Plataforma | Como operador gestiono identidades y comercios | Entornos dev/staging/prod; roles aislados (un operador de A no lee ni muta B, con pruebas negativas); OpenAPI; migraciones reproducibles en CI; auditoría; logs trazables |
| E2 Catálogo | Como comercio publico productos y precios | Canónicos sin duplicados falsos, ofertas independientes, variantes/modificadores validados en servidor, restricciones regulatorias |
| E3 Android cliente | Como comprador compro con red inestable | Build Play Store, caché y carrito local, búsqueda unificada; sin éxito falso sin confirmación del servidor |
| E4 Pedidos | Como comercio acepto pedidos | Transiciones válidas, programación, vencimientos idempotentes, motivo de rechazo, sin duplicados por clave idempotente |
| E5 Pagos | Como comercio cobro y concilio | Split real, efectivo, comisiones, liquidaciones y reembolsos trazables |
| E6 Android courier | Como repartidor acepto y entrego | Asignación atómica, tarifa mínima, reconexión, incidencias y saldo |
| E7 Alertas comercio | Como comercio no pierdo pedidos | Realtime + fallback + alarma, pruebas Android en segundo plano, impresión manual |
| E8 Chat y reclamos | Como comprador coordino y reclamo | Chat por roles, ajustes aprobados, reclamo y reembolso auditados |
| E9 Pricing | Como comercio comparo planes y topes | Tramos marginales exactos, topes por rubro, pricing versionado, simulador |
| E10 Promociones | Como comercio creo una oferta | Presupuesto, elegibilidad, límites atómicos, reversa en cancelación |
| E11 Operación | Como administrador controlo el servicio | Alertas, backups restaurados, conciliación, soporte, pruebas de cortes de red |

**Definition of Done por historia:** criterios de aceptación probados; autorización tenant revisada; validación de entradas; estados de error/carga; logging; migración reversible o plan de rollback; OpenAPI actualizado; tests proporcionales al riesgo; revisión de accesibilidad móvil.

## 14. Arquitectura

### 14.1 Topología (monorepo)

```text
pedilo/
  apps/
    customer-mobile/   # React Native + Expo (Android), Expo Router, TanStack Query
    courier-mobile/    # React Native + Expo (Android)
    merchant-web/      # Next.js 16, responsive PC/móvil
    admin-web/         # Next.js 16, acceso restringido
  services/
    api/               # Node.js + TypeScript, REST/OpenAPI 3.1 + realtime autenticado
  packages/            # código compartido (tipos, cliente API, UI, config)
  docs/
    SPEC.md
    adr/
    api/
    archive/
```

- **API:** monolito modular desplegable independiente del frontend; NestJS **o** Fastify (ADR, no ambos). Módulos: `identity`, `geography`, `merchants`, `catalog`, `discovery/search`, `checkout`, `orders`, `fulfillment` (retiro/entrega desde el lado del pedido), `deliveries` (servicio logístico, sin dependencia de `orders`, §9.0), `couriers`, `payments`, `billing`, `promotions`, `messaging`, `claims`, `reputation`, `notifications`, `analytics`, `advertising` (P1). Capas `domain`/`application`/`infrastructure` en módulos complejos; sin imports directos entre persistencias de dominios.
- **PostgreSQL** gestionado (Supabase inicialmente o equivalente) con transacciones, índices y constraints; migraciones versionadas. Migrar a AWS RDS sin rediseño si las métricas lo justifican.
- **Workers durables** para webhooks, expiraciones, ofertas, notificaciones, conciliación y reintentos. Nada crítico solo en memoria.
- **Storage** de imágenes optimizadas, CDN y URLs firmadas cuando corresponda.
- **Webs:** Tailwind CSS v4 + shadcn/ui; React Hook Form + Zod; TanStack Query (sin duplicar estado de servidor).
- **Móvil:** almacenamiento seguro para sesión; SQLite/almacenamiento local solo para datos no sensibles seleccionados.
- **Observabilidad:** Sentry, logs estructurados con correlation IDs, métricas, trazas y alarmas de negocio.
- **Tests:** Vitest, integración contra PostgreSQL, Playwright (web), pruebas en dispositivo Android.
- **Integraciones futuras:** `/api/v1` versionada y webhooks de dominio firmados (HMAC) con outbox; sin integración Comerz en MVP.

Para ~30 comercios y menos de 10 pedidos diarios cada uno no hay argumento de escala para Java o AWS completo; Java/Spring Boot sería válido solo por aprendizaje.

### 14.2 Conectividad
- Catálogo, carrito, borradores, instrucciones e historial reciente consultables offline con marca de antigüedad.
- Acciones críticas encoladas con idempotency key en estado `PENDING_SYNC`, **nunca presentadas como confirmadas** sin ACK del backend.
- Nunca cobrar, asignar repartidor ni entregar basándose solo en estado local.
- Push es aviso auxiliar: el estado real se obtiene por API y sync al reabrir.

### 14.3 Metas iniciales (a validar)
p95 de lectura < 500 ms; p95 de transición de estado < 1 s (sin push); 99,9% de eventos críticos procesados con reintentos durables (objetivo); 0 cobros duplicados en pruebas de idempotencia.

## 15. Modelo de datos lógico

Nombres ilustrativos; se detallan en migraciones.

**Identidad y geografía:** `users`, `cities`, `push_devices`, `audit_logs`.

**Comercios:** `merchants(id, legal_name, display_name, slug, category_id, status, owner_id)`, `merchant_members(role, permissions)`, `branches(merchant_id, city_id, address, lat, lng, timezone, status)`, `business_hours`, `special_hours`, `delivery_zones(branch_id, geometry_or_rule, fee_minor, min_order_minor)`, `merchant_documents`, `verification_reviews`, `regulated_categories`, `merchant_category_permissions`, `scheduled_order_slots`, `branch_capacity_rules`, `printer_devices`, `print_jobs`.

**Catálogo:** `categories(parent_id, name, kind)`, `products`, `product_variants`, `modifier_groups(min_select, max_select, required)`, `modifiers`, `canonical_products(gtin_nullable, brand, normalized_name, variant, net_content, unit, package_type, verification_status)`, `product_canonical_links(match_source, confidence, reviewed_at)`, `product_offers` (ver decisión abierta §17).

**Pedidos:** `orders(branch_id, customer_id_nullable, customer_snapshot, delivery_address_snapshot, fulfillment_type, order_status, payment_status, currency, desglose §8.5, pricing_version_id, commission_rate_snapshot, created_at, completed_at)`, `order_items` y `order_item_options` con snapshots, `order_events(from_status, to_status, actor_id, reason)`, `order_adjustments`, `sync_commands(command_id único, expiración, resultado)`.

**Reparto** (independiente de pedidos, §9.0): `deliveries(id, merchant_id, branch_id, order_id_nullable, source [ORDER | MERCHANT_REQUEST], pickup_address_snapshot, dropoff_address_snapshot, recipient_contact_snapshot, package_description, courier_fee_minor, tip_minor, cash_to_collect_minor, delivery_status, requested_at, window_start, window_end)`, `courier_profiles`, `courier_preferences`, `delivery_quotes`, `delivery_offers`, `delivery_assignments`, `delivery_events`, `delivery_proofs`, `courier_merchant_ledger`. Las tablas de reparto referencian `deliveries`, nunca `orders` directamente; `orders` no guarda estado de reparto propio más allá del que traduce desde los eventos del delivery.

**Pagos y facturación:** `payments(provider, provider_payment_id, status, amount_minor, fee_minor, confirmed_at)`, `payment_attempts`, `payment_allocations`, `refunds`, `provider_connections`, `cash_collections`, `plans`, `plan_versions(monthly_fee_minor, commission_bps, effective_from)`, `pricing_versions` (tramos y topes), `subscriptions`, `commission_ledger(kind, amount_minor, source_id)`, `settlements`, `settlement_allocations`, `merchant_statements`, `late_fee_rules`, `debt_notices`, `account_restrictions`.

**Comunicación y reclamos:** `order_conversations`, `conversation_participants`, `messages`, `message_receipts`, `claims`, `claim_evidence`, `claim_resolutions`, `customer_incidents`, `incident_appeals`, `notification_outbox`.

**Promociones y analítica:** `promotions`, `promotion_redemptions`, `promotion_budgets`, `promotion_funders`, `referral_codes`, `referral_attributions`, `analytics_events`, `search_events` (pseudónimos, retención limitada), `sponsored_campaigns`, `sponsored_impressions`, `sponsored_clicks` (solo si se activa).

**Infraestructura:** `webhook_inbox(provider, event_id, payload_hash, status)`, `outbox_events`.

**Reglas:** dinero en enteros de unidad menor; UUID/ULID; FK e índices por `branch_id`, `merchant_id`, `city_id`, `(merchant_id, created_at)`, `(order_id, created_at)`; unicidad de eventos externos; snapshots históricos; constraint que impide dos repartidores activos en un mismo reparto; PII mínima con política de retención.

## 16. Requisitos no funcionales y pruebas transversales

- **Seguridad:** RBAC en servidor, aislamiento por tenant, validación de inputs, rate limiting, protección contra enumeración de pedidos, CSRF donde aplique, secretos solo en servidor y cifrados, webhooks verificados, idempotencia en pedidos y cobros, auditoría.
- **Pagos:** nunca confiar en montos del frontend; conciliación por ID de proveedor; webhooks duplicados/desordenados; reembolsos parciales/totales y contracargos.
- **Concurrencia:** stock y cupones con transacciones/constraints; expiración de cotizaciones y órdenes pendientes.
- **Privacidad:** teléfonos y direcciones protegidos; consentimiento para compartir datos con repartidores; borrado/retención según normativa argentina.
- **Observabilidad:** alertas de pagos fallidos, pedidos sin aceptar, discrepancias de comisiones y fallas de jobs.
- **Accesibilidad y rendimiento:** móvil primero, WCAG 2.2 AA como objetivo, imágenes optimizadas, Core Web Vitals en webs.
- **Operación:** entornos dev/staging/prod, backups con restauración probada, plan de incidentes y soporte.

**Pruebas de aceptación transversales obligatorias:**
1. Dos repartidores aceptan a la vez: solo uno obtiene la asignación.
2. El cliente pulsa pagar dos veces y el webhook llega repetido/desordenado: una sola operación económica y pedido consistente.
3. Se corta internet durante aceptación o cobro: la UI muestra «pendiente de confirmación», reconcilia al volver y no inventa éxito.
4. El comercio acepta un pedido con producto agotado: el backend bloquea o exige sustitución aprobada.
5. Pedido en efectivo cobrado por el repartidor: los ledgers de comercio y repartidor cuadran, sin sumar propina indebidamente.
6. Se cancela un pedido con promoción: se revierte uso/subsidio.
7. Se pierde un push: el comercio ve el pedido por polling/sync y salta la alerta operativa.
8. Reclamo por faltante: se crea caso, se pide evidencia proporcional y se ejecuta resolución auditable.
9. Comercio sin habilitación: puede incorporarse pero no publicar checkout regulado.
10. Pedido programado: no supera cupos, ventana ni horario de corte.
11. Impresora desconectada: el pedido sigue visible sin cambiar estado; reimpresión manual controlada.
12. Usuario sin rol intenta leer chats, direcciones o cobros ajenos: denegación y auditoría.

## 17. Decisiones abiertas

**Bloqueantes de lanzamiento**
- Tarifas y plazos reales de Mercado Pago por medio/provincia, elegibilidad de split, autoridad de reembolso y saldo insuficiente.
- Impuestos, facturación de comisiones y documentación legal/sanitaria/seguros.
- Condiciones legales de repartidores independientes (verificación, responsabilidad, consentimiento).
- Cómo se cobra al comprador el envío y la propina cuando el comercio es el receptor del pago, y la compensación con el repartidor.
- Prueba de notificaciones Android del comercio en campo.

**Técnicas (antes del primer sprint, vía ADR)**
- ~~NestJS vs Fastify~~ → Fastify ([ADR 0002](adr/0002-api-fastify.md)). ORM: Drizzle ([ADR 0003](adr/0003-postgres-drizzle.md)).
- ~~Proveedor de auth~~ → Supabase Auth con roles en nuestra base ([ADR 0004](adr/0004-auth-supabase.md)). Sigue abierto: verificación de teléfono/email y checkout como invitado.
- Stack de realtime, push y workers durables.
- Hosting de `services/api`.
- ~~Catálogo: fuente única de precio~~ → `products` a nivel comercio es la oferta y la única fuente de precio; overrides por sucursal y productos canónicos después ([ADR 0006](adr/0006-catalogo-por-comercio.md)).
- Zonas por polígonos vs radios/barrios; fuente de rutas para la tarifa sugerida.
- Compatibilidad inicial de impresoras.

**De producto (configurables)**
- Política de aceptación antes/después del pago, timeout y reembolso por rechazo.
- Duración de ofertas de reparto, reglas de espera y cancelación, precios sugeridos por zona.
- Momento en que el pedido solicita el delivery (al aceptar, durante la preparación o al estar listo) y compensación al repartidor si el pedido se cancela con el viaje en curso.
- Cuándo habilitar deliveries sin pedido del marketplace (§9.0): comisión o tarifa aplicable, reclamos y responsabilidades.
- SLA de atención, ventana de reclamo, vencimiento de deuda, recargos, descuentos acumulables y financiación.
- Tipología de comprobantes; retención de PII y política de disputas.
- Categorías iniciales y variantes comunes de rubros no gastronómicos; reglas de equivalencia canónica y productos sin código.
- Si los destacados patrocinados se habilitan en el piloto, con qué precio, rotación y límites.

**Comerciales**
- Precios finales de planes, mensualidades y topes mediante simulaciones por rubro y entrevistas.
- Validación de marca **Pedilo**, dominio, redes y riesgo marcario.

## 18. Métricas de validación

- Comercios aprobados, activos semanales y retención por ciudad.
- Embudo: busca → ve resultados → abre comercio/producto → agrega al carrito → crea pedido → pedido completado.
- Tiempo medio de aceptación, tasa de rechazo/cancelación, pedidos por comercio.
- Ticket promedio, GMV, ingresos por comisión, costo PSP, deuda pendiente y recuperada.
- Mix de efectivo, transferencia y pago digital.
- Reclamos por entrega, tiempos y tasa de recompra.
- Búsquedas sin resultados, clic orgánico, productos canónicos vinculados con confianza, conversión por consulta.
- Reparto: tiempo de aceptación de ofertas, ofertas sin tomar, cancelaciones post-aceptación.
- Si hay destacados: impresiones, clics válidos y concentración de exposición, separados de lo orgánico.

## 19. Fuentes oficiales a validar antes de implementar

- Split 1:1 / Checkout API: https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Reembolsos Checkout API Orders: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/refunds-cancellations
- Reembolso de Orders API: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/refund-order/post
- Reembolso de Payments API: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-refund/post
