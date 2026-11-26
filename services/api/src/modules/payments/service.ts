import { randomBytes } from "node:crypto";

import { OrderStatus, PaymentMethod, PaymentStatus } from "@pedilo/domain";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, isUniqueViolation } from "../../lib/errors";
import type { SecretBox } from "../../lib/secret-box";
import { type Actor, recordAudit } from "../audit/service";
import { getMerchantAccess, setAcceptsMercadoPago } from "../merchants/service";
import { getOrderClaimSummary, getOrderClaimSummaryForCustomer, markOrderPaid, setOrderPaymentStatus } from "../orders/service";
import { GatewayError, type PaymentGateway, type ProviderPayment } from "./gateway";
import {
  merchantMpAccounts,
  type MerchantMpAccountRow,
  mpOauthStates,
  mpWebhookEvents,
  type PaymentRow,
  payments,
  refunds,
  type RefundRow,
} from "./schema";

/**
 * Pagos con Mercado Pago, Split 1:1 (SPEC §8.1, ADR 0021).
 *
 * - El comercio conecta su cuenta por OAuth; sus tokens se guardan cifrados y se renuevan.
 * - Se cobra con el token del comercio y la comisión de Pedilo como `application_fee`, todo
 *   calculado en el servidor desde el pedido (nunca desde el navegador).
 * - El pedido pasa a «esperando confirmación» solo con el pago aprobado por el proveedor.
 * - Los reembolsos se encolan en la transacción del hecho y un worker los manda; hasta que el
 *   proveedor confirma no hay éxito (SPEC §8.2).
 */

export interface PaymentsContext {
  gateway: PaymentGateway;
  box: SecretBox;
  publicKey: string;
  /** URL pública del webhook (null en local sin túnel: se confirma por consulta). */
  notificationUrl: string | null;
  acceptTimeoutMs?: number;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Se renueva el token del comercio si vence en menos de esto. */
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/** Estado del proveedor → estado de pago de Pedilo. */
export function mapProviderStatus(status: string): PaymentStatus {
  switch (status) {
    case "approved":
      return PaymentStatus.APPROVED;
    case "rejected":
      return PaymentStatus.REJECTED;
    case "cancelled":
      return PaymentStatus.CANCELLED;
    case "refunded":
      return PaymentStatus.REFUNDED;
    case "charged_back":
      return PaymentStatus.CHARGEBACK;
    default:
      // pending, in_process, authorized, in_mediation…
      return PaymentStatus.PENDING;
  }
}

const toPesos = (minor: number) => Math.round(minor) / 100;

// ---------------------------------------------------------------------------
// Conexión del comercio (OAuth)
// ---------------------------------------------------------------------------

/** Solo el dueño conecta la cuenta. Devuelve la URL de autorización de Mercado Pago. */
export async function startConnection(db: Db, ctx: PaymentsContext, merchantId: string, userId: string, now = new Date()) {
  await getMerchantAccess(db, merchantId, userId, { owner: true });
  const state = randomBytes(32).toString("base64url");
  await db.insert(mpOauthStates).values({ state, merchantId, userId, expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS) });
  return { url: ctx.gateway.authorizationUrl(state) };
}

/**
 * Callback del OAuth: consume el `state` una sola vez (dentro de una transacción con lock),
 * canjea el código y guarda los tokens cifrados. Devuelve el comercio para volver al panel.
 */
export async function completeConnection(
  db: Db,
  ctx: PaymentsContext,
  input: { state?: string | undefined; code?: string | undefined; error?: string | undefined },
  now = new Date(),
): Promise<{ merchantId: string | null; ok: boolean; reason?: string }> {
  if (!input.state) return { merchantId: null, ok: false, reason: "missing_state" };
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(mpOauthStates).where(eq(mpOauthStates.state, input.state!)).for("update");
    if (!row || row.usedAt || row.expiresAt.getTime() < now.getTime()) return null;
    await tx.update(mpOauthStates).set({ usedAt: now }).where(eq(mpOauthStates.id, row.id));
    return row;
  });
  if (!claimed) return { merchantId: null, ok: false, reason: "invalid_state" };
  if (input.error || !input.code) return { merchantId: claimed.merchantId, ok: false, reason: input.error ?? "missing_code" };

  let tokens;
  try {
    tokens = await ctx.gateway.exchangeCode(input.code);
  } catch {
    return { merchantId: claimed.merchantId, ok: false, reason: "exchange_failed" };
  }
  await db.transaction(async (tx) => {
    const values = {
      merchantId: claimed.merchantId,
      mpUserId: tokens.userId,
      accessTokenEnc: ctx.box.seal(tokens.accessToken),
      refreshTokenEnc: ctx.box.seal(tokens.refreshToken),
      expiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
      liveMode: tokens.liveMode,
      scope: tokens.scope,
      status: "CONNECTED" as const,
      connectedBy: claimed.userId,
      lastError: null,
    };
    await tx.insert(merchantMpAccounts).values(values).onConflictDoUpdate({ target: merchantMpAccounts.merchantId, set: values });
    await setAcceptsMercadoPago(tx, claimed.merchantId, true);
    await recordAudit(tx, { userId: claimed.userId, requestId: "mp-oauth" }, {
      action: "merchant.mercadopago_connect",
      entityType: "merchant",
      entityId: claimed.merchantId,
      after: { mpUserId: tokens.userId, liveMode: tokens.liveMode },
    });
  });
  return { merchantId: claimed.merchantId, ok: true };
}

