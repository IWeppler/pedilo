import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import {
  canTransitionOrder,
  customerCanCancel,
  FulfillmentType,
  isOrderFinal,
  ACTIVE_COURIER_STATUSES,
  DeliveryStatus,
  distanceMeters,
  isSchedulableSlot,
  MAX_DROPOFF_DISTANCE_M,
  orderStatusForDeliveryStatus,
  type OpeningRange,
  parseTime,
  paymentStateMachine,
  scheduleSlots,
  merchantOrderActions,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  type PricedProduct,
  priceSelection,
} from "@pedilo/domain";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, max, notInArray, sql } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import type { OrderLimits } from "../../config";
import { AppError, badRequest, conflict, isUniqueViolation, notFound, tooManyRequests } from "../../lib/errors";
import { getProductsForOrder } from "../menu/service";
import { enqueueOrderPlaced, saveCustomerPushToken } from "../notifications/service";
import { type Actor, recordAudit } from "../audit/service";
import { accrueOrderCommission, quoteOrderCommission } from "../billing/service";
import {
  cancelDeliveriesForOrder,
  DEFAULT_OFFER_MINUTES,
  type DeliveryDto,
  type DeliveryStatusEvent,
  getCustomerDeliveryInfo,
  getDeliveriesForOrders,
  lastDeliveryChange,
  requestDelivery,
} from "../deliveries/service";
import {
  findApprovedMerchantBySlug,
  getBranchSummary,
  getMerchantAccess,
  getTransferDetails,
  type PublicBranchDto,
} from "../merchants/service";
import { redeemPromotion, resolveOrderPromotion, reverseOrderPromotion } from "../promotions/service";
import {
  type OrderActorType,
  orderEvents,
  type OrderEventRow,
  orderItemOptions,
  type OrderItemOptionRow,
  orderItems,
  type OrderItemRow,
  type OrderRow,
  orders,
  type TransferDetails,
} from "./schema";

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface OrderDto {
  id: string;
  code: string;
  merchant: { id: string; slug: string; name: string };
  branch: { id: string; name: string; address: string };
  status: OrderStatus;
  statusReason: string | null;
  fulfillmentType: FulfillmentType;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  customer: { name: string; phone: string };
  delivery: {
    zoneName: string;
    addressLine: string;
    addressNotes: string | null;
    /** Punto que marcó el cliente en el mapa, si lo marcó (ADR 0023). */
    location: { lat: number; lng: number } | null;
  } | null;
  notes: string | null;
  items: Array<{
    id: string;
    productName: string;
    variantName: string | null;
    unitPriceMinor: number;
    quantity: number;
    totalMinor: number;
    notes: string | null;
    options: Array<{ groupName: string; name: string; quantity: number; priceDeltaMinor: number }>;
  }>;
  subtotalMinor: number;
  /** Descuento de una promo del comercio (ADR 0030). */
  discountMinor: number;
  /** Promo aplicada: título, «20% off» y el código si fue un cupón. */
  promotion: { title: string; label: string; code: string | null } | null;
  deliveryFeeMinor: number;
  totalMinor: number;
  events: Array<{ fromStatus: OrderStatus | null; toStatus: OrderStatus; actorType: OrderActorType; reason: string | null; createdAt: string }>;
  /** Hasta cuándo el comercio puede aceptarlo (null en pedidos viejos). */
  acceptDeadlineAt: string | null;
  /** Cuándo el comercio lo vio por primera vez (null = la alarma sigue sonando). */
  acknowledgedAt: string | null;
  /** Pedido programado: inicio de la franja (null = lo antes posible). */
  scheduledFor: string | null;
  /** Datos para transferir (solo con pago por transferencia). */
  transfer: TransferDetails | null;
  /** Cuándo el comercio confirmó que cobró o que le llegó la transferencia. */
  paymentConfirmedAt: string | null;
  /** Comisión Pedilo congelada al crear (ADR 0012). Solo la ven el comercio y el admin. */
  commission: {
    amountMinor: number;
    basisMinor: number;
    plan: string;
    pricingVersionId: string;
    capMinor: number;
    capApplied: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
}

function toOrderDto(
  o: OrderRow,
  items: OrderItemRow[],
  options: OrderItemOptionRow[],
  events: OrderEventRow[],
): OrderDto {
  return {
    id: o.id,
    code: o.code,
    merchant: { id: o.merchantId, slug: o.merchantSlug, name: o.merchantName },
    branch: { id: o.branchId, name: o.branchName, address: o.branchAddress },
    status: o.status,
    statusReason: o.statusReason,
    fulfillmentType: o.fulfillmentType,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customer: { name: o.customerName, phone: o.customerPhone },
    delivery:
      o.fulfillmentType === FulfillmentType.DELIVERY && o.deliveryAddressLine && o.deliveryZoneName
        ? {
            zoneName: o.deliveryZoneName,
            addressLine: o.deliveryAddressLine,
            addressNotes: o.deliveryAddressNotes,
            location: o.deliveryLat !== null && o.deliveryLng !== null ? { lat: o.deliveryLat, lng: o.deliveryLng } : null,
          }
        : null,
    notes: o.notes,
    items: items
      .filter((i) => i.orderId === o.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        id: i.id,
        productName: i.productName,
        variantName: i.variantName,
        unitPriceMinor: i.unitPriceMinor,
        quantity: i.quantity,
        totalMinor: i.totalMinor,
        notes: i.notes,
        options: options
          .filter((op) => op.orderItemId === i.id)
          .map((op) => ({ groupName: op.groupName, name: op.name, quantity: op.quantity, priceDeltaMinor: op.priceDeltaMinor })),
      })),
    subtotalMinor: o.subtotalMinor,
    discountMinor: o.discountMinor,
    promotion: o.promotionLabel ? { title: o.promotionTitle ?? o.promotionLabel, label: o.promotionLabel, code: o.couponCode } : null,
    deliveryFeeMinor: o.deliveryFeeMinor,
    totalMinor: o.totalMinor,
    events: events
      .filter((e) => e.orderId === o.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
    acceptDeadlineAt: o.acceptDeadlineAt?.toISOString() ?? null,
    acknowledgedAt: o.acknowledgedAt?.toISOString() ?? null,
    scheduledFor: o.scheduledFor?.toISOString() ?? null,
    transfer: o.paymentMethod === PaymentMethod.TRANSFER ? o.transferDetails : null,
    paymentConfirmedAt: o.paymentConfirmedAt?.toISOString() ?? null,
    commission:
      o.commissionMinor !== null && o.commissionBasisMinor !== null && o.commissionPlan && o.pricingVersionId
        ? {
            amountMinor: o.commissionMinor,
            basisMinor: o.commissionBasisMinor,
            plan: o.commissionPlan,
            pricingVersionId: o.pricingVersionId,
            capMinor: o.commissionDetail?.capMinor ?? 0,
            capApplied: o.commissionDetail?.capApplied ?? false,
          }
        : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

async function loadOrders(db: DbOrTx, rows: OrderRow[]): Promise<OrderDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    db.select().from(orderEvents).where(inArray(orderEvents.orderId, ids)),
  ]);
  const options = items.length
    ? await db.select().from(orderItemOptions).where(inArray(orderItemOptions.orderItemId, items.map((i) => i.id)))
    : [];
  return rows.map((r) => toOrderDto(r, items, options, events));
}

