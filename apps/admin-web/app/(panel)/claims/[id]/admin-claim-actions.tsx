"use client";

import { formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { resolveClaim, sendAdminClaimMessage } from "../actions";

/** Resolver o cerrar con nota (la ven cliente y comercio) y escribir en el reclamo. */
export function AdminClaimActions({ claimId, canResolve, canClose }: { claimId: string; canResolve: boolean; canClose: boolean }) {
  const [state, action] = useActionState(resolveClaim.bind(null, claimId), initialFormState);
  const [msgState, message] = useActionState(sendAdminClaimMessage.bind(null, claimId), initialFormState);
  return (
    <>
      {(canResolve || canClose) && (
        <Card>
          <CardHeader>
            <CardTitle>Decisión de Pedilo</CardTitle>
            <CardDescription>
              No mueve dinero: si corresponde una devolución, coordinala con el comercio. Casos de salud, fraude o denuncias: derivar a quien corresponda.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form key={formKey(state.values)} action={action} className="grid max-w-xl gap-3 text-sm">
              {state.message && (
                <Alert variant="destructive">
                  <AlertDescription>{state.message}</AlertDescription>
                </Alert>
              )}
              <textarea
                name="note"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                placeholder="Qué se decidió (lo ven el cliente y el comercio)"
                defaultValue={state.values?.note ?? ""}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <div className="flex flex-wrap gap-3">
                {canResolve && (
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="to" value="RESOLVED" defaultChecked className="accent-primary" /> Resuelto
                  </label>
                )}
                {canClose && (
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="to" value="CLOSED" defaultChecked={!canResolve} className="accent-primary" /> Cerrar
                  </label>
                )}
              </div>
              <div>
                <SubmitButton pendingText="Guardando…">Guardar decisión</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <form key={formKey(msgState.values)} action={message} className="flex flex-wrap items-center gap-2 text-sm">
        <Input name="body" required maxLength={1000} placeholder="Mensaje de Pedilo (lo ven cliente y comercio)" className="w-96" />
        <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
        {msgState.message && <p className="w-full text-xs text-destructive">{msgState.message}</p>}
      </form>
    </>
  );
}
