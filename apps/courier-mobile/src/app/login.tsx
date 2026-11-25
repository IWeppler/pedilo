import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Button, Card, Field } from "@/components/ui";
import { devLoginAllowed, supabaseConfigured, useAuth } from "@/lib/auth";
import { space, useTheme } from "@/lib/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ingreso con un código de 6 dígitos que llega por email. */
export default function LoginScreen() {
  const t = useTheme();
  const { sendCode, verifyCode, signInWithDevToken } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devToken, setDevToken] = useState("");
  const [showDev, setShowDev] = useState(!supabaseConfigured);

  const run = async (fn: () => Promise<string | null | void>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await fn();
      if (message) setError(message);
      return !message;
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: t.primary }]}>
            <Icon name="delivery" size={40} color={t.primaryText} />
          </View>
          <Text style={[styles.title, { color: t.text }]}>Pedilo Repartidor</Text>
          <Text style={[styles.subtitle, { color: t.muted }]}>Recibí ofertas de envío de los comercios de tu ciudad.</Text>

          {supabaseConfigured && (
            <Card>
              {!sent ? (
                <>
                  <Field
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="vos@ejemplo.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                  <Button
                    label={busy ? "Enviando…" : "Enviarme un código"}
                    disabled={busy || !EMAIL_RE.test(email.trim())}
                    onPress={async () => {
                      if (await run(() => sendCode(email.trim().toLowerCase()))) setSent(true);
                    }}
                  />
                </>
              ) : (
                <>
                  <Text style={{ color: t.text }}>Te mandamos un código a {email.trim()}. Puede tardar un minuto.</Text>
                  <Field
                    label="Código"
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/[^0-9]/g, "").slice(0, 6))}
                    placeholder="123456"
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                  />
                  <Button
                    label={busy ? "Verificando…" : "Entrar"}
                    disabled={busy || code.length !== 6}
                    onPress={() => void run(() => verifyCode(email.trim().toLowerCase(), code))}
                  />
                  <Pressable onPress={() => setSent(false)} accessibilityRole="button">
                    <Text style={[styles.link, { color: t.primary }]}>Usar otro email</Text>
                  </Pressable>
                </>
              )}
            </Card>
          )}

          {error && <Text style={[styles.error, { color: t.danger }]}>{error}</Text>}

          {devLoginAllowed &&
            (showDev ? (
              <Card>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  Desarrollo: pegá un token de `npm run dev:token -w @pedilo/api -- --name Juan`.
                </Text>
                <Field label="Token" value={devToken} onChangeText={setDevToken} autoCapitalize="none" multiline />
                <Button
                  label="Entrar con token"
                  variant="outline"
                  disabled={devToken.trim().length < 20}
                  onPress={() => void run(() => signInWithDevToken(devToken.trim()))}
                />
              </Card>
            ) : (
              <Pressable onPress={() => setShowDev(true)} accessibilityRole="button">
                <Text style={[styles.link, { color: t.muted }]}>Entrar con token de desarrollo</Text>
              </Pressable>
            ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg, flexGrow: 1, justifyContent: "center" },
  logo: { width: 80, height: 80, borderRadius: 999, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 15, textAlign: "center" },
  link: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  error: { fontSize: 14, fontWeight: "600", textAlign: "center" },
});