async function loadOrder(db: DbOrTx, id: string): Promise<OrderDto> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) throw notFound("Pedido");
  const [dto] = await loadOrders(db, [row]);
  return dto!;
}

// ---------------------------------------------------------------------------
// Token de seguimiento (ADR 0007)
// ---------------------------------------------------------------------------

export function trackingToken(secret: string, orderId: string): string {
  return createHmac("sha256", secret).update(`order:${orderId}`).digest("base64url");
}

function assertTrackingToken(secret: string, orderId: string, token: string | undefined) {
  const expected = Buffer.from(trackingToken(secret, orderId));
  const given = Buffer.from(token ?? "");
  // Mismo 404 que un pedido inexistente: no se revela si el id existe.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound("Pedido");
}

/** Plazo por defecto para que el comercio acepte un pedido (configurable con ORDER_ACCEPT_TIMEOUT_MINUTES). */
export const DEFAULT_ACCEPT_TIMEOUT_MS = 15 * 60 * 1000;

/** Programados: el comercio tiene hasta 30 min antes de la franja para aceptar (ADR 0011). */
export const SCHEDULED_ACCEPT_MARGIN_MS = 30 * 60 * 1000;

/**
 * Plazo para aceptar. Inmediato: ahora + timeout. Programado: hasta 30 min antes de la franja,
 * pero nunca menos que el timeout normal ni después del inicio de la franja.
 */
function acceptDeadline(now: Date, timeoutMs: number, scheduledFor: Date | null): Date {
  const normal = now.getTime() + timeoutMs;
  if (!scheduledFor) return new Date(normal);
  const slot = scheduledFor.getTime();
  return new Date(Math.min(slot, Math.max(normal, slot - SCHEDULED_ACCEPT_MARGIN_MS)));
}

function branchRanges(b: Pick<PublicBranchDto, "hours">): OpeningRange[] {
  return b.hours.map((h) => ({ weekday: h.weekday, opensAt: parseTime(h.opensAt) ?? 0, closesAt: parseTime(h.closesAt) ?? 0 }));
}

/** Estados que no ocupan cupo en una franja. */
const RELEASES_SLOT: OrderStatus[] = [OrderStatus.REJECTED, OrderStatus.CANCELLED, OrderStatus.EXPIRED];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function orderCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `P-${s}`;
}

// ---------------------------------------------------------------------------
// Crear pedido
// ---------------------------------------------------------------------------

export interface CreateOrderInput {
  merchantSlug: string;
  branchId: string;
  fulfillmentType: FulfillmentType;
  deliveryZoneId?: string | undefined;
  deliveryAddress?:
    | { line: string; notes?: string | null | undefined; location?: { lat: number; lng: number } | null | undefined }
    | undefined;
  customer: { name: string; phone: string };
  notes?: string | null | undefined;
  /** Cupón del comercio (ADR 0030). Sin cupón, se aplica sola la mejor oferta vigente. */
  couponCode?: string | null | undefined;
  /** Efectivo por defecto. */
  paymentMethod?: "CASH" | "TRANSFER" | "MERCADO_PAGO" | undefined;
  /** Inicio de la franja (ISO). Sin esto, lo antes posible. */
  scheduledFor?: string | undefined;
  items: Array<{
    productId: string;
    variantId?: string | null | undefined;
    modifiers: Array<{ modifierId: string; quantity: number }>;
    quantity: number;
    notes?: string | null | undefined;
  }>;
}

export interface CreateOrderResult {
  order: OrderDto;
  trackingToken: string;
  /** true si la misma Idempotency-Key ya había creado este pedido. */
  replayed: boolean;
}

/**
 * Crea el pedido recalculando todo en el servidor: el comercio tiene que estar aprobado, la
 * sucursal abierta (o la franja programada válida y con cupo), la forma de entrega y el medio de
 * pago disponibles, cada producto válido según `priceSelection` y, con envío, el subtotal tiene
 * que alcanzar el pedido mínimo de la zona.
 */
