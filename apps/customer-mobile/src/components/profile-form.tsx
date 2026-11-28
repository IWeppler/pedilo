import { ApiError, unwrap } from "@pedilo/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, type AddressValue, validPinOf } from "@/components/address-fields";
import { Icon, type IconName } from "@/components/icon";
import { Text, TextInput } from "@/components/text";
import { Button } from "@/components/ui";
import { useDeliveryAddress } from "@/lib/addresses";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCity } from "@/lib/city";
import { font, radius, space, useTheme } from "@/lib/theme";

type Profile = { displayName: string; phone: string };

type AddressSlot = { enabled: boolean; value: AddressValue };
const emptyAddress = (): AddressValue => ({ line: "", notes: "", pin: null });
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Nombre y teléfono de la cuenta (ADR 0026) y, en el registro, Casa y/o Trabajo (ADR 0034): con
 * esto el checkout no vuelve a pedir nada. Lo usan el registro (la primera vez) y «Tus datos»
 * (solo nombre y teléfono; las direcciones se editan en «¿Desde dónde pedís?»).
 */
export function ProfileForm({ initial, onDone }: { initial: Profile | null; onDone?: () => void }) {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, suggestedName, signOut } = useAuth();
  const { city } = useCity();
  const { select } = useDeliveryAddress();
  const editing = initial !== null;
  const [name, setName] = useState(initial?.displayName ?? suggestedName);
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [home, setHome] = useState<AddressSlot>({ enabled: true, value: emptyAddress() });
  const [work, setWork] = useState<AddressSlot>({ enabled: false, value: emptyAddress() });
  const [error, setError] = useState<string | null>(null);

  const filled = (slot: AddressSlot) => slot.enabled && slot.value.line.trim().length >= 3;
  const toSave = editing
    ? []
    : (
        [
          ["HOME", home],
          ["WORK", work],
        ] as const
      ).filter(([, slot]) => filled(slot));

  const save = useMutation({
    mutationFn: async () => {
      const profile = await unwrap(api.PUT("/v1/customer/me", { body: { displayName: name.trim(), phone: phone.trim() } }));
      if (editing) return profile;
      // Un reintento no duplica: se saltean las que ya quedaron guardadas.
      const have = new Set(profile.addresses.map((a) => a.label));
      let first: string | null = null;
      for (const [label, slot] of toSave) {
        if (have.has(label)) continue;
        const created = await unwrap(
          api.POST("/v1/customer/me/addresses", {
            body: { label, line: slot.value.line.trim(), notes: slot.value.notes.trim() || null, location: validPinOf(slot.value) },
          }),
        );
        first ??= created.id;
      }
      if (first) select(first);
      return unwrap(api.GET("/v1/customer/me"));
    },
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

  const ready =
    name.trim().length >= 2 &&
    digits(phone).length >= 8 &&
    (editing || (toSave.length > 0 && [home, work].every((slot) => !slot.enabled || filled(slot))));

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
            {editing ? "Los usamos en todos tus pedidos." : "Con esto no te volvemos a pedir nada al hacer un pedido."}
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

          {editing ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/address")}
              style={({ pressed }) => [styles.linkRow, { backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 }]}
            >
              <Icon name="location" size={20} color={t.text} />
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "700", flex: 1 }}>Tus direcciones</Text>
              <Icon name="chevronRight" size={18} color={t.muted} />
            </Pressable>
          ) : (
            <>
              <Text style={[styles.section, { color: t.text }]}>¿Dónde te llevamos los pedidos?</Text>
              <Text style={{ color: t.muted, marginTop: -space.sm }}>Cargá tu casa, tu trabajo o las dos. Después podés sumar más.</Text>
              <AddressSlotCard title="Casa" icon="home" slot={home} onChange={setHome} cityName={city?.name} canSkip={work.enabled} />
              <AddressSlotCard title="Trabajo" icon="work" slot={work} onChange={setWork} cityName={city?.name} canSkip={home.enabled} />
            </>
          )}

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

/** Casa o Trabajo en el registro: se completa o se saltea (siempre queda al menos una). */
function AddressSlotCard({
  title,
  icon,
  slot,
  onChange,
  cityName,
  canSkip,
}: {
  title: string;
  icon: IconName;
  slot: AddressSlot;
  onChange: (next: AddressSlot) => void;
  cityName: string | undefined;
  canSkip: boolean;
}) {
  const t = useTheme();
  if (!slot.enabled) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange({ ...slot, enabled: true })}
        style={({ pressed }) => [styles.linkRow, { backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 }]}
      >
        <Icon name="add" size={20} color={t.text} />
        <Text style={{ color: t.text, fontSize: 16, fontWeight: "700", flex: 1 }}>Agregar {title.toLowerCase()}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.slot, { backgroundColor: t.surface }]}>
      <View style={styles.slotHeader}>
        <Icon name={icon} size={20} color={t.text} />
        <Text style={{ color: t.text, fontSize: 16, fontWeight: "800", flex: 1 }}>{title}</Text>
        {canSkip && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Saltear ${title.toLowerCase()}`}
            onPress={() => onChange({ ...slot, enabled: false })}
            hitSlop={8}
          >
            <Text style={{ color: t.muted, fontWeight: "600", textDecorationLine: "underline" }}>Saltear</Text>
          </Pressable>
        )}
      </View>
      <AddressFields value={slot.value} onChange={(value) => onChange({ ...slot, value })} cityName={cityName} fallback={null} inputBackground={t.background} />
    </View>
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
  linkRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  slot: { borderRadius: radius.md, padding: space.md, gap: space.md },
  slotHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  notice: { flexDirection: "row", gap: space.sm, alignItems: "center", borderRadius: radius.md, padding: space.md },
  signOut: { alignSelf: "center", paddingVertical: space.sm },
});
