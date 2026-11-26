import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { merchants } from "../merchants/schema";
import { orders } from "../orders/schema";

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

export const NotificationKind = {
  ORDER_PLACED: "ORDER_PLACED",
  TEST: "TEST",
  /** Reclamos (ADR 0020): nuevo reclamo para el comercio; novedades para comercio o cliente. */
  CLAIM_OPENED: "CLAIM_OPENED",
  CLAIM_UPDATE: "CLAIM_UPDATE",
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

/** A quién va el aviso: navegadores del comercio (Web Push) o celulares del cliente del pedido (Expo Push). */
export const NotificationAudience = { MERCHANT: "MERCHANT", CUSTOMER: "CUSTOMER" } as const;
export type NotificationAudience = (typeof NotificationAudience)[keyof typeof NotificationAudience];

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
    audience: text("audience").$type<NotificationAudience>().notNull().default("MERCHANT"),
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
    check("notification_outbox_audience_check", sql`${t.audience} <> 'CUSTOMER' OR ${t.orderId} IS NOT NULL`),
  ],
);

/**
 * Celulares del cliente que siguen un pedido (Expo Push, ADR 0020). El cliente no tiene cuenta
 * (ADR 0007): el token de push se asocia al pedido, registrado con el token de seguimiento.
 */
export const customerPushTokens = pgTable(
  "customer_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    expoToken: text("expo_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("customer_push_tokens_unique").on(t.orderId, t.expoToken)],
);

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta que abre al tocar la notificación (del panel, o de la app del cliente). */
  url: string;
  /** Notificaciones con el mismo tag se reemplazan (evita duplicados con el aviso de la página). */
  tag: string;
}

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type CustomerPushTokenRow = typeof customerPushTokens.$inferSelect;
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;
