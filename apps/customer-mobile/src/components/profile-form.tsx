import { ApiError, unwrap } from "@pedilo/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, type AddressValue, validPinOf } from "@/components/address-fields";
import { Icon } from "@/components/icon";
import { Text, TextInput } from "@/components/text";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCity } from "@/lib/city";
import { font, radius, space, useTheme } from "@/lib/theme";

type Profile = {
  displayName: string;
  phone: string;
  address: { line: string; notes: string | null; location: { lat: number; lng: number } | null } | null;
};

/**
 * Nombre, teléfono y dirección de entrega de la cuenta (ADR 0026). Con esto el checkout no vuelve
 * a pedir nada. Lo usan el registro (la primera vez) y «Tus datos» (para editarlos).
 */
export function ProfileForm({ initial, onDone }: { initial: Profile | null; onDone?: () => void }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { user, suggestedName, signOut } = useAuth();
  const { city } = useCity();
  const editing = initial !== null;
  const [name, setName] = useState(initial?.displayName ?? suggestedName);
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState<AddressValue>(
    initial?.address
      ? {
          line: initial.address.line,
          notes: initial.address.notes ?? "",
          pin: initial.address.location ? { ...initial.address.location, forLine: initial.address.line } : null,
        }
      : { line: "", notes: "", pin: null },
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT("/v1/customer/me", {
          body: {
            displayName: name.trim(),
            phone: phone.trim(),
            address: { line: address.line.trim(), notes: address.notes.trim() || null, location: validPinOf(address) },
          },
        }),
      ),
    onSuccess: (data) => {
      // Al quedar registrado, la app pasa sola a los comercios.
      queryClient.setQueryData(["customer", "me"], data);
      onDone?.();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.status === 400
          ? "Revisá el nombre (al menos 2 letras), el teléfono (con característica) y la dirección."
          : "No pudimos guardar tus datos. Revisá tu conexión y probá de nuevo.",
      ),
  });

  const ready = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 8 && address.line.trim().length >= 3;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {editing && onDone && (
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              onPress={onDone}
              hitSlop={8}
              style={[styles.close, { backgroundColor: t.surface }]}
            >
              <Icon name="close" size={20} color={t.text} />
            </Pressable>
          </View>
        )}
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {editing ? "Tus datos" : "Un paso más"}
          </Text>
          <Text style={[styles.subtitle, { color: t.muted }]}>
            {editing
              ? "Los usamos en todos tus pedidos. La dirección también la podés cambiar al pedir."
              : "Con esto no te volvemos a pedir nada al hacer un pedido."}
          </Text>

          <Field label="Nombre y apellido" value={name} onChange={setName} autoComplete="name" />
          <Field
            label="Teléfono"
            hint="Para que el comercio o el repartidor te puedan llamar."
            value={phone}
            onChange={setPhone}
            placeholder="3491 555-123"
            keyboardType="phone-pad"
            autoComplete="tel"
          />

          <Text style={[styles.section, { color: t.text }]}>Dirección de entrega</Text>
          <AddressFields value={address} onChange={setAddress} cityName={city?.name} fallback={null} inputBackground={t.surface} />

          {error && (
            <View style={[styles.notice, { backgroundColor: t.dangerBg }]} accessibilityLiveRegion="polite">
              <Icon name="warning" size={18} color={t.danger} />
              <Text style={{ color: t.danger, flex: 1, fontWeight: "600" }}>{error}</Text>
            </View>
          )}

          <Button
            label={save.isPending ? "Guardando…" : editing ? "Guardar" : "Empezar a pedir"}
            onPress={() => {
              setError(null);
              save.mutate();
            }}
            disabled={!ready || save.isPending}
            style={{ marginTop: space.sm }}
          />
          <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={8} style={styles.signOut}>
            <Text style={{ color: t.muted, fontWeight: "600", textDecorationLine: "underline" }}>
              {user?.email ? `Salir de ${user.email}` : "Salir"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoComplete,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad" | "default";
  autoComplete?: "name" | "tel";
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        keyboardType={keyboardType ?? "default"}
        autoComplete={autoComplete}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
      />
      {hint && <Text style={{ color: t.muted, fontSize: 13 }}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.lg, paddingTop: space.sm },
  close: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, paddingTop: space.xl, gap: space.md, paddingBottom: space.xl },
  title: { fontFamily: font.display, fontSize: 32, lineHeight: 36, fontWeight: "800", letterSpacing: -0.6 },
  subtitle: { fontSize: 16, lineHeight: 23, marginBottom: space.sm, maxWidth: 360 },
  section: { fontFamily: font.display, fontSize: 18, fontWeight: "700", marginTop: space.sm },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  notice: { flexDirection: "row", gap: space.sm, alignItems: "center", borderRadius: radius.md, padding: space.md },
  signOut: { alignSelf: "center", paddingVertical: space.sm },
});
