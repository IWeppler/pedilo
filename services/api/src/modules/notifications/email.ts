import { formatARSWhole } from "@pedilo/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { getUserSummaries } from "../identity/service";
import {
  type ClaimEmailData,
  EmailKind,
  emailOutbox,
  type EmailOutboxRow,
  type OrderEmailData,
  OutboxStatus,
} from "./schema";

/**
 * Emails al cliente (ADR 0032): pedido aceptado, rechazado, cancelado o vencido, y novedades del
 * reclamo. Se encolan en la transacción del hecho con un snapshot de los datos; `processEmailOutbox`
 * arma el texto y los manda después, con reintentos. Los emails de la cuenta (confirmación, contraseña) los manda
 * Supabase Auth por su SMTP, no pasan por acá.
 */

// ---------------------------------------------------------------------------
// Envío (inyectable para tests)
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Mismo id en un reintento → el proveedor no lo manda dos veces. */
  idempotencyKey: string;
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; permanent: boolean; error: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailResult>;
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface EmailLayoutInput {
  /** Texto corto que los clientes de correo muestran junto al asunto. */
  preheader: string;
  title: string;
  paragraphs: string[];
  /** Filas «etiqueta: valor» (detalle del pedido). */
  details?: Array<[string, string]>;
  /** Botón al pedido, si hay una URL pública de la app. */
  action?: { label: string; url: string } | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Arma el email en texto y HTML. HTML simple con tablas y estilos en línea (lo que soportan todos
 * los clientes de correo), con la paleta de la app: tinta, blanco y el rojo de marca solo en el logo.
 */
export function renderEmail(input: EmailLayoutInput): Omit<EmailContent, "subject"> {
  const details = input.details ?? [];
  const text = [
    input.title,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    ...(details.length ? [...details.map(([k, v]) => `${k}: ${v}`), ""] : []),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`, ""] : []),
    "—",
    "Pedilo · Este email es automático; si necesitás algo, escribile al comercio desde la app.",
  ].join("\n");

  const rows = details
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6e6a64;font-size:14px">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 0;color:#151515;font-size:14px;text-align:right">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 28px 0;font-size:22px;font-weight:800;color:#e5432b;letter-spacing:-0.5px">pedilo</td></tr>
<tr><td style="padding:16px 28px 0;font-size:22px;font-weight:700;color:#151515;line-height:1.3">${escapeHtml(input.title)}</td></tr>
${input.paragraphs.map((p) => `<tr><td style="padding:12px 28px 0;font-size:16px;color:#151515;line-height:1.5">${escapeHtml(p)}</td></tr>`).join("\n")}
${rows ? `<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e6e4e0">${rows}</table></td></tr>` : ""}
${
  input.action
    ? `<tr><td style="padding:24px 28px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#151515;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 22px;border-radius:12px">${escapeHtml(input.action.label)}</a></td></tr>`
    : ""
}
<tr><td style="padding:28px;font-size:12px;color:#6e6a64;line-height:1.5">Este email es automático. Si necesitás algo, escribile al comercio desde la app.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export type OrderEmailKind = Exclude<EmailKind, "CLAIM_UPDATE">;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Email del cambio de estado de un pedido. */
export function orderEmail(kind: OrderEmailKind, o: OrderEmailData, orderUrl: string | null): EmailContent {
  const hi = `Hola ${firstName(o.customerName)}:`;
  const refundLine = o.refund ? "Como lo pagaste con tarjeta, te devolvemos el total por Mercado Pago. Puede tardar unos días en verse." : null;
  const byKind: Record<OrderEmailKind, { subject: string; title: string; lines: string[] }> = {
    ORDER_ACCEPTED: {
      subject: `${o.merchantName} aceptó tu pedido ${o.code}`,
      title: "Tu pedido está confirmado",
      lines: [
        hi,
        `${o.merchantName} aceptó tu pedido y ya lo está preparando.`,
        o.fulfillmentType === "PICKUP" ? "Te avisamos cuando esté listo para retirar." : "Te avisamos cuando salga para tu casa.",
      ],
    },
    ORDER_REJECTED: {
      subject: `${o.merchantName} no pudo tomar tu pedido ${o.code}`,
      title: "No pudieron tomar tu pedido",
      lines: [hi, `${o.merchantName} no pudo tomar tu pedido.`, ...(o.reason ? [`Motivo: ${o.reason}`] : [])],
    },
    ORDER_CANCELLED: {
      subject: `Tu pedido ${o.code} se canceló`,
      title: "Tu pedido se canceló",
      lines: [hi, `${o.merchantName} canceló tu pedido.`, ...(o.reason ? [`Motivo: ${o.reason}`] : [])],
    },
    ORDER_EXPIRED: {
      subject: `Tu pedido ${o.code} no se confirmó`,
      title: "Tu pedido no se confirmó",
      lines: [hi, `${o.merchantName} no respondió a tiempo, así que el pedido no sigue. No se te cobra nada.`],
    },
  };
  const t = byKind[kind];
  const lines = [...t.lines, ...(refundLine ? [refundLine] : [])];
  const items = o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ");
  const content = renderEmail({
    preheader: lines[1] ?? t.title,
    title: t.title,
    paragraphs: lines,
    details: [
      ["Pedido", o.code],
      ["Comercio", o.merchantName],
      ["Entrega", o.fulfillmentType === "PICKUP" ? "Retiro en el local" : "Envío a domicilio"],
      ...(items ? ([["Productos", items]] as Array<[string, string]>) : []),
      ["Total", formatARSWhole(o.totalMinor)],
    ],
    action: orderUrl ? { label: "Ver mi pedido", url: orderUrl } : null,
  });
  return { ...content, subject: t.subject };
}

/** Email de una novedad del reclamo (mismo texto que el push). */
export function claimEmail(c: ClaimEmailData, orderUrl: string | null): EmailContent {
  const content = renderEmail({
    preheader: c.body,
    title: c.title,
    paragraphs: [c.body],
    details: [["Pedido", c.orderCode]],
    action: orderUrl ? { label: "Ver el reclamo", url: orderUrl } : null,
  });
  return { ...content, subject: `${c.title} · pedido ${c.orderCode}` };
}

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

/** Cambio de estado del pedido → email al cliente. Llamar dentro de la transacción del hecho. */
export async function enqueueOrderEmail(tx: DbOrTx, e: { kind: OrderEmailKind; userId: string; orderId: string; data: OrderEmailData }) {
  await tx.insert(emailOutbox).values(e);
}

/** Novedad del reclamo → email al cliente. Llamar dentro de la transacción del hecho. */
export async function enqueueClaimEmail(tx: DbOrTx, e: { userId: string; orderId: string; data: ClaimEmailData }) {
  await tx.insert(emailOutbox).values({ kind: EmailKind.CLAIM_UPDATE, ...e });
}

/** El email listo para mandar. `appUrl`: URL pública de la app del cliente, para el botón al pedido. */
export function renderOutboxEmail(row: Pick<EmailOutboxRow, "kind" | "orderId" | "data">, appUrl: string | null): EmailContent {
  const orderUrl = appUrl && row.orderId ? `${appUrl}/order/${row.orderId}` : null;
  return row.kind === EmailKind.CLAIM_UPDATE
    ? claimEmail(row.data as ClaimEmailData, orderUrl)
    : orderEmail(row.kind, row.data as OrderEmailData, orderUrl);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export const EMAIL_MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60 * 1000;
const backoffMs = (attempts: number) => Math.min(60_000 * 2 ** (attempts - 1), 30 * 60 * 1000);

/**
 * Manda una tanda de emails pendientes. Seguro con varias instancias (SKIP LOCKED y "alquiler" de
 * la fila antes del HTTP). Sin proveedor configurado o sin email del usuario → SKIPPED. Error
 * transitorio → reintento con espera creciente; rechazo definitivo o MAX_ATTEMPTS → FAILED.
 */
export async function processEmailOutbox(
  db: Db,
  sender: EmailSender | null,
  opts: { appUrl: string | null } = { appUrl: null },
  now = new Date(),
  batchSize = 20,
): Promise<number> {
  const claimed: EmailOutboxRow[] = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, OutboxStatus.PENDING), lte(emailOutbox.nextAttemptAt, now)))
      .orderBy(asc(emailOutbox.nextAttemptAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (rows.length) {
      await tx
        .update(emailOutbox)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), attempts: sql`${emailOutbox.attempts} + 1` })
        .where(inArray(emailOutbox.id, rows.map((r) => r.id)));
    }
    return rows;
  });
  if (claimed.length === 0) return 0;

  const users = await getUserSummaries(db, claimed.map((r) => r.userId));
  for (const row of claimed) {
    const attempts = row.attempts + 1;
    const to = users.get(row.userId)?.email;
    if (!sender) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: "Email sin configurar (RESEND_API_KEY)" });
      continue;
    }
    if (!to) {
      await finish(db, row.id, { status: OutboxStatus.SKIPPED, lastError: "El usuario no tiene email" });
      continue;
    }
    const content = renderOutboxEmail(row, opts.appUrl);
    const result = await sender.send({ to, ...content, idempotencyKey: `email-${row.id}` });
    if (result.ok) {
      await finish(db, row.id, { status: OutboxStatus.SENT, sentAt: now, providerId: result.id, lastError: null });
    } else if (result.permanent || attempts >= EMAIL_MAX_ATTEMPTS) {
      await finish(db, row.id, { status: OutboxStatus.FAILED, lastError: result.error });
    } else {
      await db
        .update(emailOutbox)
        .set({ nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: result.error })
        .where(eq(emailOutbox.id, row.id));
    }
  }
  return claimed.length;
}

async function finish(
  db: Db,
  id: string,
  values: { status: OutboxStatus; lastError?: string | null; sentAt?: Date | null; providerId?: string | null },
) {
  await db.update(emailOutbox).set(values).where(eq(emailOutbox.id, id));
}
