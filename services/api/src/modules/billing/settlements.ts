import { lastWeeklyCutoff, settlementStatus, type SettlementStatus } from "@pedilo/domain";
import { and, asc, desc, eq, inArray, isNull, lt, sql, sum } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { getMerchantAccess, getMerchantNames } from "../merchants/service";
import {
  commissionEntries,
  settlementAllocations,
  type SettlementPaymentMethod,
  type SettlementPaymentRow,
  settlementPayments,
  type SettlementRow,
  settlements,
} from "./schema";

/**
 * Liquidación semanal de comisiones (SPEC §8.4, ADR 0013).
 *
 * - Cada lunes 00:00 (zona de liquidación) se cierra la semana: por comercio, los asientos todavía
 *   no liquidados creados antes del corte forman una liquidación con vencimiento.
 * - Si el saldo de esos asientos es ≤ 0 (créditos), no se emite: pasan a la semana siguiente.
 * - Los pagos los registra el admin, parciales o totales, nunca por más de lo adeudado.
 * - Todo es append-only: el estado sale de los pagos y del vencimiento.
 */

export interface SettlementConfig {
  timeZone: string;
  dueDays: number;
}

export const DEFAULT_SETTLEMENT_CONFIG: SettlementConfig = { timeZone: "America/Argentina/Buenos_Aires", dueDays: 7 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Asientos de un comercio que todavía no entraron en ninguna liquidación, creados antes de `before`. */
function unsettledEntries(db: DbOrTx, merchantId: string, before?: Date) {
  return db
    .select({ id: commissionEntries.id, amountMinor: commissionEntries.amountMinor })
    .from(commissionEntries)
    .leftJoin(settlementAllocations, eq(settlementAllocations.entryId, commissionEntries.id))
    .where(
      and(
        eq(commissionEntries.merchantId, merchantId),
        isNull(settlementAllocations.entryId),
        before ? lt(commissionEntries.createdAt, before) : undefined,
      ),
    );
}

/**
 * Cierra la última semana completa. Idempotente (una liquidación por comercio y corte) y seguro
 * con varias instancias (lock por comercio). Devuelve cuántas liquidaciones emitió.
 */
export async function closeSettlementWeek(
  db: Db,
  opts: { now?: Date; config?: SettlementConfig; actorUserId?: string | null } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const config = opts.config ?? DEFAULT_SETTLEMENT_CONFIG;
  const periodEnd = lastWeeklyCutoff(now, config.timeZone);
  const periodStart = new Date(periodEnd.getTime() - 7 * DAY_MS);
  const dueAt = new Date(periodEnd.getTime() + config.dueDays * DAY_MS);

  // Candidatos: comercios con asientos sin liquidar anteriores al corte, sin liquidación de este corte.
  const candidates = await db
    .select({ merchantId: commissionEntries.merchantId })
    .from(commissionEntries)
    .leftJoin(settlementAllocations, eq(settlementAllocations.entryId, commissionEntries.id))
    .where(
      and(
        isNull(settlementAllocations.entryId),
        lt(commissionEntries.createdAt, periodEnd),
        sql`not exists (select 1 from settlements s where s.merchant_id = ${commissionEntries.merchantId} and s.period_end = ${periodEnd})`,
      ),
    )
    .groupBy(commissionEntries.merchantId)
    .having(sql`sum(${commissionEntries.amountMinor}) > 0`);

  let created = 0;
  for (const { merchantId } of candidates) {
    try {
      const ok = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settle:${merchantId}`}))`);
        const entries = await unsettledEntries(tx, merchantId, periodEnd);
        const total = entries.reduce((s, e) => s + e.amountMinor, 0);
        if (entries.length === 0 || total <= 0) return false;
        const [row] = await tx
          .insert(settlements)
          .values({
            merchantId,
            periodStart,
            periodEnd,
            totalMinor: total,
            entryCount: entries.length,
            dueAt,
            createdBy: opts.actorUserId ?? null,
          })
          .returning({ id: settlements.id });
        await tx.insert(settlementAllocations).values(entries.map((e) => ({ settlementId: row!.id, entryId: e.id })));
        return true;
      });
      if (ok) created++;
    } catch (err) {
      // Otra instancia emitió la misma liquidación: no es un error.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

export interface PaymentInput {
  amountMinor: number;
  method: SettlementPaymentMethod;
  reference?: string | null | undefined;
  paidAt?: string | undefined;
}

/** Registra un pago del comercio. Parcial o total; nunca por más de lo pendiente. */
export async function recordSettlementPayment(
  db: Db,
  settlementId: string,
  input: PaymentInput,
  actor: Actor,
  now = new Date(),
): Promise<SettlementDetailDto> {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(settlements).where(eq(settlements.id, settlementId)).for("update");
    if (!s) throw notFound("Liquidación");
    const [paid] = await tx
      .select({ n: sum(settlementPayments.amountMinor).mapWith(Number) })
      .from(settlementPayments)
      .where(eq(settlementPayments.settlementId, settlementId));
    const outstanding = s.totalMinor - (paid?.n ?? 0);
    if (outstanding <= 0) throw conflict("La liquidación ya está pagada", { reason: "ALREADY_PAID" });
    if (input.amountMinor > outstanding) {
      throw conflict("El pago supera lo que falta pagar", { reason: "OVERPAYMENT", outstandingMinor: outstanding });
    }
    const paidAt = input.paidAt ? new Date(input.paidAt) : now;
    const [row] = await tx
      .insert(settlementPayments)
      .values({
        settlementId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference?.trim() || null,
        paidAt,
        createdBy: actor.userId,
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "settlement.payment",
      entityType: "settlement",
      entityId: settlementId,
      after: { paymentId: row!.id, amountMinor: input.amountMinor, method: input.method, outstandingBefore: outstanding },
    });
  });
  return getSettlement(db, settlementId, now);
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export interface SettlementDto {
  id: string;
  merchant: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  entryCount: number;
  dueAt: string;
  status: SettlementStatus;
  createdAt: string;
}