export async function createOrder(
  db: Db,
  input: CreateOrderInput,
  idempotencyKey: string,
  opts: {
    secret: string;
    now?: Date;
    customerUserId?: string | null;
    acceptTimeoutMs?: number;
    limits?: Pick<OrderLimits, "maxActivePerPhone" | "maxDailyPerPhone">;
  },
): Promise<CreateOrderResult> {
  const existing = await findByIdempotencyKey(db, idempotencyKey, opts.customerUserId ?? null);
  if (existing) return { order: existing, trackingToken: trackingToken(opts.secret, existing.id), replayed: true };

  const merchant = await findApprovedMerchantBySlug(db, input.merchantSlug, opts.now ?? new Date());
  if (!merchant) throw notFound("Comercio");
  if (opts.limits) await assertPhoneLimits(db, merchant.id, input.customer.phone, opts.limits, opts.now ?? new Date());
  const now = opts.now ?? new Date();
  const branch = merchant.branches.find((b) => b.id === input.branchId);
  if (!branch) throw badRequest("Sucursal inválida", { field: "branchId" });

  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    scheduledFor = new Date(input.scheduledFor);
    if (!branch.scheduling.enabled) {
      throw conflict("Este comercio no acepta pedidos programados", { reason: "SCHEDULING_DISABLED" });
    }
    if (
      Number.isNaN(scheduledFor.getTime()) ||
      !isSchedulableSlot(branchRanges(branch), branch.timezone, now, { ...branch.scheduling, closures: branch.closures }, scheduledFor)
    ) {
      throw conflict("Ese horario ya no está disponible. Elegí otro.", { reason: "SLOT_UNAVAILABLE" });
    }
  } else if (!branch.openNow) {
    throw conflict("El comercio está cerrado en este momento", {
      reason: "BRANCH_CLOSED",
      schedulingAvailable: branch.scheduling.enabled,
    });
  }

  const paymentMethod = input.paymentMethod ?? PaymentMethod.CASH;
  let transferDetails: TransferDetails | null = null;
  if (paymentMethod === PaymentMethod.MERCADO_PAGO && !merchant.payment.card) {
    throw conflict("Este comercio no acepta tarjeta", { reason: "PAYMENT_METHOD_NOT_AVAILABLE" });
  }
  const digital = paymentMethod === PaymentMethod.MERCADO_PAGO;
  if (paymentMethod === PaymentMethod.CASH && !merchant.payment.cash) {
    throw conflict("Este comercio no acepta efectivo", { reason: "PAYMENT_METHOD_NOT_AVAILABLE" });
  }
  if (paymentMethod === PaymentMethod.TRANSFER) {
    transferDetails = await getTransferDetails(db, merchant.id);
    if (!transferDetails) throw conflict("Este comercio no acepta transferencias", { reason: "PAYMENT_METHOD_NOT_AVAILABLE" });
  }

  let zone: (typeof branch.zones)[number] | undefined;
  if (input.fulfillmentType === FulfillmentType.PICKUP) {
    if (!branch.acceptsPickup) throw conflict("Esta sucursal no acepta retiro en el local", { reason: "PICKUP_NOT_AVAILABLE" });
  } else {
    if (!branch.acceptsDelivery) throw conflict("Esta sucursal no hace envíos", { reason: "DELIVERY_NOT_AVAILABLE" });
    zone = branch.zones.find((z) => z.id === input.deliveryZoneId);
    if (!zone) throw badRequest("Elegí una zona de envío de la sucursal", { field: "deliveryZoneId" });
    if (!input.deliveryAddress?.line.trim()) throw badRequest("Falta la dirección de entrega", { field: "deliveryAddress" });
    const pin = input.deliveryAddress.location;
    if (pin && branch.lat !== null && branch.lng !== null && distanceMeters(pin, { lat: branch.lat, lng: branch.lng }) > MAX_DROPOFF_DISTANCE_M) {
      throw badRequest("El punto marcado en el mapa queda demasiado lejos del comercio", { field: "deliveryAddress.location" });
    }
  }

  const lines = await priceLines(db, merchant.id, input.items);

  const subtotalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
  const deliveryFeeMinor = zone?.feeMinor ?? 0;
  if (zone && subtotalMinor < zone.minOrderMinor) {
    throw conflict("No llegás al pedido mínimo de la zona", {
      reason: "MIN_ORDER_NOT_MET",
      minOrderMinor: zone.minOrderMinor,
      subtotalMinor,
    });
  }

  // Promo del comercio (ADR 0030): la mejor oferta o el cupón. Un cupón inválido corta acá.
  const { applied: promo } = await resolveOrderPromotion(db, {
    merchantId: merchant.id,
    customerUserId: opts.customerUserId ?? null,
    lines: lines.map((l) => ({ productId: l.productId, totalMinor: l.totalMinor })),
    couponCode: input.couponCode,
    now,
  });
  const discountMinor = promo?.discountMinor ?? 0;
  const totalMinor = subtotalMinor - discountMinor + deliveryFeeMinor;

  // Comisión con el plan y el pricing de este momento: queda congelada en el pedido. La paga el
  // comercio sobre lo que cobra: subtotal menos su descuento (SPEC §6.2, base comisionable).
  const commission = await quoteOrderCommission(db, merchant, subtotalMinor - discountMinor, now);

  try {
    const orderId = await db.transaction(async (tx) => {
      if (scheduledFor && branch.scheduling.slotCapacity !== null) {
        // Un lock por franja: dos pedidos simultáneos no pueden pasarse del cupo.
        const lockKey = `slot:${branch.id}:${scheduledFor.toISOString()}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
        const [taken] = await tx
          .select({ n: count() })
          .from(orders)
          .where(and(eq(orders.branchId, branch.id), eq(orders.scheduledFor, scheduledFor), notInArray(orders.status, RELEASES_SLOT)));
        if ((taken?.n ?? 0) >= branch.scheduling.slotCapacity) {
          throw conflict("Ese horario se llenó. Elegí otro.", { reason: "SLOT_FULL" });
        }
      }
      const [row] = await tx
        .insert(orders)
        .values({
          code: orderCode(),
          merchantId: merchant.id,
          branchId: branch.id,
          merchantName: merchant.displayName,
          merchantSlug: merchant.slug,
          branchName: branch.name,
          branchAddress: branch.addressLine,
          // Efectivo/transferencia: va directo al comercio. Tarjeta: espera la confirmación del pago
          // (SPEC §7.1 paso 6); el comercio no lo ve hasta que se aprueba.
          status: digital ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED,
          fulfillmentType: input.fulfillmentType,
          paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          transferDetails,
          scheduledFor,
          pricingVersionId: commission.pricingVersionId,
          commissionPlan: commission.plan,
          commissionCategory: commission.category,
          commissionBasisMinor: commission.basisMinor,
          commissionMinor: commission.result.commissionMinor,
          commissionDetail: commission.result,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerUserId: opts.customerUserId ?? null,
          deliveryZoneId: zone?.id ?? null,
          deliveryZoneName: zone?.name ?? null,
          deliveryAddressLine: zone ? input.deliveryAddress!.line.trim() : null,
          deliveryAddressNotes: zone ? input.deliveryAddress?.notes?.trim() || null : null,
          deliveryLat: zone ? (input.deliveryAddress?.location?.lat ?? null) : null,
          deliveryLng: zone ? (input.deliveryAddress?.location?.lng ?? null) : null,
          notes: input.notes?.trim() || null,
          subtotalMinor,
          discountMinor,
          promotionId: promo?.promotionId ?? null,
          promotionLabel: promo?.label ?? null,
          promotionTitle: promo?.title ?? null,
          couponCode: promo?.code ?? null,
          deliveryFeeMinor,
          totalMinor,
          idempotencyKey,
          // Con tarjeta el plazo para aceptar corre desde que se aprueba el pago.
          acceptDeadlineAt: digital ? null : acceptDeadline(now, opts.acceptTimeoutMs ?? DEFAULT_ACCEPT_TIMEOUT_MS, scheduledFor),
        })
        .returning({ id: orders.id, code: orders.code });
      const id = row!.id;
      // Uso de la promo: cupo atómico, en la misma transacción (si se agotó, no se crea el pedido).
      if (promo) await redeemPromotion(tx, promo, id, opts.customerUserId ?? null);

      for (const [i, line] of lines.entries()) {
        const { options, ...rest } = line;
        const [item] = await tx.insert(orderItems).values({ orderId: id, ...rest, sortOrder: i }).returning({ id: orderItems.id });
        if (options.length) await tx.insert(orderItemOptions).values(options.map((o) => ({ orderItemId: item!.id, ...o })));
      }
      await tx.insert(orderEvents).values({
        orderId: id,
        fromStatus: null,
        toStatus: digital ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED,
        actorType: "CUSTOMER",
        actorUserId: opts.customerUserId ?? null,
      });
      if (digital) return id;
      // Aviso push al comercio: misma transacción, se envía después (outbox, ADR 0009).
      await enqueueOrderPlaced(tx, {
        id,
        code: row!.code,
        merchantId: merchant.id,
        customerName: input.customer.name,
        fulfillmentType: input.fulfillmentType,
        totalMinor,
        scheduledFor,
        timezone: branch.timezone,
      });
      return id;
    });
    return { order: await loadOrder(db, orderId), trackingToken: trackingToken(opts.secret, orderId), replayed: false };
  } catch (err) {
    // Dos requests simultáneos con la misma clave: gana uno y el otro devuelve ese pedido.
    if (isUniqueViolation(err)) {
      const winner = await findByIdempotencyKey(db, idempotencyKey, opts.customerUserId ?? null);
      if (winner) return { order: winner, trackingToken: trackingToken(opts.secret, winner.id), replayed: true };
    }
    throw err;
  }
}

/**
 * Precio y validación de cada ítem con las reglas de dominio (lo comparten el pedido y la
 * cotización del checkout).
 */
async function priceLines(db: DbOrTx, merchantId: string, items: CreateOrderInput["items"]) {
  const products = await getProductsForOrder(db, merchantId, items.map((i) => i.productId));
  return items.map((item, index) => {
    const product = products.get(item.productId);
    if (!product) {
      throw conflict("Un producto ya no está disponible", { reason: "PRODUCT_UNAVAILABLE", itemIndex: index });
    }
    const result = priceSelection(product as PricedProduct, { variantId: item.variantId, modifiers: item.modifiers });
    if (!result.ok) {
      throw conflict(`«${product.name}»: la selección no es válida`, {
        reason: "ITEM_INVALID",
        itemIndex: index,
        errors: result.errors,
      });
    }
    const variant = product.variants.find((v) => v.id === result.variantId);
    const options = item.modifiers.map((pick) => {
      const group = product.modifierGroups.find((g) => g.modifiers.some((m) => m.id === pick.modifierId))!;
      const modifier = group.modifiers.find((m) => m.id === pick.modifierId)!;
      return { modifierId: modifier.id, groupName: group.name, name: modifier.name, quantity: pick.quantity, priceDeltaMinor: modifier.priceDeltaMinor };
    });
    return {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      unitPriceMinor: result.unitPriceMinor,
      quantity: item.quantity,
      totalMinor: result.unitPriceMinor * item.quantity,
      notes: item.notes?.trim() || null,
      options,
    };
  });
}

export interface OrderQuote {
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  promotion: { title: string; label: string; code: string | null } | null;
  /** Ingresó un cupón válido, pero la oferta vigente descuenta más: se aplica la oferta. */
  couponOutdone: boolean;
  /** El cupón no se puede usar (inválido, vencido, agotado, ya usado, mínimo…). */
  couponError: { reason: string; message: string } | null;
}

/**
 * Cotización del checkout (ADR 0030): subtotal, descuento, envío y total con las mismas reglas que
 * el pedido, sin crearlo. Un cupón que no sirve no corta la cotización: vuelve en `couponError`.
 */
export async function quoteOrder(db: Db, input: Omit<CreateOrderInput, "customer">, customerUserId: string, now = new Date()): Promise<OrderQuote> {
  const merchant = await findApprovedMerchantBySlug(db, input.merchantSlug, now);
  if (!merchant) throw notFound("Comercio");
  const branch = merchant.branches.find((b) => b.id === input.branchId);
  if (!branch) throw badRequest("Sucursal inválida", { field: "branchId" });
  const zone = input.fulfillmentType === FulfillmentType.DELIVERY ? branch.zones.find((z) => z.id === input.deliveryZoneId) : undefined;
  const lines = await priceLines(db, merchant.id, input.items);
  const subtotalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
  const deliveryFeeMinor = zone?.feeMinor ?? 0;
  const req = {
    merchantId: merchant.id,
    customerUserId,
    lines: lines.map((l) => ({ productId: l.productId, totalMinor: l.totalMinor })),
    now,
  };
  let couponError: OrderQuote["couponError"] = null;
  let resolved;
  try {
    resolved = await resolveOrderPromotion(db, { ...req, couponCode: input.couponCode });
  } catch (err) {
    const reason = err instanceof AppError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
    if (!reason?.startsWith("COUPON_")) throw err;
    couponError = { reason, message: (err as Error).message };
    resolved = await resolveOrderPromotion(db, req);
  }
  const promo = resolved.applied;
  const discountMinor = promo?.discountMinor ?? 0;
  return {
    subtotalMinor,
    discountMinor,
    deliveryFeeMinor,
    totalMinor: subtotalMinor - discountMinor + deliveryFeeMinor,
    promotion: promo ? { title: promo.title, label: promo.label, code: promo.code } : null,
    couponOutdone: resolved.couponOutdone,
    couponError,
  };
}

/** Solo los dígitos: "3491 555-123" y "3491555123" son el mismo teléfono. */
const phoneDigits = (phone: string) => phone.replace(/\D/g, "");

/**
 * Anti-abuso por teléfono (ADR 0010), contado en la base para que valga con varias instancias y
 * aunque cambie la IP: pedidos en curso en este comercio y pedidos de las últimas 24 h.
 */
async function assertPhoneLimits(
  db: Db,
  merchantId: string,
  phone: string,
  limits: Pick<OrderLimits, "maxActivePerPhone" | "maxDailyPerPhone">,
  now: Date,
) {
  const digits = phoneDigits(phone);
  const samePhone = sql`regexp_replace(${orders.customerPhone}, '[^0-9]', '', 'g') = ${digits}`;
  const finals = Object.values(OrderStatus).filter(isOrderFinal);

  if (limits.maxActivePerPhone > 0) {
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), notInArray(orders.status, finals), samePhone));
    if ((row?.n ?? 0) >= limits.maxActivePerPhone) {
      throw tooManyRequests("Ya tenés varios pedidos en curso en este comercio. Esperá a que avancen antes de hacer otro.", {
        reason: "TOO_MANY_ACTIVE_ORDERS",
        limit: limits.maxActivePerPhone,
      });
    }
  }
  if (limits.maxDailyPerPhone > 0) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(and(gte(orders.createdAt, since), samePhone));
    if ((row?.n ?? 0) >= limits.maxDailyPerPhone) {
      throw tooManyRequests("Llegaste al máximo de pedidos por día con este teléfono. Probá mañana o comunicate con el comercio.", {
        reason: "DAILY_LIMIT",
        limit: limits.maxDailyPerPhone,
      });
    }
  }
}

/**
 * Reintento con la misma clave: devuelve el pedido ya creado, solo a quien lo creó. Con la clave de
 * otro cliente no se revela nada (ni el pedido ni su token de seguimiento).
 */
async function findByIdempotencyKey(db: DbOrTx, key: string, customerUserId: string | null): Promise<OrderDto | null> {
  const [row] = await db.select().from(orders).where(eq(orders.idempotencyKey, key));
  if (!row) return null;
  if (row.customerUserId !== customerUserId) {
    throw conflict("Esa clave de idempotencia ya se usó. Generá una nueva.", { reason: "IDEMPOTENCY_KEY_REUSED" });
  }
  const [dto] = await loadOrders(db, [row]);
  return dto ?? null;
}

// ---------------------------------------------------------------------------
// Cliente (con token de seguimiento)
// ---------------------------------------------------------------------------

/** Lo que necesita un reclamo de su pedido (ADR 0019). */
export interface OrderClaimSummary {
  id: string;
  code: string;
  merchantId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotalMinor: number;
  totalMinor: number;
  /** Cuándo llegó a su estado final (null si sigue en curso). */
  finishedAt: Date | null;
  commission: {
    pricingVersionId: string;
    plan: string;
    category: string;
    basisMinor: number;
    amountMinor: number;
  } | null;
}

async function claimSummary(db: DbOrTx, row: OrderRow): Promise<OrderClaimSummary> {
  const [last] = isOrderFinal(row.status)
    ? await db
        .select({ at: orderEvents.createdAt })
        .from(orderEvents)
        .where(and(eq(orderEvents.orderId, row.id), eq(orderEvents.toStatus, row.status)))
        .orderBy(desc(orderEvents.createdAt))
        .limit(1)
    : [];
  return {
    id: row.id,
    code: row.code,
    merchantId: row.merchantId,
    status: row.status,
    paymentMethod: row.paymentMethod,
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    finishedAt: last?.at ?? null,
    commission:
      row.pricingVersionId && row.commissionPlan && row.commissionCategory && row.commissionBasisMinor !== null && row.commissionMinor !== null
        ? {
            pricingVersionId: row.pricingVersionId,
            plan: row.commissionPlan,
            category: row.commissionCategory,
            basisMinor: row.commissionBasisMinor,
            amountMinor: row.commissionMinor,
          }
        : null,
  };
}

/** Resumen para reclamos, verificando el token de seguimiento del cliente. */
export async function getOrderClaimSummaryForCustomer(db: DbOrTx, orderId: string, token: string | undefined, secret: string) {
  assertTrackingToken(secret, orderId, token);
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!row) throw notFound("Pedido");
  return claimSummary(db, row);
}

/** Pedidos completados (entregados o retirados) por comercio desde `since` (para métricas de reclamos). */
export async function countCompletedOrders(db: DbOrTx, since: Date, merchantId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ merchantId: orders.merchantId, n: count() })
    .from(orders)
    .where(
      and(
        inArray(orders.status, [OrderStatus.DELIVERED, OrderStatus.PICKED_UP]),
        gte(orders.createdAt, since),
        merchantId ? eq(orders.merchantId, merchantId) : undefined,
      ),
    )
    .groupBy(orders.merchantId);
  return new Map(rows.map((r) => [r.merchantId, r.n]));
}

/** Resumen para reclamos, del lado del comercio o del admin (sin token). */
export async function getOrderClaimSummary(db: DbOrTx, orderId: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!row) throw notFound("Pedido");
  return claimSummary(db, row);
}

/** El cliente registra su celular para recibir avisos del pedido (Expo Push, ADR 0020). */
export async function registerOrderPushToken(db: Db, orderId: string, token: string | undefined, secret: string, expoToken: string) {
  assertTrackingToken(secret, orderId, token);
  await saveCustomerPushToken(db, orderId, expoToken);
}

export interface CustomerOrderSummary {
  id: string;
  code: string;
  merchantName: string;
  /** Para abrir su menú desde «Volver a pedir» (ADR 0028). */
  merchantSlug: string;
  /** «2× Muzzarella, Coca 1,5 L»: lo que se pidió, para reconocerlo. */
  itemsSummary: string;
  status: OrderStatus;
  totalMinor: number;
  createdAt: string;
  /** Para abrir el seguimiento desde cualquier celular con la misma cuenta. */
  trackingToken: string;
}

/** Pedidos hechos con la cuenta del cliente (ADR 0026), los más nuevos primero. */
export async function listCustomerOrders(db: Db, userId: string, secret: string, limit = 50): Promise<CustomerOrderSummary[]> {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      merchantName: orders.merchantName,
      merchantSlug: orders.merchantSlug,
      status: orders.status,
      totalMinor: orders.totalMinor,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.customerUserId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  const items = rows.length
    ? await db
        .select({ orderId: orderItems.orderId, productName: orderItems.productName, quantity: orderItems.quantity })
        .from(orderItems)
        .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
        .orderBy(asc(orderItems.sortOrder))
    : [];
  const summary = (orderId: string) =>
    items
      .filter((i) => i.orderId === orderId)
      .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.productName}` : i.productName))
      .join(", ");
  return rows.map((r) => ({
    ...r,
    itemsSummary: summary(r.id),
    createdAt: r.createdAt.toISOString(),
    trackingToken: trackingToken(secret, r.id),
  }));
}

export async function getOrderForCustomer(db: Db, orderId: string, token: string | undefined, secret: string) {
  assertTrackingToken(secret, orderId, token);
  const [order, tracking] = await Promise.all([loadOrder(db, orderId), getCustomerDeliveryInfo(db, orderId)]);
  return { ...order, tracking };
}

export async function cancelOrderByCustomer(
  db: Db,
  orderId: string,
  token: string | undefined,
  secret: string,
  reason: string | null,
): Promise<OrderDto> {
  assertTrackingToken(secret, orderId, token);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!row) throw notFound("Pedido");
    if (!customerCanCancel(row.status)) {
      throw conflict("El comercio ya aceptó el pedido: para cancelarlo, comunicate con el comercio", {
        reason: "NOT_CANCELLABLE",
        status: row.status,
      });
    }
    await applyTransition(tx, row, OrderStatus.CANCELLED, { actorType: "CUSTOMER", actorUserId: null, reason: reason ?? "Cancelado por el cliente" });
  });
  return loadOrder(db, orderId);
}

