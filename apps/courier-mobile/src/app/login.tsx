import { type ComponentRef, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { supabaseConfigured, useAuth } from "@/lib/auth";
import { radius, space, useTheme } from "@/lib/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Largo del código por email: tiene que coincidir con «Email OTP Length» de Supabase. */
const CODE_LENGTH = Number(process.env.EXPO_PUBLIC_OTP_LENGTH) || 6;
/** Espera antes de poder pedir otro código (Supabase limita los envíos). */
const RESEND_SECONDS = 60;

/**
 * Ingreso del repartidor: email → código por email (ADR 0015). Pensada para usar en la calle,
 * con una mano: letra grande, mucho contraste y botones altos. El código se manda solo al
 * completarlo; se puede pegar o dejar que el teléfono lo complete.
 */
export default function LoginScreen() {
  const t = useTheme();
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);

  const address = email.trim().toLowerCase();

  const send = async () => {
    setBusy(true);
    setError(null);
    const message = await sendCode(address);
    setBusy(false);
    if (message) return setError(message);
    setSentAt(Date.now());
    setStep("code");
  };

  return (
    <View style={[styles.screen, { backgroundColor: t.primary }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false}>
          <SafeAreaView edges={["top"]} style={styles.hero}>
            <View style={[styles.mark, { backgroundColor: t.text }]}>
              <Icon name="delivery" size={30} color={t.primary} />
            </View>
            {step === "email" ? (
              <>
                <Text style={[styles.headline, { color: t.text }]} accessibilityRole="header">
                  Repartí con Pedilo
                </Text>
                <Text style={[styles.lede, { color: t.text }]}>Ofertas de envío de los comercios de tu ciudad, en tu celular.</Text>
              </>
            ) : (
              <>
                <Text style={[styles.headline, { color: t.text }]} accessibilityRole="header">
                  Revisá tu email
                </Text>
                <Text style={[styles.lede, { color: t.text }]}>
                  Te mandamos un código de {CODE_LENGTH} dígitos a{"\n"}
                  <Text style={{ fontWeight: "800" }}>{address}</Text>
                </Text>
              </>
            )}
          </SafeAreaView>

          <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: t.background }]}>
            {!supabaseConfigured ? (
              <Text style={[styles.body, { color: t.danger }]}>
                Esta versión de la app no tiene configurado el ingreso. Falta EXPO_PUBLIC_SUPABASE_URL y su clave pública.
              </Text>
            ) : step === "email" ? (
              <EmailStep email={email} onChange={setEmail} busy={busy} error={error} onSubmit={() => void send()} />
            ) : (
              <CodeStep
                sentAt={sentAt}
                onVerify={async (code) => {
                  const message = await verifyCode(address, code);
                  return message;
                }}
                onResend={async () => {
                  const message = await sendCode(address);
                  if (!message) setSentAt(Date.now());
                  return message;
                }}
                onChangeEmail={() => {
                  setError(null);
                  setStep("email");
                }}
              />
            )}
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function EmailStep({
  email,
  onChange,
  busy,
  error,
  onSubmit,
}: {
  email: string;
  onChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const valid = EMAIL_RE.test(email.trim());
  return (
    <>
      <View style={{ gap: space.sm }}>
        <Text style={[styles.label, { color: t.text }]} nativeID="email-label">
          Tu email
        </Text>
        <View style={[styles.inputBox, { backgroundColor: t.card, borderColor: error ? t.danger : focused ? t.primary : t.border }]}>
          <Icon name="mail" size={22} color={focused ? t.primary : t.muted} />
          <TextInput
            value={email}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => valid && !busy && onSubmit()}
            placeholder="nombre@gmail.com"
            placeholderTextColor={t.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            accessibilityLabelledBy="email-label"
            accessibilityLabel="Tu email"
            style={[styles.input, { color: t.text }]}
          />
        </View>
        {error && (
          <Text style={[styles.body, { color: t.danger }]} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        )}
      </View>
      <BigButton label="Enviarme el código" busyLabel="Enviando…" busy={busy} disabled={!valid} onPress={onSubmit} />
      <Text style={[styles.note, { color: t.muted }]}>
        No hace falta contraseña: entrás con un código que llega a tu email. Si es la primera vez, después te pedimos tus datos.
      </Text>
    </>
  );
}

function CodeStep({
  sentAt,
  onVerify,
  onResend,
  onChangeEmail,
}: {
  sentAt: number;
  onVerify: (code: string) => Promise<string | null>;
  onResend: () => Promise<string | null>;
  onChangeEmail: () => void;
}) {
  const t = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [shake] = useState(() => new Animated.Value(0));
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));
  useEffect(() => {
    if (wait === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const verify = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const message = await onVerify(value);
    setBusy(false);
    if (!message) return; // Entró: el layout cambia de pantalla solo.
    setError(message);
    setCode("");
    input.current?.focus();
    if (!(await AccessibilityInfo.isReduceMotionEnabled().catch(() => false))) {
      Animated.sequence(
        [-10, 10, -6, 6, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: Platform.OS !== "web" })),
      ).start();
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  const resend = async () => {
    setError(null);
    setCode("");
    const message = await onResend();
    setNow(Date.now());
    if (message) setError(message);
    else setNotice("Te mandamos un código nuevo. El anterior ya no sirve.");
    input.current?.focus();
  };

  return (
    <>
      <View style={{ gap: space.sm }}>
        <Text style={[styles.label, { color: t.text }]}>Código</Text>
        <Pressable onPress={() => input.current?.focus()} accessible={false}>
          <Animated.View style={[styles.cells, { transform: [{ translateX: shake }] }]}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => {
              const digit = code[i];
              const active = focused && !busy && i === Math.min(code.length, CODE_LENGTH - 1) && code.length < CODE_LENGTH;
              return (
                <View
                  key={i}
                  style={[
                    styles.cell,
                    {
                      backgroundColor: digit ? t.surface : t.card,
                      borderColor: error ? t.danger : active ? t.primary : digit ? t.surface : t.border,
                    },
                  ]}
                >
                  <Text style={[styles.digit, { color: t.text }]}>{digit ?? ""}</Text>
                  {active && <View style={[styles.caret, { backgroundColor: t.primary }]} />}
                </View>
              );
            })}
          </Animated.View>
          {/* Un solo input invisible encima de las casillas: teclado numérico, pegar y autocompletar. */}
          <TextInput
            ref={input}
            value={code}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            editable={!busy}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            caretHidden
            accessibilityLabel={`Código de ${CODE_LENGTH} dígitos`}
            style={styles.hiddenInput}
          />
        </Pressable>
        {error ? (
          <Text style={[styles.body, { color: t.danger }]} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : notice ? (
          <Text style={[styles.body, { color: t.success }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : (
          <Text style={[styles.note, { color: t.muted }]}>Si no lo ves, buscalo en spam. Vence en una hora.</Text>
        )}
      </View>

      <BigButton
        label="Entrar"
        busyLabel="Verificando…"
        busy={busy}
        disabled={code.length < CODE_LENGTH}
        onPress={() => void verify(code)}
      />

      <View style={styles.links}>
        <Pressable onPress={() => void resend()} disabled={wait > 0 || busy} accessibilityRole="button" hitSlop={10}>
          <Text style={[styles.link, { color: wait > 0 ? t.muted : t.text }]}>
            {wait > 0 ? `Pedir otro código en ${wait} s` : "Pedir otro código"}
          </Text>
        </Pressable>
        <Pressable onPress={onChangeEmail} disabled={busy} accessibilityRole="button" hitSlop={10}>
          <Text style={[styles.link, { color: t.text }]}>Cambiar email</Text>
        </Pressable>
      </View>
    </>
  );
}

function BigButton({
  label,
  busyLabel,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? t.surface : t.primary, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {busy && <ActivityIndicator color={t.primaryText} />}
      <Text style={[styles.buttonText, { color: disabled ? t.muted : t.primaryText }]}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 36, gap: space.md },
  mark: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  headline: { fontSize: 36, lineHeight: 40, fontWeight: "900", letterSpacing: -0.8 },
  lede: { fontSize: 17, lineHeight: 24, fontWeight: "500", maxWidth: 340 },
  sheet: {
    flexGrow: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: 28,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  label: { fontSize: 15, fontWeight: "700" },
  inputBox: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 2, borderRadius: radius.md, paddingHorizontal: space.lg, height: 60 },
  input: { flex: 1, fontSize: 18, height: "100%" },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  note: { fontSize: 14, lineHeight: 20 },
  cells: { flexDirection: "row", gap: space.sm, justifyContent: "space-between" },
  cell: { flex: 1, maxWidth: 58, height: 68, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
  caret: { position: "absolute", bottom: 12, width: 18, height: 3, borderRadius: 2 },
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0, color: "transparent" },
  button: { height: 58, borderRadius: radius.pill, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 18, fontWeight: "800" },
  links: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space.md },
  link: { fontSize: 15, fontWeight: "700", textDecorationLine: "underline", paddingVertical: space.xs },
});
