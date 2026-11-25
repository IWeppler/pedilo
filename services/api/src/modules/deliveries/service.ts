import {
  ACTIVE_COURIER_STATUSES,
  canRevealDropoffAddress,
  courierDeliveryActions,
  CourierStatus,
  deliveryStateMachine,
  DeliveryStatus,
  type Vehicle,
} from "@pedilo/domain";
import { and, asc, desc, eq, gt, inArray, lte, notExists, notInArray, sql } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { getMerchantAccess } from "../merchants/service";
import {
  courierProfiles,
  type CourierProfileRow,
  deliveries,
  deliveryDeclines,
  deliveryEvents,
  type DeliveryRow,
} from "./schema";

/**
 * Reparto (SPEC §9, ADR 0014). Desacoplado de pedidos: no importa nada del módulo `orders`.
 *
 * - Pedidos → reparto: comandos (`requestDelivery`, `cancelDeliveriesForOrder`).
 * - Reparto → pedidos: eventos (`onDeliveryStatusChange`), en la misma transacción.
 * - Aceptar una oferta es un UPDATE condicional: nunca hay dos ganadores.
 */

// ---------------------------------------------------------------------------
// Eventos hacia otros módulos
// ---------------------------------------------------------------------------

export interface DeliveryStatusEvent {
  deliveryId: string;
  orderId: string | null;
  from: DeliveryStatus;
  to: DeliveryStatus;
  reason: string | null;
}
export type DeliveryStatusListener = (tx: Tx, event: DeliveryStatusEvent) => Promise<void>;

const listeners = new Set<DeliveryStatusListener>();

/** Suscribe un módulo a los cambios de estado (lo conecta `app.ts`). Idempotente. */
export function onDeliveryStatusChange(listener: DeliveryStatusListener): void {
  listeners.add(listener);
}

type ActorType = "MERCHANT" | "COURIER" | "SYSTEM";

