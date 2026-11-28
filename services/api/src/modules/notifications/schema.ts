import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { courierProfiles } from "../deliveries/schema";
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
  /** Oferta de reparto nueva (o con mejor pago) para un repartidor. */
  DELIVERY_OFFERED: "DELIVERY_OFFERED",
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

/**
 * A quién va el aviso: navegadores del comercio (Web Push), celulares del cliente del pedido o
 * celulares de un repartidor (Expo Push).
 */
export const NotificationAudience = { MERCHANT: "MERCHANT", CUSTOMER: "CUSTOMER", COURIER: "COURIER" } as const;
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
    /** Repartidor destinatario (audience = COURIER): una fila por repartidor. */
    courierId: uuid("courier_id").references(() => courierProfiles.id, { onDelete: "cascade" }),
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
    check("notification_outbox_courier_check", sql`${t.audience} <> 'COURIER' OR ${t.courierId} IS NOT NULL`),
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

/**
 * Celulares de los repartidores (Expo Push): reciben las ofertas con la app cerrada. Un token es
 * de un solo repartidor: si otro inicia sesión en ese celular, pasa a ser suyo.
 */
export const courierPushTokens = pgTable(
  "courier_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => courierProfiles.id, { onDelete: "cascade" }),
    expoToken: text("expo_token").notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("courier_push_tokens_token_unique").on(t.expoToken), index("courier_push_tokens_courier_idx").on(t.courierId)],
);

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta que abre al tocar la notificación (del panel, o de la app del cliente). */
  url: string;
  /** Notificaciones con el mismo tag se reemplazan (evita duplicados con el aviso de la página). */
  tag: string;
  /** Canal de Android (Expo Push). Las ofertas van por uno propio, con sonido e importancia máxima. */
  channelId?: string;
  /** Pasada esta hora el aviso ya no sirve (p. ej. la oferta venció): no se manda. */
  expiresAt?: string;
}

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type CourierPushTokenRow = typeof courierPushTokens.$inferSelect;
export type CustomerPushTokenRow = typeof customerPushTokens.$inferSelect;
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;

export const EmailKind = {
  ORDER_ACCEPTED: "ORDER_ACCEPTED",
  ORDER_REJECTED: "ORDER_REJECTED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_EXPIRED: "ORDER_EXPIRED",
  CLAIM_UPDATE: "CLAIM_UPDATE",
} as const;
export type EmailKind = (typeof EmailKind)[keyof typeof EmailKind];

/**
 * Outbox de emails al cliente (ADR 0032). Se escribe en la transacción del hecho con un snapshot de
 * los datos; el texto y el destinatario (el email vigente del usuario) se resuelven al mandar. Un
 * worker lo envía con reintentos, igual que los avisos push.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<EmailKind>().notNull(),
    userId: uuid("user_id").notNull(),
    orderId: uuid("order_id"),
    /** Datos del mensaje (snapshot del hecho); el texto se arma al mandarlo. */
    data: jsonb("data").$type<EmailData>().notNull(),
    status: text("status").$type<OutboxStatus>().notNull().default("PENDING"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    /** Id del mensaje en el proveedor (para rastrearlo en Resend). */
    providerId: text("provider_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("email_outbox_pending_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'PENDING'`),
    check("email_outbox_status_check", sql`${t.status} IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')`),
  ],
);

export interface OrderEmailData {
  code: string;
  merchantName: string;
  customerName: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  totalMinor: number;
  items: Array<{ name: string; quantity: number }>;
  reason: string | null;
  /** Se pagó con tarjeta y hay que devolverlo (rechazo, cancelación o vencimiento). */
  refund: boolean;
}

export interface ClaimEmailData {
  orderCode: string;
  title: string;
  body: string;
}

export type EmailData = OrderEmailData | ClaimEmailData;

export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
