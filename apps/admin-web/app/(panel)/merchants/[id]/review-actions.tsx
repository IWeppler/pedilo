"use client";

import { formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { approveMerchant, rejectMerchant } from "../actions";

/** Aprobar o rechazar (con motivo) un comercio en revisión. */
export function ReviewActions({ merchantId, ready }: { merchantId: string; ready: boolean }) {
  const [approveState, approve] = useActionState(approveMerchant.bind(null, merchantId), initialFormState);
  const [rejectState, reject] = useActionState(rejectMerchant.bind(null, merchantId), initialFormState);
  const reasonError = rejectState.fieldErrors?.reason;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisión</CardTitle>
        <CardDescription>
          Al aprobar, el comercio puede empezar a operar. Si lo rechazás, el motivo le llega al comercio para que corrija.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <form action={approve} className="grid content-start gap-3">
          {approveState.message && (
            <Alert variant="destructive">
              <AlertDescription>{approveState.message}</AlertDescription>
            </Alert>
          )}
          {!ready && (
            <p className="text-sm text-destructive">El checklist no está completo: revisá antes de aprobar.</p>
          )}
          <div>
            <SubmitButton pendingText="Aprobando…">Aprobar comercio</SubmitButton>
          </div>
        </form>

        <form key={formKey(rejectState.values)} action={reject} className="grid gap-3">
          {rejectState.message && !reasonError && (
            <Alert variant="destructive">
              <AlertDescription>{rejectState.message}</AlertDescription>
            </Alert>
          )}
          <FormField id="reason" label="Motivo del rechazo" error={reasonError} hint="Lo ve el comercio. Sé concreto.">
            <textarea
              {...fieldA11y("reason", reasonError, true)}
              defaultValue={rejectState.values?.reason ?? ""}
              rows={3}
              required
              minLength={5}
              maxLength={500}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
          </FormField>
          <div>
            <SubmitButton pendingText="Rechazando…">Rechazar</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