async function changeStatus(
  tx: Tx,
  row: DeliveryRow,
  to: DeliveryStatus,
  actor: { type: ActorType; userId: string | null; courierId?: string | null; reason?: string | null; eventId?: string | null },
  set: Partial<typeof deliveries.$inferInsert> = {},
): Promise<DeliveryRow> {
  if (!deliveryStateMachine.canTransition(row.status, to)) {
    throw conflict("Ese cambio de estado del reparto no es válido ahora", { reason: "INVALID_TRANSITION", status: row.status, to });
  }
  const [updated] = await tx
    .update(deliveries)
    .set({ status: to, version: row.version + 1, statusReason: actor.reason ?? null, ...set })
    .where(and(eq(deliveries.id, row.id), eq(deliveries.version, row.version)))
    .returning();
  if (!updated) throw conflict("El reparto cambió mientras tanto. Actualizá y probá de nuevo.", { reason: "STALE" });
  await tx.insert(deliveryEvents).values({
    deliveryId: row.id,
    fromStatus: row.status,
    toStatus: to,
    actorType: actor.type,
    actorUserId: actor.userId,
    courierId: actor.courierId ?? row.courierId,
    reason: actor.reason ?? null,
    eventId: actor.eventId ?? null,
  });
  for (const listener of listeners) {
    await listener(tx, { deliveryId: row.id, orderId: row.orderId, from: row.status, to, reason: actor.reason ?? null });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CourierDto {
  id: string;
  displayName: string;
  phone: string;
  vehicle: Vehicle;
  cityId: string;
  minFeeMinor: number;
  status: CourierStatus;
  statusReason: string | null;
  available: boolean;
  createdAt: string;
}

const toCourierDto = (c: CourierProfileRow): CourierDto => ({
  id: c.id,
  displayName: c.displayName,
  phone: c.phone,
  vehicle: c.vehicle,
  cityId: c.cityId,
  minFeeMinor: c.minFeeMinor,
  status: c.status,
  statusReason: c.statusReason,
  available: c.available,
  createdAt: c.createdAt.toISOString(),
});

/** Lo que ve un repartidor antes de aceptar: sin dirección exacta ni datos del destinatario. */
export interface OfferDto {
  id: string;
  reference: string;
  pickupName: string;
  pickupAddress: string;
  dropoffArea: string;
  packageDescription: string;
  courierFeeMinor: number;
  tipMinor: number;
  cashToCollectMinor: number;
  expiresAt: string;
}

const toOfferDto = (d: DeliveryRow): OfferDto => ({
  id: d.id,
  reference: d.reference,
  pickupName: d.pickupName,
  pickupAddress: d.pickupAddress,
  dropoffArea: d.dropoffArea,
  packageDescription: d.packageDescription,
  courierFeeMinor: d.courierFeeMinor,
  tipMinor: d.tipMinor,
  cashToCollectMinor: d.cashToCollectMinor,
  expiresAt: d.offerExpiresAt!.toISOString(),
});

export interface DeliveryDto {
  id: string;
  orderId: string | null;
  reference: string;
  status: DeliveryStatus;
  version: number;
  pickup: { name: string; address: string; phone: string | null };
  dropoff: { area: string; address: string | null; notes: string | null };
  recipient: { name: string; phone: string } | null;
  packageDescription: string;
  courierFeeMinor: number;
  tipMinor: number;
  cashToCollectMinor: number;
  courier: { id: string; name: string; phone: string; vehicle: Vehicle } | null;
  offerExpiresAt: string | null;
  statusReason: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `reveal`: mostrar destino y destinatario (comercio siempre; repartidor solo asignado). */
function toDeliveryDto(d: DeliveryRow, courier: CourierProfileRow | undefined, reveal: boolean): DeliveryDto {
  return {
    id: d.id,
    orderId: d.orderId,
    reference: d.reference,
    status: d.status,
    version: d.version,
    pickup: { name: d.pickupName, address: d.pickupAddress, phone: d.pickupPhone },
    dropoff: { area: d.dropoffArea, address: reveal ? d.dropoffAddress : null, notes: reveal ? d.dropoffNotes : null },
    recipient: reveal ? { name: d.recipientName, phone: d.recipientPhone } : null,
    packageDescription: d.packageDescription,
    courierFeeMinor: d.courierFeeMinor,
    tipMinor: d.tipMinor,
    cashToCollectMinor: d.cashToCollectMinor,
    courier: courier ? { id: courier.id, name: courier.displayName, phone: courier.phone, vehicle: courier.vehicle } : null,
    offerExpiresAt: d.offerExpiresAt?.toISOString() ?? null,
    statusReason: d.statusReason,
    assignedAt: d.assignedAt?.toISOString() ?? null,
    pickedUpAt: d.pickedUpAt?.toISOString() ?? null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

async function withCouriers(db: DbOrTx, rows: DeliveryRow[], reveal: (d: DeliveryRow) => boolean): Promise<DeliveryDto[]> {
  const ids = [...new Set(rows.map((r) => r.courierId).filter((x): x is string => x !== null))];
  const couriers = ids.length ? await db.select().from(courierProfiles).where(inArray(courierProfiles.id, ids)) : [];
  const byId = new Map(couriers.map((c) => [c.id, c]));
  return rows.map((r) => toDeliveryDto(r, r.courierId ? byId.get(r.courierId) : undefined, reveal(r)));
}

// ---------------------------------------------------------------------------
// Comandos desde pedidos
// ---------------------------------------------------------------------------

export interface DeliveryRequest {
  orderId: string;
  reference: string;
  merchantId: string;
  branchId: string;
  cityId: string;
  pickup: { name: string; address: string; phone: string | null };
  dropoff: { area: string; address: string; notes: string | null };
  recipient: { name: string; phone: string };
  packageDescription: string;
  cashToCollectMinor: number;
}

export const DEFAULT_OFFER_MINUTES = 10;

/** Crea el delivery de un pedido y lo publica como oferta (SPEC §9.2). Un activo por pedido. */
export async function requestDelivery(
  tx: Tx,
  req: DeliveryRequest,
  offer: { feeMinor: number; offerMinutes: number; actorUserId: string },
  now = new Date(),
): Promise<string> {
  let row: DeliveryRow;
  try {
    [row] = (await tx
      .insert(deliveries)
      .values({
        source: "ORDER",
        orderId: req.orderId,
        reference: req.reference,
        merchantId: req.merchantId,
        branchId: req.branchId,
        cityId: req.cityId,
        status: DeliveryStatus.DELIVERY_NEEDED,
        pickupName: req.pickup.name,
        pickupAddress: req.pickup.address,
        pickupPhone: req.pickup.phone,
        dropoffArea: req.dropoff.area,
        dropoffAddress: req.dropoff.address,
        dropoffNotes: req.dropoff.notes,
        recipientName: req.recipient.name,
        recipientPhone: req.recipient.phone,
        packageDescription: req.packageDescription,
        courierFeeMinor: offer.feeMinor,
        cashToCollectMinor: req.cashToCollectMinor,
      })
      .returning()) as [DeliveryRow];
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Este pedido ya tiene un reparto en curso", { reason: "DELIVERY_EXISTS" });
    throw err;
  }
  await tx.insert(deliveryEvents).values({
    deliveryId: row.id,
    fromStatus: null,
    toStatus: DeliveryStatus.DELIVERY_NEEDED,
    actorType: "MERCHANT",
    actorUserId: offer.actorUserId,
  });
  await changeStatus(
    tx,
    row,
    DeliveryStatus.OFFERED,
    { type: "MERCHANT", userId: offer.actorUserId },
    { offerExpiresAt: new Date(now.getTime() + offer.offerMinutes * 60_000) },
  );
  return row.id;
}

/**
 * Se canceló el pedido: se cancela su reparto si todavía no salió (SPEC §9.0). Con el paquete en
 * manos del repartidor no se cancela (el pedido tampoco se puede cancelar en ese punto).
 */
export async function cancelDeliveriesForOrder(tx: Tx, orderId: string, reason: string | null): Promise<void> {
  const rows = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.orderId, orderId), notInArray(deliveries.status, [DeliveryStatus.CANCELLED, DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERY_FAILED])))
    .for("update");
  for (const row of rows) {
    if (deliveryStateMachine.canTransition(row.status, DeliveryStatus.CANCELLED)) {
      await changeStatus(tx, row, DeliveryStatus.CANCELLED, { type: "SYSTEM", userId: null, reason: reason ?? "Se canceló el pedido" }, { offerExpiresAt: null });
    }
  }
}

/** Repartos vigentes (no cancelados) de varios pedidos, para mostrarlos en el panel. */
export async function getDeliveriesForOrders(db: DbOrTx, orderIds: string[]): Promise<Map<string, DeliveryDto>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(deliveries)
    .where(and(inArray(deliveries.orderId, orderIds), notInArray(deliveries.status, [DeliveryStatus.CANCELLED])));
  const dtos = await withCouriers(db, rows, () => true);
  return new Map(dtos.map((d) => [d.orderId!, d]));
}

/** Último cambio en los repartos del comercio (para el pulso del tablero). */
export async function lastDeliveryChange(db: DbOrTx, merchantId: string): Promise<string> {
  const [row] = await db
    .select({ at: sql<string | null>`max(${deliveries.updatedAt})::text`, n: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(eq(deliveries.merchantId, merchantId));
  return `${row?.at ?? "0"}:${row?.n ?? 0}`;
}

// ---------------------------------------------------------------------------
// Comercio
// ---------------------------------------------------------------------------

async function loadMerchantDelivery(tx: DbOrTx, merchantId: string, deliveryId: string): Promise<DeliveryRow> {
  const [row] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.merchantId, merchantId)))
    .for("update");
  if (!row) throw notFound("Reparto");
  return row;
}

