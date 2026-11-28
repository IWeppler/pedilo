import { randomInt } from "node:crypto";

import {
  ACTIVE_COURIER_STATUSES,
  canRevealDropoffAddress,
  COURIER_LOCATION_MAX_AGE_MS,
  courierDeliveryActions,
  CourierStatus,
  CUSTOMER_TRACKING_STATUSES,
  deliveryStateMachine,
  DeliveryStatus,
  formatARS,
  type Vehicle,
} from "@pedilo/domain";
import { and, asc, desc, eq, gt, inArray, lte, notExists, notInArray, sql } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { getMerchantAccess, getMerchantNames } from "../merchants/service";
import { NotificationKind } from "../notifications/schema";
import {
  enqueueCourierNotifications,
  removeCourierPushToken,
  saveCourierPushToken,
  skipPendingNotifications,
} from "../notifications/service";
import {
  courierLocations,
  courierMerchantEntries,
  type CourierMerchantEntryKind,
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
  // Terminó (o soltó) su último reparto activo: deja de compartir ubicación (ADR 0022).
  if (row.courierId && !ACTIVE_COURIER_STATUSES.includes(to)) await clearLocationIfIdle(tx, row.courierId);
  if (row.status === DeliveryStatus.OFFERED && to !== DeliveryStatus.OFFERED) await offerClosed(tx, row.id);
  for (const listener of listeners) {
    await listener(tx, { deliveryId: row.id, orderId: row.orderId, from: row.status, to, reason: actor.reason ?? null });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Avisos de ofertas a los repartidores (ADR 0025)
// ---------------------------------------------------------------------------

/** Canal de Android de las ofertas: lo crea la app (sonido, importancia máxima). */
export const OFFER_CHANNEL_ID = "offers";
const offerTag = (deliveryId: string) => `offer-${deliveryId}`;

/**
 * Quién puede tomar la oferta, con el mismo criterio que la bandeja (`listOffers`): aprobados y
 * disponibles de la ciudad, que cobran al menos su mínimo y que no la rechazaron.
 */
async function eligibleCourierIds(tx: DbOrTx, d: DeliveryRow): Promise<string[]> {
  const rows = await tx
    .select({ id: courierProfiles.id })
    .from(courierProfiles)
    .where(
      and(
        eq(courierProfiles.cityId, d.cityId),
        eq(courierProfiles.status, CourierStatus.APPROVED),
        eq(courierProfiles.available, true),
        lte(courierProfiles.minFeeMinor, d.courierFeeMinor + d.tipMinor),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(deliveryDeclines)
            .where(and(eq(deliveryDeclines.deliveryId, d.id), eq(deliveryDeclines.courierId, courierProfiles.id))),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * La oferta se publicó (o cambió su pago): avisa a quienes pueden tomarla, aunque tengan la app
 * cerrada. Sin la dirección exacta, como en la bandeja. Vence con la oferta.
 */
async function notifyOffer(tx: Tx, d: DeliveryRow): Promise<void> {
  await skipPendingNotifications(tx, offerTag(d.id), "La oferta cambió");
  const cash = d.cashToCollectMinor > 0 ? ` · Cobrás ${formatARS(d.cashToCollectMinor)} en efectivo` : "";
  await enqueueCourierNotifications(tx, {
    kind: NotificationKind.DELIVERY_OFFERED,
    merchantId: d.merchantId,
    orderId: d.orderId,
    courierIds: await eligibleCourierIds(tx, d),
    payload: {
      title: `Envío por ${formatARS(d.courierFeeMinor + d.tipMinor)}`,
      body: `Retirás en ${d.pickupName} · Llevás a ${d.dropoffArea}${cash}`,
      url: "/",
      tag: offerTag(d.id),
      channelId: OFFER_CHANNEL_ID,
      ...(d.offerExpiresAt && { expiresAt: d.offerExpiresAt.toISOString() }),
    },
  });
}

/** La oferta dejó de estar abierta: los avisos que no salieron todavía ya no se mandan. */
const offerClosed = (tx: DbOrTx, deliveryId: string) => skipPendingNotifications(tx, offerTag(deliveryId), "La oferta ya no está abierta");

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
  /** `location`: punto exacto que marcó el cliente (ADR 0023); como la dirección, solo asignado. */
  dropoff: { area: string; address: string | null; notes: string | null; location: { lat: number; lng: number } | null };
  recipient: { name: string; phone: string } | null;
  packageDescription: string;
  courierFeeMinor: number;
  tipMinor: number;
  cashToCollectMinor: number;
  courier: { id: string; name: string; phone: string; vehicle: Vehicle } | null;
  /** Para marcar entregado hay que ingresar el PIN que tiene el cliente (ADR 0016). */
  pinRequired: boolean;
  /** Solo para el comercio: el repartidor nunca lo ve. */
  pin: string | null;
  pinLocked: boolean;
  /** Última ubicación del repartidor (solo para el comercio, con un reparto en curso; ADR 0022). */
  courierLocation: CourierLocationDto | null;
  offerExpiresAt: string | null;
  statusReason: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `reveal`: mostrar destino y destinatario (comercio siempre; repartidor solo asignado). */
function toDeliveryDto(
  d: DeliveryRow,
  courier: CourierProfileRow | undefined,
  reveal: boolean,
  showPin: boolean,
  location: CourierLocationDto | null = null,
): DeliveryDto {
  return {
    id: d.id,
    orderId: d.orderId,
    reference: d.reference,
    status: d.status,
    version: d.version,
    pickup: { name: d.pickupName, address: d.pickupAddress, phone: d.pickupPhone },
    dropoff: {
      area: d.dropoffArea,
      address: reveal ? d.dropoffAddress : null,
      notes: reveal ? d.dropoffNotes : null,
      location: reveal && d.dropoffLat !== null && d.dropoffLng !== null ? { lat: d.dropoffLat, lng: d.dropoffLng } : null,
    },
    recipient: reveal ? { name: d.recipientName, phone: d.recipientPhone } : null,
    packageDescription: d.packageDescription,
    courierFeeMinor: d.courierFeeMinor,
    tipMinor: d.tipMinor,
    cashToCollectMinor: d.cashToCollectMinor,
    courier: courier ? { id: courier.id, name: courier.displayName, phone: courier.phone, vehicle: courier.vehicle } : null,
    pinRequired: d.pinRequired,
    pin: showPin && d.pinRequired ? d.dropoffPin : null,
    pinLocked: d.pinRequired && d.pinAttempts >= MAX_PIN_ATTEMPTS,
    courierLocation: location,
    offerExpiresAt: d.offerExpiresAt?.toISOString() ?? null,
    statusReason: d.statusReason,
    assignedAt: d.assignedAt?.toISOString() ?? null,
    pickedUpAt: d.pickedUpAt?.toISOString() ?? null,
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** `forMerchant`: incluye el PIN y la ubicación del repartidor. */
async function withCouriers(
  db: DbOrTx,
  rows: DeliveryRow[],
  reveal: (d: DeliveryRow) => boolean,
  forMerchant = false,
): Promise<DeliveryDto[]> {
  const ids = [...new Set(rows.map((r) => r.courierId).filter((x): x is string => x !== null))];
  const [couriers, locations] = await Promise.all([
    ids.length ? db.select().from(courierProfiles).where(inArray(courierProfiles.id, ids)) : [],
    forMerchant ? freshLocations(db, ids) : new Map<string, CourierLocationDto>(),
  ]);
  const byId = new Map(couriers.map((c) => [c.id, c]));
  return rows.map((r) =>
    toDeliveryDto(
      r,
      r.courierId ? byId.get(r.courierId) : undefined,
      reveal(r),
      forMerchant,
      r.courierId && ACTIVE_COURIER_STATUSES.includes(r.status) ? (locations.get(r.courierId) ?? null) : null,
    ),
  );
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
  dropoff: { area: string; address: string; notes: string | null; location?: { lat: number; lng: number } | null };
  recipient: { name: string; phone: string };
  packageDescription: string;
  cashToCollectMinor: number;
}

export const DEFAULT_OFFER_MINUTES = 10;
/** Intentos de PIN antes de bloquear (el comercio lo desbloquea). */
export const MAX_PIN_ATTEMPTS = 5;

/** Crea el delivery de un pedido y lo publica como oferta (SPEC §9.2). Un activo por pedido. */
export async function requestDelivery(
  tx: Tx,
  req: DeliveryRequest,
  offer: { feeMinor: number; offerMinutes: number; actorUserId: string; requirePin?: boolean },
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
        dropoffLat: req.dropoff.location?.lat ?? null,
        dropoffLng: req.dropoff.location?.lng ?? null,
        recipientName: req.recipient.name,
        recipientPhone: req.recipient.phone,
        packageDescription: req.packageDescription,
        courierFeeMinor: offer.feeMinor,
        cashToCollectMinor: req.cashToCollectMinor,
        pinRequired: offer.requirePin ?? true,
        dropoffPin: (offer.requirePin ?? true) ? String(randomInt(0, 10_000)).padStart(4, "0") : null,
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
  const offered = await changeStatus(
    tx,
    row,
    DeliveryStatus.OFFERED,
    { type: "MERCHANT", userId: offer.actorUserId },
    { offerExpiresAt: new Date(now.getTime() + offer.offerMinutes * 60_000) },
  );
  await notifyOffer(tx, offered);
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
  const dtos = await withCouriers(db, rows, () => true, true);
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

async function deliveryDto(db: DbOrTx, id: string, reveal: boolean, showPin = false): Promise<DeliveryDto> {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.id, id));
  if (!row) throw notFound("Reparto");
  return (await withCouriers(db, [row], () => reveal, showPin))[0]!;
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
    let offered: DeliveryRow;
    if (row.status === DeliveryStatus.OFFERED) {
      [offered] = (await tx
        .update(deliveries)
        .set({ ...set, version: row.version + 1 })
        .where(eq(deliveries.id, row.id))
        .returning()) as [DeliveryRow];
    } else {
      offered = await changeStatus(tx, row, DeliveryStatus.OFFERED, { type: "MERCHANT", userId }, set);
    }
    // Con la tarifa nueva, quien la había rechazado la vuelve a ver (y le llega el aviso).
    await tx.delete(deliveryDeclines).where(eq(deliveryDeclines.deliveryId, row.id));
    await notifyOffer(tx, offered);
  });
  return deliveryDto(db, deliveryId, true, true);
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
  return deliveryDto(db, deliveryId, true, true);
}

export async function listMerchantDeliveries(db: Db, merchantId: string, userId: string): Promise<DeliveryDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const rows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.merchantId, merchantId))
    .orderBy(desc(deliveries.createdAt))
    .limit(100);
  return withCouriers(db, rows, () => true, true);
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

/** Registra el celular del repartidor para recibir ofertas con la app cerrada (ADR 0025). Idempotente. */
export async function registerCourierPushToken(db: Db, userId: string, expoToken: string): Promise<void> {
  const courier = await myCourier(db, userId);
  await saveCourierPushToken(db, courier.id, expoToken);
}

/** Al cerrar sesión, el celular deja de recibir avisos. */
export async function unregisterCourierPushToken(db: Db, userId: string, expoToken: string): Promise<void> {
  const courier = await myCourier(db, userId);
  await removeCourierPushToken(db, courier.id, expoToken);
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
    await offerClosed(tx, deliveryId);
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
  input: { to: DeliveryStatus; reason?: string | null | undefined; eventId: string; pin?: string | null | undefined },
): Promise<DeliveryDto> {
  const courier = await myCourier(db, userId);
  const [seen] = await db.select({ id: deliveryEvents.id }).from(deliveryEvents).where(eq(deliveryEvents.eventId, input.eventId));
  if (seen) return deliveryDto(db, deliveryId, true);
  if (input.to === DeliveryStatus.DELIVERED) await checkPin(db, courier.id, deliveryId, input.pin);

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
      if (input.to === DeliveryStatus.DELIVERED) await recordDeliveryEntries(tx, row);
    });
  } catch (err) {
    // La misma acción llegó dos veces a la vez: la primera ganó.
    if (!isUniqueViolation(err)) throw err;
  }
  return deliveryDto(db, deliveryId, true);
}

