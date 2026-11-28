import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { AuthHeading, AuthScreen, ErrorNotice, Field, MIN_PASSWORD, PasswordInput, PrimaryButton, TextLink } from "@/components/auth-ui";
import { useAuth } from "@/lib/auth";
import { space } from "@/lib/theme";

/**
 * Volvió del link de «¿Olvidaste tu contraseña?» (ADR 0026): ya tiene sesión, pero antes de seguir
 * elige la contraseña nueva. Al guardarla, `_layout` lo lleva a la app.
 */
export default function ResetPasswordScreen() {
  const { updatePassword, signOut, user } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length >= MIN_PASSWORD;

  const save = async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    const failed = await updatePassword(password);
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <AuthScreen>
      <AuthHeading icon="note" title="Elegí tu contraseña nueva" lede={user?.email ? `Para ${user.email}.` : undefined} />
      <View style={styles.stack}>
        <Field label="Contraseña nueva" hint={`Al menos ${MIN_PASSWORD} caracteres.`}>
          <PasswordInput
            isNew
            value={password}
            onChangeText={setPassword}
            placeholder="Elegí una contraseña"
            returnKeyType="go"
            onSubmitEditing={() => void save()}
            autoFocus
          />
        </Field>
        {error && <ErrorNotice message={error} />}
        <PrimaryButton label="Guardar contraseña" busy={busy} disabled={!ready || busy} onPress={() => void save()} />
        <TextLink label="Cancelar y salir" onPress={() => void signOut()} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
