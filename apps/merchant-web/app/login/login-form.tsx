"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { loginWithToken } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState(loginWithToken, initialFormState);
  const error = state.fieldErrors?.token;

  return (
    <form action={action} className="grid gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField
        id="token"
        label="Token de desarrollo"
        error={error}
        hint={
          <>
            Generalo con <code className="font-mono">npm run dev:token -w @pedilo/api -- --name tu-comercio</code>
          </>
        }
      >
        <textarea
          {...fieldA11y("token", error, true)}
          rows={4}
          required
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
      </FormField>
      <SubmitButton pendingText="Verificando…">Entrar</SubmitButton>
    </form>
  );
}
