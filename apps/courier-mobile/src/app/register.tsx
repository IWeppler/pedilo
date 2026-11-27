import { ApiError, unwrap } from "@pedilo/api-client";
import { type Vehicle, VEHICLE_LABELS } from "@pedilo/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Button, Card, Chip, Field, Loading } from "@/components/ui";
import { api, useCities } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { font, space, useTheme } from "@/lib/theme";

const VEHICLES: Vehicle[] = ["MOTO", "BIKE", "CAR", "WALK"];

/** Alta del perfil de repartidor. Queda en revisión hasta que Pedilo lo aprueba. */
export default function RegisterScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const cities = useCities();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>("MOTO");
  const [cityId, setCityId] = useState<string | null>(null);
  const [minFee, setMinFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cities.isPending) return <Loading />;
  const city = cityId ?? (cities.data?.length === 1 ? cities.data[0]!.id : null);
  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 8 && city !== null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.POST("/v1/courier/profile", {
          body: {
            displayName: name.trim(),
            phone: phone.trim(),
            vehicle,
            cityId: city!,
            minFeeMinor: Math.round((Number(minFee.replace(",", ".")) || 0) * 100),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["courier", "me"] });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos registrarte. Revisá tu conexión.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: t.text }]}>Registrate como repartidor</Text>
          <Text style={{ color: t.muted }}>Pedilo revisa tus datos antes de habilitarte. Te avisamos acá mismo.</Text>
          <Card>
            <Field label="Nombre y apellido" value={name} onChangeText={setName} autoComplete="name" />
            <Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="3491 123456" />
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: t.muted }]}>Vehículo</Text>
              <View style={styles.chips}>
                {VEHICLES.map((v) => (
                  <Chip key={v} label={VEHICLE_LABELS[v]} selected={vehicle === v} onPress={() => setVehicle(v)} />
                ))}
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: t.muted }]}>Ciudad</Text>
              <View style={styles.chips}>
                {cities.data?.map((c) => (
                  <Chip key={c.id} label={c.name} selected={city === c.id} onPress={() => setCityId(c.id)} />
                ))}
              </View>
            </View>
            <Field
              label="Pago mínimo por envío ($, opcional)"
              value={minFee}
              onChangeText={setMinFee}
              keyboardType="decimal-pad"
              placeholder="No ver ofertas que paguen menos"
            />
          </Card>
          {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
          <Button label={busy ? "Enviando…" : "Enviar para revisión"} disabled={!valid || busy} onPress={() => void submit()} />
          <Button label="Salir" variant="outline" onPress={() => void signOut()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg },
  title: { fontFamily: font.display, fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  label: { fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
