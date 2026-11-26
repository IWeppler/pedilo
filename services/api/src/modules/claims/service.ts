import {
  CLAIM_WINDOW_HOURS,
  type ClaimReason,
  ClaimResolutionType,
  claimStateMachine,
  ClaimStatus,
  isClaimOpen,
  isRefundResolution,
  MERCHANT_CLAIM_SLA_HOURS,
  OrderStatus,
} from "@pedilo/domain";
import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";

import type { Db, DbOrTx, Tx } from "../../db/client";
import { badRequest, conflict, isUniqueViolation, notFound } from "../../lib/errors";
import { media, mediaPath, mediaUrl, processImage } from "../../lib/media";
import { type Actor, recordAudit } from "../audit/service";
import { adjustCommissionForRefund } from "../billing/service";
import { getMerchantAccess, getMerchantNames } from "../merchants/service";
import { getOrderClaimSummary, getOrderClaimSummaryForCustomer, type OrderClaimSummary } from "../orders/service";
import { type ClaimActor, claimEvents, type ClaimEventKind, claimEvidence, type ClaimRow, claims } from "./schema";

/**
 * Reclamos (SPEC §11.2, ADR 0019). Pedilo da soporte operativo, no arbitraje: el comercio propone
 * primero, el cliente acepta o no, y Pedilo interviene si se escala o si el comercio no responde.
 * Sin decisiones automáticas irreversibles: lo único automático es escalar.
 */

