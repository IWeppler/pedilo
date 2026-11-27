import { OrderStatus, type PaymentMethod } from "@pedilo/domain";
import { and, eq, gte, inArray, isNotNull, min } from "drizzle-orm";

import type { DbOrTx } from "../../db/client";
import { commissionEntries } from "../billing/schema";
import { claims } from "../claims/schema";
import { getMerchantAccess } from "../merchants/service";
import { orderEvents, orders } from "../orders/schema";

/**
 * Ganancias del comercio por día (zona horaria de la liquidación). Todo sale de datos que ya
 * existen; no hay tablas propias:
 * - **Ventas**: total (productos + envío) de los pedidos completados (entregados o retirados),
 *   fechados el día en que se completaron.
 * - **Comisión Pedilo**: asientos del ledger (devengos y ajustes, incluidos los de reclamos),
 *   fechados el día del asiento.
 * - **Devoluciones**: lo devuelto en reclamos, el día de la devolución.
 * - **Ganancia neta** = ventas − comisión − devoluciones. No descuenta costos propios ni lo que
 *   se le paga al repartidor (eso vive en la cuenta con cada repartidor, ADR 0016).
 */

const COMPLETED = [OrderStatus.DELIVERED, OrderStatus.PICKED_UP];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EarningsTotals {
  orders: number;
  salesMinor: number;
  deliveryFeesMinor: number;
  commissionMinor: number;
  refundsMinor: number;
  netMinor: number;
  averageTicketMinor: number | null;
}

export interface EarningsDay {
  date: string;
  orders: number;
  salesMinor: number;
  commissionMinor: number;
  refundsMinor: number;
  netMinor: number;
  cumulativeNetMinor: number;
}

export interface EarningsReport {
  from: string;
  to: string;
  timeZone: string;
  totals: EarningsTotals;
  previous: EarningsTotals;
  salesByPaymentMethod: Record<PaymentMethod, number>;
  days: EarningsDay[];
}

export async function merchantEarnings(
  db: DbOrTx,
  merchantId: string,
  userId: string,
  opts: { days: number; timeZone: string; now?: Date },
): Promise<EarningsReport> {
  await getMerchantAccess(db, merchantId, userId);
  return earningsReport(db, merchantId, opts);
}

export async function earningsReport(
  db: DbOrTx,
  merchantId: string,
  { days, timeZone, now = new Date() }: { days: number; timeZone: string; now?: Date },
): Promise<EarningsReport> {
  const localDate = dateFormatter(timeZone);
  const to = localDate(now);
  const from = addDays(to, -(days - 1));
  const previousFrom = addDays(from, -days);
  // Margen de un día para cubrir cualquier diferencia de zona horaria; después se filtra por fecha local.
  const since = new Date(now.getTime() - (2 * days + 1) * DAY_MS);

  const [completedAt, entries, refunds] = await Promise.all([
    db
      .select({ orderId: orderEvents.orderId, at: min(orderEvents.createdAt) })
      .from(orderEvents)
      .innerJoin(orders, eq(orders.id, orderEvents.orderId))
      .where(and(eq(orders.merchantId, merchantId), inArray(orderEvents.toStatus, COMPLETED), gte(orderEvents.createdAt, since)))
      .groupBy(orderEvents.orderId),
    db
      .select({ amountMinor: commissionEntries.amountMinor, at: commissionEntries.createdAt })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.merchantId, merchantId), gte(commissionEntries.createdAt, since))),
    db
      .select({ amountMinor: claims.refundedMinor, at: claims.refundedAt })
      .from(claims)
      .where(and(eq(claims.merchantId, merchantId), isNotNull(claims.refundedAt), gte(claims.refundedAt, since))),
  ]);

  const orderIds = completedAt.map((c) => c.orderId);
  const orderRows = orderIds.length
    ? await db
        .select({
          id: orders.id,
          status: orders.status,
          totalMinor: orders.totalMinor,
          deliveryFeeMinor: orders.deliveryFeeMinor,
          paymentMethod: orders.paymentMethod,
        })
        .from(orders)
        .where(and(inArray(orders.id, orderIds), inArray(orders.status, COMPLETED)))
    : [];
  const orderById = new Map(orderRows.map((o) => [o.id, o]));

  const current = new Map<string, Omit<EarningsDay, "date" | "netMinor" | "cumulativeNetMinor">>();
  for (let d = from; d <= to; d = addDays(d, 1)) current.set(d, { orders: 0, salesMinor: 0, commissionMinor: 0, refundsMinor: 0 });
  const totals = emptyTotals();
  const previous = emptyTotals();
  const salesByPaymentMethod: Record<PaymentMethod, number> = { CASH: 0, TRANSFER: 0, MERCADO_PAGO: 0 };

  // Fecha local de cada movimiento: al período actual, al anterior (para comparar) o afuera.
  const bucket = (at: Date) => {
    const date = localDate(at);
    if (date >= from && date <= to) return { date, period: totals };
    if (date >= previousFrom && date < from) return { date, period: previous };
    return null;
  };

  for (const c of completedAt) {
    const order = orderById.get(c.orderId);
    const b = c.at ? bucket(c.at) : null;
    if (!order || !b) continue;
    b.period.orders += 1;
    b.period.salesMinor += order.totalMinor;
    b.period.deliveryFeesMinor += order.deliveryFeeMinor;
    if (b.period === totals) {
      const day = current.get(b.date)!;
      day.orders += 1;
      day.salesMinor += order.totalMinor;
      salesByPaymentMethod[order.paymentMethod] += order.totalMinor;
    }
  }
  for (const e of entries) {
    const b = bucket(e.at);
    if (!b) continue;
    b.period.commissionMinor += e.amountMinor;
    if (b.period === totals) current.get(b.date)!.commissionMinor += e.amountMinor;
  }
  for (const r of refunds) {
    const b = r.at ? bucket(r.at) : null;
    if (!b) continue;
    b.period.refundsMinor += r.amountMinor ?? 0;
    if (b.period === totals) current.get(b.date)!.refundsMinor += r.amountMinor ?? 0;
  }

  let cumulative = 0;
  const series: EarningsDay[] = [...current.entries()].map(([date, d]) => {
    const netMinor = d.salesMinor - d.commissionMinor - d.refundsMinor;
    cumulative += netMinor;
    return { date, ...d, netMinor, cumulativeNetMinor: cumulative };
  });

  return {
    from,
    to,
    timeZone,
    totals: finish(totals),
    previous: finish(previous),
    salesByPaymentMethod,
    days: series,
  };
}

function emptyTotals(): EarningsTotals {
  return { orders: 0, salesMinor: 0, deliveryFeesMinor: 0, commissionMinor: 0, refundsMinor: 0, netMinor: 0, averageTicketMinor: null };
}

function finish(t: EarningsTotals): EarningsTotals {
  return {
    ...t,
    netMinor: t.salesMinor - t.commissionMinor - t.refundsMinor,
    averageTicketMinor: t.orders > 0 ? Math.round(t.salesMinor / t.orders) : null,
  };
}

/** Fecha local `YYYY-MM-DD` de un instante en la zona horaria dada. */
function dateFormatter(timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at: Date) => fmt.format(at);
}

/** Suma días a una fecha `YYYY-MM-DD` (aritmética de calendario, sin zona horaria). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