/**
 * PIN de entrega (SPEC §9.2). Cada error suma un intento (se guarda aunque la acción falle); al
 * llegar al máximo se bloquea hasta que el comercio lo desbloquee.
 */
async function checkPin(db: Db, courierId: string, deliveryId: string, pin: string | null | undefined): Promise<void> {
  const [row] = await db
    .select({ pinRequired: deliveries.pinRequired, dropoffPin: deliveries.dropoffPin, attempts: deliveries.pinAttempts })
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.courierId, courierId)));
  if (!row?.pinRequired) return;
  if (row.attempts >= MAX_PIN_ATTEMPTS) {
    throw conflict("Se bloqueó el PIN por demasiados intentos. Llamá al comercio para que lo desbloquee.", { reason: "PIN_LOCKED" });
  }
  if (!pin) throw badRequest("Pedile el PIN de entrega al cliente", { field: "pin" });
  if (pin.trim() !== row.dropoffPin) {
    const [updated] = await db
      .update(deliveries)
      .set({ pinAttempts: sql`${deliveries.pinAttempts} + 1` })
      .where(eq(deliveries.id, deliveryId))
      .returning({ attempts: deliveries.pinAttempts });
    const left = Math.max(0, MAX_PIN_ATTEMPTS - (updated?.attempts ?? MAX_PIN_ATTEMPTS));
    throw conflict(left > 0 ? `El PIN no es correcto. Te quedan ${left} intentos.` : "El PIN no es correcto y se bloqueó.", {
      reason: left > 0 ? "PIN_INVALID" : "PIN_LOCKED",
      attemptsLeft: left,
    });
  }
}

