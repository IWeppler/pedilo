import type { PaymentStatus } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { claims } from "../claims/schema";
import { merchants } from "../merchants/schema";
import { orders } from "../orders/schema";

/**
 * Pagos digitales con Mercado Pago (ADR 0021): Split 1:1. Cada comercio conecta su cuenta por
 * OAuth; los cobros se hacen con SU token y la comisión de Pedilo va como `application_fee`.
 */

/** `state` del OAuth: aleatorio, de un solo uso, con vencimiento, atado al usuario que conecta. */
export const mpOauthStates = pgTable(
  "mp_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mp_oauth_states_state_unique").on(t.state)],
);

export const MpConnectionStatus = { CONNECTED: "CONNECTED", NEEDS_REAUTH: "NEEDS_REAUTH" } as const;
export type MpConnectionStatus = (typeof MpConnectionStatus)[keyof typeof MpConnectionStatus];

/** Cuenta de Mercado Pago conectada del comercio. Tokens cifrados (AES-256-GCM); nunca salen de la API. */
export const merchantMpAccounts = pgTable(
  "merchant_mp_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    /** `user_id` de Mercado Pago del comercio (identidad de la conexión). */
    mpUserId: text("mp_user_id").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    liveMode: boolean("live_mode").notNull(),
    scope: text("scope"),
    status: text("status").$type<MpConnectionStatus>().notNull().default("CONNECTED"),
    connectedBy: uuid("connected_by").notNull(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("merchant_mp_accounts_merchant_unique").on(t.merchantId),
    check("merchant_mp_accounts_status_check", sql`${t.status} IN ('CONNECTED', 'NEEDS_REAUTH')`),
  ],
);

/** Cada intento de cobro de un pedido (un rechazo y un reintento son dos filas). */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("MERCADO_PAGO"),
    /** Id del pago en Mercado Pago (null si la llamada falló antes de crearlo). */
    providerPaymentId: text("provider_payment_id"),
    status: text("status").$type<PaymentStatus>().notNull(),
    /** Estado crudo del proveedor (approved, in_process, rejected…) y su detalle. */
    providerStatus: text("provider_status"),
    providerStatusDetail: text("provider_status_detail"),
    amountMinor: integer("amount_minor").notNull(),
    /** Comisión de Pedilo retenida en el split. */
    applicationFeeMinor: integer("application_fee_minor").notNull(),
    refundedMinor: integer("refunded_minor").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payments_provider_id_unique").on(t.providerPaymentId),
    uniqueIndex("payments_idempotency_unique").on(t.idempotencyKey),
    index("payments_order_idx").on(t.orderId, t.createdAt),
    check("payments_amounts_check", sql`${t.amountMinor} > 0 AND ${t.applicationFeeMinor} >= 0 AND ${t.applicationFeeMinor} < ${t.amountMinor} AND ${t.refundedMinor} >= 0`),
  ],
);

export const RefundStatus = {
  /** Pedido al proveedor pendiente de mandar (lo manda el worker). */
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  /** El proveedor lo rechazó (p. ej. saldo insuficiente del comercio): revisión manual. */
  FAILED: "FAILED",
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

/**
 * Reembolsos (SPEC §8.2). Se encolan en la transacción del hecho (rechazo del pedido, reclamo) y
 * un worker los manda con idempotencia. Hasta que el proveedor confirma, no hay éxito.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    claimId: uuid("claim_id").references(() => claims.id, { onDelete: "restrict" }),
    /** null = total. */
    amountMinor: integer("amount_minor"),
    reason: text("reason").notNull(),
    status: text("status").$type<RefundStatus>().notNull().default("PENDING"),
    providerRefundId: text("provider_refund_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("refunds_idempotency_unique").on(t.idempotencyKey),
    index("refunds_pending_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'PENDING'`),
    check("refunds_status_check", sql`${t.status} IN ('PENDING', 'APPROVED', 'FAILED')`),
    check("refunds_amount_check", sql`${t.amountMinor} IS NULL OR ${t.amountMinor} > 0`),
  ],
);

/** Webhooks recibidos (auditoría y deduplicación por `x-request-id`). */
export const mpWebhookEvents = pgTable(
  "mp_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: text("request_id").notNull(),
    topic: text("topic").notNull(),
    dataId: text("data_id").notNull(),
    mpUserId: text("mp_user_id"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mp_webhook_events_request_unique").on(t.requestId)],
);

export type MerchantMpAccountRow = typeof merchantMpAccounts.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