// ---------------------------------------------------------------------------
// Comercio
// ---------------------------------------------------------------------------

/** `active`: pedidos en curso (más antiguos primero). `done`: últimos 50 finalizados. */
export async function listMerchantOrders(
  db: Db,
  merchantId: string,
  userId: string,
  scope: "active" | "done",
): Promise<Array<OrderDto & { dispatch: DeliveryDto | null }>> {
  await getMerchantAccess(db, merchantId, userId);
  const finals = Object.values(OrderStatus).filter(isOrderFinal);
  // Pedidos con tarjeta nunca pagados (esperando el pago o vencidos sin pagar): el comercio no los ve.
  const seen = sql`not (${orders.paymentMethod} = ${PaymentMethod.MERCADO_PAGO} and ${orders.paymentConfirmedAt} is null)`;
  const rows =
    scope === "active"
      ? await db
          .select()
          .from(orders)
          .where(and(eq(orders.merchantId, merchantId), notInArray(orders.status, finals), seen))
          .orderBy(asc(orders.createdAt))
      : await db
          .select()
          .from(orders)
          .where(and(eq(orders.merchantId, merchantId), inArray(orders.status, finals), seen))
          .orderBy(desc(orders.updatedAt))
          .limit(50);
  const [list, byOrder] = await Promise.all([loadOrders(db, rows), getDeliveriesForOrders(db, rows.map((r) => r.id))]);
  return list.map((o) => ({ ...o, dispatch: byOrder.get(o.id) ?? null }));
}

