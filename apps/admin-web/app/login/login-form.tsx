"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

import { loginWithToken, sendLoginLink } from "./actions";

/** Login con Supabase: pide el email y manda un link de acceso. */
export function EmailLoginForm() {
  const [state, action] = useActionState(sendLoginLink, initialFormState);
  const error = state.fieldErrors?.email;

  if (state.saved) {
    return (
      <Alert>
        <AlertDescription>
          Si la cuenta existe, te mandamos un link a <strong>{state.values?.email}</strong>. Abrilo en este mismo navegador para entrar.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField id="email" label="Email" error={error} hint="Solo para cuentas del equipo con rol de administrador.">
        <Input
          {...fieldA11y("email", error, true)}
          type="email"
          required
          autoComplete="email"
          defaultValue={state.values?.email}
        />
      </FormField>
      <SubmitButton pendingText="Enviando…">Enviarme el link</SubmitButton>
    </form>
  );
}

/** Login de desarrollo (sin Supabase): se pega un token generado por la API. */
export function DevTokenForm() {
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
            Generalo con <code className="font-mono">npm run dev:token -w @pedilo/api -- --admin</code>
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
