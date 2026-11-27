import { type ReactNode, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, type TextInputProps, View, type ViewStyle } from "react-native";

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

/**
 * Etiqueta + input con el estilo de la app: relleno gris que al enfocarse pasa a blanco con
 * borde fino de tinta (el borde siempre existe, así no salta). `prefix` queda fijo a la
 * izquierda («+54», «$»); `hint` explica el formato y `error` lo reemplaza en rojo.
 */
export function Field({
  label,
  prefix,
  hint,
  error,
  ...props
}: { label: string; prefix?: string; hint?: string; error?: string | null } & TextInputProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: t.text }]}>{label}</Text>
      <View
        style={[
          styles.inputBox,
          {
            backgroundColor: focused ? t.background : t.surface,
            borderColor: error ? t.danger : focused ? t.text : t.surface,
          },
          props.multiline && styles.inputBoxMultiline,
        ]}
      >
        {prefix && <Text style={[styles.prefix, { color: t.text, borderColor: t.border }]}>{prefix}</Text>}
        <TextInput
          placeholderTextColor={t.muted}
          accessibilityLabel={prefix ? `${label} (${prefix})` : label}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.input, styles.noOutline, { color: t.text }, props.style]}
        />
      </View>
      {error ? (
        <Text style={[styles.hint, { color: t.danger, fontWeight: "600" }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  fieldLabel: { fontSize: 15, fontWeight: "700" },
  inputBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: radius.md, minHeight: 56, paddingHorizontal: space.md },
  inputBoxMultiline: { alignItems: "flex-start", paddingVertical: space.sm },
  prefix: { fontSize: 17, fontWeight: "600", paddingRight: space.md, marginRight: space.md, borderRightWidth: 1, fontVariant: ["tabular-nums"] },
  input: { flex: 1, fontSize: 17, paddingVertical: 14 },
  // En web el navegador dibuja su propio contorno de foco: el foco ya lo marca la caja.
  noOutline: Platform.select({ web: { outlineWidth: 0 } as object, default: {} }),
  hint: { fontSize: 13, lineHeight: 18 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  body: { fontSize: 15 },
  badge: { borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "600" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.md, paddingVertical: 6 },
  chipText: { fontSize: 14, fontWeight: "500" },
  button: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: space.lg, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