/**
 * Cambio de estado por el comercio. Solo las acciones de `merchantOrderActions` (domain);
 * las que lo piden requieren motivo. "Listo" en un retiro pasa además a "Listo para retirar".
 */
export async function transitionMerchantOrder(
  db: Db,
  merchantId: string,
  orderId: string,
  to: OrderStatus,
  reason: string | null,
  actorUserId: string,
): Promise<OrderDto> {
  await getMerchantAccess(db, merchantId, actorUserId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
      .for("update");
    if (!row) throw notFound("Pedido");

    const action = merchantOrderActions(row.status, row.fulfillmentType).find((a) => a.to === to);
    if (!action || !canTransitionOrder(row.status, to, row.fulfillmentType)) {
      throw conflict("Ese cambio de estado no es válido ahora", { reason: "INVALID_TRANSITION", status: row.status, to });
    }
    if (action.needsReason && !reason?.trim()) throw badRequest("Indicá el motivo (lo ve el cliente)", { field: "reason" });
    if (BY_COURIER.includes(to)) {
      const delivery = (await getDeliveriesForOrders(tx, [row.id])).get(row.id);
      if (delivery) {
        throw conflict(
          delivery.courier
            ? "Este envío lo está haciendo un repartidor: el estado se actualiza desde su app"
            : "Hay una búsqueda de repartidor en curso: cancelala antes de mandarlo por tu cuenta",
          { reason: "DELIVERY_IN_PROGRESS" },
        );
      }
    }
    if (to === OrderStatus.CANCELLED || to === OrderStatus.REJECTED) await cancelDeliveriesForOrder(tx, row.id, reason?.trim() || null);

    // Aceptar o rechazar también cuenta como "visto": apaga la alarma.
    if (!row.acknowledgedAt) await tx.update(orders).set({ acknowledgedAt: new Date() }).where(eq(orders.id, row.id));

    const updated = await applyTransition(tx, row, to, { actorType: "MERCHANT", actorUserId, reason: reason?.trim() || null });
    if (to === OrderStatus.READY && row.fulfillmentType === FulfillmentType.PICKUP) {
      await applyTransition(tx, updated, OrderStatus.READY_FOR_PICKUP, { actorType: "SYSTEM", actorUserId: null, reason: null }, 1);
    }
  });
  return loadOrder(db, orderId);
}

