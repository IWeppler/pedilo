import {
  bestPromotion,
  type DiscountLine,
  DiscountType,
  discountLabel,
  evaluatePromotion,
  normalizeCouponCode,
  PromotionKind,
  type PromotionRule,
} from "@pedilo/domain";
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { type Actor, recordAudit } from "../audit/service";
import { productIdsOfMerchant } from "../menu/service";
import { getMerchantAccess } from "../merchants/service";
import { type PromotionRow, promotionProducts, promotionRedemptions, promotions } from "./schema";

/**
 * Promociones del comercio (SPEC §12.4, ADR 0030).
 *
 * - El comercio (dueño) crea ofertas automáticas y cupones con código.
 * - El pedido pide `resolveOrderPromotion` (la mejor que aplica) y, en su transacción,
 *   `redeemPromotion` (cupo atómico). Si el pedido no sigue, `reverseOrderPromotion`.
 */

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PromotionDto {
  id: string;
  kind: PromotionKind;
  code: string | null;
  title: string;
  discountType: DiscountType;
  value: number;
  /** «20% off», «$ 2.000 off». */
  label: string;
  /** `null` = todo el menú. */
  productIds: string[] | null;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  redemptionsCount: number;
  active: boolean;
  /** Derivado: vigente ahora (activa, dentro de fechas y con cupo). */
  live: boolean;
  /** En qué está ahora, para el panel. */
  state: "LIVE" | "SCHEDULED" | "PAUSED" | "EXHAUSTED" | "ENDED";
  createdAt: string;
}

/** Lo que ve el cliente de una oferta (los cupones nunca son públicos). */
export interface PublicOfferDto {
  id: string;
  title: string;
  label: string;
  discountType: DiscountType;
  value: number;
  productIds: string[] | null;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  endsAt: string | null;
}

const isLive = (p: PromotionRow, now: Date) =>
  p.active && p.startsAt <= now && (!p.endsAt || p.endsAt > now) && (p.maxRedemptions === null || p.redemptionsCount < p.maxRedemptions);

function stateOf(p: PromotionRow, now: Date): PromotionDto["state"] {
  if (isLive(p, now)) return "LIVE";
  if (!p.active) return "PAUSED";
  if (p.startsAt > now) return "SCHEDULED";
  if (p.maxRedemptions !== null && p.redemptionsCount >= p.maxRedemptions) return "EXHAUSTED";
  return "ENDED";
}

const toRule = (p: PromotionRow, productIds: string[] | null): PromotionRule => ({
  discountType: p.discountType,
  value: p.value,
  productIds,
  minSubtotalMinor: p.minSubtotalMinor,
  maxDiscountMinor: p.maxDiscountMinor,
});

async function productsOf(db: DbOrTx, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(promotionProducts).where(inArray(promotionProducts.promotionId, ids));
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.promotionId, [...(map.get(r.promotionId) ?? []), r.productId]);
  return map;
}

