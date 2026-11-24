"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { submitForReview } from "./actions";

export function SubmitForReview({ merchantId, resubmit }: { merchantId: string; resubmit: boolean }) {
  const [state, action] = useActionState(submitForReview.bind(null, merchantId), initialFormState);
  return (
    <form action={action} className="grid gap-3">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div>
        <SubmitButton pendingText="Enviando…">{resubmit ? "Volver a enviar a revisión" : "Enviar a revisión"}</SubmitButton>
      </div>
    </form>
  );
}
