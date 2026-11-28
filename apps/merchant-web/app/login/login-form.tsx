"use client";

import { type FormState, initialFormState } from "@pedilo/web-utils";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { FormField, fieldA11y } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  loginWithPassword,
  loginWithToken,
  requestPasswordReset,
  resendSignupCode,
  signInWithGoogle,
  signUpWithPassword,
  verifySignupCode,
} from "./actions";

export type LoginMode = "ingreso" | "registro" | "recuperar";

/**
 * Comercios: Google o email y contraseña (sin links ni códigos de acceso, que son para
 * repartidores). `registro` crea la cuenta; `recuperar` manda el link para elegir otra contraseña.
 */
export function SupabaseLoginForm({ mode }: { mode: LoginMode }) {
  if (mode === "recuperar") return <ResetRequestForm />;
  return (
    <div className="grid gap-5">
      <GoogleForm signup={mode === "registro"} />
      <div
        className="flex items-center gap-3 text-xs text-muted-foreground"
        role="separator"
      >
        <span className="h-px flex-1 bg-border" />o con tu email
        <span className="h-px flex-1 bg-border" />
      </div>
      {mode === "registro" ? <SignUpForm /> : <PasswordLoginForm />}
    </div>
  );
}

function PasswordLoginForm() {
  const [state, action] = useActionState(loginWithPassword, initialFormState);
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      <ErrorMessage state={state} />
      <EmailField error={err.email} defaultValue={state.values?.email} />
      <FormField
        id="password"
        label={
          <span className="flex w-full items-center justify-between">
            Contraseña
            <Link
              href="/login?modo=recuperar"
              className="text-xs font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ¿La olvidaste?
            </Link>
          </span>
        }
        error={err.password}
      >
        <PasswordInput
          {...fieldA11y("password", err.password)}
          required
          autoComplete="current-password"
        />
      </FormField>
      <SubmitButton pendingText="Entrando…" size="lg">
        Entrar
      </SubmitButton>
    </form>
  );
}

function SignUpForm() {
  const [state, action] = useActionState(signUpWithPassword, initialFormState);
  const err = state.fieldErrors ?? {};

  if (state.saved && state.values?.email)
    return <ConfirmSignup email={state.values.email} />;

  return (
    <form action={action} className="grid gap-4">
      <ErrorMessage state={state} />
      <EmailField error={err.email} defaultValue={state.values?.email} />
      <FormField
        id="password"
        label="Contraseña"
        error={err.password}
        hint="Al menos 8 caracteres."
      >
        <PasswordInput
          {...fieldA11y("password", err.password, true)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </FormField>
      <FormField
        id="confirmPassword"
        label="Repetí la contraseña"
        error={err.confirmPassword}
      >
        <PasswordInput
          {...fieldA11y("confirmPassword", err.confirmPassword)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </FormField>
      <SubmitButton pendingText="Creando cuenta…" size="lg">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}

/**
 * Después de crear la cuenta: el email de Supabase trae un código o un link, según la plantilla
 * «Confirm signup». Con el código se confirma acá; con el link, abriéndolo.
 */
function ConfirmSignup({ email }: { email: string }) {
  const [state, action] = useActionState(verifySignupCode, {
    ...initialFormState,
    values: { email },
  });
  const [resendState, resend] = useActionState(
    resendSignupCode,
    initialFormState,
  );
  const error = state.fieldErrors?.code;

  return (
    <div className="grid gap-4">
      <EmailSent title="Confirmá tu email">
        Te mandamos un email a{" "}
        <strong className="text-foreground">{email}</strong>. Ingresá el código.
      </EmailSent>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="email" value={email} />
        <FormField id="code" label="Código" error={error}>
          <Input
            {...fieldA11y("code", error)}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={10}
            placeholder="123456"
            className="h-10 text-center font-mono text-lg tracking-[0.3em]"
          />
        </FormField>
        <SubmitButton pendingText="Confirmando…" size="lg">
          Confirmar y seguir
        </SubmitButton>
      </form>
      <form action={resend} className="grid justify-items-center gap-1 text-sm">
        <input type="hidden" name="email" value={email} />
        <ResendButton />
        {resendState.message && (
          <p className="text-xs text-muted-foreground" role="status">
            {resendState.message}
          </p>
        )}
      </form>
    </div>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
    >
      {pending ? "Enviando…" : "No me llegó, mandar otro"}
    </button>
  );
}

function ResetRequestForm() {
  const [state, action] = useActionState(
    requestPasswordReset,
    initialFormState,
  );
  const err = state.fieldErrors ?? {};

  if (state.saved) {
    return (
      <EmailSent title="Revisá tu email">
        Si hay una cuenta con{" "}
        <strong className="text-foreground">{state.values?.email}</strong>, te
        llega un link para elegir una contraseña nueva. Abrilo en este mismo
        navegador.
      </EmailSent>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <ErrorMessage state={state} />
      <EmailField error={err.email} defaultValue={state.values?.email} />
      <SubmitButton pendingText="Enviando…" size="lg">
        Mandarme el link
      </SubmitButton>
    </form>
  );
}

function GoogleForm({ signup }: { signup: boolean }) {
  const [state, action] = useActionState(signInWithGoogle, initialFormState);
  return (
    <form action={action} className="grid gap-3">
      <ErrorMessage state={state} />
      <GoogleButton>
        {signup ? "Registrarme con Google" : "Ingresar con Google"}
      </GoogleButton>
    </form>
  );
}

function EmailField({
  error,
  defaultValue,
}: {
  error?: string;
  defaultValue?: string;
}) {
  return (
    <FormField id="email" label="Email" error={error}>
      <Input
        {...fieldA11y("email", error)}
        type="email"
        required
        autoComplete="email"
        placeholder="tu@comercio.com"
        defaultValue={defaultValue}
        className="h-10"
      />
    </FormField>
  );
}

function ErrorMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

function EmailSent({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-xl border p-5">
      <MailCheck className="size-6 text-primary" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function GoogleButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      className="w-full gap-2"
      disabled={pending}
      aria-disabled={pending}
    >
      <GoogleLogo />
      {pending ? "Abriendo Google…" : children}
    </Button>
  );
}

/** Logo de Google (la «G» de cuatro colores de sus guías de marca para «Sign in with Google»). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** Login de desarrollo (sin Supabase): se pega un token generado por la API. */
export function DevTokenForm() {
  const [state, action] = useActionState(loginWithToken, initialFormState);
  const error = state.fieldErrors?.token;

  return (
    <form action={action} className="grid gap-4">
      <ErrorMessage state={state} />
      <FormField
        id="token"
        label="Token de desarrollo"
        error={error}
        hint={
          <>
            Generalo con{" "}
            <code className="font-mono">
              npm run dev:token -w @pedilo/api -- --name tu-comercio
            </code>
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
