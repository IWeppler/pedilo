import { formatARS } from "@pedilo/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { getMerchantAccess } from "../merchants/service";
import {
  courierPushTokens,
  customerPushTokens,
  NotificationAudience,
  NotificationKind,
  notificationOutbox,
  type NotificationOutboxRow,
  OutboxStatus,
  type PushPayload,
  type PushSubscriptionRow,
  pushSubscriptions,
} from "./schema";

/**
 * Avisos al comercio por Web Push (ADR 0009). Los hechos dejan un registro en la outbox dentro de
 * su transacción; `processOutbox` los envía después, con reintentos.
 */

// ---------------------------------------------------------------------------
// Envío (inyectable para tests)
// ---------------------------------------------------------------------------

export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export interface PushSender {
  send(subscription: Pick<PushSubscriptionRow, "endpoint" | "p256dh" | "auth">, payload: PushPayload): Promise<PushResult>;
}

/** Push a los celulares del cliente y de los repartidores (Expo Push, ADR 0020/0025). */
export interface ExpoPushSender {
  send(expoToken: string, payload: PushPayload): Promise<PushResult>;
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

/** Pedido nuevo → aviso al comercio. Llamar dentro de la transacción que crea el pedido. */
export async function enqueueOrderPlaced(
  tx: DbOrTx,
  order: {
    id: string;
    code: string;
    merchantId: string;
    customerName: string;
    fulfillmentType: "PICKUP" | "DELIVERY";
    totalMinor: number;
    scheduledFor?: Date | null;
    timezone?: string;
  },
): Promise<void> {
  const when = order.scheduledFor
    ? ` · Programado ${new Intl.DateTimeFormat("es-AR", {
        timeZone: order.timezone ?? "America/Argentina/Buenos_Aires",
        weekday: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(order.scheduledFor)}`
    : "";
  await tx.insert(notificationOutbox).values({
    kind: NotificationKind.ORDER_PLACED,
    merchantId: order.merchantId,
    orderId: order.id,
    payload: {
      title: `Pedido nuevo · ${order.code}`,
      body: `${order.customerName} · ${order.fulfillmentType === "PICKUP" ? "Retiro" : "Envío"} · ${formatARS(order.totalMinor)}${when}`,
      url: `/m/${order.merchantId}/orders`,
      tag: `order-${order.id}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Suscripciones del comercio
// ---------------------------------------------------------------------------

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Registra (o actualiza) el navegador del usuario para recibir avisos de este comercio. */
export async function subscribe(db: Db, merchantId: string, userId: string, input: SubscriptionInput, userAgent: string | null) {
  await getMerchantAccess(db, merchantId, userId);
  await db
    .insert(pushSubscriptions)
    .values({ merchantId, userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { merchantId, userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent },
    });
}

export async function unsubscribe(db: Db, merchantId: string, userId: string, endpoint: string) {
  await getMerchantAccess(db, merchantId, userId);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.merchantId, merchantId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Aviso de prueba a los dispositivos del comercio (botón «Probar» del panel). */
/** Aviso genérico (reclamos, ADR 0020). Llamar dentro de la transacción del hecho. */
export async function enqueueNotification(
  tx: DbOrTx,
  n: {
    kind: NotificationKind;
    audience: NotificationAudience;
    merchantId: string;
    orderId: string;
    payload: PushPayload;
  },
): Promise<void> {
  await tx.insert(notificationOutbox).values(n);
}

/**
 * Oferta de reparto → aviso a cada repartidor que puede tomarla (ADR 0025). Quién puede tomarla lo
 * decide `deliveries`; acá solo se encola, una fila por repartidor, en la transacción de la oferta.
 */
export async function enqueueCourierNotifications(
  tx: DbOrTx,
  n: { kind: NotificationKind; merchantId: string; orderId: string | null; courierIds: string[]; payload: PushPayload },
): Promise<void> {
  if (n.courierIds.length === 0) return;
  await tx.insert(notificationOutbox).values(
    n.courierIds.map((courierId) => ({
      kind: n.kind,
      audience: NotificationAudience.COURIER,
      merchantId: n.merchantId,
      orderId: n.orderId,
      courierId,
      payload: n.payload,
    })),
  );
}

/**
 * Descarta los avisos todavía sin mandar con este tag (p. ej. la oferta ya la tomó alguien o
 * venció): un reintento tardío no tiene que despertar a nadie por algo que ya no está.
 */
export async function skipPendingNotifications(tx: DbOrTx, tag: string, reason: string): Promise<void> {
  await tx
    .update(notificationOutbox)
    .set({ status: OutboxStatus.SKIPPED, lastError: reason })
    .where(and(eq(notificationOutbox.status, OutboxStatus.PENDING), sql`${notificationOutbox.payload}->>'tag' = ${tag}`));
}

/** El repartidor registra su celular (Expo Push). Si el token era de otro repartidor, pasa a ser suyo. */
export async function saveCourierPushToken(db: DbOrTx, courierId: string, expoToken: string): Promise<void> {
  await db
    .insert(courierPushTokens)
    .values({ courierId, expoToken })
    .onConflictDoUpdate({ target: courierPushTokens.expoToken, set: { courierId } });
}

/** Al cerrar sesión: este celular deja de recibir avisos del repartidor. */
export async function removeCourierPushToken(db: DbOrTx, courierId: string, expoToken: string): Promise<void> {
  await db.delete(courierPushTokens).where(and(eq(courierPushTokens.courierId, courierId), eq(courierPushTokens.expoToken, expoToken)));
}

/** El cliente registra su celular para recibir avisos de un pedido (Expo Push). Idempotente. */
export async function saveCustomerPushToken(db: DbOrTx, orderId: string, expoToken: string): Promise<void> {
  await db.insert(customerPushTokens).values({ orderId, expoToken }).onConflictDoNothing();
}

export async function enqueueTest(db: Db, merchantId: string, userId: string) {
  await getMerchantAccess(db, merchantId, userId);
  await db.insert(notificationOutbox).values({
    kind: NotificationKind.TEST,
    merchantId,
    payload: { title: "Pedilo: aviso de prueba", body: "Así te vamos a avisar cuando entre un pedido.", url: `/m/${merchantId}/orders`, tag: "pedilo-test" },
  });
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5;
/** Mientras se envía, la fila queda "tomada" este tiempo (si el proceso muere, se reintenta después). */
const LEASE_MS = 2 * 60 * 1000;
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 15 * 60 * 1000);

/**
 * Procesa una tanda de avisos pendientes. Seguro con varias instancias: toma filas con SKIP LOCKED
 * y las "alquila" antes de hacer HTTP fuera de la transacción.
 * - Sin push configurado (sender null) o sin dispositivos → SKIPPED.
 * - Llegó a algún dispositivo → SENT. Suscripciones vencidas (404/410) se borran.
 * - Solo errores transitorios → reintento con espera creciente; tras MAX_ATTEMPTS → FAILED.
 */
export async function processOutbox(
  db: Db,
  sender: PushSender | null,
  now = new Date(),
  batchSize = 20,
  expoSender: ExpoPushSender | null = null,
): Promise<number> {
  const claimed: NotificationOutboxRow[] = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.status, OutboxStatus.PENDING), lte(notificationOutbox.nextAttemptAt, now)))
      .orderBy(asc(notificationOutbox.nextAttemptAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (rows.length) {
      await tx
        .update(notificationOutbox)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: sql`${notificationOutbox.attempts} + 1` })
        .where(inArray(notificationOutbox.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  for (const row of claimed) {
    const attempts = row.attempts + 1;
    const audience = row.audience;
    const viaExpo = audience !== NotificationAudience.MERCHANT;
    if (row.payload.expiresAt && new Date(row.payload.expiresAt) <= now) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: "Venció antes de mandarse" });
      continue;
    }
    if (viaExpo ? !expoSender : !sender) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: viaExpo ? "Expo Push no configurado" : "Web Push no configurado (VAPID)" });
      continue;
    }

    // Destinos: navegadores del comercio, o celulares del cliente que sigue el pedido o del repartidor.
    const expoTargets = (tokens: Array<{ id: string; expoToken: string }>) =>
      tokens.map((t) => ({ id: t.id, send: () => expoSender!.send(t.expoToken, row.payload) }));
    const targets: Array<{ id: string; send: () => Promise<PushResult> }> =
      audience === NotificationAudience.CUSTOMER
        ? expoTargets(await db.select().from(customerPushTokens).where(eq(customerPushTokens.orderId, row.orderId!)))
        : audience === NotificationAudience.COURIER
          ? expoTargets(await db.select().from(courierPushTokens).where(eq(courierPushTokens.courierId, row.courierId!)))
          : (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.merchantId, row.merchantId))).map((s) => ({
              id: s.id,
              send: () => sender!.send(s, row.payload),
            }));
    if (targets.length === 0) {
      await finish(db, row.id, {
        status: OutboxStatus.SKIPPED,
        lastError:
          audience === NotificationAudience.CUSTOMER
            ? "El cliente no registró su celular"
            : audience === NotificationAudience.COURIER
              ? "El repartidor no registró su celular"
              : "El comercio no tiene dispositivos registrados",
      });
      continue;
    }

    let delivered = 0;
    const gone: string[] = [];
    const errors: string[] = [];
    for (const target of targets) {
      const result = await target.send();
      if (result.ok) {
        delivered++;
        if (audience === NotificationAudience.MERCHANT) {
          await db.update(pushSubscriptions).set({ lastSuccessAt: now }).where(eq(pushSubscriptions.id, target.id));
        } else if (audience === NotificationAudience.COURIER) {
          await db.update(courierPushTokens).set({ lastSuccessAt: now }).where(eq(courierPushTokens.id, target.id));
        }
      } else if (result.gone) gone.push(target.id);
      else errors.push(result.error);
    }
    if (gone.length) {
      if (audience === NotificationAudience.CUSTOMER) await db.delete(customerPushTokens).where(inArray(customerPushTokens.id, gone));
      else if (audience === NotificationAudience.COURIER) await db.delete(courierPushTokens).where(inArray(courierPushTokens.id, gone));
      else await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    }

    if (delivered > 0 || errors.length === 0) {
      await finish(db, row.id, {
        status: delivered > 0 ? OutboxStatus.SENT : OutboxStatus.SKIPPED,
        deliveredCount: delivered,
        sentAt: delivered > 0 ? now : null,
        lastError: errors[0] ?? (delivered === 0 ? "Todas las suscripciones estaban vencidas" : null),
      });
    } else if (attempts >= MAX_ATTEMPTS) {
      await finish(db, row.id, { status: OutboxStatus.FAILED, lastError: errors[0]! });
    } else {
      await db
        .update(notificationOutbox)
        .set({ nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: errors[0]! })
        .where(eq(notificationOutbox.id, row.id));
    }
  }
  return claimed.length;
}

async function finish(
  db: Db,
  id: string,
  values: { status: OutboxStatus; lastError?: string | null; deliveredCount?: number; sentAt?: Date | null },
) {
  await db.update(notificationOutbox).set(values).where(eq(notificationOutbox.id, id));
}
