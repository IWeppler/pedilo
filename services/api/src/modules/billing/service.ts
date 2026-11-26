import {
  calculateCommission,
  type CommissionBracket,
  type CommissionResult,
  MerchantCategory,
  PlanCode,
  type PricingVersion,
} from "@pedilo/domain";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { badRequest, conflict, isUniqueViolation } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { getCategory } from "../catalog/service";
import { getMerchantAccess, getMerchantCategoryId } from "../merchants/service";
import { accountTotals, listSettlementsOf, type SettlementDto } from "./settlements";
import {
  commissionEntries,
  type CommissionEntryKind,
  type CommissionEntryRow,
  merchantPlans,
  type MerchantPlanRow,
  pricingVersions,
  type PricingVersionRow,
} from "./schema";

/**
 * Planes, comisiones y ledger (SPEC §6, ADR 0012).
 *
 * - El pricing vive en la base como versiones inmutables; rige la última que ya empezó.
 * - Cada comercio tiene un plan con historial; sin plan asignado, Emprendedor.
 * - La comisión se calcula al crear el pedido y queda congelada en él; se devenga en el ledger
 *   cuando el pedido se completa (retirado o entregado).
 */

/** Plan de quien todavía no tiene uno asignado ($0 de mensualidad). */
export const DEFAULT_PLAN: PlanCode = PlanCode.EMPRENDEDOR;
/** Tope para rubros sin categoría de comisión asignada por el admin. */
export const DEFAULT_COMMISSION_CATEGORY: MerchantCategory = MerchantCategory.ENTREPRENEUR;

// ---------------------------------------------------------------------------
// Versiones de pricing
// ---------------------------------------------------------------------------

export interface PricingVersionDto extends Omit<PricingVersion, "brackets"> {
  brackets: CommissionBracket[];
  effectiveFrom: string;
  notes: string | null;
  createdAt: string;
}