async function deliveryDto(db: DbOrTx, id: string, reveal: boolean): Promise<DeliveryDto> {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id));
  if (!row) throw notFound("Reparto");
  return (await withCouriers(db, [row], () => reveal))[0]!;
}

/** Volver a ofertar (nadie aceptó, el repartidor canceló o para subir la tarifa). */
export async function reofferDelivery(
  db: Db,
  merchantId: string,
  deliveryId: string,
  offer: { feeMinor: number; offerMinutes: number },
  userId: string,
  now = new Date(),
): Promise<DeliveryDto> {
  await getMerchantAccess(db, merchantId, userId);
  await db.transaction(async (tx) => {
    const row = await loadMerchantDelivery(tx, merchantId, deliveryId);
    const set = { courierFeeMinor: offer.feeMinor, offerExpiresAt: new Date(now.getTime() + offer.offerMinutes * 60_000), courierId: null };
    // Ya publicada: solo se actualiza la tarifa y el plazo.
    if (row.status === DeliveryStatus.OFFERED) {
      await tx
        .update(deliveries)
        .set({ ...set, version: row.version + 1 })
        .where(eq(deliveries.id, row.id));
    } else {
      await changeStatus(tx, row, DeliveryStatus.OFFERED, { type: "MERCHANT", userId }, set);
    }
    // Con la tarifa nueva, quien la había rechazado la vuelve a ver.
    await tx.delete(deliveryDeclines).where(eq(deliveryDeclines.deliveryId, row.id));
  });
  return deliveryDto(db, deliveryId, true);
}

