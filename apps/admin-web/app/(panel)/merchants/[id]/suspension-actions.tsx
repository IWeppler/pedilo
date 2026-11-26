"use client";

import { formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { reactivateMerchant, suspendMerchant } from "../actions";

/** Suspender un comercio aprobado (con motivo) o reactivarlo. */
export function SuspensionActions({ merchantId, status, reason }: { merchantId: string; status: string; reason: string | null }) {
  const [suspendState, suspend] = useActionState(suspendMerchant.bind(null, merchantId), initialFormState);
  const [reactivateState, reactivate] = useActionState(reactivateMerchant.bind(null, merchantId), initialFormState);
  const reasonError = suspendState.fieldErrors?.reason;

  if (status === "SUSPENDED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comercio suspendido</CardTitle>
          <CardDescription>{reason ? `Motivo: ${reason}` : "Sin motivo registrado."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={reactivate} className="grid gap-2">
            {reactivateState.message && (
              <Alert variant="destructive">
                <AlertDescription>{reactivateState.message}</AlertDescription>
              </Alert>
            )}
            <div>
              <SubmitButton pendingText="Reactivando…">Reactivar comercio</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suspender</CardTitle>
        <CardDescription>
          Deja de aparecer en la app y no recibe pedidos nuevos. Puede terminar los que tiene en curso. Se puede reactivar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formKey(suspendState.values)} action={suspend} className="grid max-w-xl gap-3">
          {suspendState.message && !reasonError && (
            <Alert variant="destructive">
              <AlertDescription>{suspendState.message}</AlertDescription>
            </Alert>
          )}
          <FormField id="suspend-reason" label="Motivo" error={reasonError} hint="Lo ve el comercio.">
            <textarea
              {...fieldA11y("suspend-reason", reasonError, true)}
              name="reason"
              defaultValue={suspendState.values?.reason ?? ""}
              rows={2}
              required
              minLength={5}
              maxLength={500}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
          </FormField>
          <div>
            <SubmitButton pendingText="Suspendiendo…">Suspender comercio</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