const HOUR = 60 * 60 * 1000;
const CLAIMABLE: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PICKED_UP, OrderStatus.DELIVERY_FAILED];
const MAX_EVIDENCE = 3;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ClaimDto {
  id: string;
  orderId: string;
  orderCode: string;
  merchant: { id: string; name: string };
  reason: ClaimReason;
  description: string;
  sensitive: boolean;
  status: ClaimStatus;
  merchantDueAt: string;
  proposal: { type: ClaimResolutionType; amountMinor: number | null; note: string | null; proposedAt: string } | null;
  refundedMinor: number | null;
  resolutionNote: string | null;
  orderTotalMinor: number;
  evidence: string[];
  events: Array<{ actor: ClaimActor; kind: ClaimEventKind; body: string | null; amountMinor: number | null; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

async function loadClaims(db: DbOrTx, rows: ClaimRow[], totals: Map<string, number>): Promise<ClaimDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [events, evidence, names] = await Promise.all([
    db.select().from(claimEvents).where(inArray(claimEvents.claimId, ids)).orderBy(asc(claimEvents.createdAt)),
    db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, ids)).orderBy(asc(claimEvidence.createdAt)),
    getMerchantNames(db, [...new Set(rows.map((r) => r.merchantId))]),
  ]);
  return rows.map((c) => ({
    id: c.id,
    orderId: c.orderId,
    orderCode: c.orderCode,
    merchant: { id: c.merchantId, name: names.get(c.merchantId) ?? "—" },
    reason: c.reason,
    description: c.description,
    sensitive: c.sensitive,
    status: c.status,
    merchantDueAt: c.merchantDueAt.toISOString(),
    proposal:
      c.proposalType && c.proposedAt
        ? { type: c.proposalType, amountMinor: c.proposalAmountMinor, note: c.proposalNote, proposedAt: c.proposedAt.toISOString() }
        : null,
    refundedMinor: c.refundedMinor,
    resolutionNote: c.resolutionNote,
    orderTotalMinor: totals.get(c.orderId) ?? 0,
    evidence: evidence.filter((e) => e.claimId === c.id).map((e) => mediaUrl(e.imagePath)!),
    events: events
      .filter((e) => e.claimId === c.id)
      .map((e) => ({ actor: e.actor, kind: e.kind, body: e.body, amountMinor: e.amountMinor, createdAt: e.createdAt.toISOString() })),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

async function claimDto(db: DbOrTx, row: ClaimRow): Promise<ClaimDto> {
  const order = await getOrderClaimSummary(db, row.orderId);
  return (await loadClaims(db, [row], new Map([[row.orderId, order.totalMinor]])))[0]!;
}

async function event(
  tx: Tx,
  claimId: string,
  actor: ClaimActor,
  kind: ClaimEventKind,
  extra: { userId?: string | null; body?: string | null; amountMinor?: number | null } = {},
) {
  await tx.insert(claimEvents).values({
    claimId,
    actor,
    kind,
    actorUserId: extra.userId ?? null,
    body: extra.body ?? null,
    amountMinor: extra.amountMinor ?? null,
  });
}

async function move(tx: Tx, row: ClaimRow, to: ClaimStatus, set: Partial<typeof claims.$inferInsert> = {}): Promise<void> {
  if (!claimStateMachine.canTransition(row.status, to)) {
    throw conflict("Ese paso no es válido en el estado actual del reclamo", { reason: "INVALID_TRANSITION", status: row.status, to });
  }
  await tx.update(claims).set({ status: to, ...set }).where(eq(claims.id, row.id));
}

const lockClaim = async (tx: Tx, where: ReturnType<typeof eq>) => {
  const [row] = await tx.select().from(claims).where(where).for("update");
  if (!row) throw notFound("Reclamo");
  return row;
};

// ---------------------------------------------------------------------------
// Cliente (con el token de seguimiento del pedido)
// ---------------------------------------------------------------------------

export interface OpenClaimInput {
  reason: ClaimReason;
  description: string;
  sensitive?: boolean | undefined;
}

/** El cliente abre un reclamo: hasta 48 h después de que el pedido terminó, uno por pedido. */
export async function openClaim(
  db: Db,
  orderId: string,
  token: string | undefined,
  secret: string,
  input: OpenClaimInput,
  now = new Date(),
): Promise<ClaimDto> {
  const order = await getOrderClaimSummaryForCustomer(db, orderId, token, secret);
  if (!CLAIMABLE.includes(order.status) || !order.finishedAt) {
    throw conflict("Podés reclamar cuando el pedido se haya entregado o retirado", { reason: "NOT_CLAIMABLE", status: order.status });
  }
  if (now.getTime() - order.finishedAt.getTime() > CLAIM_WINDOW_HOURS * HOUR) {
    throw conflict(`Pasaron más de ${CLAIM_WINDOW_HOURS} horas desde la entrega: comunicate con el comercio`, { reason: "CLAIM_WINDOW_CLOSED" });
  }
  const sensitive = input.sensitive ?? false;
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(claims)
        .values({
          orderId,
          merchantId: order.merchantId,
          orderCode: order.code,
          reason: input.reason,
          description: input.description.trim(),
          sensitive,
          // Salud o seguridad: directo a Pedilo (SPEC §11.2: suspender automatismos).
          status: sensitive ? ClaimStatus.ESCALATED : ClaimStatus.OPEN,
          merchantDueAt: new Date(now.getTime() + MERCHANT_CLAIM_SLA_HOURS * HOUR),
          ...(sensitive && { escalatedAt: now }),
        })
        .returning({ id: claims.id });
      await event(tx, row!.id, "CUSTOMER", "OPENED", { body: input.description.trim() });
      if (sensitive) await event(tx, row!.id, "SYSTEM", "ESCALATED", { body: "Problema de salud o seguridad: lo revisa Pedilo" });
      return row!.id;
    });
    return claimDto(db, (await db.select().from(claims).where(eq(claims.id, id)))[0]!);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Este pedido ya tiene un reclamo", { reason: "CLAIM_EXISTS" });
    throw err;
  }
}

async function customerClaim(db: DbOrTx, orderId: string, token: string | undefined, secret: string) {
  await getOrderClaimSummaryForCustomer(db, orderId, token, secret);
  const [row] = await db.select().from(claims).where(eq(claims.orderId, orderId));
  return row ?? null;
}

export async function getClaimForCustomer(db: Db, orderId: string, token: string | undefined, secret: string): Promise<ClaimDto | null> {
  const row = await customerClaim(db, orderId, token, secret);
  return row ? claimDto(db, row) : null;
}