function toDto(p: PromotionRow, productIds: string[] | null, now: Date): PromotionDto {
  return {
    id: p.id,
    kind: p.kind,
    code: p.code,
    title: p.title,
    discountType: p.discountType,
    value: p.value,
    label: discountLabel(p),
    productIds: p.allProducts ? null : (productIds ?? []),
    minSubtotalMinor: p.minSubtotalMinor,
    maxDiscountMinor: p.maxDiscountMinor,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt?.toISOString() ?? null,
    maxRedemptions: p.maxRedemptions,
    perCustomerLimit: p.perCustomerLimit,
    redemptionsCount: p.redemptionsCount,
    active: p.active,
    live: isLive(p, now),
    state: stateOf(p, now),
    createdAt: p.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Comercio
// ---------------------------------------------------------------------------

export interface PromotionInput {
  kind: PromotionKind;
  code?: string | null | undefined;
  title: string;
  discountType: DiscountType;
  value: number;
  productIds?: string[] | null | undefined;
  minSubtotalMinor?: number | undefined;
  maxDiscountMinor?: number | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  maxRedemptions?: number | null | undefined;
  perCustomerLimit?: number | null | undefined;
  active?: boolean | undefined;
}

export async function listMerchantPromotions(db: Db, merchantId: string, userId: string, now = new Date()): Promise<PromotionDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const rows = await db.select().from(promotions).where(eq(promotions.merchantId, merchantId)).orderBy(desc(promotions.createdAt));
  const prods = await productsOf(db, rows.map((r) => r.id));
  return rows.map((r) => toDto(r, prods.get(r.id) ?? null, now));
}

async function validInput(db: DbOrTx, merchantId: string, input: PromotionInput) {
  const code = input.kind === PromotionKind.COUPON ? normalizeCouponCode(input.code ?? "") : null;
  if (input.kind === PromotionKind.COUPON && !/^[A-Z0-9-]{3,20}$/.test(code ?? "")) {
    throw badRequest("El código tiene que tener entre 3 y 20 letras o números", { field: "code" });
  }
  if (input.discountType === DiscountType.PERCENT && (input.value < 1 || input.value > 90)) {
    throw badRequest("El porcentaje tiene que estar entre 1 y 90", { field: "value" });
  }
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (endsAt && endsAt <= startsAt) throw badRequest("La fecha de fin tiene que ser posterior a la de inicio", { field: "endsAt" });
  const productIds = input.productIds ?? null;
  if (productIds) {
    if (productIds.length === 0) throw badRequest("Elegí al menos un producto, o que aplique a todo el menú", { field: "productIds" });
    const own = await productIdsOfMerchant(db, merchantId, productIds);
    if (own.size !== new Set(productIds).size) throw badRequest("Algún producto no es de este comercio", { field: "productIds" });
  }
  return {
    values: {
      kind: input.kind,
      code,
      title: input.title.trim(),
      discountType: input.discountType,
      value: input.value,
      allProducts: productIds === null,
      minSubtotalMinor: input.minSubtotalMinor ?? 0,
      maxDiscountMinor: input.discountType === DiscountType.PERCENT ? (input.maxDiscountMinor ?? null) : null,
      startsAt,
      endsAt,
      maxRedemptions: input.maxRedemptions ?? null,
      perCustomerLimit: input.perCustomerLimit === undefined ? (input.kind === PromotionKind.COUPON ? 1 : null) : input.perCustomerLimit,
      active: input.active ?? true,
    },
    productIds,
  };
}

const duplicateCode = (err: unknown) => {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause ?? (err as { code?: string; constraint_name?: string });
  return cause?.code === "23505";
};

export async function createPromotion(db: Db, merchantId: string, input: PromotionInput, actor: Actor): Promise<PromotionDto> {
  await getMerchantAccess(db, merchantId, actor.userId, { owner: true });
  const { values, productIds } = await validInput(db, merchantId, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(promotions).values({ merchantId, ...values }).returning();
      if (productIds) await tx.insert(promotionProducts).values(productIds.map((productId) => ({ promotionId: row!.id, productId })));
      const dto = toDto(row!, productIds, new Date());
      await recordAudit(tx, actor, { action: "promotion.create", entityType: "promotion", entityId: row!.id, after: dto });
      return dto;
    });
  } catch (err) {
    if (duplicateCode(err)) throw conflict("Ya tenés un cupón con ese código", { reason: "CODE_TAKEN" });
    throw err;
  }
}

