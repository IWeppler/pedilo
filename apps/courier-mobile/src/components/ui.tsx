import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, type TextInputProps, View, type ViewStyle } from "react-native";

import { Text, TextInput } from "@/components/text";
import { radius, space, useTheme } from "@/lib/theme";

/** Piezas chicas de UI reutilizadas en las pantallas. */

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function Loading() {
  const t = useTheme();
  return (
    <Centered>
      <ActivityIndicator color={t.text} />
    </Centered>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <Centered>
      <Text style={[styles.body, { color: t.text, textAlign: "center" }]}>{message}</Text>
      {onRetry && <Button label="Reintentar" onPress={onRetry} variant="outline" />}
    </Centered>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "danger" }) {
  const t = useTheme();
  const colors = {
    neutral: { bg: t.surface, fg: t.muted },
    success: { bg: t.successBg, fg: t.success },
    danger: { bg: t.dangerBg, fg: t.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primary : "transparent" }]}
    >
      <Text style={[styles.chipText, { color: selected ? t.primaryText : t.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline";
  style?: ViewStyle;
}) {
  const t = useTheme();
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.primary : "transparent",
          borderColor: primary ? t.primary : t.border,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? t.primaryText : t.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  // Sin sombras: la tarjeta se separa del fondo con una línea.
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

/** Etiqueta + input con el estilo de la app. */
export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        {...props}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }, props.style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  fieldLabel: { fontSize: 13, fontWeight: "600" },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  body: { fontSize: 15 },
  badge: { borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: "500" },
  button: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: space.lg, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
