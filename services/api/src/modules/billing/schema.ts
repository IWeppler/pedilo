import type { CommissionBracket, MerchantCategory, MinorUnits, PlanCode, PlanTerms } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { merchants } from "../merchants/schema";
import { orders } from "../orders/schema";

/**
 * Versiones de pricing (SPEC §6.1–6.2, ADR 0012): tramos, topes por rubro y términos de cada plan.
 * Inmutables: un cambio de precios es una versión nueva con `effective_from` futura. Los pedidos
 * guardan la versión con la que se calcularon, así nunca hay cambios retroactivos.
 */
export const pricingVersions = pgTable("pricing_versions", {
  id: text("id").primaryKey(),
  brackets: jsonb("brackets").$type<CommissionBracket[]>().notNull(),
  capsByCategory: jsonb("caps_by_category").$type<Record<MerchantCategory, MinorUnits>>().notNull(),
  plans: jsonb("plans").$type<Record<PlanCode, PlanTerms>>().notNull(),
  /** Desde cuándo rige. La vigente es la de mayor `effective_from` que ya empezó. */
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Plan de cada comercio con historial. El vigente es el que tiene `ends_at` null.
 * Sin fila = plan Emprendedor ($0 de mensualidad).
 */
export const merchantPlans = pgTable(
  "merchant_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    planCode: text("plan_code").$type<PlanCode>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    reason: text("reason"),
    assignedBy: uuid("assigned_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_plans_current_unique").on(t.merchantId).where(sql`${t.endsAt} IS NULL`),
    index("merchant_plans_merchant_idx").on(t.merchantId, t.startsAt),
    check("merchant_plans_code_check", sql`${t.planCode} IN ('EMPRENDEDOR', 'NEGOCIO', 'PRO')`),
  ],
);

export const CommissionEntryKind = {
  /** Comisión devengada al completar un pedido (SPEC §6.3). */
  ACCRUED: "ACCRUED",
  /** Corrección manual de un admin (positiva o negativa), con motivo. Nunca se borran asientos. */
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type CommissionEntryKind = (typeof CommissionEntryKind)[keyof typeof CommissionEntryKind];

/**
 * Cuenta de comisiones por cobrar de cada comercio (no es una billetera). Append-only: el saldo
 * es la suma de los asientos; las correcciones son asientos compensatorios.
 */
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
    kind: text("kind").$type<CommissionEntryKind>().notNull(),
    /** Positivo = el comercio le debe a Pedilo; negativo = crédito a favor del comercio. */
    amountMinor: integer("amount_minor").notNull(),
    description: text("description").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un pedido devenga una sola vez, aunque la transición se reintente.
    uniqueIndex("commission_entries_accrued_unique").on(t.orderId).where(sql`${t.kind} = 'ACCRUED'`),
    index("commission_entries_merchant_idx").on(t.merchantId, t.createdAt),
    check("commission_entries_kind_check", sql`${t.kind} IN ('ACCRUED', 'ADJUSTMENT')`),
    check("commission_entries_order_check", sql`${t.kind} <> 'ACCRUED' OR ${t.orderId} IS NOT NULL`),
    check("commission_entries_amount_check", sql`${t.amountMinor} <> 0`),
  ],
);

/**
 * Liquidación semanal (SPEC §8.4, ADR 0013): agrupa los asientos de un comercio hasta un corte.
 * Inmutable: el estado (pendiente, parcial, pagada, vencida) sale de los pagos y el vencimiento.
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    /** Corte anterior (informativo: puede incluir asientos más viejos que no se habían liquidado). */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    /** Corte de la semana: entran los asientos creados antes de este instante. */
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    totalMinor: integer("total_minor").notNull(),
    entryCount: integer("entry_count").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("settlements_merchant_period_unique").on(t.merchantId, t.periodEnd),
    index("settlements_due_idx").on(t.dueAt),
    check("settlements_total_check", sql`${t.totalMinor} > 0 AND ${t.entryCount} > 0`),
    check("settlements_period_check", sql`${t.periodStart} < ${t.periodEnd} AND ${t.dueAt} > ${t.periodEnd}`),
  ],
);

/** Qué asientos entraron en cada liquidación. Un asiento entra en una sola. */
export const settlementAllocations = pgTable(
  "settlement_allocations",
  {
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => commissionEntries.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("settlement_allocations_entry_unique").on(t.entryId), index("settlement_allocations_settlement_idx").on(t.settlementId)],
);

export const SettlementPaymentMethod = { TRANSFER: "TRANSFER", CASH: "CASH", OTHER: "OTHER" } as const;
export type SettlementPaymentMethod = (typeof SettlementPaymentMethod)[keyof typeof SettlementPaymentMethod];

/** Pagos del comercio a Pedilo contra una liquidación. Parciales permitidos; nunca más que lo adeudado. */
export const settlementPayments = pgTable(
  "settlement_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id, { onDelete: "restrict" }),
    amountMinor: integer("amount_minor").notNull(),
    method: text("method").$type<SettlementPaymentMethod>().notNull(),
    /** Número de operación, comprobante, etc. */
    reference: text("reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("settlement_payments_settlement_idx").on(t.settlementId),
    check("settlement_payments_amount_check", sql`${t.amountMinor} > 0`),
    check("settlement_payments_method_check", sql`${t.method} IN ('TRANSFER', 'CASH', 'OTHER')`),
  ],
);

export type SettlementRow = typeof settlements.$inferSelect;
export type SettlementPaymentRow = typeof settlementPayments.$inferSelect;
export type PricingVersionRow = typeof pricingVersions.$inferSelect;
export type MerchantPlanRow = typeof merchantPlans.$inferSelect;
export type CommissionEntryRow = typeof commissionEntries.$inferSelect;