/** El comercio desbloquea el PIN (p. ej. después de confirmar por teléfono con el cliente). */
export async function resetPinAttempts(db: Db, merchantId: string, deliveryId: string, userId: string): Promise<DeliveryDto> {
  await getMerchantAccess(db, merchantId, userId);
  const [row] = await db
    .update(deliveries)
    .set({ pinAttempts: 0 })
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.merchantId, merchantId)))
    .returning({ id: deliveries.id });
  if (!row) throw notFound("Reparto");
  return deliveryDto(db, deliveryId, true, true);
}

/** Lo que el cliente ve del reparto de su pedido: PIN (mientras no se entregó) y quién lo lleva. */
export interface CustomerDeliveryInfo {
  status: DeliveryStatus;
  pin: string | null;
  courier: { name: string; vehicle: Vehicle } | null;
  /** Dónde está el repartidor: solo con el paquete ya retirado y un punto reciente (ADR 0022). */
  courierLocation: CourierLocationDto | null;
}

export async function getCustomerDeliveryInfo(db: DbOrTx, orderId: string): Promise<CustomerDeliveryInfo | null> {
  const [row] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.orderId, orderId), notInArray(deliveries.status, [DeliveryStatus.CANCELLED])));
  if (!row) return null;
  const tracking = row.courierId !== null && CUSTOMER_TRACKING_STATUSES.includes(row.status);
  const [[courier], locations] = await Promise.all([
    row.courierId ? db.select().from(courierProfiles).where(eq(courierProfiles.id, row.courierId)) : [],
    tracking ? freshLocations(db, [row.courierId!]) : new Map<string, CourierLocationDto>(),
  ]);
  const open = !["DELIVERED", "DELIVERY_FAILED"].includes(row.status);
  return {
    status: row.status,
    pin: row.pinRequired && open ? row.dropoffPin : null,
    // Solo el primer nombre: el cliente no necesita el teléfono del repartidor.
    courier: courier ? { name: courier.displayName.split(" ")[0]!, vehicle: courier.vehicle } : null,
    courierLocation: tracking ? (locations.get(row.courierId!) ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Seguimiento en vivo (ADR 0022)
// ---------------------------------------------------------------------------

export interface CourierLocationDto {
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Cuándo se tomó el punto (hora del servidor). */
  recordedAt: string;
}

/** Un punto que llega con más antigüedad que esto ya no sirve para seguir el envío: se ignora. */
export const MAX_LOCATION_INPUT_AGE_MS = 5 * 60 * 1000;

/** Últimas ubicaciones recientes de varios repartidores (las viejas no se muestran). */
async function freshLocations(db: DbOrTx, courierIds: string[], now = new Date()): Promise<Map<string, CourierLocationDto>> {
  if (courierIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(courierLocations)
    .where(
      and(
        inArray(courierLocations.courierId, courierIds),
        gt(courierLocations.recordedAt, new Date(now.getTime() - COURIER_LOCATION_MAX_AGE_MS)),
      ),
    );
  return new Map(
    rows.map((l) => [l.courierId, { lat: l.lat, lng: l.lng, accuracyM: l.accuracyM, recordedAt: l.recordedAt.toISOString() }]),
  );
}

/** Si al repartidor no le queda ningún reparto activo, se borra su ubicación. */
async function clearLocationIfIdle(db: DbOrTx, courierId: string): Promise<void> {
  const [active] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.courierId, courierId), inArray(deliveries.status, [...ACTIVE_COURIER_STATUSES])))
    .limit(1);
  if (!active) await db.delete(courierLocations).where(eq(courierLocations.courierId, courierId));
}

