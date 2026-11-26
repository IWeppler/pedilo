"use client";

import type { Claim } from "@pedilo/api-client";
import { CLAIM_RESOLUTION_LABELS, type ClaimResolutionType, formatARS } from "@pedilo/domain";
import { formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { markClaimRefunded, proposeClaimResolution, sendClaimMessage } from "../actions";

const TYPES: ClaimResolutionType[] = ["REFUND_FULL", "REFUND_PARTIAL", "RESEND", "REPLACE", "REJECT"];

/** Proponer solución, registrar la devolución acordada y escribir al cliente. */
export function ClaimActions({ merchantId, claim: c }: { merchantId: string; claim: Claim }) {
  const [proposeState, propose] = useActionState(proposeClaimResolution.bind(null, merchantId, c.id), initialFormState);
  const [refundState, refund] = useActionState(markClaimRefunded.bind(null, merchantId, c.id), initialFormState);
  const [msgState, message] = useActionState(sendClaimMessage.bind(null, merchantId, c.id), initialFormState);
  const [type, setType] = useState<ClaimResolutionType>("REFUND_PARTIAL");
  const canPropose = !c.sensitive && (c.status === "OPEN" || c.status === "DISPUTED");
  const open = c.status !== "RESOLVED" && c.status !== "CLOSED";

  return (
    <>
      {canPropose && (
        <Card>
          <CardHeader>
            <CardTitle>{c.status === "DISPUTED" ? "El cliente no aceptó: proponé otra solución" : "Proponé una solución"}</CardTitle>
            <CardDescription>El cliente la acepta o no. Si no llegan a un acuerdo, puede pedir que intervenga Pedilo.</CardDescription>
          </CardHeader>
          <CardContent>
            <form key={formKey(proposeState.values)} action={propose} className="grid max-w-xl gap-3 text-sm">
              {proposeState.message && (
                <Alert variant="destructive">
                  <AlertDescription>{proposeState.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-3">
                {TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5">
                    <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="accent-primary" />
                    {CLAIM_RESOLUTION_LABELS[t]}
                  </label>
                ))}
              </div>
              {type === "REFUND_FULL" && <p className="text-muted-foreground">Devolvés el total del pedido: {formatARS(c.orderTotalMinor)}.</p>}
              {type === "REFUND_PARTIAL" && (
                <label className="flex items-center gap-2">
                  Monto a devolver $
                  <Input name="amount" inputMode="decimal" required className="w-32" defaultValue={proposeState.values?.amount ?? ""} />
                  <span className="text-muted-foreground">(menos de {formatARS(c.orderTotalMinor)})</span>
                </label>
              )}
              <label className="grid gap-1">
                {type === "REJECT" ? "Motivo del rechazo (obligatorio, lo ve el cliente)" : "Mensaje para el cliente (opcional)"}
                <Input name="note" maxLength={500} required={type === "REJECT"} defaultValue={proposeState.values?.note ?? ""} />
              </label>
              <div>
                <SubmitButton pendingText="Enviando…">Enviar propuesta</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {c.status === "AGREED_REFUND" && (
        <Card>
          <CardHeader>
            <CardTitle>Devolución acordada: {formatARS(c.proposal?.amountMinor ?? 0)}</CardTitle>
            <CardDescription>Devolvele la plata al cliente (efectivo o transferencia) y registralo acá. La comisión de Pedilo se ajusta sola.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={refund} className="flex flex-wrap items-center gap-2 text-sm">
              <Input name="note" maxLength={300} placeholder="Ej.: transferido, operación 1234" className="w-72" />
              <SubmitButton pendingText="Registrando…">Ya le devolví {formatARS(c.proposal?.amountMinor ?? 0)}</SubmitButton>
              {refundState.message && <p className="w-full text-xs text-destructive">{refundState.message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {open && (
        <form key={formKey(msgState.values)} action={message} className="flex flex-wrap items-center gap-2 text-sm">
          <Input name="body" required maxLength={1000} placeholder="Escribile al cliente" className="w-96" />
          <SubmitButton pendingText="Enviando…">Enviar mensaje</SubmitButton>
          {msgState.message && <p className="w-full text-xs text-destructive">{msgState.message}</p>}
        </form>
      )}
    </>
  );
}