export interface SettlementDetailDto extends SettlementDto {
  payments: Array<{ id: string; amountMinor: number; method: SettlementPaymentMethod; reference: string | null; paidAt: string; createdAt: string }>;
  entries: Array<{ id: string; kind: string; amountMinor: number; description: string; orderId: string | null; createdAt: string }>;
}

async function toDtos(db: DbOrTx, rows: SettlementRow[], now: Date): Promise<SettlementDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [paidRows, names] = await Promise.all([
    db
      .select({ id: settlementPayments.settlementId, n: sum(settlementPayments.amountMinor).mapWith(Number) })
      .from(settlementPayments)
      .where(inArray(settlementPayments.settlementId, ids))
      .groupBy(settlementPayments.settlementId),
    getMerchantNames(db, [...new Set(rows.map((r) => r.merchantId))]),
  ]);
  const paid = new Map(paidRows.map((p) => [p.id, p.n]));
  return rows.map((r) => {
    const paidMinor = paid.get(r.id) ?? 0;
    return {
      id: r.id,
      merchant: { id: r.merchantId, name: names.get(r.merchantId) ?? "—" },
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      totalMinor: r.totalMinor,
      paidMinor,
      outstandingMinor: r.totalMinor - paidMinor,
      entryCount: r.entryCount,
      dueAt: r.dueAt.toISOString(),
      status: settlementStatus({ totalMinor: r.totalMinor, paidMinor, dueAt: r.dueAt }, now),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

const toPayment = (p: SettlementPaymentRow) => ({
  id: p.id,
  amountMinor: p.amountMinor,
  method: p.method,
  reference: p.reference,
  paidAt: p.paidAt.toISOString(),
  createdAt: p.createdAt.toISOString(),
});

async function getSettlement(db: Db, id: string, now: Date): Promise<SettlementDetailDto> {
  const [row] = await db.select().from(settlements).where(eq(settlements.id, id));
  if (!row) throw notFound("Liquidación");
  const [[dto], payments, entries] = await Promise.all([
    toDtos(db, [row], now),
    db.select().from(settlementPayments).where(eq(settlementPayments.settlementId, id)).orderBy(asc(settlementPayments.paidAt)),
    db
      .select({
        id: commissionEntries.id,
        kind: commissionEntries.kind,
        amountMinor: commissionEntries.amountMinor,
        description: commissionEntries.description,
        orderId: commissionEntries.orderId,
        createdAt: commissionEntries.createdAt,
      })
      .from(settlementAllocations)
      .innerJoin(commissionEntries, eq(commissionEntries.id, settlementAllocations.entryId))
      .where(eq(settlementAllocations.settlementId, id))
      .orderBy(asc(commissionEntries.createdAt)),
  ]);
  return {
    ...dto!,
    payments: payments.map(toPayment),
    entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}

export const getSettlementForAdmin = (db: Db, id: string, now = new Date()) => getSettlement(db, id, now);

/** Detalle para un miembro del comercio: 404 si la liquidación es de otro comercio. */
export async function getSettlementForMerchant(db: Db, merchantId: string, id: string, userId: string, now = new Date()) {
  await getMerchantAccess(db, merchantId, userId);
  const detail = await getSettlement(db, id, now);
  if (detail.merchant.id !== merchantId) throw notFound("Liquidación");
  return detail;
}

/** Liquidaciones de un comercio, la más nueva primero (sin chequeo de pertenencia). */
export async function listSettlementsOf(db: DbOrTx, merchantId: string, now = new Date(), limit = 52): Promise<SettlementDto[]> {
  const rows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.merchantId, merchantId))
    .orderBy(desc(settlements.periodEnd))
    .limit(limit);
  return toDtos(db, rows, now);
}

/** Todas las liquidaciones para el admin, filtrables por estado. Vencidas primero. */
export async function listSettlementsForAdmin(db: Db, status: SettlementStatus | undefined, now = new Date()): Promise<SettlementDto[]> {
  const rows = await db.select().from(settlements).orderBy(desc(settlements.periodEnd), asc(settlements.dueAt)).limit(500);
  const dtos = await toDtos(db, rows, now);
  const order: Record<SettlementStatus, number> = { OVERDUE: 0, PARTIALLY_PAID: 1, PENDING: 2, PAID: 3 };
  return dtos.filter((d) => !status || d.status === status).sort((a, b) => order[a.status] - order[b.status]);
}

/** Totales de la cuenta del comercio: adeudado (asientos − pagos) y lo que todavía no se liquidó. */
export async function accountTotals(db: DbOrTx, merchantId: string): Promise<{ balanceMinor: number; unsettledMinor: number }> {
  const [[entries], [payments], unsettled] = await Promise.all([
    db.select({ n: sum(commissionEntries.amountMinor).mapWith(Number) }).from(commissionEntries).where(eq(commissionEntries.merchantId, merchantId)),
    db
      .select({ n: sum(settlementPayments.amountMinor).mapWith(Number) })
      .from(settlementPayments)
      .innerJoin(settlements, eq(settlements.id, settlementPayments.settlementId))
      .where(eq(settlements.merchantId, merchantId)),
    unsettledEntries(db, merchantId),
  ]);
  return {
    balanceMinor: (entries?.n ?? 0) - (payments?.n ?? 0),
    unsettledMinor: unsettled.reduce((s, e) => s + e.amountMinor, 0),
  };
}
