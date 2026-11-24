import type { DbOrTx } from "../../db/client";
import { auditLogs } from "./schema";

/** Quién hace la acción y en qué request (para correlacionar con los logs). */
export interface Actor {
  userId: string;
  requestId: string;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Registrar SIEMPRE dentro de la misma transacción que la mutación auditada. */
export async function recordAudit(tx: DbOrTx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: actor.userId,
    requestId: actor.requestId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