async function applyTransition(
  tx: Tx,
  row: OrderRow,
  to: OrderStatus,
  actor: { actorType: OrderActorType; actorUserId: string | null; reason: string | null },
  offsetMs = 0,
): Promise<OrderRow> {
  const at = new Date(Date.now() + offsetMs);
  // Efectivo sin cobrar en un pedido que no sigue: ya no se espera ese pago. La transferencia queda
  // pendiente: puede haber llegado igual y el comercio tiene que poder registrarla (para devolverla).
  // Pago con tarjeta aprobado en un pedido que no sigue: hay que devolverlo (SPEC §8.2.2).
  const refundDigital =
    RELEASES_SLOT.includes(to) && row.paymentMethod === PaymentMethod.MERCADO_PAGO && row.paymentStatus === PaymentStatus.APPROVED;
  const dropCash =
    RELEASES_SLOT.includes(to) && row.paymentMethod === PaymentMethod.CASH && row.paymentStatus === PaymentStatus.PENDING;
  const [updated] = await tx
    .update(orders)
    .set({
      status: to,
      ...(actor.reason !== null && { statusReason: actor.reason }),
      ...(dropCash && { paymentStatus: PaymentStatus.CANCELLED }),
      ...(refundDigital && { paymentStatus: PaymentStatus.REFUND_PENDING }),
      // Pedido con tarjeta que nunca se pagó: el pago ya no se espera.
      ...(RELEASES_SLOT.includes(to) && row.paymentMethod === PaymentMethod.MERCADO_PAGO && row.paymentStatus === PaymentStatus.PENDING && {
        paymentStatus: PaymentStatus.CANCELLED,
      }),
    })
    .where(eq(orders.id, row.id))
    .returning();
  await tx.insert(orderEvents).values({
    orderId: row.id,
    fromStatus: row.status,
    toStatus: to,
    actorType: actor.actorType,
    actorUserId: actor.actorUserId,
    reason: actor.reason,
    createdAt: at,
  });
  // Venta concluida: se devenga la comisión en el ledger (SPEC §6.3), en la misma transacción.
  // Con tarjeta la comisión ya la retuvo el split (application_fee): no es deuda del comercio.
  if ((to === OrderStatus.PICKED_UP || to === OrderStatus.DELIVERED) && row.paymentMethod !== PaymentMethod.MERCADO_PAGO) {
    await accrueOrderCommission(tx, updated!);
  }
  // El pedido no siguió: el uso de la promo vuelve al cupo (ADR 0030).
  if (RELEASES_SLOT.includes(to) && row.promotionId) await reverseOrderPromotion(tx, row.id);
  if (refundDigital) {
    for (const listener of paidCancelListeners) await listener(tx, { orderId: row.id, reason: actor.reason ?? `Pedido ${to.toLowerCase()}` });
  }
  return updated!;
}

/** Estados del pedido que, con un repartidor de Pedilo, los mueve el reparto y no el comercio. */
const BY_COURIER: OrderStatus[] = [OrderStatus.PICKED_UP_BY_COURIER, OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED];

// ---------------------------------------------------------------------------
// Reparto (SPEC §9.0, ADR 0014): comandos hacia deliveries y traducción de sus eventos
// ---------------------------------------------------------------------------

/**
 * El comercio pide un repartidor para un pedido con envío: se crea el delivery con los datos
 * necesarios (snapshot) y se publica la oferta. Tarifa sugerida: el costo de envío del pedido.
 */
export async function requestOrderDelivery(
  db: Db,
  merchantId: string,
  orderId: string,
  input: { feeMinor?: number | undefined; offerMinutes?: number | undefined; requirePin?: boolean | undefined },
  userId: string,
): Promise<OrderDto & { dispatch: DeliveryDto | null }> {
  await getMerchantAccess(db, merchantId, userId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
      .for("update");
    if (!row) throw notFound("Pedido");
    if (row.fulfillmentType !== FulfillmentType.DELIVERY || !row.deliveryAddressLine) {
      throw conflict("Solo los pedidos con envío necesitan repartidor", { reason: "NOT_DELIVERY" });
    }
    if (!REQUESTABLE.includes(row.status)) {
      throw conflict("Pedí el repartidor después de aceptar el pedido y antes de que salga", { reason: "INVALID_STATUS", status: row.status });
    }
    const branch = await getBranchSummary(tx, row.branchId);
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, row.id)).orderBy(asc(orderItems.sortOrder));
    const description = items.map((i) => `${i.quantity} × ${i.productName}`).join(", ");
    await requestDelivery(
      tx,
      {
        orderId: row.id,
        reference: row.code,
        merchantId,
        branchId: row.branchId,
        cityId: branch.cityId,
        pickup: { name: row.merchantName, address: row.branchAddress, phone: branch.phone },
        dropoff: {
          area: row.deliveryZoneName ?? "—",
          address: row.deliveryAddressLine,
          notes: row.deliveryAddressNotes,
          location: row.deliveryLat !== null && row.deliveryLng !== null ? { lat: row.deliveryLat, lng: row.deliveryLng } : null,
        },
        recipient: { name: row.customerName, phone: row.customerPhone },
        packageDescription: description.length > 300 ? `${description.slice(0, 297)}…` : description,
        // Efectivo sin cobrar: lo cobra el repartidor al entregar y se lo debe al comercio (SPEC §8.3).
        cashToCollectMinor:
          row.paymentMethod === PaymentMethod.CASH && row.paymentStatus === PaymentStatus.PENDING ? row.totalMinor : 0,
      },
      {
        feeMinor: input.feeMinor ?? row.deliveryFeeMinor,
        offerMinutes: input.offerMinutes ?? DEFAULT_OFFER_MINUTES,
        actorUserId: userId,
        requirePin: input.requirePin ?? true,
      },
    );
  });
  const [dto] = await loadOrders(db, await db.select().from(orders).where(eq(orders.id, orderId)));
  return { ...dto!, dispatch: (await getDeliveriesForOrders(db, [orderId])).get(orderId) ?? null };
}