export interface MpConnectionDto {
  connected: boolean;
  status: "CONNECTED" | "NEEDS_REAUTH" | null;
  mpUserId: string | null;
  liveMode: boolean | null;
  connectedAt: string | null;
}

export async function getConnection(db: Db, merchantId: string, userId: string): Promise<MpConnectionDto> {
  await getMerchantAccess(db, merchantId, userId);
  const [row] = await db.select().from(merchantMpAccounts).where(eq(merchantMpAccounts.merchantId, merchantId));
  return {
    connected: row?.status === "CONNECTED",
    status: row?.status ?? null,
    mpUserId: row?.mpUserId ?? null,
    liveMode: row?.liveMode ?? null,
    connectedAt: row?.createdAt.toISOString() ?? null,
  };
}

/** Desconectar: se borran los tokens y deja de ofrecerse la tarjeta. Los pagos hechos siguen. */
export async function disconnect(db: Db, merchantId: string, actor: Actor): Promise<MpConnectionDto> {
  await getMerchantAccess(db, merchantId, actor.userId, { owner: true });
  await db.transaction(async (tx) => {
    await tx.delete(merchantMpAccounts).where(eq(merchantMpAccounts.merchantId, merchantId));
    await setAcceptsMercadoPago(tx, merchantId, false);
    await recordAudit(tx, actor, { action: "merchant.mercadopago_disconnect", entityType: "merchant", entityId: merchantId });
  });
  return getConnection(db, merchantId, actor.userId);
}

/**
 * Token vigente del comercio. Si vence pronto se renueva y se guardan los DOS tokens nuevos
 * (la renovación puede rotar el refresh token). Si falla, la conexión queda para reautorizar:
 * nunca se usa el token de Pedilo en su lugar.
 */
async function sellerToken(db: Db, ctx: PaymentsContext, merchantId: string, now = new Date()): Promise<{ token: string; account: MerchantMpAccountRow }> {
  const [account] = await db.select().from(merchantMpAccounts).where(eq(merchantMpAccounts.merchantId, merchantId));
  if (!account || account.status !== "CONNECTED") {
    throw conflict("El comercio no tiene Mercado Pago conectado", { reason: "MP_NOT_CONNECTED" });
  }
  if (account.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    return { token: ctx.box.open(account.accessTokenEnc), account };
  }
  try {
    const tokens = await ctx.gateway.refresh(ctx.box.open(account.refreshTokenEnc));
    const [updated] = await db
      .update(merchantMpAccounts)
      .set({
        accessTokenEnc: ctx.box.seal(tokens.accessToken),
        refreshTokenEnc: ctx.box.seal(tokens.refreshToken),
        expiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
        lastError: null,
      })
      .where(and(eq(merchantMpAccounts.id, account.id), eq(merchantMpAccounts.refreshTokenEnc, account.refreshTokenEnc)))
      .returning();
    if (!updated) return sellerToken(db, ctx, merchantId, now); // otra instancia lo renovó primero
    return { token: tokens.accessToken, account: updated };
  } catch (err) {
    await db
      .update(merchantMpAccounts)
      .set({ status: "NEEDS_REAUTH", lastError: err instanceof Error ? err.message.slice(0, 300) : "refresh" })
      .where(eq(merchantMpAccounts.id, account.id));
    await setAcceptsMercadoPago(db, merchantId, false);
    throw conflict("La conexión del comercio con Mercado Pago venció: tiene que volver a conectarla", { reason: "MP_NEEDS_REAUTH" });
  }
}