/** Editar todo (menos el tipo). Los usos ya hechos no cambian. */
export async function updatePromotion(db: Db, merchantId: string, promotionId: string, input: PromotionInput, actor: Actor): Promise<PromotionDto> {
  await getMerchantAccess(db, merchantId, actor.userId, { owner: true });
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(promotions)
        .where(and(eq(promotions.id, promotionId), eq(promotions.merchantId, merchantId)))
        .for("update");
      if (!current) throw notFound("Promoción");
      if (input.kind !== current.kind) throw badRequest("No se puede cambiar una oferta por un cupón ni al revés", { field: "kind" });
      const { values, productIds } = await validInput(tx, merchantId, input);
      if (values.maxRedemptions !== null && values.maxRedemptions < current.redemptionsCount) {
        throw badRequest(`Ya se usó ${current.redemptionsCount} veces: el cupo no puede ser menor`, { field: "maxRedemptions" });
      }
      const [row] = await tx.update(promotions).set(values).where(eq(promotions.id, promotionId)).returning();
      await tx.delete(promotionProducts).where(eq(promotionProducts.promotionId, promotionId));
      if (productIds) await tx.insert(promotionProducts).values(productIds.map((productId) => ({ promotionId, productId })));
      const before = toDto(current, (await productsOf(tx, [promotionId])).get(promotionId) ?? null, new Date());
      const dto = toDto(row!, productIds, new Date());
      await recordAudit(tx, actor, { action: "promotion.update", entityType: "promotion", entityId: promotionId, before, after: dto });
      return dto;
    });
  } catch (err) {
    if (duplicateCode(err)) throw conflict("Ya tenés un cupón con ese código", { reason: "CODE_TAKEN" });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Público: ofertas vigentes (los cupones no se publican)
// ---------------------------------------------------------------------------

async function liveOffers(db: DbOrTx, merchantIds: string[], now: Date): Promise<Array<{ row: PromotionRow; productIds: string[] | null }>> {
  if (merchantIds.length === 0) return [];
  const rows = await db
    .select()
    .from(promotions)
    .where(
      and(
        inArray(promotions.merchantId, merchantIds),
        eq(promotions.kind, PromotionKind.OFFER),
        eq(promotions.active, true),
        lte(promotions.startsAt, now),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
        or(isNull(promotions.maxRedemptions), sql`${promotions.redemptionsCount} < ${promotions.maxRedemptions}`),
      ),
    )
    .orderBy(asc(promotions.createdAt));
  const prods = await productsOf(db, rows.map((r) => r.id));
  return rows.map((row) => ({ row, productIds: row.allProducts ? null : (prods.get(row.id) ?? []) }));
}

const toPublic = (o: { row: PromotionRow; productIds: string[] | null }): PublicOfferDto => ({
  id: o.row.id,
  title: o.row.title,
  label: discountLabel(o.row),
  discountType: o.row.discountType,
  value: o.row.value,
  productIds: o.productIds,
  minSubtotalMinor: o.row.minSubtotalMinor,
  maxDiscountMinor: o.row.maxDiscountMinor,
  endsAt: o.row.endsAt?.toISOString() ?? null,
});

/** Ofertas vigentes de un comercio (menú público). */
export async function listPublicOffers(db: DbOrTx, merchantId: string, now = new Date()): Promise<PublicOfferDto[]> {
  return (await liveOffers(db, [merchantId], now)).map(toPublic);
}

/**
 * La oferta más llamativa de cada comercio, para el listado y el banner del inicio: el mayor
 * porcentaje, o el mayor monto si no hay porcentajes.
 */
export async function headlineOffers(db: DbOrTx, merchantIds: string[], now = new Date()): Promise<Map<string, PublicOfferDto>> {
  const offers = await liveOffers(db, merchantIds, now);
  const score = (p: PromotionRow) => (p.discountType === DiscountType.PERCENT ? 1_000_000_000 + p.value : p.value);
  const best = new Map<string, { row: PromotionRow; productIds: string[] | null }>();
  for (const o of offers) {
    const cur = best.get(o.row.merchantId);
    if (!cur || score(o.row) > score(cur.row)) best.set(o.row.merchantId, o);
  }
  return new Map([...best].map(([id, o]) => [id, toPublic(o)]));
}

// ---------------------------------------------------------------------------
// Pedido: elegir, canjear y revertir
// ---------------------------------------------------------------------------

export const CouponError = {
  COUPON_INVALID: "COUPON_INVALID",
  COUPON_EXPIRED: "COUPON_EXPIRED",
  COUPON_EXHAUSTED: "COUPON_EXHAUSTED",
  COUPON_ALREADY_USED: "COUPON_ALREADY_USED",
  COUPON_MIN_NOT_MET: "COUPON_MIN_NOT_MET",
  COUPON_NOT_APPLICABLE: "COUPON_NOT_APPLICABLE",
} as const;
export type CouponError = (typeof CouponError)[keyof typeof CouponError];

export interface OrderPromotion {
  promotionId: string;
  kind: PromotionKind;
  label: string;
  title: string;
  code: string | null;
  discountMinor: number;
  perCustomerLimit: number | null;
}

export interface ResolvedPromotion {
  applied: OrderPromotion | null;
  /** Ingresó un cupón válido pero la oferta vigente descuenta más: se aplica la oferta. */
  couponOutdone: boolean;
}

async function customerUses(db: DbOrTx, promotionId: string, userId: string | null): Promise<number> {
  if (!userId) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(promotionRedemptions)
    .where(and(eq(promotionRedemptions.promotionId, promotionId), eq(promotionRedemptions.customerUserId, userId), eq(promotionRedemptions.status, "APPLIED")));
  return row?.n ?? 0;
}

const couponFail = (reason: CouponError, message: string, extra: Record<string, unknown> = {}) => conflict(message, { reason, ...extra });

/**
 * La promo que lleva el pedido: la mejor oferta vigente que aplica, o el cupón si descuenta más.
 * Un cupón inválido es un error (409 con `reason` COUPON_*): el cliente lo saca o lo corrige.
 */
export async function resolveOrderPromotion(
  db: DbOrTx,
  req: { merchantId: string; customerUserId: string | null; lines: DiscountLine[]; couponCode?: string | null | undefined; now?: Date },
): Promise<ResolvedPromotion> {
  const now = req.now ?? new Date();
  const offers = await liveOffers(db, [req.merchantId], now);
  // Ofertas con límite por cliente que ya agotó: no cuentan.
  const usable: Array<{ row: PromotionRow; productIds: string[] | null }> = [];
  for (const o of offers) {
    if (o.row.perCustomerLimit === null || (await customerUses(db, o.row.id, req.customerUserId)) < o.row.perCustomerLimit) usable.push(o);
  }
  const best = bestPromotion(
    usable.map((o) => ({ ...toRule(o.row, o.productIds), source: o.row })),
    req.lines,
  );
  const fromRow = (row: PromotionRow, discountMinor: number): OrderPromotion => ({
    promotionId: row.id,
    kind: row.kind,
    label: discountLabel(row),
    title: row.title,
    code: row.code,
    discountMinor,
    perCustomerLimit: row.perCustomerLimit,
  });
  const offer = best ? fromRow(best.rule.source, best.discountMinor) : null;

  const code = req.couponCode ? normalizeCouponCode(req.couponCode) : "";
  if (!code) return { applied: offer, couponOutdone: false };

  const [coupon] = await db
    .select()
    .from(promotions)
    .where(and(eq(promotions.merchantId, req.merchantId), eq(promotions.kind, PromotionKind.COUPON), eq(promotions.code, code)));
  if (!coupon || !coupon.active || coupon.startsAt > now) throw couponFail(CouponError.COUPON_INVALID, "Ese cupón no existe en este comercio");
  if (coupon.endsAt && coupon.endsAt <= now) throw couponFail(CouponError.COUPON_EXPIRED, "Ese cupón ya venció");
  if (coupon.maxRedemptions !== null && coupon.redemptionsCount >= coupon.maxRedemptions) {
    throw couponFail(CouponError.COUPON_EXHAUSTED, "Ese cupón ya se agotó");
  }
  if (coupon.perCustomerLimit !== null && (await customerUses(db, coupon.id, req.customerUserId)) >= coupon.perCustomerLimit) {
    throw couponFail(CouponError.COUPON_ALREADY_USED, "Ya usaste este cupón");
  }
  const productIds = coupon.allProducts ? null : ((await productsOf(db, [coupon.id])).get(coupon.id) ?? []);
  const result = evaluatePromotion(toRule(coupon, productIds), req.lines);
  if (!result.ok) {
    throw result.reason === "MIN_NOT_MET"
      ? couponFail(CouponError.COUPON_MIN_NOT_MET, "Tu pedido no llega al mínimo de este cupón", { minSubtotalMinor: coupon.minSubtotalMinor })
      : couponFail(CouponError.COUPON_NOT_APPLICABLE, "Este cupón no aplica a los productos de tu pedido");
  }
  if (offer && offer.discountMinor >= result.discountMinor) return { applied: offer, couponOutdone: true };
  return { applied: fromRow(coupon, result.discountMinor), couponOutdone: false };
}

/**
 * Registra el uso en la transacción del pedido. El cupo se controla con un UPDATE condicional: dos
 * pedidos simultáneos no pueden pasarse. El límite por cliente se revisa con la promo bloqueada.
 */
export async function redeemPromotion(tx: Tx, p: OrderPromotion, orderId: string, customerUserId: string | null): Promise<void> {
  await tx.select({ id: promotions.id }).from(promotions).where(eq(promotions.id, p.promotionId)).for("update");
  if (p.perCustomerLimit !== null && (await customerUses(tx, p.promotionId, customerUserId)) >= p.perCustomerLimit) {
    throw p.kind === PromotionKind.COUPON
      ? couponFail(CouponError.COUPON_ALREADY_USED, "Ya usaste este cupón")
      : conflict("Ya usaste esta oferta. Revisá el total y confirmá de nuevo.", { reason: "PROMOTION_UNAVAILABLE" });
  }
  const [taken] = await tx
    .update(promotions)
    .set({ redemptionsCount: sql`${promotions.redemptionsCount} + 1` })
    .where(and(eq(promotions.id, p.promotionId), or(isNull(promotions.maxRedemptions), sql`${promotions.redemptionsCount} < ${promotions.maxRedemptions}`)))
    .returning({ id: promotions.id });
  if (!taken) {
    throw p.kind === PromotionKind.COUPON
      ? couponFail(CouponError.COUPON_EXHAUSTED, "Ese cupón ya se agotó")
      : conflict("La oferta se agotó recién. Revisá el total y confirmá de nuevo.", { reason: "PROMOTION_UNAVAILABLE" });
  }
  await tx.insert(promotionRedemptions).values({ promotionId: p.promotionId, orderId, customerUserId, discountMinor: p.discountMinor });
}

/** El pedido no siguió (cancelado, rechazado, vencido): el uso vuelve al cupo. Idempotente. */
export async function reverseOrderPromotion(tx: Tx, orderId: string, now = new Date()): Promise<void> {
  const [r] = await tx
    .update(promotionRedemptions)
    .set({ status: "REVERSED", reversedAt: now })
    .where(and(eq(promotionRedemptions.orderId, orderId), eq(promotionRedemptions.status, "APPLIED")))
    .returning({ promotionId: promotionRedemptions.promotionId });
  if (r) {
    await tx
      .update(promotions)
      .set({ redemptionsCount: sql`greatest(${promotions.redemptionsCount} - 1, 0)` })
      .where(eq(promotions.id, r.promotionId));
  }
}