function toPricingDto(row: PricingVersionRow): PricingVersionDto {
  return {
    id: row.id,
    brackets: row.brackets,
    capsByCategory: row.capsByCategory,
    plans: row.plans,
    effectiveFrom: row.effectiveFrom.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** La versión vigente en `now`. Siempre hay una: la migración siembra la inicial. */
export async function getActivePricing(db: DbOrTx, now = new Date()): Promise<PricingVersionDto> {
  const [row] = await db
    .select()
    .from(pricingVersions)
    .where(lte(pricingVersions.effectiveFrom, now))
    .orderBy(desc(pricingVersions.effectiveFrom))
    .limit(1);
  if (!row) throw new Error("No hay ninguna versión de pricing vigente");
  return toPricingDto(row);
}

export async function listPricingVersions(db: Db): Promise<PricingVersionDto[]> {
  const rows = await db.select().from(pricingVersions).orderBy(desc(pricingVersions.effectiveFrom));
  return rows.map(toPricingDto);
}

export interface CreatePricingInput extends PricingVersion {
  effectiveFrom: string;
  notes?: string | null | undefined;
}

/**
 * Nueva versión de pricing. Solo hacia adelante (nunca retroactiva): `effectiveFrom` tiene que
 * ser futura. Los tramos se validan con las mismas reglas del cálculo.
 */
export async function createPricingVersion(db: Db, input: CreatePricingInput, actor: Actor, now = new Date()) {
  const effectiveFrom = new Date(input.effectiveFrom);
  if (effectiveFrom.getTime() <= now.getTime()) {
    throw badRequest("La versión nueva tiene que empezar en el futuro: el pricing nunca cambia hacia atrás", {
      field: "effectiveFrom",
    });
  }
  try {
    // Valida tramos (crecientes, último sin límite) con el mismo código que calcula.
    calculateCommission({ basisMinor: 0, baseRateBps: 0, category: DEFAULT_COMMISSION_CATEGORY, pricing: input });
  } catch (err) {
    throw badRequest(`Tramos inválidos: ${(err as Error).message}`, { field: "brackets" });
  }
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pricingVersions)
        .values({
          id: input.id,
          brackets: [...input.brackets],
          capsByCategory: { ...input.capsByCategory },
          plans: { ...input.plans },
          effectiveFrom,
          notes: input.notes?.trim() || null,
          createdBy: actor.userId,
        })
        .returning();
      const dto = toPricingDto(row!);
      await recordAudit(tx, actor, { action: "pricing.create", entityType: "pricing_version", entityId: dto.id, after: dto });
      return dto;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una versión con ese id", { reason: "DUPLICATE_ID" });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Plan del comercio
// ---------------------------------------------------------------------------

async function currentPlanRow(db: DbOrTx, merchantId: string): Promise<MerchantPlanRow | null> {
  const [row] = await db
    .select()
    .from(merchantPlans)
    .where(and(eq(merchantPlans.merchantId, merchantId), isNull(merchantPlans.endsAt)));
  return row ?? null;
}

/**
 * Cambia el plan de un comercio desde ahora (nunca hacia atrás). Los pedidos ya creados
 * conservan la comisión con la que se crearon.
 */
export async function assignMerchantPlan(
  db: Db,
  merchantId: string,
  planCode: PlanCode,
  reason: string | null,
  actor: Actor,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Serializa cambios de plan del mismo comercio.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`plan:${merchantId}`}))`);
    const current = await currentPlanRow(tx, merchantId);
    if ((current?.planCode ?? DEFAULT_PLAN) === planCode && current) return;
    const now = new Date();
    if (current) await tx.update(merchantPlans).set({ endsAt: now }).where(eq(merchantPlans.id, current.id));
    await tx.insert(merchantPlans).values({ merchantId, planCode, startsAt: now, reason, assignedBy: actor.userId });
    await recordAudit(tx, actor, {
      action: "merchant.plan_change",
      entityType: "merchant",
      entityId: merchantId,
      before: { plan: current?.planCode ?? null },
      after: { plan: planCode, reason },
    });
  });
}

// ---------------------------------------------------------------------------
// Comisión de un pedido (snapshot al crear)
// ---------------------------------------------------------------------------

export interface OrderCommission {
  pricingVersionId: string;
  plan: PlanCode;
  category: MerchantCategory;
  basisMinor: number;
  result: CommissionResult;
}

/**
 * Comisión Pedilo de un pedido nuevo: base = subtotal de productos (sin envío; todavía no hay
 * descuentos ni propinas). Plan y pricing vigentes en `now`; tope según el rubro del comercio.
 */
export async function quoteOrderCommission(
  db: DbOrTx,
  merchant: { id: string; categoryId: string },
  basisMinor: number,
  now = new Date(),
): Promise<OrderCommission> {
  const [pricing, planRow, rubro] = await Promise.all([
    getActivePricing(db, now),
    currentPlanRow(db, merchant.id),
    getCategory(db, merchant.categoryId),
  ]);
  const plan = planRow?.planCode ?? DEFAULT_PLAN;
  const category = rubro.commissionCategory ?? DEFAULT_COMMISSION_CATEGORY;
  const result = calculateCommission({ basisMinor, baseRateBps: pricing.plans[plan].baseRateBps, category, pricing });
  return { pricingVersionId: pricing.id, plan, category, basisMinor, result };
}

/**
 * Devenga la comisión de un pedido completado. Idempotente (índice único por pedido): si la
 * transición se reintenta no se duplica. Comisión 0 no genera asiento.
 */
export async function accrueOrderCommission(
  tx: DbOrTx,
  order: { id: string; code: string; merchantId: string; commissionMinor: number | null },
): Promise<void> {
  if (!order.commissionMinor) return;
  await tx
    .insert(commissionEntries)
    .values({
      merchantId: order.merchantId,
      orderId: order.id,
      kind: "ACCRUED",
      amountMinor: order.commissionMinor,
      description: `Comisión pedido ${order.code}`,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Ajustes y estado de cuenta
// ---------------------------------------------------------------------------

/**
 * Devolución acordada en un reclamo (SPEC §8.2.7): asiento compensatorio para que la comisión
 * quede calculada sobre lo que finalmente se vendió. Solo si la comisión ya se había devengado.
 * Se recalcula con la misma versión de pricing, plan y rubro del pedido (nunca con los vigentes).
 */
export async function adjustCommissionForRefund(
  tx: DbOrTx,
  order: {
    id: string;
    code: string;
    merchantId: string;
    commission: { pricingVersionId: string; plan: string; category: string; basisMinor: number; amountMinor: number } | null;
  },
  refundMinor: number,
): Promise<number> {
  const c = order.commission;
  if (!c || refundMinor <= 0) return 0;
  const [accrued] = await tx
    .select({ id: commissionEntries.id })
    .from(commissionEntries)
    .where(and(eq(commissionEntries.orderId, order.id), eq(commissionEntries.kind, "ACCRUED")));
  if (!accrued) return 0;
  const [pricing] = await tx.select().from(pricingVersions).where(eq(pricingVersions.id, c.pricingVersionId));
  if (!pricing) return 0;
  const basis = Math.max(0, c.basisMinor - Math.min(refundMinor, c.basisMinor));
  const recalculated = calculateCommission({
    basisMinor: basis,
    baseRateBps: pricing.plans[c.plan as PlanCode].baseRateBps,
    category: c.category as MerchantCategory,
    pricing: toPricingDto(pricing),
  }).commissionMinor;
  const delta = recalculated - c.amountMinor;
  if (delta === 0) return 0;
  await tx.insert(commissionEntries).values({
    merchantId: order.merchantId,
    orderId: order.id,
    kind: "ADJUSTMENT",
    amountMinor: delta,
    description: `Devolución por reclamo ${order.code}`,
  });
  return delta;
}

/** Corrección manual del admin: asiento compensatorio con motivo (nunca se editan asientos). */
export async function createAdjustment(
  db: Db,
  merchantId: string,
  input: { amountMinor: number; description: string },
  actor: Actor,
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
    throw badRequest("El monto del ajuste no puede ser 0", { field: "amountMinor" });
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(commissionEntries)
      .values({
        merchantId,
        kind: "ADJUSTMENT",
        amountMinor: input.amountMinor,
        description: input.description.trim(),
        createdBy: actor.userId,
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "commission.adjustment",
      entityType: "merchant",
      entityId: merchantId,
      after: { entryId: row!.id, amountMinor: input.amountMinor, description: row!.description },
    });
  });
}

export interface BillingDto {
  plan: {
    code: PlanCode;
    /** null = nunca se asignó (Emprendedor por defecto). */
    since: string | null;
    monthlyFeeMinor: number;
    baseRateBps: number;
    maxBranches: number;
    maxUsers: number;
  };
  category: MerchantCategory;
  /** El rubro no tiene categoría de comisión: se usa el tope por defecto. */
  categoryDefaulted: boolean;
  capMinor: number;
  pricing: PricingVersionDto;
  /** Lo que el comercio debe: asientos − pagos de liquidaciones. */
  balanceMinor: number;
  /** Parte del saldo que todavía no entró en ninguna liquidación (se liquida en el próximo corte). */
  unsettledMinor: number;
  /** Liquidaciones semanales, la más nueva primero (ADR 0013). */
  settlements: SettlementDto[];
  history: Array<{ code: PlanCode; startsAt: string; endsAt: string | null; reason: string | null }>;
  entries: Array<{
    id: string;
    kind: CommissionEntryKind;
    amountMinor: number;
    description: string;
    orderId: string | null;
    createdAt: string;
  }>;
}

const toEntry = (e: CommissionEntryRow) => ({
  id: e.id,
  kind: e.kind,
  amountMinor: e.amountMinor,
  description: e.description,
  orderId: e.orderId,
  createdAt: e.createdAt.toISOString(),
});

async function loadBilling(db: Db, merchantId: string, categoryId: string): Promise<BillingDto> {
  const [pricing, history, rubro, totals, settlementList, entries] = await Promise.all([
    getActivePricing(db),
    db.select().from(merchantPlans).where(eq(merchantPlans.merchantId, merchantId)).orderBy(desc(merchantPlans.startsAt)),
    getCategory(db, categoryId),
    accountTotals(db, merchantId),
    listSettlementsOf(db, merchantId),
    db
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.merchantId, merchantId))
      .orderBy(desc(commissionEntries.createdAt))
      .limit(100),
  ]);
  const current = history.find((h) => h.endsAt === null);
  const code = current?.planCode ?? DEFAULT_PLAN;
  const terms = pricing.plans[code];
  const category = rubro.commissionCategory ?? DEFAULT_COMMISSION_CATEGORY;
  return {
    plan: { code, since: current?.startsAt.toISOString() ?? null, ...terms },
    category,
    categoryDefaulted: rubro.commissionCategory === null,
    capMinor: pricing.capsByCategory[category],
    pricing,
    balanceMinor: totals.balanceMinor,
    unsettledMinor: totals.unsettledMinor,
    settlements: settlementList,
    history: history.map((h) => ({
      code: h.planCode,
      startsAt: h.startsAt.toISOString(),
      endsAt: h.endsAt?.toISOString() ?? null,
      reason: h.reason,
    })),
    entries: entries.map(toEntry),
  };
}

/** Plan, comisiones y estado de cuenta para los miembros del comercio. */
export async function getMerchantBilling(db: Db, merchantId: string, userId: string): Promise<BillingDto> {
  await getMerchantAccess(db, merchantId, userId);
  return loadBilling(db, merchantId, await getMerchantCategoryId(db, merchantId));
}

/** Lo mismo para el admin (sin chequeo de pertenencia: la ruta exige admin). */
export async function getMerchantBillingForAdmin(db: Db, merchantId: string): Promise<BillingDto> {
  return loadBilling(db, merchantId, await getMerchantCategoryId(db, merchantId));
}
