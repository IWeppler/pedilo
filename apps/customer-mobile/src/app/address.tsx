import { ApiError, unwrap } from "@pedilo/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AddressFields, type AddressValue, validPinOf } from "@/components/address-fields";
import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { Button, Loading } from "@/components/ui";
import { api, useCustomerProfile } from "@/lib/api";
import { useCity } from "@/lib/city";
import { font, radius, space, useTheme } from "@/lib/theme";

/**
 * «Tu dirección» (desde el encabezado del inicio): dónde te llevamos los pedidos, con el punto en el
 * mapa, y la ciudad cuyos comercios ves. Queda guardada en la cuenta (ADR 0026).
 */
export default function AddressScreen() {
  const profile = useCustomerProfile(true);
  if (!profile.data) return <Loading />;
  return <AddressForm profile={profile.data} />;
}

function AddressForm({
  profile,
}: {
  profile: { displayName: string; phone: string; address: { line: string; notes: string | null; location: { lat: number; lng: number } | null } | null };
}) {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { city } = useCity();
  const saved = profile.address;
  const [address, setAddress] = useState<AddressValue>(
    saved ? { line: saved.line, notes: saved.notes ?? "", pin: saved.location ? { ...saved.location, forLine: saved.line } : null } : { line: "", notes: "", pin: null },
  );
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PUT("/v1/customer/me", {
          body: {
            displayName: profile.displayName,
            phone: profile.phone,
            address: { line: address.line.trim(), notes: address.notes.trim() || null, location: validPinOf(address) },
          },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["customer", "me"], data);
      close();
    },
    onError: (err) =>
      setError(err instanceof ApiError && err.status === 400 ? "Revisá la dirección: calle y número." : "No pudimos guardar la dirección. Revisá tu conexión."),
  });

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            Tu dirección
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={close} hitSlop={8} style={[styles.close, { backgroundColor: t.surface }]}>
            <Icon name="close" size={20} color={t.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AddressFields value={address} onChange={setAddress} cityName={city?.name} fallback={null} inputBackground={t.surface} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ciudad: ${city?.name ?? "sin elegir"}. Cambiar`}
            onPress={() => router.push("/city")}
            style={({ pressed }) => [styles.cityRow, { backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 }]}
          >
            <Icon name="location" size={20} color={t.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.muted, fontSize: 13 }}>Ciudad</Text>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{city?.name ?? "Elegí tu ciudad"}</Text>
            </View>
            <Text style={{ color: t.text, fontWeight: "700", textDecorationLine: "underline" }}>Cambiar</Text>
          </Pressable>

          {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}

          <Button
            label={save.isPending ? "Guardando…" : "Guardar dirección"}
            onPress={() => {
              setError(null);
              save.mutate();
            }}
            disabled={address.line.trim().length < 3 || save.isPending}
          />
        </ScrollView>
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
  cityRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
});
