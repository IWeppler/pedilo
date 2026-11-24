import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { ErrorState, Loading } from "@/components/ui";
import { useCities } from "@/lib/api";
import { useCity } from "@/lib/city";
import { canLocate, locateCity, type LocateResult } from "@/lib/locate-city";
import { cardShadow, radius, space, useTheme } from "@/lib/theme";

type City = { slug: string; name: string; province: string };
type LocateFailure = Exclude<LocateResult<City>, { kind: "found" }>;

/** Elegir ciudad: con la ubicación del teléfono o de la lista. Se guarda en el teléfono. */
export default function CityScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city, setCity } = useCity();
  const cities = useCities();
  const [locating, setLocating] = useState(false);
  const [result, setResult] = useState<LocateFailure | null>(null);

  const choose = (c: City) => {
    setCity({ slug: c.slug, name: c.name });
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const locate = async () => {
    if (!cities.data) return;
    setResult(null);
    setLocating(true);
    const r = await locateCity(cities.data);
    setLocating(false);
    if (r.kind === "found") choose(r.city);
    else setResult(r);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.topBar}>
        {router.canGoBack() && city ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            onPress={() => router.back()}
            hitSlop={8}
            style={[styles.close, cardShadow(t), { backgroundColor: t.card }]}
          >
            <Icon name="close" size={20} color={t.text} />
          </Pressable>
        ) : (
          <View style={styles.close} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.badge, { backgroundColor: t.primarySoft }]}>
          <Icon name="location" size={32} color={t.primary} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>¿Dónde estás?</Text>
        <Text style={[styles.subtitle, { color: t.muted }]}>Elegí tu ciudad para ver los comercios cerca tuyo.</Text>

        {cities.isPending ? (
          <View style={styles.state}>
            <Loading />
          </View>
        ) : cities.isError ? (
          <View style={styles.state}>
            <ErrorState message="No pudimos cargar las ciudades. Revisá tu conexión." onRetry={() => cities.refetch()} />
          </View>
        ) : (
          <>
            {canLocate && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Usar mi ubicación"
                onPress={locate}
                disabled={locating}
                style={({ pressed }) => [styles.locate, { backgroundColor: t.primary, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={styles.locateIcon}>
                  {locating ? <ActivityIndicator color={t.primaryText} /> : <Icon name="location" size={22} color={t.primaryText} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locateTitle, { color: t.primaryText }]}>{locating ? "Buscando tu ubicación…" : "Usar mi ubicación"}</Text>
                  <Text style={[styles.locateSub, { color: t.primaryText }]}>Detectamos tu ciudad con el GPS</Text>
                </View>
                {!locating && <Icon name="chevronRight" size={22} color={t.primaryText} />}
              </Pressable>
            )}

            {result && <LocateNotice result={result} />}

            {canLocate && (
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: t.border }]} />
                <Text style={[styles.dividerText, { color: t.muted }]}>o elegí de la lista</Text>
                <View style={[styles.dividerLine, { backgroundColor: t.border }]} />
              </View>
            )}

            <View style={[styles.list, cardShadow(t), { backgroundColor: t.card }]}>
              {cities.data.map((c, i) => {
                const selected = city?.slug === c.slug;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${c.name}, ${c.province}`}
                    onPress={() => choose(c)}
                    style={({ pressed }) => [
                      styles.row,
                      i < cities.data.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: selected ? t.primary : t.surface }]}>
                      <Icon name="location" size={18} color={selected ? t.primaryText : t.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cityName, { color: t.text }]}>{c.name}</Text>
                      <Text style={[styles.province, { color: t.muted }]}>{c.province}</Text>
                    </View>
                    {selected ? <Icon name="check" size={20} color={t.primary} /> : <Icon name="chevronRight" size={20} color={t.muted} />}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Explica por qué no se pudo detectar la ciudad y, si sirve, ofrece abrir los ajustes. */
function LocateNotice({ result }: { result: LocateFailure }) {
  const t = useTheme();
  let message: string;
  let settings = false;
  switch (result.kind) {
    case "not-served":
      message = result.place
        ? `Todavía no llegamos a ${result.place}. Elegí una ciudad de la lista.`
        : "No pudimos reconocer tu ciudad. Elegila de la lista.";
      break;
    case "denied":
      message = result.canAskAgain
        ? "Necesitamos permiso de ubicación para detectar tu ciudad."
        : "El permiso de ubicación está desactivado para Pedilo.";
      settings = !result.canAskAgain;
      break;
    case "services-off":
      message = "La ubicación del teléfono está apagada. Activala o elegí tu ciudad de la lista.";
      break;
    case "error":
      message = "No pudimos obtener tu ubicación. Probá de nuevo o elegí de la lista.";
      break;
  }
  return (
    <View style={[styles.notice, { backgroundColor: t.surface }]} accessibilityLiveRegion="polite">
      <Icon name="info" size={18} color={t.muted} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={[styles.noticeText, { color: t.text }]}>{message}</Text>
        {settings && (
          <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={8}>
            <Text style={[styles.noticeLink, { color: t.primary }]}>Abrir ajustes</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.lg, paddingTop: space.sm },
  close: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.xl },

  badge: { width: 64, height: 64, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { fontSize: 15, marginBottom: space.sm },
  state: { minHeight: 200 },

  locate: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.lg, padding: space.lg },
  locateIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  locateTitle: { fontSize: 16, fontWeight: "800" },
  locateSub: { fontSize: 13, opacity: 0.9 },

  notice: { flexDirection: "row", gap: space.sm, borderRadius: radius.md, padding: space.md, alignItems: "flex-start" },
  noticeText: { fontSize: 14 },
  noticeLink: { fontSize: 14, fontWeight: "700" },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginVertical: space.xs },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },

  list: { borderRadius: radius.lg, paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowIcon: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  cityName: { fontSize: 16, fontWeight: "700" },
  province: { fontSize: 13 },
});