const REQUESTABLE: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY];

/**
 * Evento del reparto → estado del pedido (`orderStatusForDeliveryStatus`). Si el repartidor
 * retira un pedido que el comercio todavía no marcó como listo, se lo marca listo primero: el
 * paquete físico ya salió. Cambios que el pedido ya no admite (p. ej. cancelado) se ignoran.
 */
export async function applyDeliveryEvent(tx: Tx, event: DeliveryStatusEvent): Promise<void> {
  if (!event.orderId) return;
  const target = orderStatusForDeliveryStatus(event.to);
  if (!target) return;
  const [row] = await tx.select().from(orders).where(eq(orders.id, event.orderId)).for("update");
  if (!row) return;
  const system = { actorType: "SYSTEM" as const, actorUserId: null };
  let current = row;
  if (target === OrderStatus.PICKED_UP_BY_COURIER) {
    for (const step of [OrderStatus.PREPARING, OrderStatus.READY]) {
      if (canTransitionOrder(current.status, step, current.fulfillmentType)) {
        current = await applyTransition(tx, current, step, { ...system, reason: null });
      }
    }
  }
  if (canTransitionOrder(current.status, target, current.fulfillmentType)) {
    await applyTransition(tx, current, target, {
      ...system,
      reason: target === OrderStatus.DELIVERY_FAILED ? (event.reason ?? "El repartidor no pudo entregarlo") : null,
    });
  }
}

/**
 * El comercio confirma que cobró el efectivo o que le llegó la transferencia (SPEC §8.3). Nunca
 * se marca solo. Idempotente: confirmar dos veces no cambia nada.
 */
export async function confirmMerchantPayment(db: Db, merchantId: string, orderId: string, actor: Actor): Promise<OrderDto> {
  await getMerchantAccess(db, merchantId, actor.userId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.merchantId, merchantId)))
      .for("update");
    if (!row) throw notFound("Pedido");
    if (row.paymentStatus === PaymentStatus.APPROVED) return;
    if (row.paymentMethod === PaymentMethod.MERCADO_PAGO) {
      throw conflict("Los pagos digitales los confirma el procesador de pagos", { reason: "DIGITAL_PAYMENT" });
    }
    if (!paymentStateMachine.canTransition(row.paymentStatus, PaymentStatus.APPROVED)) {
      throw conflict("Este pago ya no se puede confirmar", { reason: "INVALID_PAYMENT_STATUS", paymentStatus: row.paymentStatus });
    }
    const confirmedAt = new Date();
    await tx
      .update(orders)
      .set({ paymentStatus: PaymentStatus.APPROVED, paymentConfirmedAt: confirmedAt, paymentConfirmedBy: actor.userId })
      .where(eq(orders.id, row.id));
    await recordAudit(tx, actor, {
      action: "order.payment_confirmed",
      entityType: "order",
      entityId: row.id,
      before: { paymentStatus: row.paymentStatus },
      after: { paymentStatus: PaymentStatus.APPROVED, paymentMethod: row.paymentMethod, confirmedAt: confirmedAt.toISOString() },
    });
  });
  return loadOrder(db, orderId);
}

// ---------------------------------------------------------------------------
// Pedidos programados (ADR 0011)
// ---------------------------------------------------------------------------

export interface BranchSlotsDto {
  timezone: string;
  /** Franjas de 30 min dentro del horario, desde ahora + anticipación hasta el máximo de días. */
  slots: Array<{ startsAt: string; available: boolean }>;
}

/** Franjas para programar un pedido. Vacío si la sucursal no acepta programados. */
export async function listBranchSlots(db: Db, slug: string, branchId: string, now = new Date()): Promise<BranchSlotsDto> {
  const merchant = await findApprovedMerchantBySlug(db, slug, now);
  const branch = merchant?.branches.find((b) => b.id === branchId);
  if (!branch) throw notFound("Sucursal");
  if (!branch.scheduling.enabled) return { timezone: branch.timezone, slots: [] };

  const slots = scheduleSlots(branchRanges(branch), branch.timezone, now, { ...branch.scheduling, closures: branch.closures });
  const capacity = branch.scheduling.slotCapacity;
  const taken = new Map<number, number>();
  if (capacity !== null && slots.length > 0) {
    const rows = await db
      .select({ at: orders.scheduledFor, n: count() })
      .from(orders)
      .where(
        and(
          eq(orders.branchId, branch.id),
          gte(orders.scheduledFor, slots[0]!),
          lte(orders.scheduledFor, slots.at(-1)!),
          notInArray(orders.status, RELEASES_SLOT),
        ),
      )
      .groupBy(orders.scheduledFor);
    for (const r of rows) if (r.at) taken.set(r.at.getTime(), r.n);
  }
  return {
    timezone: branch.timezone,
    slots: slots.map((s) => ({
      startsAt: s.toISOString(),
      available: capacity === null || (taken.get(s.getTime()) ?? 0) < capacity,
    })),
  };
}

// ---------------------------------------------------------------------------
// Avisos al comercio (SPEC §10)
// ---------------------------------------------------------------------------

/**
 * Marca pedidos como vistos por el comercio (apaga la alarma). Solo afecta pedidos del comercio
 * que todavía no estaban vistos; repetir la llamada no cambia nada. Devuelve cuántos marcó.
 */
export async function acknowledgeMerchantOrders(
  db: Db,
  merchantId: string,
  userId: string,
  orderIds: string[],
): Promise<{ acknowledged: number }> {
  await getMerchantAccess(db, merchantId, userId);
  if (orderIds.length === 0) return { acknowledged: 0 };
  const rows = await db
    .update(orders)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(orders.merchantId, merchantId), inArray(orders.id, orderIds), isNull(orders.acknowledgedAt)))
    .returning({ id: orders.id });
  return { acknowledged: rows.length };
}

export interface MerchantOrdersPulse {
  /** Cambia cada vez que cambia algún pedido del comercio: si es distinto al anterior, hay que recargar. */
  version: string;
  activeCount: number;
  /** Pedidos esperando confirmación, del más antiguo al más nuevo. */
  waiting: Array<{ id: string; code: string; createdAt: string; acceptDeadlineAt: string | null; acknowledged: boolean }>;
}

/**
 * Resumen liviano para consultar seguido (cada pocos segundos) sin traer los pedidos completos.
 * El tablero recarga solo cuando cambia `version` y hace sonar la alarma mientras haya pedidos sin ver.
 */