export async function cancelDeliveryByMerchant(
  db: Db,
  merchantId: string,
  deliveryId: string,
  reason: string,
  userId: string,
): Promise<DeliveryDto> {
  await getMerchantAccess(db, merchantId, userId);
  await db.transaction(async (tx) => {
    const row = await loadMerchantDelivery(tx, merchantId, deliveryId);
    if (!deliveryStateMachine.canTransition(row.status, DeliveryStatus.CANCELLED)) {
      throw conflict("El repartidor ya retiró el pedido: no se puede cancelar el reparto", { reason: "ALREADY_PICKED_UP" });
    }
    await changeStatus(tx, row, DeliveryStatus.CANCELLED, { type: "MERCHANT", userId, reason }, { offerExpiresAt: null });
  });
  return deliveryDto(db, deliveryId, true);
}

export async function listMerchantDeliveries(db: Db, merchantId: string, userId: string): Promise<DeliveryDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const rows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.merchantId, merchantId))
    .orderBy(desc(deliveries.createdAt))
    .limit(100);
  return withCouriers(db, rows, () => true);
}

// ---------------------------------------------------------------------------
// Repartidor
// ---------------------------------------------------------------------------

async function myCourier(db: DbOrTx, userId: string): Promise<CourierProfileRow> {
  const [row] = await db.select().from(courierProfiles).where(eq(courierProfiles.userId, userId));
  if (!row) throw notFound("Perfil de repartidor");
  return row;
}

function assertApproved(c: CourierProfileRow) {
  if (c.status !== CourierStatus.APPROVED) {
    throw forbidden(
      c.status === CourierStatus.PENDING_REVIEW ? "Tu perfil está en revisión" : "Tu perfil de repartidor no está habilitado",
    );
  }
}

export interface CourierInput {
  displayName: string;
  phone: string;
  vehicle: Vehicle;
  cityId: string;
  minFeeMinor?: number | undefined;
}

export async function registerCourier(db: Db, userId: string, input: CourierInput): Promise<CourierDto> {
  try {
    const [row] = await db
      .insert(courierProfiles)
      .values({ userId, ...input, minFeeMinor: input.minFeeMinor ?? 0 })
      .returning();
    return toCourierDto(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya tenés un perfil de repartidor", { reason: "ALREADY_REGISTERED" });
    throw err;
  }
}

export const getMyCourier = async (db: Db, userId: string) => toCourierDto(await myCourier(db, userId));

export async function updateMyCourier(
  db: Db,
  userId: string,
  input: Partial<Pick<CourierInput, "displayName" | "phone" | "vehicle" | "minFeeMinor">> & { available?: boolean | undefined },
): Promise<CourierDto> {
  const current = await myCourier(db, userId);
  if (input.available) assertApproved(current);
  const [row] = await db
    .update(courierProfiles)
    .set({
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.vehicle !== undefined && { vehicle: input.vehicle }),
      ...(input.minFeeMinor !== undefined && { minFeeMinor: input.minFeeMinor }),
      ...(input.available !== undefined && { available: input.available }),
      lastSeenAt: new Date(),
    })
    .where(eq(courierProfiles.id, current.id))
    .returning();
  return toCourierDto(row!);
}

/**
 * Ofertas abiertas para el repartidor: su ciudad, que no vencieron, que pagan al menos su mínimo
 * y que no rechazó. Hora del servidor: el reloj del teléfono no cuenta (SPEC §9.3).
 */