/**
 * El repartidor manda dónde está. Solo se guarda con un reparto en curso; si no tiene ninguno se
 * borra lo que hubiera y se responde `sharing: false` para que la app deje de mandar.
 *
 * El teléfono manda la antigüedad del punto (`ageMs`), no su hora: un reloj mal puesto no rompe
 * nada. Un punto más viejo que el guardado (llegó tarde, fuera de orden) no lo pisa.
 */
export async function updateCourierLocation(
  db: Db,
  userId: string,
  input: { lat: number; lng: number; accuracyM?: number | null | undefined; ageMs?: number | undefined },
  now = new Date(),
): Promise<{ sharing: boolean }> {
  const courier = await myCourier(db, userId);
  assertApproved(courier);
  const [active] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.courierId, courier.id), inArray(deliveries.status, [...ACTIVE_COURIER_STATUSES])))
    .limit(1);
  if (!active) {
    await db.delete(courierLocations).where(eq(courierLocations.courierId, courier.id));
    return { sharing: false };
  }
  const ageMs = Math.max(0, input.ageMs ?? 0);
  if (ageMs > MAX_LOCATION_INPUT_AGE_MS) return { sharing: true };
  const point = {
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM == null ? null : Math.round(input.accuracyM),
    recordedAt: new Date(now.getTime() - ageMs),
    receivedAt: now,
  };
  await db
    .insert(courierLocations)
    .values({ courierId: courier.id, ...point })
    .onConflictDoUpdate({
      target: courierLocations.courierId,
      set: point,
      setWhere: sql`excluded.recorded_at > ${courierLocations.recordedAt}`,
    });
  await db.update(courierProfiles).set({ lastSeenAt: now }).where(eq(courierProfiles.id, courier.id));
  return { sharing: true };
}

