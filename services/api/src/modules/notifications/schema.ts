import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { merchants } from "../merchants/schema";

/**
 * Suscripciones Web Push de los navegadores del comercio (ADR 0009). Una por navegador/dispositivo
 * (endpoint único). Se borran solas cuando el servicio de push responde que ya no existen.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint), index("push_subscriptions_merchant_idx").on(t.merchantId)],
);

export const NotificationKind = { ORDER_PLACED: "ORDER_PLACED", TEST: "TEST" } as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const OutboxStatus = { PENDING: "PENDING", SENT: "SENT", FAILED: "FAILED", SKIPPED: "SKIPPED" } as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

/**
 * Outbox de avisos (SPEC §10, ARCHITECTURE §4): se escribe en la misma transacción que el hecho
 * (p. ej. el pedido) y un worker lo envía con reintentos. Nada se pierde si el proceso se cae.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<NotificationKind>().notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    /** Título, texto, url y tag de la notificación. */
    payload: jsonb("payload").$type<PushPayload>().notNull(),
    status: text("status").$type<OutboxStatus>().notNull().default("PENDING"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    /** A cuántos dispositivos llegó (notification_sent, SPEC §10). */
    deliveredCount: smallint("delivered_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("notification_outbox_pending_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'PENDING'`),
    check("notification_outbox_status_check", sql`${t.status} IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')`),
  ],
);

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta del panel que abre al tocar la notificación. */
  url: string;
  /** Notificaciones con el mismo tag se reemplazan (evita duplicados con el aviso de la página). */
  tag: string;
}

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;