// ---------------------------------------------------------------------------
// Cobro (cliente, con el token de seguimiento)
// ---------------------------------------------------------------------------

export interface CardPaymentInput {
  token: string;
  paymentMethodId: string;
  issuerId?: string | null | undefined;
  payer: { email: string; identification: { type: string; number: string } };
}

export interface PaymentResultDto {
  status: PaymentStatus;
  providerStatus: string | null;
  statusDetail: string | null;
  orderStatus: OrderStatus;
}

/**
 * Cobra un pedido con tarjeta. Monto, comisión y comercio salen del pedido (snapshot del
 * servidor). `idempotencyKey` lo genera la pantalla de pago por intento: un doble toque o un
 * reintento de red con la misma clave no cobra dos veces.
 */
export async function payOrder(
  db: Db,
  ctx: PaymentsContext,
  orderId: string,
  trackingToken: string | undefined,
  secret: string,
  input: CardPaymentInput,
  idempotencyKey: string,
): Promise<PaymentResultDto> {
  const order = await getOrderClaimSummaryForCustomer(db, orderId, trackingToken, secret);
  const [existing] = await db.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
  if (existing) return resultOf(db, existing);

  if (order.paymentMethod !== PaymentMethod.MERCADO_PAGO) throw conflict("Este pedido no se paga con tarjeta", { reason: "NOT_CARD_ORDER" });
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw conflict("Este pedido ya no está esperando el pago", { reason: "NOT_PAYABLE", status: order.status });
  }
  const [inFlight] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), inArray(payments.status, [PaymentStatus.APPROVED, PaymentStatus.PENDING])));
  if (inFlight) throw conflict("Ya hay un pago en curso o aprobado para este pedido", { reason: "PAYMENT_IN_PROGRESS" });

  // Comisión del pedido (snapshot, ADR 0012). Nunca igual o mayor al total.
  const fee = Math.max(0, Math.min(order.commission?.amountMinor ?? 0, order.totalMinor - 1));
  const { token: sellerAccess } = await sellerToken(db, ctx, order.merchantId);

  let row: PaymentRow;
  try {
    [row] = (await db
      .insert(payments)
      .values({
        orderId,
        merchantId: order.merchantId,
        status: PaymentStatus.PENDING,
        amountMinor: order.totalMinor,
        applicationFeeMinor: fee,
        idempotencyKey,
      })
      .returning()) as [PaymentRow];
  } catch (err) {
    if (isUniqueViolation(err)) {
      const [winner] = await db.select().from(payments).where(eq(payments.idempotencyKey, idempotencyKey));
      if (winner) return resultOf(db, winner);
    }
    throw err;
  }

  let provider: ProviderPayment;
  try {
    provider = await ctx.gateway.createPayment(
      sellerAccess,
      {
        transactionAmount: toPesos(order.totalMinor),
        applicationFee: toPesos(fee),
        token: input.token,
        paymentMethodId: input.paymentMethodId,
        issuerId: input.issuerId ?? null,
        installments: 1,
        payer: input.payer,
        description: `Pedido ${order.code} en Pedilo`,
        externalReference: orderId,
        notificationUrl: ctx.notificationUrl,
      },
      idempotencyKey,
    );
  } catch (err) {
    const message = err instanceof GatewayError ? err.message : "Error de conexión con Mercado Pago";
    await db
      .update(payments)
      .set({ status: PaymentStatus.REJECTED, providerStatus: "error", providerStatusDetail: message.slice(0, 200) })
      .where(eq(payments.id, row.id));
    throw conflict("No pudimos procesar el pago. Revisá los datos de la tarjeta o probá con otra.", { reason: "PAYMENT_FAILED" });
  }
  return applyProviderPayment(db, ctx, row.id, provider);
}

/** Aplica el estado del proveedor al intento y, si se aprobó, al pedido. Idempotente. */
async function applyProviderPayment(db: Db, ctx: PaymentsContext, paymentRowId: string, provider: ProviderPayment): Promise<PaymentResultDto> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, paymentRowId)).for("update");
    if (!row) return;
    const status = mapProviderStatus(provider.status);
    await tx
      .update(payments)
      .set({ providerPaymentId: provider.id, status, providerStatus: provider.status, providerStatusDetail: provider.statusDetail })
      .where(eq(payments.id, row.id));
    if (status === PaymentStatus.APPROVED) {
      await markOrderPaid(tx, row.orderId, { ...(ctx.acceptTimeoutMs !== undefined && { acceptTimeoutMs: ctx.acceptTimeoutMs }) });
    }
  });
  const [fresh] = await db.select().from(payments).where(eq(payments.id, paymentRowId));
  return resultOf(db, fresh!);
}