/** Red de seguridad: borra ubicaciones viejas que quedaron (la app dejó de mandar). */
export async function purgeStaleCourierLocations(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .delete(courierLocations)
    .where(lte(courierLocations.recordedAt, new Date(now.getTime() - COURIER_LOCATION_MAX_AGE_MS)))
    .returning({ id: courierLocations.courierId });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Cuenta comercio ↔ repartidor (SPEC §8.3, ADR 0016)
// ---------------------------------------------------------------------------

/** Al entregar: el comercio le debe el pago (+ propina) y el repartidor le debe el efectivo cobrado. */
async function recordDeliveryEntries(tx: Tx, d: DeliveryRow): Promise<void> {
  const values: Array<typeof courierMerchantEntries.$inferInsert> = [];
  const fee = d.courierFeeMinor + d.tipMinor;
  if (fee > 0) {
    values.push({ merchantId: d.merchantId, courierId: d.courierId!, deliveryId: d.id, kind: "DELIVERY_FEE", amountMinor: fee, description: `Envío ${d.reference}` });
  }
  if (d.cashToCollectMinor > 0) {
    values.push({
      merchantId: d.merchantId,
      courierId: d.courierId!,
      deliveryId: d.id,
      kind: "CASH_COLLECTED",
      amountMinor: -d.cashToCollectMinor,
      description: `Efectivo cobrado ${d.reference}`,
    });
  }
  if (values.length) await tx.insert(courierMerchantEntries).values(values).onConflictDoNothing();
}

export interface CourierAccountEntryDto {
  id: string;
  kind: CourierMerchantEntryKind;
  amountMinor: number;
  description: string;
  deliveryId: string | null;
  createdAt: string;
}

const toAccountEntry = (e: typeof courierMerchantEntries.$inferSelect): CourierAccountEntryDto => ({
  id: e.id,
  kind: e.kind,
  amountMinor: e.amountMinor,
  description: e.description,
  deliveryId: e.deliveryId,
  createdAt: e.createdAt.toISOString(),
});

async function pairBalances(db: DbOrTx, where: ReturnType<typeof eq>) {
  return db
    .select({
      merchantId: courierMerchantEntries.merchantId,
      courierId: courierMerchantEntries.courierId,
      balance: sql<number>`sum(${courierMerchantEntries.amountMinor})::int`,
      lastAt: sql<Date>`max(${courierMerchantEntries.createdAt})`,
    })
    .from(courierMerchantEntries)
    .where(where)
    .groupBy(courierMerchantEntries.merchantId, courierMerchantEntries.courierId);
}

export interface MerchantCourierBalanceDto {
  courier: { id: string; name: string; phone: string; vehicle: Vehicle };
  /** Positivo: le debés al repartidor. Negativo: el repartidor te debe. */
  balanceMinor: number;
  lastEntryAt: string;
}

export async function listMerchantCourierBalances(db: Db, merchantId: string, userId: string): Promise<MerchantCourierBalanceDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const rows = await pairBalances(db, eq(courierMerchantEntries.merchantId, merchantId));
  if (rows.length === 0) return [];
  const couriers = await db.select().from(courierProfiles).where(inArray(courierProfiles.id, rows.map((r) => r.courierId)));
  const byId = new Map(couriers.map((c) => [c.id, c]));
  return rows
    .map((r) => {
      const c = byId.get(r.courierId)!;
      return {
        courier: { id: c.id, name: c.displayName, phone: c.phone, vehicle: c.vehicle },
        balanceMinor: r.balance,
        lastEntryAt: new Date(r.lastAt).toISOString(),
      };
    })
    .sort((a, b) => Math.abs(b.balanceMinor) - Math.abs(a.balanceMinor));
}

