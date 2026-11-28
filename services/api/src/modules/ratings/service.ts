import { canRateUntil, publicRating, type RatingSummary, summarizeRatings } from "@pedilo/domain";
import { desc, eq, inArray } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { conflict, isUniqueViolation } from "../../lib/errors";
import { getMerchantAccess } from "../merchants/service";
import { getRatableOrder } from "../orders/service";
import { merchantRatings } from "./schema";

/**
 * Calificaciones de comercios (SPEC §11.3, ADR 0031). Solo quien hizo el pedido, una vez, dentro
 * del plazo desde la entrega o el retiro.
 */

export interface MyRatingDto {
  orderId: string;
  stars: number;
  createdAt: string;
}

export async function rateOrder(
  db: Db,
  orderId: string,
  userId: string,
  input: { stars: number; comment?: string | null | undefined },
  now = new Date(),
): Promise<MyRatingDto> {
  const order = await getRatableOrder(db, orderId, userId);
  if (now > canRateUntil(order.completedAt)) {
    throw conflict("Pasó el plazo para calificar este pedido", { reason: "RATING_WINDOW_CLOSED" });
  }
  try {
    const [row] = await db
      .insert(merchantRatings)
      .values({
        orderId,
        orderCode: order.code,
        merchantId: order.merchantId,
        customerUserId: userId,
        stars: input.stars,
        comment: input.comment?.trim() || null,
      })
      .returning();
    return { orderId, stars: row!.stars, createdAt: row!.createdAt.toISOString() };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya calificaste este pedido", { reason: "RATING_EXISTS" });
    throw err;
  }
}

/** Las calificaciones que dejó el cliente en estos pedidos (para «Mis pedidos»). */
export async function ratingsForOrders(db: DbOrTx, orderIds: string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select({ orderId: merchantRatings.orderId, stars: merchantRatings.stars })
    .from(merchantRatings)
    .where(inArray(merchantRatings.orderId, orderIds));
  return new Map(rows.map((r) => [r.orderId, r.stars]));
}

/** Promedio público de cada comercio (solo con el mínimo de calificaciones). */
export async function publicRatings(db: DbOrTx, merchantIds: string[]): Promise<Map<string, { average: number; count: number }>> {
  if (merchantIds.length === 0) return new Map();
  const rows = await db
    .select({ merchantId: merchantRatings.merchantId, stars: merchantRatings.stars })
    .from(merchantRatings)
    .where(inArray(merchantRatings.merchantId, merchantIds));
  const out = new Map<string, { average: number; count: number }>();
  for (const id of merchantIds) {
    const pub = publicRating(summarizeRatings(rows.filter((r) => r.merchantId === id).map((r) => r.stars)));
    if (pub) out.set(id, pub);
  }
  return out;
}

export interface MerchantRatingsDto {
  summary: RatingSummary | null;
  /** ¿Ya se muestra en la app? (con el mínimo de calificaciones). */
  public: boolean;
  recent: Array<{ id: string; orderCode: string; stars: number; comment: string | null; createdAt: string }>;
}

/** Para el panel: resumen, si ya es público, y las últimas calificaciones con comentarios. */
export async function listMerchantRatings(db: Db, merchantId: string, userId: string, limit = 50): Promise<MerchantRatingsDto> {
  await getMerchantAccess(db, merchantId, userId);
  const all = await db
    .select()
    .from(merchantRatings)
    .where(eq(merchantRatings.merchantId, merchantId))
    .orderBy(desc(merchantRatings.createdAt));
  const summary = summarizeRatings(all.map((r) => r.stars));
  return {
    summary,
    public: publicRating(summary) !== null,
    recent: all.slice(0, limit).map((r) => ({ id: r.id, orderCode: r.orderCode, stars: r.stars, comment: r.comment, createdAt: r.createdAt.toISOString() })),
  };
}
