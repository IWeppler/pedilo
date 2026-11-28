import { type ComponentRef, useRef, useState } from "react";
import { ActivityIndicator, Pressable, type TextInput as RNTextInput, StyleSheet, View } from "react-native";

import {
  AuthHeading,
  AuthScreen,
  EMAIL_PATTERN,
  EmailInput,
  ErrorNotice,
  Field,
  MIN_PASSWORD,
  PasswordInput,
  PrimaryButton,
  TextLink,
} from "@/components/auth-ui";
import { AppleLogo, GoogleLogo } from "@/components/brand-logos";
import { Text } from "@/components/text";
import { authConfigured, type SignInProvider, useAuth } from "@/lib/auth";
import { font, radius, space, useTheme } from "@/lib/theme";

type Mode = "signIn" | "signUp";
/** Qué muestra la pantalla: el formulario, o el aviso de que le mandamos un email. */
type View_ =
  | { kind: "form" }
  | { kind: "confirmSent"; email: string }
  | { kind: "forgot" }
  | { kind: "resetSent"; email: string };

/**
 * Lo primero que ve el cliente (ADR 0026): ingresar o crear la cuenta con Google, Apple o email y
 * contraseña. Con email, la cuenta se confirma con el link que le llega; si olvidó la contraseña,
 * pide un link para elegir otra. Al entrar, `_layout` lleva a donde corresponde.
 */
export default function LoginScreen() {
  const t = useTheme();
  const { signIn, signInWithPassword, signUpWithPassword, resendConfirmation, sendPasswordReset } = useAuth();
  const [view, setView] = useState<View_>({ kind: "form" });
  const [mode, setMode] = useState<Mode>("signIn");
  const [busy, setBusy] = useState<SignInProvider | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resent, setResent] = useState(false);
  const passwordInput = useRef<ComponentRef<typeof RNTextInput>>(null);

  const signUp = mode === "signUp";
  const cleanEmail = email.trim().toLowerCase();
  const emailOk = EMAIL_PATTERN.test(cleanEmail);
  const ready = emailOk && password.length >= (signUp ? MIN_PASSWORD : 1);

  const go = (next: View_) => {
    setError(null);
    setResent(false);
    setView(next);
  };

  const withProvider = async (provider: SignInProvider) => {
    setError(null);
    setBusy(provider);
    const result = await signIn(provider);
    setBusy(null);
    if (result !== null && result !== "cancelled") setError(result);
  };

  const submit = async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy("email");
    const result = signUp ? await signUpWithPassword(cleanEmail, password) : await signInWithPassword(cleanEmail, password);
    setBusy(null);
    if (result?.kind === "confirm") go({ kind: "confirmSent", email: result.email });
    else if (result?.kind === "error") setError(result.message);
  };

  const requestReset = async () => {
    if (!emailOk || busy) return;
    setError(null);
    setBusy("email");
    const failed = await sendPasswordReset(cleanEmail);
    setBusy(null);
    if (failed) setError(failed);
    else go({ kind: "resetSent", email: cleanEmail });
  };

  const resend = async (send: () => Promise<string | null>) => {
    setError(null);
    const failed = await send();
    if (failed) setError(failed);
    else setResent(true);
  };

  // --- Le mandamos un email: confirmar la cuenta o elegir otra contraseña ---
  if (view.kind === "confirmSent" || view.kind === "resetSent") {
    const reset = view.kind === "resetSent";
    const sentTo = view.email;
    return (
      <AuthScreen>
        <AuthHeading
          icon="check"
          title="Revisá tu email"
          lede={
            reset ? (
              <>
                Si hay una cuenta con <Text style={{ color: t.text, fontWeight: "700" }}>{sentTo}</Text>, te llega un link para elegir una
                contraseña nueva. Abrilo desde este celular.
              </>
            ) : (
              <>
                Te mandamos un link a <Text style={{ color: t.text, fontWeight: "700" }}>{sentTo}</Text>. Abrilo desde este celular para
                confirmar tu cuenta.
              </>
            )
          }
        />
        <View style={styles.stack}>
          <PrimaryButton
            label={reset ? "Volver a ingresar" : "Ya lo confirmé"}
            onPress={() => {
              setMode("signIn");
              go({ kind: "form" });
            }}
          />
          <TextLink
            label={resent ? "Te mandamos otro email" : "Mandar el email de nuevo"}
            disabled={resent}
            onPress={() => void resend(() => (reset ? sendPasswordReset(sentTo) : resendConfirmation(sentTo)))}
          />
        </View>
        {error && <ErrorNotice message={error} />}
      </AuthScreen>
    );
  }

  // --- Olvidó la contraseña: pide el link ---
  if (view.kind === "forgot") {
    return (
      <AuthScreen>
        <AuthHeading title="Elegí una contraseña nueva" lede="Te mandamos un link a tu email para cambiarla." />
        <View style={styles.stack}>
          <Field label="Email">
            <EmailInput value={email} onChangeText={setEmail} returnKeyType="send" onSubmitEditing={() => void requestReset()} autoFocus />
          </Field>
          {error && <ErrorNotice message={error} />}
          <PrimaryButton label="Mandarme el link" busy={busy === "email"} disabled={!emailOk || busy !== null} onPress={() => void requestReset()} />
          <TextLink label="Volver" onPress={() => go({ kind: "form" })} />
        </View>
      </AuthScreen>
    );
  }

  // --- Ingresar o crear la cuenta ---
  return (
    <AuthScreen>
      <Text style={[styles.wordmark, { color: t.accent }]} accessibilityRole="header" accessibilityLabel="Pedilo">
        pedilo
      </Text>
      <Text style={[styles.lede, { color: t.text }]}>{signUp ? "Creá tu cuenta para pedir." : "Ingresá para pedir."}</Text>

      {!authConfigured ? (
        <ErrorNotice message="El ingreso no está configurado en esta versión de la app." />
      ) : (
        <>
          <View style={styles.stack}>
            <ProviderButton provider="google" label="Continuar con Google" busy={busy === "google"} disabled={busy !== null} onPress={() => void withProvider("google")} />
            <ProviderButton provider="apple" label="Continuar con Apple" busy={busy === "apple"} disabled={busy !== null} onPress={() => void withProvider("apple")} />
          </View>

          <View style={styles.divider} accessible accessibilityLabel="O con tu email">
            <View style={[styles.rule, { backgroundColor: t.border }]} />
            <Text style={[styles.dividerText, { color: t.muted }]}>o con tu email</Text>
            <View style={[styles.rule, { backgroundColor: t.border }]} />
          </View>

          <View style={[styles.segment, { backgroundColor: t.surface }]} accessibilityRole="tablist">
            {(["signIn", "signUp"] as const).map((m) => {
              const selected = mode === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setMode(m);
                    setError(null);
                  }}
                  style={[styles.segmentItem, selected && { backgroundColor: t.background, borderColor: t.border }]}
                >
                  <Text style={[styles.segmentLabel, { color: selected ? t.text : t.muted }]}>{m === "signIn" ? "Ingresar" : "Crear cuenta"}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.stack}>
            <Field label="Email">
              <EmailInput value={email} onChangeText={setEmail} returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
            </Field>
            <Field label="Contraseña" hint={signUp ? `Al menos ${MIN_PASSWORD} caracteres.` : undefined}>
              <PasswordInput
                inputRef={passwordInput}
                isNew={signUp}
                value={password}
                onChangeText={setPassword}
                placeholder={signUp ? "Elegí una contraseña" : "Tu contraseña"}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
            </Field>
            {!signUp && <TextLink label="¿Olvidaste tu contraseña?" align="end" onPress={() => go({ kind: "forgot" })} />}

            {error && <ErrorNotice message={error} />}

            <PrimaryButton label={signUp ? "Crear cuenta" : "Ingresar"} busy={busy === "email"} disabled={!ready || busy !== null} onPress={() => void submit()} />
          </View>
        </>
      )}
    </AuthScreen>
  );
}

