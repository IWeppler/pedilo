import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import {
  canTransitionOrder,
  customerCanCancel,
  FulfillmentType,
  isOrderFinal,
  merchantOrderActions,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  type PricedProduct,
  priceSelection,
} from "@pedilo/domain";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { getProductsForOrder } from "../menu/service";
import { findApprovedMerchantBySlug, getMerchantAccess } from "../merchants/service";
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
  delivery: { zoneName: string; addressLine: string; addressNotes: string | null } | null;
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
  deliveryFeeMinor: number;
  totalMinor: number;
  events: Array<{ fromStatus: OrderStatus | null; toStatus: OrderStatus; actorType: OrderActorType; reason: string | null; createdAt: string }>;
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
        ? { zoneName: o.deliveryZoneName, addressLine: o.deliveryAddressLine, addressNotes: o.deliveryAddressNotes }
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
  deliveryAddress?: { line: string; notes?: string | null | undefined } | undefined;
  customer: { name: string; phone: string };
  notes?: string | null | undefined;
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
 * sucursal abierta, la forma de entrega disponible, cada producto válido según `priceSelection`
 * y, con envío, el subtotal tiene que alcanzar el pedido mínimo de la zona.
 */
export async function createOrder(
  db: Db,
  input: CreateOrderInput,
  idempotencyKey: string,
  opts: { secret: string; now?: Date; customerUserId?: string | null },
): Promise<CreateOrderResult> {
  const existing = await findByIdempotencyKey(db, idempotencyKey);
  if (existing) return { order: existing, trackingToken: trackingToken(opts.secret, existing.id), replayed: true };

  const merchant = await findApprovedMerchantBySlug(db, input.merchantSlug, opts.now ?? new Date());
  if (!merchant) throw notFound("Comercio");
  const branch = merchant.branches.find((b) => b.id === input.branchId);
  if (!branch) throw badRequest("Sucursal inválida", { field: "branchId" });
  if (!branch.openNow) throw conflict("El comercio está cerrado en este momento", { reason: "BRANCH_CLOSED" });

  let zone: (typeof branch.zones)[number] | undefined;
  if (input.fulfillmentType === FulfillmentType.PICKUP) {
    if (!branch.acceptsPickup) throw conflict("Esta sucursal no acepta retiro en el local", { reason: "PICKUP_NOT_AVAILABLE" });
  } else {
    if (!branch.acceptsDelivery) throw conflict("Esta sucursal no hace envíos", { reason: "DELIVERY_NOT_AVAILABLE" });
    zone = branch.zones.find((z) => z.id === input.deliveryZoneId);
    if (!zone) throw badRequest("Elegí una zona de envío de la sucursal", { field: "deliveryZoneId" });
    if (!input.deliveryAddress?.line.trim()) throw badRequest("Falta la dirección de entrega", { field: "deliveryAddress" });
  }

  // Precios y validación de cada ítem con las reglas de dominio.
  const products = await getProductsForOrder(db, merchant.id, input.items.map((i) => i.productId));
  const lines = input.items.map((item, index) => {
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

  const subtotalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
  const deliveryFeeMinor = zone?.feeMinor ?? 0;
  if (zone && subtotalMinor < zone.minOrderMinor) {
    throw conflict("No llegás al pedido mínimo de la zona", {
      reason: "MIN_ORDER_NOT_MET",
      minOrderMinor: zone.minOrderMinor,
      subtotalMinor,
    });
  }

  try {
    const orderId = await db.transaction(async (tx) => {
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
          // Efectivo: el pedido va directo al comercio (no hay pago digital que esperar).
          status: OrderStatus.PLACED,
          fulfillmentType: input.fulfillmentType,
          paymentMethod: PaymentMethod.CASH,
          paymentStatus: PaymentStatus.PENDING,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerUserId: opts.customerUserId ?? null,
          deliveryZoneId: zone?.id ?? null,
          deliveryZoneName: zone?.name ?? null,
          deliveryAddressLine: zone ? input.deliveryAddress!.line.trim() : null,
          deliveryAddressNotes: zone ? input.deliveryAddress?.notes?.trim() || null : null,
          notes: input.notes?.trim() || null,
          subtotalMinor,
          deliveryFeeMinor,
          totalMinor: subtotalMinor + deliveryFeeMinor,
          idempotencyKey,
        })
        .returning({ id: orders.id });
      const id = row!.id;

      for (const [i, line] of lines.entries()) {
        const { options, ...rest } = line;
        const [item] = await tx.insert(orderItems).values({ orderId: id, ...rest, sortOrder: i }).returning({ id: orderItems.id });
        if (options.length) await tx.insert(orderItemOptions).values(options.map((o) => ({ orderItemId: item!.id, ...o })));
      }
      await tx.insert(orderEvents).values({ orderId: id, fromStatus: null, toStatus: OrderStatus.PLACED, actorType: "CUSTOMER", actorUserId: opts.customerUserId ?? null });
      return id;
    });
    return { order: await loadOrder(db, orderId), trackingToken: trackingToken(opts.secret, orderId), replayed: false };
  } catch (err) {
    // Dos requests simultáneos con la misma clave: gana uno y el otro devuelve ese pedido.
    if (isUniqueViolation(err)) {
      const winner = await findByIdempotencyKey(db, idempotencyKey);
      if (winner) return { order: winner, trackingToken: trackingToken(opts.secret, winner.id), replayed: true };
    }
    throw err;
  }
}

async function findByIdempotencyKey(db: DbOrTx, key: string): Promise<OrderDto | null> {
  const [row] = await db.select().from(orders).where(eq(orders.idempotencyKey, key));
  if (!row) return null;
  const [dto] = await loadOrders(db, [row]);
  return dto ?? null;
}

// ---------------------------------------------------------------------------
// Cliente (con token de seguimiento)
// ---------------------------------------------------------------------------

export async function getOrderForCustomer(db: Db, orderId: string, token: string | undefined, secret: string) {
  assertTrackingToken(secret, orderId, token);
  return loadOrder(db, orderId);
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
): Promise<OrderDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const finals = Object.values(OrderStatus).filter(isOrderFinal);
  const rows =
    scope === "active"
      ? await db
          .select()
          .from(orders)
          .where(and(eq(orders.merchantId, merchantId), notInArray(orders.status, finals)))
          .orderBy(asc(orders.createdAt))
      : await db
          .select()
          .from(orders)
          .where(and(eq(orders.merchantId, merchantId), inArray(orders.status, finals)))
          .orderBy(desc(orders.updatedAt))
          .limit(50);
  return loadOrders(db, rows);
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
  const [updated] = await tx
    .update(orders)
    .set({ status: to, ...(actor.reason !== null && { statusReason: actor.reason }) })
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
  return updated!;
}
