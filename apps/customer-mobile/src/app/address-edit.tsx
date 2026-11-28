import { ApiError } from "@pedilo/api-client";
import { ADDRESS_LABELS, type AddressLabel, addressTitle } from "@pedilo/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, type AddressValue, validPinOf } from "@/components/address-fields";
import { Icon } from "@/components/icon";
import { Text, TextInput } from "@/components/text";
import { Button, Chip, Loading } from "@/components/ui";
import { useAddressMutations, useDeliveryAddress } from "@/lib/addresses";
import { useCity } from "@/lib/city";
import { font, radius, space, useTheme } from "@/lib/theme";

const LABELS: AddressLabel[] = ["HOME", "WORK", "OTHER"];

const REASONS: Record<string, string> = {
  ADDRESS_LABEL_TAKEN: "Ya tenés una dirección con ese nombre. Elegí otra opción.",
  ADDRESS_LIMIT: "Ya tenés 5 direcciones. Borrá una para sumar otra.",
};

/**
 * Agregar o editar una dirección (ADR 0034). Con `id` edita; sin él agrega, y puede venir con el
 * punto y la calle que sugirió el GPS (`lat`, `lng`, `line`). Al agregar, queda elegida.
 */
export default function AddressEditScreen() {
  const params = useLocalSearchParams<{ id?: string; lat?: string; lng?: string; line?: string }>();
  const { addresses, ready } = useDeliveryAddress();
  if (!ready) return <Loading />;
  const existing = params.id ? (addresses.find((a) => a.id === params.id) ?? null) : null;
  return <AddressEditor key={existing?.id ?? "new"} existing={existing} params={params} />;
}

function AddressEditor({
  existing,
  params,
}: {
  existing: ReturnType<typeof useDeliveryAddress>["addresses"][number] | null;
  params: { lat?: string; lng?: string; line?: string };
}) {
  const t = useTheme();
  const router = useRouter();
  const { city } = useCity();
  const { addresses, select } = useDeliveryAddress();
  const { add, update, remove } = useAddressMutations();
  const taken = new Set(addresses.filter((a) => a.id !== existing?.id && a.label !== "OTHER").map((a) => a.label));
  const gps = params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : null;
  const initialLine = existing?.line ?? params.line ?? "";

  const [label, setLabel] = useState<AddressLabel>(existing?.label ?? LABELS.find((l) => l === "OTHER" || !taken.has(l))!);
  const [name, setName] = useState(existing?.name ?? "");
  const [address, setAddress] = useState<AddressValue>({
    line: initialLine,
    notes: existing?.notes ?? "",
    // El punto del GPS no se guarda solo: el mapa se abre para que el cliente lo confirme.
    pin: existing?.location ? { ...existing.location, forLine: initialLine } : null,
  });
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/address"));
  const busy = add.isPending || update.isPending || remove.isPending;

  const onError = (err: unknown) => {
    const reason = err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
    setError(
      (reason && REASONS[reason]) ??
        (err instanceof ApiError && err.status === 400 ? "Revisá la dirección: calle y número." : "No pudimos guardar la dirección. Revisá tu conexión."),
    );
  };

  const save = () => {
    setError(null);
    const input = { label, name: label === "OTHER" ? name : null, line: address.line, notes: address.notes, location: validPinOf(address) };
    if (existing) {
      update.mutate({ id: existing.id, ...input }, { onSuccess: close, onError });
    } else {
      add.mutate(input, {
        onSuccess: (created) => {
          // Queda elegida: al volver, el selector (y el inicio o el checkout) ya la muestran.
          select(created.id);
          close();
        },
        onError,
      });
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {existing ? `Editar ${addressTitle(existing).toLowerCase()}` : "Nueva dirección"}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={close} hitSlop={8} style={[styles.close, { backgroundColor: t.surface }]}>
            <Icon name="close" size={20} color={t.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AddressFields
            value={address}
            onChange={setAddress}
            cityName={city?.name}
            fallback={gps}
            suggestedPin={existing ? null : gps}
            inputBackground={t.surface}
          />
          {gps && !existing && address.line.trim() === initialLine.trim() && initialLine && (
            <Text style={{ color: t.muted }}>Sugerimos la calle según tu ubicación. Revisala y corregí el número si hace falta.</Text>
          )}

          <View style={{ gap: space.sm }}>
            <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>¿Cómo la llamamos?</Text>
            <View style={styles.chips}>
              {LABELS.filter((l) => l === "OTHER" || !taken.has(l)).map((l) => (
                <Chip key={l} label={ADDRESS_LABELS[l]} selected={label === l} onPress={() => setLabel(l)} />
              ))}
            </View>
          </View>
          {label === "OTHER" && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>Nombre (opcional)</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Casa de mamá, club…"
                placeholderTextColor={t.muted}
                accessibilityLabel="Nombre de la dirección"
                maxLength={40}
                style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
              />
            </View>
          )}

          {existing && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => remove.mutate(existing.id, { onSuccess: close, onError })}
              hitSlop={8}
              style={styles.delete}
            >
              <Text style={{ color: t.danger, fontWeight: "700" }}>Borrar esta dirección</Text>
            </Pressable>
          )}
        </ScrollView>

        {/* Pie fijo: el botón se ve aunque el teclado esté abierto. */}
        <View style={[styles.footer, { borderColor: t.border }]}>
          {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
          <Button label={busy ? "Guardando…" : "Guardar dirección"} onPress={save} disabled={address.line.trim().length < 3 || busy} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  title: { fontFamily: font.display, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  close: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  delete: { alignSelf: "center", paddingVertical: space.sm },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
});