/**
 * Botones de Google y Apple según sus pautas de marca: Google blanco con borde gris y su «G» a
 * color; Apple negro con el logo y el texto en blanco.
 */
function ProviderButton({
  provider,
  label,
  busy,
  disabled,
  onPress,
}: {
  provider: SignInProvider;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const apple = provider === "apple";
  const fg = apple ? "#FFFFFF" : "#1F1F1F";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.provider, apple ? styles.apple : styles.google, { opacity: disabled && !busy ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <View style={styles.logo}>{busy ? <ActivityIndicator color={fg} /> : apple ? <AppleLogo size={19} color={fg} /> : <GoogleLogo size={19} />}</View>
      <Text style={[styles.providerLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wordmark: { fontFamily: font.display, fontWeight: "800", fontSize: 64, lineHeight: 64, letterSpacing: -2.5 },
  lede: { fontSize: 18, lineHeight: 25, marginTop: -space.sm, marginBottom: space.sm },
  stack: { gap: space.md },

  provider: {
    minHeight: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  google: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#747775" },
  apple: { backgroundColor: "#000000" },
  logo: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  providerLabel: { fontSize: 16, fontWeight: "700" },

  divider: { flexDirection: "row", alignItems: "center", gap: space.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 14 },

  segment: { flexDirection: "row", borderRadius: radius.pill, padding: 4 },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentLabel: { fontSize: 15, fontWeight: "700" },
});