export async function getMerchantCourierAccount(db: Db, merchantId: string, courierId: string, userId: string) {
  await getMerchantAccess(db, merchantId, userId);
  const entries = await db
    .select()
    .from(courierMerchantEntries)
    .where(and(eq(courierMerchantEntries.merchantId, merchantId), eq(courierMerchantEntries.courierId, courierId)))
    .orderBy(desc(courierMerchantEntries.createdAt))
    .limit(200);
  if (entries.length === 0) throw notFound("Cuenta con el repartidor");
  const [c] = await db.select().from(courierProfiles).where(eq(courierProfiles.id, courierId));
  const [total] = await pairBalances(db, and(eq(courierMerchantEntries.merchantId, merchantId), eq(courierMerchantEntries.courierId, courierId))!);
  return {
    courier: { id: c!.id, name: c!.displayName, phone: c!.phone, vehicle: c!.vehicle },
    balanceMinor: total?.balance ?? 0,
    entries: entries.map(toAccountEntry),
  };
}

/**
 * El comercio registra un pago: le pagó al repartidor (TO_COURIER, baja lo que le debe) o el
 * repartidor le rindió efectivo (FROM_COURIER). Solo con repartidores con los que ya trabajó.
 */
export async function recordCourierPayment(
  db: Db,
  merchantId: string,
  courierId: string,
  input: { direction: "TO_COURIER" | "FROM_COURIER"; amountMinor: number; note?: string | null | undefined },
  actor: Actor,
) {
  await getMerchantAccess(db, merchantId, actor.userId);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: courierMerchantEntries.id })
      .from(courierMerchantEntries)
      .where(and(eq(courierMerchantEntries.merchantId, merchantId), eq(courierMerchantEntries.courierId, courierId)))
      .limit(1);
    if (!existing) throw notFound("Cuenta con el repartidor");
    const note = input.note?.trim();
    const description =
      (input.direction === "TO_COURIER" ? "Pago al repartidor" : "Efectivo rendido por el repartidor") + (note ? ` · ${note}` : "");
    const amountMinor = input.direction === "TO_COURIER" ? -input.amountMinor : input.amountMinor;
    const [row] = await tx
      .insert(courierMerchantEntries)
      .values({ merchantId, courierId, kind: "PAYMENT", amountMinor, description, createdBy: actor.userId })
      .returning({ id: courierMerchantEntries.id });
    await recordAudit(tx, actor, {
      action: "courier_account.payment",
      entityType: "merchant",
      entityId: merchantId,
      after: { entryId: row!.id, courierId, direction: input.direction, amountMinor: input.amountMinor },
    });
  });
  return getMerchantCourierAccount(db, merchantId, courierId, actor.userId);
}

export interface CourierBalanceDto {
  merchant: { id: string; name: string };
  /** Positivo: el comercio te debe. Negativo: le debés al comercio (efectivo cobrado). */
  balanceMinor: number;
  entries: CourierAccountEntryDto[];
}

/** Saldos del repartidor con cada comercio, con los últimos movimientos. */
export async function listCourierBalances(db: Db, userId: string): Promise<CourierBalanceDto[]> {
  const courier = await myCourier(db, userId);
  const rows = await pairBalances(db, eq(courierMerchantEntries.courierId, courier.id));
  if (rows.length === 0) return [];
  const [names, entries] = await Promise.all([
    getMerchantNames(db, rows.map((r) => r.merchantId)),
    db
      .select()
      .from(courierMerchantEntries)
      .where(eq(courierMerchantEntries.courierId, courier.id))
      .orderBy(desc(courierMerchantEntries.createdAt))
      .limit(200),
  ]);
  return rows.map((r) => ({
    merchant: { id: r.merchantId, name: names.get(r.merchantId) ?? "—" },
    balanceMinor: r.balance,
    entries: entries.filter((e) => e.merchantId === r.merchantId).slice(0, 20).map(toAccountEntry),
  }));
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