/** Foto de evidencia (opcional, hasta 3). Se reprocesa igual que las del menú: sin metadatos. */
export async function addEvidence(db: Db, orderId: string, token: string | undefined, secret: string, bytes: Buffer): Promise<ClaimDto> {
  const row = await customerClaim(db, orderId, token, secret);
  if (!row) throw notFound("Reclamo");
  if (!isClaimOpen(row.status)) throw conflict("El reclamo ya está cerrado", { reason: "CLAIM_CLOSED" });
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(claimEvidence).where(eq(claimEvidence.claimId, row.id));
  if (n >= MAX_EVIDENCE) throw conflict(`Podés subir hasta ${MAX_EVIDENCE} fotos`, { reason: "TOO_MANY_PHOTOS" });
  const image = await processImage(bytes, "product");
  const path = mediaPath(row.merchantId, `claim-${row.id}`);
  await media.put(path, image, "image/webp");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(claimEvidence).values({ claimId: row.id, imagePath: path });
      await event(tx, row.id, "CUSTOMER", "EVIDENCE");
    });
  } catch (err) {
    await media.remove(path).catch(() => undefined);
    throw err;
  }
  return claimDto(db, row);
}

/** El cliente acepta o rechaza la propuesta del comercio. */
export async function respondToProposal(
  db: Db,
  orderId: string,
  token: string | undefined,
  secret: string,
  input: { accept: boolean; comment?: string | null | undefined },
): Promise<ClaimDto> {
  const found = await customerClaim(db, orderId, token, secret);
  if (!found) throw notFound("Reclamo");
  await db.transaction(async (tx) => {
    const row = await lockClaim(tx, eq(claims.id, found.id));
    if (row.status !== ClaimStatus.MERCHANT_REVIEW || !row.proposalType) {
      throw conflict("No hay una propuesta del comercio para responder", { reason: "NO_PROPOSAL" });
    }
    const comment = input.comment?.trim() || null;
    if (!input.accept) {
      await move(tx, row, ClaimStatus.DISPUTED);
      await event(tx, row.id, "CUSTOMER", "REJECTED", { body: comment });
      return;
    }
    await event(tx, row.id, "CUSTOMER", "ACCEPTED", { body: comment });
    // Devolución: queda acordada hasta que el comercio la registre. Reenvío, reemplazo o
    // rechazo aceptado: resuelto.
    if (isRefundResolution(row.proposalType)) await move(tx, row, ClaimStatus.AGREED_REFUND);
    else await move(tx, row, ClaimStatus.RESOLVED, { resolvedAt: new Date(), resolutionNote: row.proposalNote });
  });
  return claimDto(db, (await db.select().from(claims).where(eq(claims.id, found.id)))[0]!);
}

/** El cliente pide que intervenga Pedilo (si rechazó la propuesta o el comercio no ayuda). */
export async function escalateByCustomer(
  db: Db,
  orderId: string,
  token: string | undefined,
  secret: string,
  comment: string,
  now = new Date(),
): Promise<ClaimDto> {
  const found = await customerClaim(db, orderId, token, secret);
  if (!found) throw notFound("Reclamo");
  await db.transaction(async (tx) => {
    const row = await lockClaim(tx, eq(claims.id, found.id));
    await move(tx, row, ClaimStatus.ESCALATED, { escalatedAt: now });
    await event(tx, row.id, "CUSTOMER", "ESCALATED", { body: comment.trim() });
  });
  return claimDto(db, (await db.select().from(claims).where(eq(claims.id, found.id)))[0]!);
}

export async function customerMessage(db: Db, orderId: string, token: string | undefined, secret: string, body: string): Promise<ClaimDto> {
  const row = await customerClaim(db, orderId, token, secret);
  if (!row) throw notFound("Reclamo");
  if (!isClaimOpen(row.status)) throw conflict("El reclamo ya está cerrado", { reason: "CLAIM_CLOSED" });
  await db.transaction((tx) => event(tx, row.id, "CUSTOMER", "MESSAGE", { body: body.trim() }));
  return claimDto(db, row);
}

// ---------------------------------------------------------------------------
// Comercio
// ---------------------------------------------------------------------------

async function merchantClaim(tx: Tx, merchantId: string, claimId: string) {
  return lockClaim(tx, and(eq(claims.id, claimId), eq(claims.merchantId, merchantId))!);
}