export async function listOffers(db: Db, userId: string, now = new Date()): Promise<OfferDto[]> {
  const courier = await myCourier(db, userId);
  assertApproved(courier);
  await db.update(courierProfiles).set({ lastSeenAt: now }).where(eq(courierProfiles.id, courier.id));
  if (!courier.available) return [];
  const rows = await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, DeliveryStatus.OFFERED),
        eq(deliveries.cityId, courier.cityId),
        gt(deliveries.offerExpiresAt, now),
        sql`${deliveries.courierFeeMinor} + ${deliveries.tipMinor} >= ${courier.minFeeMinor}`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(deliveryDeclines)
            .where(and(eq(deliveryDeclines.deliveryId, deliveries.id), eq(deliveryDeclines.courierId, courier.id))),
        ),
      ),
    )
    .orderBy(asc(deliveries.offerExpiresAt));
  return rows.map(toOfferDto);
}

/**
 * Aceptar una oferta (SPEC §9.2): un UPDATE condicional sobre el estado y el vencimiento. Si dos
 * repartidores aceptan a la vez, solo uno ve la fila actualizada; el otro recibe OFFER_TAKEN.
 */
export async function acceptOffer(db: Db, userId: string, deliveryId: string, now = new Date()): Promise<DeliveryDto> {
  const courier = await myCourier(db, userId);
  assertApproved(courier);
  await db.transaction(async (tx) => {
    const [won] = await tx
      .update(deliveries)
      .set({
        status: DeliveryStatus.ASSIGNED,
        courierId: courier.id,
        assignedAt: now,
        offerExpiresAt: null,
        version: sql`${deliveries.version} + 1`,
      })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          eq(deliveries.status, DeliveryStatus.OFFERED),
          eq(deliveries.cityId, courier.cityId),
          gt(deliveries.offerExpiresAt, now),
        ),
      )
      .returning();
    if (!won) {
      const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId));
      if (!row || row.cityId !== courier.cityId) throw notFound("Oferta");
      if (row.status === DeliveryStatus.OFFERED || row.status === DeliveryStatus.OFFER_EXPIRED) {
        throw conflict("La oferta venció", { reason: "OFFER_EXPIRED" });
      }
      throw conflict("Otro repartidor la aceptó primero", { reason: "OFFER_TAKEN" });
    }
    await tx.insert(deliveryEvents).values({
      deliveryId,
      fromStatus: DeliveryStatus.OFFERED,
      toStatus: DeliveryStatus.ASSIGNED,
      actorType: "COURIER",
      actorUserId: userId,
      courierId: courier.id,
    });
    for (const listener of listeners) {
      await listener(tx, { deliveryId, orderId: won.orderId, from: DeliveryStatus.OFFERED, to: DeliveryStatus.ASSIGNED, reason: null });
    }
  });
  return deliveryDto(db, deliveryId, true);
}

/** Rechazar no penaliza: solo deja de mostrársela (SPEC §9.2). */
export async function declineOffer(db: Db, userId: string, deliveryId: string): Promise<void> {
  const courier = await myCourier(db, userId);
  const [row] = await db.select({ id: deliveries.id, cityId: deliveries.cityId }).from(deliveries).where(eq(deliveries.id, deliveryId));
  if (!row || row.cityId !== courier.cityId) throw notFound("Oferta");
  await db.insert(deliveryDeclines).values({ deliveryId, courierId: courier.id }).onConflictDoNothing();
}

/** Repartos del repartidor: en curso (con destino completo) o terminados (últimos 50). */
export async function listMyDeliveries(db: Db, userId: string, scope: "active" | "done"): Promise<DeliveryDto[]> {
  const courier = await myCourier(db, userId);
  if (scope === "active") {
    const rows = await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.courierId, courier.id), inArray(deliveries.status, [...ACTIVE_COURIER_STATUSES])))
      .orderBy(asc(deliveries.assignedAt));
    return withCouriers(db, rows, (d) => canRevealDropoffAddress(d.status));
  }
  // Terminados: los que entregó o fallaron (los que canceló ya no son suyos).
  const rows = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.courierId, courier.id), inArray(deliveries.status, [DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERY_FAILED])))
    .orderBy(desc(deliveries.updatedAt))
    .limit(50);
  return withCouriers(db, rows, (d) => canRevealDropoffAddress(d.status));
}

/**
 * Cambio de estado del repartidor asignado. `eventId` lo genera la app por cada acción: si la
 * misma acción llega dos veces (reintento tras perder señal), la segunda no hace nada.
 */
