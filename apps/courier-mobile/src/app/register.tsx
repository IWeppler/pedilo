import { ApiError, unwrap } from "@pedilo/api-client";
import { type Vehicle, VEHICLE_LABELS } from "@pedilo/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Chip, ErrorState, Field, Loading } from "@/components/ui";
import { api, useCities } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cleanPhoneInput, isValidPhone, toE164 } from "@/lib/phone";
import { font, radius, space, useTheme } from "@/lib/theme";

const VEHICLES: Vehicle[] = ["MOTO", "BIKE", "CAR", "WALK"];
/** El piloto es en Tostado: la ciudad no se elige (si no está cargada, se muestran las que haya). */
const DEFAULT_CITY_SLUG = "tostado";

/**
 * Alta del perfil de repartidor. Al enviarlo queda en revisión: la app pasa a la pantalla
 * «Recibimos tus datos» (en `(tabs)/_layout`), que cambia sola cuando Pedilo lo aprueba.
 */
export default function RegisterScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signOut, email } = useAuth();
  const cities = useCities();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>("MOTO");
  const [cityId, setCityId] = useState<string | null>(null);
  const [minFee, setMinFee] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cities.isPending) return <Loading />;
  if (cities.isError) return <ErrorState message="No pudimos conectar con Pedilo. Revisá tu conexión." onRetry={() => void cities.refetch()} />;

  const list = cities.data ?? [];
  const fixedCity = list.find((c) => c.slug === DEFAULT_CITY_SLUG) ?? (list.length === 1 ? list[0] : undefined);
  const city = fixedCity?.id ?? cityId;
  const nameOk = name.trim().length >= 2;
  const phoneOk = isValidPhone(phone);
  const valid = nameOk && phoneOk && city !== null;

  const submit = async () => {
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await unwrap(
        api.POST("/v1/courier/profile", {
          body: {
            displayName: name.trim().replace(/\s+/g, " "),
            phone: toE164(phone),
            vehicle,
            cityId: city!,
            minFeeMinor: Math.round((Number(minFee.replace(",", ".")) || 0) * 100),
          },
        }),
      );
      // Se guarda ya el perfil nuevo: si se esperara a volver a pedirlo, el inicio todavía
      // vería «sin perfil» y volvería a mostrar este formulario vacío.
      queryClient.setQueryData(["courier", "me"], created);
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar. Revisá tu conexión y probá de nuevo.");
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: t.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.sm }}>
            <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
              Tus datos de repartidor
            </Text>
            <Text style={[styles.lede, { color: t.muted }]}>
              {fixedCity ? `Para repartir en ${fixedCity.name}. ` : ""}Pedilo los revisa antes de habilitarte.
            </Text>
          </View>

          <View style={styles.form}>
            <Field
              label="Nombre y apellido"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              placeholder="Como figura en tu DNI"
              error={tried && !nameOk ? "Escribí tu nombre y apellido." : null}
            />
            <Field
              label="Celular"
              prefix="+54"
              value={phone}
              onChangeText={(v) => setPhone(cleanPhoneInput(v))}
              keyboardType="number-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="3491123456"
              maxLength={13}
              hint="Código de área y número, todo junto: sin 0 ni 15."
              error={tried && !phoneOk ? "Tiene que tener 10 números: código de área sin 0 y el número sin 15." : null}
            />

            <View style={{ gap: space.sm }}>
              <Text style={[styles.label, { color: t.text }]}>Vehículo</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {VEHICLES.map((v) => (
                  <Chip key={v} label={VEHICLE_LABELS[v]} selected={vehicle === v} onPress={() => setVehicle(v)} />
                ))}
              </View>
            </View>

            {!fixedCity && (
              <View style={{ gap: space.sm }}>
                <Text style={[styles.label, { color: t.text }]}>Ciudad</Text>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {list.map((c) => (
                    <Chip key={c.id} label={c.name} selected={city === c.id} onPress={() => setCityId(c.id)} />
                  ))}
                </View>
                {tried && !city && <Text style={[styles.hint, { color: t.danger }]}>Elegí la ciudad donde vas a repartir.</Text>}
              </View>
            )}

            <Field
              label="Pago mínimo por envío (opcional)"
              prefix="$"
              value={minFee}
              onChangeText={(v) => setMinFee(v.replace(/[^\d]/g, "").slice(0, 7))}
              keyboardType="number-pad"
              placeholder="0"
              hint="No te mostramos ofertas que paguen menos. Lo podés cambiar después en tu perfil."
            />
          </View>

          {error && (
            <Text style={[styles.hint, { color: t.danger, fontWeight: "600" }]} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          )}

          <View style={{ gap: space.md }}>
            <Pressable
              onPress={() => void submit()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy }}
              style={({ pressed }) => [styles.button, { backgroundColor: t.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              {busy && <ActivityIndicator color={t.primaryText} />}
              <Text style={[styles.buttonText, { color: t.primaryText }]}>{busy ? "Enviando…" : "Enviar para revisión"}</Text>
            </Pressable>
            <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={8} style={styles.signOut}>
              <Text style={[styles.signOutText, { color: t.muted }]}>
                {email ? `No soy yo: salir de ${email}` : "Salir"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xl, gap: 28 },
  title: { fontFamily: font.display, fontSize: 32, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  lede: { fontSize: 16, lineHeight: 23 },
  form: { gap: 22 },
  label: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  button: { height: 58, borderRadius: radius.pill, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 17, fontWeight: "700" },
  signOut: { alignSelf: "center", paddingVertical: space.xs },
  signOutText: { fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },
});
