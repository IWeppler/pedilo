"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { updatePassword } from "../login/actions";

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePassword, initialFormState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField id="password" label="Contraseña nueva" error={err.password} hint="Al menos 8 caracteres.">
        <PasswordInput {...fieldA11y("password", err.password, true)} required minLength={8} autoComplete="new-password" />
      </FormField>
      <FormField id="confirmPassword" label="Repetí la contraseña" error={err.confirmPassword}>
        <PasswordInput {...fieldA11y("confirmPassword", err.confirmPassword)} required minLength={8} autoComplete="new-password" />
      </FormField>
      <SubmitButton pendingText="Guardando…" size="lg">
        Guardar y entrar
      </SubmitButton>
    </form>
  );
}