export async function courierUpdateStatus(
  db: Db,
  userId: string,
  deliveryId: string,
  input: { to: DeliveryStatus; reason?: string | null | undefined; eventId: string },
): Promise<DeliveryDto> {
  const courier = await myCourier(db, userId);
  const [seen] = await db.select({ id: deliveryEvents.id }).from(deliveryEvents).where(eq(deliveryEvents.eventId, input.eventId));
  if (seen) return deliveryDto(db, deliveryId, true);

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courier.id)))
        .for("update");
      if (!row) throw notFound("Reparto");
      const action = courierDeliveryActions(row.status).find((a) => a.to === input.to);
      if (!action) throw conflict("Ese cambio de estado no es válido ahora", { reason: "INVALID_TRANSITION", status: row.status, to: input.to });
      const reason = input.reason?.trim() || null;
      if (action.needsReason && !reason) throw badRequest("Indicá el motivo", { field: "reason" });

      const now = new Date();
      await changeStatus(
        tx,
        row,
        input.to,
        { type: "COURIER", userId, courierId: courier.id, reason, eventId: input.eventId },
        {
          ...(input.to === DeliveryStatus.PICKED_UP && { pickedUpAt: now }),
          ...(input.to === DeliveryStatus.DELIVERED && { deliveredAt: now }),
          // Canceló antes de retirar: deja de ser suyo y el comercio puede volver a ofertar.
          ...(input.to === DeliveryStatus.COURIER_CANCELLED && { courierId: null, assignedAt: null }),
        },
      );
    });
  } catch (err) {
    // La misma acción llegó dos veces a la vez: la primera ganó.
    if (!isUniqueViolation(err)) throw err;
  }
  return deliveryDto(db, deliveryId, true);
}

// ---------------------------------------------------------------------------
// Vencimiento de ofertas y administración
// ---------------------------------------------------------------------------

/** Pasa a OFFER_EXPIRED las ofertas vencidas sin aceptar. Seguro con varias instancias. */
export async function expireOffers(db: Db, now = new Date(), batchSize = 50): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.status, DeliveryStatus.OFFERED), lte(deliveries.offerExpiresAt, now)))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    for (const row of due) {
      await changeStatus(tx, row, DeliveryStatus.OFFER_EXPIRED, { type: "SYSTEM", userId: null, reason: "Nadie aceptó a tiempo" });
    }
    return due.length;
  });
}

export interface AdminCourierDto extends CourierDto {
  userId: string;
  lastSeenAt: string | null;
}

export async function listCouriersForAdmin(db: Db, status?: CourierStatus): Promise<AdminCourierDto[]> {
  const rows = await db
    .select()
    .from(courierProfiles)
    .where(status ? eq(courierProfiles.status, status) : undefined)
    .orderBy(asc(courierProfiles.createdAt));
  return rows.map((c) => ({ ...toCourierDto(c), userId: c.userId, lastSeenAt: c.lastSeenAt?.toISOString() ?? null }));
}

/** Aprobar, rechazar o suspender (con motivo). Suspender lo saca de disponible. */
export async function reviewCourier(
  db: Db,
  courierId: string,
  to: "APPROVED" | "REJECTED" | "SUSPENDED",
  reason: string | null,
  actor: Actor,
): Promise<AdminCourierDto> {
  if (to !== "APPROVED" && !reason?.trim()) throw badRequest("Indicá el motivo", { field: "reason" });
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(courierProfiles).where(eq(courierProfiles.id, courierId)).for("update");
    if (!current) throw notFound("Repartidor");
    await tx
      .update(courierProfiles)
      .set({ status: to, statusReason: to === "APPROVED" ? null : reason!.trim(), ...(to !== "APPROVED" && { available: false }) })
      .where(eq(courierProfiles.id, courierId));
    await recordAudit(tx, actor, {
      action: `courier.${to.toLowerCase()}`,
      entityType: "courier",
      entityId: courierId,
      before: { status: current.status },
      after: { status: to, reason },
    });
  });
  const [row] = await db.select().from(courierProfiles).where(eq(courierProfiles.id, courierId));
  return { ...toCourierDto(row!), userId: row!.userId, lastSeenAt: row!.lastSeenAt?.toISOString() ?? null };
}