export async function getMerchantOrdersPulse(db: Db, merchantId: string, userId: string): Promise<MerchantOrdersPulse> {
  await getMerchantAccess(db, merchantId, userId);
  const finals = Object.values(OrderStatus).filter(isOrderFinal);
  const [[stats], waiting, deliveriesVersion] = await Promise.all([
    db
      .select({
        lastUpdate: max(orders.updatedAt),
        total: count(),
        active: sql<number>`count(*) filter (where ${notInArray(orders.status, finals)})`.mapWith(Number),
      })
      .from(orders)
      .where(eq(orders.merchantId, merchantId)),
    db
      .select({ id: orders.id, code: orders.code, createdAt: orders.createdAt, acceptDeadlineAt: orders.acceptDeadlineAt, acknowledgedAt: orders.acknowledgedAt })
      .from(orders)
      .where(and(eq(orders.merchantId, merchantId), eq(orders.status, OrderStatus.PLACED)))
      .orderBy(asc(orders.createdAt)),
    // Un repartidor que acepta o avanza no cambia el pedido, pero el tablero tiene que enterarse.
    lastDeliveryChange(db, merchantId),
  ]);
  return {
    version: `${stats?.lastUpdate?.toISOString() ?? "0"}:${stats?.total ?? 0}|${deliveriesVersion}`,
    activeCount: stats?.active ?? 0,
    waiting: waiting.map((w) => ({
      id: w.id,
      code: w.code,
      createdAt: w.createdAt.toISOString(),
      acceptDeadlineAt: w.acceptDeadlineAt?.toISOString() ?? null,
      acknowledged: w.acknowledgedAt !== null,
    })),
  };
}

export const EXPIRED_REASON = "El comercio no respondió a tiempo";

/**
 * Vence los pedidos que siguen esperando confirmación pasado su plazo (SPEC §7.1 paso 7).
 * Idempotente y seguro con varias instancias: toma las filas con SKIP LOCKED y revalida el estado
 * dentro de la transacción. Devuelve cuántos venció.
 */
// ---------------------------------------------------------------------------
// Pago con tarjeta (ADR 0021): lo usa el módulo de pagos
// ---------------------------------------------------------------------------

export type PaidOrderCancelledListener = (tx: Tx, event: { orderId: string; reason: string }) => Promise<void>;
const paidCancelListeners = new Set<PaidOrderCancelledListener>();

/** Pagos se suscribe para devolver el dinero cuando un pedido pagado no sigue (lo conecta app.ts). */
export function onPaidOrderCancelled(listener: PaidOrderCancelledListener): void {
  paidCancelListeners.add(listener);
}

/** Tiempo para pagar un pedido con tarjeta antes de que venza. */
export const UNPAID_ORDER_TTL_MS = 30 * 60 * 1000;

/**
 * Pago aprobado: el pedido pasa a «esperando confirmación» del comercio, con su plazo, y recién
 * ahora suena la alarma (SPEC §7.1 paso 6). Idempotente: si ya no está esperando pago, no hace nada.
 */
export async function markOrderPaid(tx: Tx, orderId: string, opts: { acceptTimeoutMs?: number; now?: Date } = {}): Promise<boolean> {
  const [row] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!row || row.status !== OrderStatus.PENDING_PAYMENT) return false;
  const now = opts.now ?? new Date();
  await tx
    .update(orders)
    .set({
      paymentStatus: PaymentStatus.APPROVED,
      paymentConfirmedAt: now,
      acceptDeadlineAt: acceptDeadline(now, opts.acceptTimeoutMs ?? DEFAULT_ACCEPT_TIMEOUT_MS, row.scheduledFor),
    })
    .where(eq(orders.id, row.id));
  const [fresh] = await tx.select().from(orders).where(eq(orders.id, row.id));
  await applyTransition(tx, fresh!, OrderStatus.PLACED, { actorType: "SYSTEM", actorUserId: null, reason: null });
  await enqueueOrderPlaced(tx, {
    id: row.id,
    code: row.code,
    merchantId: row.merchantId,
    customerName: row.customerName,
    fulfillmentType: row.fulfillmentType,
    totalMinor: row.totalMinor,
    scheduledFor: row.scheduledFor,
  });
  return true;
}

/** El proveedor confirmó (o rechazó) un reembolso: se refleja en el pago del pedido. */
export async function setOrderPaymentStatus(tx: Tx, orderId: string, status: PaymentStatus): Promise<void> {
  await tx.update(orders).set({ paymentStatus: status }).where(eq(orders.id, orderId));
}

/** Pedidos con tarjeta sin pagar a los 30 minutos: vencen (el cliente puede volver a pedir). */
export async function expireUnpaidOrders(db: Db, now = new Date(), batchSize = 50): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, OrderStatus.PENDING_PAYMENT), lte(orders.createdAt, new Date(now.getTime() - UNPAID_ORDER_TTL_MS))))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    for (const row of due) {
      await applyTransition(tx, row, OrderStatus.EXPIRED, { actorType: "SYSTEM", actorUserId: null, reason: "No se completó el pago" });
    }
    return due.length;
  });
}

export async function expireOverdueOrders(db: Db, now = new Date(), batchSize = 50): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, OrderStatus.PLACED), lte(orders.acceptDeadlineAt, now)))
      .orderBy(asc(orders.acceptDeadlineAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    for (const row of due) {
      await applyTransition(tx, row, OrderStatus.EXPIRED, { actorType: "SYSTEM", actorUserId: null, reason: EXPIRED_REASON });
    }
    return due.length;
  });
}

// ---------------------------------------------------------------------------
// Para calificaciones (ADR 0031)
// ---------------------------------------------------------------------------

const COMPLETED_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PICKED_UP];

/** Cuándo se entregó o se retiró cada pedido (null si todavía no). */
export async function completedAtFor(db: DbOrTx, orderIds: string[]): Promise<Map<string, Date>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ orderId: orderEvents.orderId, at: max(orderEvents.createdAt) })
    .from(orderEvents)
    .where(and(inArray(orderEvents.orderId, orderIds), inArray(orderEvents.toStatus, COMPLETED_STATUSES)))
    .groupBy(orderEvents.orderId);
  return new Map(rows.filter((r) => r.at).map((r) => [r.orderId, r.at as Date]));
}

/**
 * El pedido que el cliente quiere calificar: tiene que ser suyo (si no, 404) y estar entregado o
 * retirado (409 ORDER_NOT_COMPLETED).
 */
export async function getRatableOrder(db: DbOrTx, orderId: string, userId: string) {
  const [row] = await db
    .select({ id: orders.id, code: orders.code, merchantId: orders.merchantId, status: orders.status, customerUserId: orders.customerUserId })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row || row.customerUserId !== userId) throw notFound("Pedido");
  const completedAt = (await completedAtFor(db, [orderId])).get(orderId);
  if (!COMPLETED_STATUSES.includes(row.status) || !completedAt) {
    throw conflict("Podés calificar cuando el pedido esté entregado o retirado", { reason: "ORDER_NOT_COMPLETED" });
  }
  return { orderId: row.id, code: row.code, merchantId: row.merchantId, completedAt };
}
