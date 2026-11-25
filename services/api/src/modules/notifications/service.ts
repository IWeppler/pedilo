import { formatARS } from "@pedilo/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { getMerchantAccess } from "../merchants/service";
import {
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
export async function processOutbox(db: Db, sender: PushSender | null, now = new Date(), batchSize = 20): Promise<number> {
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
    if (!sender) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: "Web Push no configurado (VAPID)" });
      continue;
    }
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.merchantId, row.merchantId));
    if (subs.length === 0) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: "El comercio no tiene dispositivos registrados" });
      continue;
    }

    let delivered = 0;
    const gone: string[] = [];
    const errors: string[] = [];
    for (const sub of subs) {
      const result = await sender.send(sub, row.payload);
      if (result.ok) {
        delivered++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: now }).where(eq(pushSubscriptions.id, sub.id));
      } else if (result.gone) gone.push(sub.id);
      else errors.push(result.error);
    }
    if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));

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
