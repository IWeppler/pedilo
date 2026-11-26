import type { ClaimReason, ClaimResolutionType, ClaimStatus } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { merchants } from "../merchants/schema";
import { orders } from "../orders/schema";

/**
 * Reclamos de soporte de primer nivel (SPEC §11.2, ADR 0019). Uno por pedido. Primero propone el
 * comercio; si no responde a tiempo, o el cliente no acepta y lo escala, interviene Pedilo.
 */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    /** Para mostrar ("P-7K3Q"). */
    orderCode: text("order_code").notNull(),
    reason: text("reason").$type<ClaimReason>().notNull(),
    description: text("description").notNull(),
    /** Salud o seguridad (lesión, intoxicación…): va directo a Pedilo, sin automatismos. */
    sensitive: boolean("sensitive").notNull().default(false),
    status: text("status").$type<ClaimStatus>().notNull(),
    /** Hasta cuándo el comercio puede proponer; después se escala solo. */
    merchantDueAt: timestamp("merchant_due_at", { withTimezone: true }).notNull(),

    proposalType: text("proposal_type").$type<ClaimResolutionType>(),
    proposalAmountMinor: integer("proposal_amount_minor"),
    proposalNote: text("proposal_note"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),

    /** Monto devuelto (efectivo/transferencia, lo registra el comercio). */
    refundedMinor: integer("refunded_minor"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("claims_order_unique").on(t.orderId),
    index("claims_merchant_idx").on(t.merchantId, t.createdAt),
    index("claims_due_idx").on(t.merchantDueAt).where(sql`${t.status} = 'OPEN'`),
    check(
      "claims_reason_check",
      sql`${t.reason} IN ('MISSING_ITEM', 'WRONG_ITEM', 'QUALITY', 'DELAY', 'NOT_DELIVERED', 'WRONG_CHARGE')`,
    ),
    check("claims_amounts_check", sql`coalesce(${t.proposalAmountMinor}, 0) >= 0 AND coalesce(${t.refundedMinor}, 0) >= 0`),
  ],
);

export const ClaimActor = { CUSTOMER: "CUSTOMER", MERCHANT: "MERCHANT", ADMIN: "ADMIN", SYSTEM: "SYSTEM" } as const;
export type ClaimActor = (typeof ClaimActor)[keyof typeof ClaimActor];

export const ClaimEventKind = {
  OPENED: "OPENED",
  MESSAGE: "MESSAGE",
  EVIDENCE: "EVIDENCE",
  PROPOSAL: "PROPOSAL",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  ESCALATED: "ESCALATED",
  REFUNDED: "REFUNDED",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;
export type ClaimEventKind = (typeof ClaimEventKind)[keyof typeof ClaimEventKind];

/** Línea de tiempo del reclamo: mensajes, propuestas y cambios. Inmutable. */
export const claimEvents = pgTable(
  "claim_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    actor: text("actor").$type<ClaimActor>().notNull(),
    actorUserId: uuid("actor_user_id"),
    kind: text("kind").$type<ClaimEventKind>().notNull(),
    body: text("body"),
    amountMinor: integer("amount_minor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claim_events_claim_idx").on(t.claimId, t.createdAt)],
);

/** Fotos que sube el cliente (reprocesadas como las del menú, ADR 0017). */
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    imagePath: text("image_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claim_evidence_claim_idx").on(t.claimId)],
);

export type ClaimRow = typeof claims.$inferSelect;
export type ClaimEventRow = typeof claimEvents.$inferSelect;