export async function listMerchantClaims(db: Db, merchantId: string, userId: string, scope: "open" | "all"): Promise<ClaimDto[]> {
  await getMerchantAccess(db, merchantId, userId);
  const rows = await db.select().from(claims).where(eq(claims.merchantId, merchantId)).orderBy(desc(claims.createdAt)).limit(100);
  const filtered = scope === "open" ? rows.filter((r) => isClaimOpen(r.status)) : rows;
  const totals = new Map<string, number>();
  for (const r of filtered) totals.set(r.orderId, (await getOrderClaimSummary(db, r.orderId)).totalMinor);
  return loadClaims(db, filtered, totals);
}

export async function getMerchantClaim(db: Db, merchantId: string, claimId: string, userId: string): Promise<ClaimDto> {
  await getMerchantAccess(db, merchantId, userId);
  const [row] = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.merchantId, merchantId)));
  if (!row) throw notFound("Reclamo");
  return claimDto(db, row);
}

/**
 * El comercio propone una solución (SPEC §11.2): devolución total o parcial (hasta el total del
 * pedido), reenvío, reemplazo o rechazo motivado. Puede volver a proponer si el cliente rechazó.
 */
export async function proposeResolution(
  db: Db,
  merchantId: string,
  claimId: string,
  input: { type: ClaimResolutionType; amountMinor?: number | null | undefined; note?: string | null | undefined },
  actor: Actor,
  now = new Date(),
): Promise<ClaimDto> {
  await getMerchantAccess(db, merchantId, actor.userId);
  const note = input.note?.trim() || null;
  if (input.type === ClaimResolutionType.REJECT && !note) throw badRequest("Explicá por qué rechazás el reclamo (lo ve el cliente)", { field: "note" });
  await db.transaction(async (tx) => {
    const row = await merchantClaim(tx, merchantId, claimId);
    if (row.sensitive) throw conflict("Este reclamo lo gestiona Pedilo directamente", { reason: "SENSITIVE" });
    const order = await getOrderClaimSummary(tx, row.orderId);
    let amount: number | null = null;
    if (input.type === ClaimResolutionType.REFUND_FULL) amount = order.totalMinor;
    if (input.type === ClaimResolutionType.REFUND_PARTIAL) {
      amount = input.amountMinor ?? 0;
      if (amount <= 0 || amount >= order.totalMinor) {
        throw badRequest("La devolución parcial tiene que ser mayor a 0 y menor que el total del pedido", { field: "amountMinor" });
      }
    }
    // OPEN → propuesta; DISPUTED → nueva propuesta (vuelve a revisión del cliente).
    if (row.status === ClaimStatus.DISPUTED) {
      await tx.update(claims).set({ status: ClaimStatus.MERCHANT_REVIEW }).where(eq(claims.id, row.id));
    } else {
      await move(tx, row, ClaimStatus.MERCHANT_REVIEW);
    }
    await tx
      .update(claims)
      .set({ proposalType: input.type, proposalAmountMinor: amount, proposalNote: note, proposedAt: now })
      .where(eq(claims.id, row.id));
    await event(tx, row.id, "MERCHANT", "PROPOSAL", { userId: actor.userId, body: note, amountMinor: amount });
    await recordAudit(tx, actor, { action: "claim.propose", entityType: "claim", entityId: row.id, after: { type: input.type, amount, note } });
  });
  return getMerchantClaim(db, merchantId, claimId, actor.userId);
}

/**
 * El comercio registra que devolvió la plata (efectivo o transferencia, SPEC §8.2.7). Se resuelve
 * el reclamo y la comisión de Pedilo se corrige con un asiento compensatorio.
 */
export async function markRefunded(
  db: Db,
  merchantId: string,
  claimId: string,
  note: string | null,
  actor: Actor,
  now = new Date(),
): Promise<ClaimDto> {
  await getMerchantAccess(db, merchantId, actor.userId);
  await db.transaction(async (tx) => {
    const row = await merchantClaim(tx, merchantId, claimId);
    if (row.status !== ClaimStatus.AGREED_REFUND || !row.proposalAmountMinor) {
      throw conflict("No hay una devolución acordada para registrar", { reason: "NO_AGREED_REFUND" });
    }
    const order = await getOrderClaimSummary(tx, row.orderId);
    const amount = row.proposalAmountMinor;
    await move(tx, row, ClaimStatus.RESOLVED, {
      refundedMinor: amount,
      refundedAt: now,
      resolvedAt: now,
      resolutionNote: note?.trim() || row.proposalNote,
    });
    await event(tx, row.id, "MERCHANT", "REFUNDED", { userId: actor.userId, body: note?.trim() || null, amountMinor: amount });
    const delta = await adjustCommissionForRefund(tx, order, amount);
    await recordAudit(tx, actor, {
      action: "claim.refunded",
      entityType: "claim",
      entityId: row.id,
      after: { amountMinor: amount, commissionAdjustmentMinor: delta },
    });
  });
  return getMerchantClaim(db, merchantId, claimId, actor.userId);
}