async function resultOf(db: DbOrTx, row: PaymentRow): Promise<PaymentResultDto> {
  const order = await getOrderClaimSummary(db, row.orderId);
  return { status: row.status, providerStatus: row.providerStatus, statusDetail: row.providerStatusDetail, orderStatus: order.status };
}

/**
 * Estado del pago del pedido para la pantalla de seguimiento. Si el último intento sigue en curso,
 * se consulta al proveedor (los pagos de prueba no mandan webhooks).
 */
export async function getOrderPayment(
  db: Db,
  ctx: PaymentsContext,
  orderId: string,
  trackingToken: string | undefined,
  secret: string,
): Promise<PaymentResultDto | null> {
  await getOrderClaimSummaryForCustomer(db, orderId, trackingToken, secret);
  const [last] = await db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt)).limit(1);
  if (!last) return null;
  if (last.status === PaymentStatus.PENDING && last.providerPaymentId) return syncPayment(db, ctx, last);
  return resultOf(db, last);
}

async function syncPayment(db: Db, ctx: PaymentsContext, row: PaymentRow): Promise<PaymentResultDto> {
  try {
    const { token } = await sellerToken(db, ctx, row.merchantId);
    return await applyProviderPayment(db, ctx, row.id, await ctx.gateway.getPayment(token, row.providerPaymentId!));
  } catch {
    return resultOf(db, row);
  }
}

// ---------------------------------------------------------------------------
// Webhook (firmado; la firma se valida en la ruta)
// ---------------------------------------------------------------------------

/**
 * Aviso de Mercado Pago ya validado. Se registra (deduplicado por `x-request-id`) y se vuelve a
 * consultar el pago al proveedor: el contenido del aviso nunca se toma como verdad.
 */
export async function handleWebhook(
  db: Db,
  ctx: PaymentsContext,
  n: { requestId: string; topic: string; dataId: string; mpUserId: string | null },
): Promise<void> {
  try {
    await db.insert(mpWebhookEvents).values({ requestId: n.requestId, topic: n.topic, dataId: n.dataId, mpUserId: n.mpUserId });
  } catch (err) {
    if (isUniqueViolation(err)) return; // ya procesado
    throw err;
  }
  let error: string | null = null;
  if (n.topic === "payment") {
    const [row] = await db.select().from(payments).where(eq(payments.providerPaymentId, n.dataId));
    if (row) await syncPayment(db, ctx, row);
    else error = "Pago desconocido";
  }
  await db
    .update(mpWebhookEvents)
    .set({ processedAt: new Date(), error })
    .where(eq(mpWebhookEvents.requestId, n.requestId));
}

// ---------------------------------------------------------------------------
// Reembolsos (SPEC §8.2)
// ---------------------------------------------------------------------------

export interface RefundSettledEvent {
  refundId: string;
  orderId: string;
  claimId: string | null;
  ok: boolean;
  amountMinor: number;
  error: string | null;
}
export type RefundSettledListener = (tx: Tx, event: RefundSettledEvent) => Promise<void>;
const refundListeners = new Set<RefundSettledListener>();

/** Reclamos se suscribe para resolverse cuando el proveedor confirma (lo conecta app.ts). */
export function onRefundSettled(listener: RefundSettledListener): void {
  refundListeners.add(listener);
}

/**
 * Encola un reembolso del pago aprobado del pedido (null = total). En la transacción del hecho;
 * lo manda `processRefunds`. Nunca más que lo que queda por devolver.
 */
export async function requestRefund(
  tx: Tx,
  input: { orderId: string; amountMinor: number | null; reason: string; claimId?: string | null },
): Promise<string> {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, input.orderId), eq(payments.status, PaymentStatus.APPROVED)))
    .orderBy(desc(payments.createdAt))
    .limit(1)
    .for("update");
  if (!payment) throw conflict("El pedido no tiene un pago con tarjeta aprobado para devolver", { reason: "NO_APPROVED_PAYMENT" });
  const left = payment.amountMinor - payment.refundedMinor;
  if (input.amountMinor !== null && (input.amountMinor <= 0 || input.amountMinor > left)) {
    throw badRequest("El monto a devolver supera lo que queda del pago", { field: "amountMinor", leftMinor: left });
  }
  const [row] = await tx
    .insert(refunds)
    .values({
      paymentId: payment.id,
      orderId: input.orderId,
      claimId: input.claimId ?? null,
      amountMinor: input.amountMinor === left ? null : input.amountMinor,
      reason: input.reason,
      idempotencyKey: `refund-${randomBytes(16).toString("hex")}`,
    })
    .returning({ id: refunds.id });
  return row!.id;
}

