import { type ComponentProps, type ComponentRef, type ReactNode, type Ref, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type TextInput as RNTextInput,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Text, TextInput } from "@/components/text";
import { font, radius, space, useTheme } from "@/lib/theme";

/** Piezas de las pantallas de ingreso (login y contraseña nueva, ADR 0026). */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;

/** Pantalla centrada, con el formulario de 400 px como máximo en pantallas anchas. */
export function AuthScreen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Título y una línea de explicación, con un ícono opcional arriba. */
export function AuthHeading({ title, lede, icon }: { title: string; lede?: ReactNode; icon?: "check" | "note" }) {
  const t = useTheme();
  return (
    <>
      {icon && (
        <View style={[styles.icon, { backgroundColor: t.accentSoft }]}>
          <Icon name={icon} size={26} color={t.accent} />
        </View>
      )}
      <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
        {title}
      </Text>
      {lede && <Text style={[styles.lede, { color: t.muted }]}>{lede}</Text>}
    </>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      {children}
      {hint && <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>}
    </View>
  );
}

export function EmailInput(props: Omit<ComponentProps<typeof TextInput>, "style">) {
  const t = useTheme();
  return (
    <TextInput
      placeholder="tu@email.com"
      placeholderTextColor={t.muted}
      accessibilityLabel="Email"
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      textContentType="emailAddress"
      {...props}
      style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
    />
  );
}

/** Contraseña con «Mostrar / Ocultar»: más fácil que pedirla dos veces. */
export function PasswordInput({
  inputRef,
  isNew,
  ...props
}: Omit<ComponentProps<typeof TextInput>, "style" | "secureTextEntry"> & { inputRef?: Ref<ComponentRef<typeof RNTextInput>>; isNew: boolean }) {
  const t = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View style={[styles.passwordRow, { backgroundColor: t.surface }]}>
      <TextInput
        ref={inputRef as never}
        placeholderTextColor={t.muted}
        accessibilityLabel="Contraseña"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={isNew ? "new-password" : "current-password"}
        textContentType={isNew ? "newPassword" : "password"}
        {...props}
        secureTextEntry={!visible}
        style={[styles.input, styles.passwordInput, { color: t.text }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        style={styles.reveal}
      >
        <Text style={[styles.revealLabel, { color: t.muted }]}>{visible ? "Ocultar" : "Mostrar"}</Text>
      </Pressable>
    </View>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  const t = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: t.dangerBg }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name="warning" size={18} color={t.danger} />
      <Text style={[styles.noticeText, { color: t.danger }]}>{message}</Text>
    </View>
  );
}

export function PrimaryButton({ label, busy, disabled, onPress }: { label: string; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: t.primary, opacity: disabled && !busy ? 0.35 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={t.primaryText} /> : <Text style={[styles.buttonLabel, { color: t.primaryText }]}>{label}</Text>}
    </Pressable>
  );
}

/** Acción secundaria como texto subrayado. */
export function TextLink({
  label,
  onPress,
  disabled,
  align = "center",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  align?: "center" | "start" | "end";
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[styles.textLink, { alignSelf: align === "center" ? "center" : align === "start" ? "flex-start" : "flex-end" }]}
    >
      <Text style={[styles.textLinkLabel, { color: disabled ? t.muted : t.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.xl, paddingVertical: space.xl },
  column: { width: "100%", maxWidth: 400, alignSelf: "center", gap: space.lg },

  icon: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.display, fontWeight: "800", fontSize: 30, lineHeight: 34, letterSpacing: -0.6 },
  lede: { fontSize: 16, lineHeight: 23, marginTop: -space.sm },

  label: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 13 },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 14, fontSize: 16 },
  passwordRow: { flexDirection: "row", alignItems: "center", borderRadius: radius.md },
  passwordInput: { flex: 1 },
  reveal: { paddingHorizontal: space.md, paddingVertical: space.sm },
  revealLabel: { fontSize: 14, fontWeight: "700" },

  button: { minHeight: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg },
  buttonLabel: { fontSize: 16, fontWeight: "700" },

  notice: { flexDirection: "row", gap: space.sm, alignItems: "center", borderRadius: radius.md, padding: space.md },
  noticeText: { flex: 1, fontSize: 15, fontWeight: "600" },
  textLink: { paddingVertical: space.xs },
  textLinkLabel: { fontSize: 15, fontWeight: "700", textDecorationLine: "underline" },
});