export async function merchantMessage(db: Db, merchantId: string, claimId: string, body: string, userId: string): Promise<ClaimDto> {
  await getMerchantAccess(db, merchantId, userId);
  await db.transaction(async (tx) => {
    const row = await merchantClaim(tx, merchantId, claimId);
    if (!isClaimOpen(row.status)) throw conflict("El reclamo ya está cerrado", { reason: "CLAIM_CLOSED" });
    await event(tx, row.id, "MERCHANT", "MESSAGE", { userId, body: body.trim() });
  });
  return getMerchantClaim(db, merchantId, claimId, userId);
}

// ---------------------------------------------------------------------------
// Pedilo (admin) y vencimientos
// ---------------------------------------------------------------------------

export async function listClaimsForAdmin(db: Db, status?: ClaimStatus): Promise<ClaimDto[]> {
  const rows = await db
    .select()
    .from(claims)
    .where(status ? eq(claims.status, status) : undefined)
    .orderBy(desc(claims.sensitive), asc(claims.createdAt))
    .limit(200);
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.orderId, (await getOrderClaimSummary(db, r.orderId)).totalMinor);
  return loadClaims(db, rows, totals);
}

export async function getClaimForAdmin(db: Db, claimId: string): Promise<ClaimDto> {
  const [row] = await db.select().from(claims).where(eq(claims.id, claimId));
  if (!row) throw notFound("Reclamo");
  return claimDto(db, row);
}

/**
 * Pedilo resuelve o cierra un reclamo escalado, con nota (lo ve el cliente y el comercio). No
 * mueve dinero: si corresponde una devolución, la coordina con el comercio por fuera.
 */
export async function resolveByAdmin(
  db: Db,
  claimId: string,
  input: { to: "RESOLVED" | "CLOSED"; note: string },
  actor: Actor,
  now = new Date(),
): Promise<ClaimDto> {
  await db.transaction(async (tx) => {
    const row = await lockClaim(tx, eq(claims.id, claimId));
    await move(tx, row, input.to, { resolutionNote: input.note.trim(), ...(input.to === "RESOLVED" && { resolvedAt: now }) });
    await event(tx, row.id, "ADMIN", input.to === "RESOLVED" ? "RESOLVED" : "CLOSED", { userId: actor.userId, body: input.note.trim() });
    await recordAudit(tx, actor, { action: `claim.${input.to.toLowerCase()}`, entityType: "claim", entityId: row.id, after: { note: input.note } });
  });
  return getClaimForAdmin(db, claimId);
}

export async function adminMessage(db: Db, claimId: string, body: string, userId: string): Promise<ClaimDto> {
  await db.transaction(async (tx) => {
    const row = await lockClaim(tx, eq(claims.id, claimId));
    await event(tx, row.id, "ADMIN", "MESSAGE", { userId, body: body.trim() });
  });
  return getClaimForAdmin(db, claimId);
}

/** El comercio no propuso a tiempo: se escala a Pedilo. Seguro con varias instancias. */
export async function escalateOverdueClaims(db: Db, now = new Date(), batch = 50): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.status, ClaimStatus.OPEN), lte(claims.merchantDueAt, now)))
      .limit(batch)
      .for("update", { skipLocked: true });
    for (const row of due) {
      await move(tx, row, ClaimStatus.ESCALATED, { escalatedAt: now });
      await event(tx, row.id, "SYSTEM", "ESCALATED", { body: `El comercio no respondió en ${MERCHANT_CLAIM_SLA_HOURS} horas` });
    }
    return due.length;
  });
}

export type { OrderClaimSummary };