export const MAX_REFUND_ATTEMPTS = 5;
const refundBackoffMs = (attempts: number) => Math.min(60_000 * 2 ** (attempts - 1), 30 * 60 * 1000);

/**
 * Manda los reembolsos pendientes. Errores permanentes del proveedor (p. ej. saldo insuficiente
 * del comercio) → FAILED y el pago queda en REFUND_BLOCKED: nunca un éxito falso (SPEC §8.2.6).
 * Errores transitorios → reintento con espera; tras el máximo, FAILED.
 */
export async function processRefunds(db: Db, ctx: PaymentsContext, now = new Date(), batch = 10): Promise<number> {
  const due: RefundRow[] = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(refunds)
      .where(and(eq(refunds.status, "PENDING"), lte(refunds.nextAttemptAt, now)))
      .orderBy(asc(refunds.nextAttemptAt))
      .limit(batch)
      .for("update", { skipLocked: true });
    if (rows.length) {
      await tx
        .update(refunds)
        .set({ nextAttemptAt: new Date(now.getTime() + 2 * 60 * 1000), attempts: sql`${refunds.attempts} + 1` })
        .where(inArray(refunds.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  for (const r of due) {
    const [payment] = await db.select().from(payments).where(eq(payments.id, r.paymentId));
    const attempts = r.attempts + 1;
    let ok = false;
    let error: string | null = null;
    let providerRefundId: string | null = null;
    let permanent = false;
    try {
      const { token } = await sellerToken(db, ctx, payment!.merchantId, now);
      const res = await ctx.gateway.refund(token, payment!.providerPaymentId!, r.amountMinor === null ? null : toPesos(r.amountMinor), r.idempotencyKey);
      ok = res.status === "approved";
      providerRefundId = res.id;
      if (!ok) error = `Reembolso en estado ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      permanent = (err instanceof GatewayError && err.permanent) || (err as { details?: { reason?: string } }).details?.reason === "MP_NEEDS_REAUTH";
    }

    if (!ok && !permanent && attempts < MAX_REFUND_ATTEMPTS) {
      await db
        .update(refunds)
        .set({ nextAttemptAt: new Date(now.getTime() + refundBackoffMs(attempts)), lastError: error?.slice(0, 300) })
        .where(eq(refunds.id, r.id));
      continue;
    }

    await db.transaction(async (tx) => {
      const amount = r.amountMinor ?? payment!.amountMinor - payment!.refundedMinor;
      await tx
        .update(refunds)
        .set({ status: ok ? "APPROVED" : "FAILED", providerRefundId, lastError: ok ? null : error?.slice(0, 300) })
        .where(eq(refunds.id, r.id));
      let orderPaymentStatus: PaymentStatus = PaymentStatus.REFUND_BLOCKED;
      if (ok) {
        const refunded = payment!.refundedMinor + amount;
        const full = refunded >= payment!.amountMinor;
        await tx
          .update(payments)
          .set({ refundedMinor: refunded, status: full ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED })
          .where(eq(payments.id, payment!.id));
        orderPaymentStatus = full ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
      }
      await setOrderPaymentStatus(tx, r.orderId, orderPaymentStatus);
      for (const listener of refundListeners) {
        await listener(tx, { refundId: r.id, orderId: r.orderId, claimId: r.claimId, ok, amountMinor: amount, error });
      }
    });
  }
  return due.length;
}

/** El pedido pagado no sigue (rechazo, cancelación, vencimiento): devolución total. */
export async function refundCancelledOrder(tx: Tx, event: { orderId: string; reason: string }): Promise<void> {
  await requestRefund(tx, { orderId: event.orderId, amountMinor: null, reason: event.reason }).catch((err: unknown) => {
    // Sin pago aprobado (p. ej. ya devuelto) no hay nada que devolver.
    if ((err as { details?: { reason?: string } }).details?.reason !== "NO_APPROVED_PAYMENT") throw err;
  });
}

export const getPublicConfig = (ctx: PaymentsContext | null) => ({ enabled: ctx !== null, publicKey: ctx?.publicKey ?? null });


