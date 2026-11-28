import { addressTitle, MAX_CUSTOMER_ADDRESSES } from "@pedilo/domain";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { Text } from "@/components/text";
import { Loading } from "@/components/ui";
import { type SavedAddress, useDeliveryAddress } from "@/lib/addresses";
import { useCity } from "@/lib/city";
import { locateMe } from "@/lib/current-position";
import { font, radius, space, useTheme } from "@/lib/theme";

const LABEL_ICON: Record<SavedAddress["label"], IconName> = { HOME: "home", WORK: "work", OTHER: "location" };

/**
 * «¿Desde dónde pedís?» (ADR 0034): elegir una dirección guardada, usar la ubicación actual o
 * agregar otra. También la ciudad cuyos comercios se ven.
 */
export default function AddressScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city } = useCity();
  const { addresses, selected, select, ready } = useDeliveryAddress();
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const full = addresses.length >= MAX_CUSTOMER_ADDRESSES;

  if (!ready) return <Loading />;

  const pickCurrentLocation = async () => {
    setNotice(null);
    setLocating(true);
    const r = await locateMe();
    setLocating(false);
    if (r.kind === "found") {
      router.push({
        pathname: "/address-edit",
        params: { lat: String(r.location.lat), lng: String(r.location.lng), ...(r.line && { line: r.line }) },
      });
    } else {
      setNotice(
        r.kind === "denied"
          ? "Sin permiso de ubicación. Podés escribir la dirección a mano."
          : r.kind === "services-off"
            ? "La ubicación del teléfono está apagada. Activala o escribí la dirección."
            : "No pudimos ubicarte. Probá de nuevo o escribí la dirección.",
      );
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.topBar}>
        <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
          ¿Desde dónde pedís?
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={close} hitSlop={8} style={[styles.close, { backgroundColor: t.surface }]}>
          <Icon name="close" size={20} color={t.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {addresses.length > 0 && (
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            {addresses.map((a, i) => {
              const checked = a.id === selected?.id;
              return (
                <View key={a.id} style={[styles.row, i < addresses.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${addressTitle(a)}: ${a.line}`}
                    onPress={() => {
                      select(a.id);
                      close();
                    }}
                    style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Icon name={LABEL_ICON[a.label]} size={22} color={checked ? t.text : t.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontSize: 16, fontWeight: checked ? "800" : "600" }}>{addressTitle(a)}</Text>
                      <Text style={{ color: t.muted, fontSize: 14 }} numberOfLines={1}>
                        {[a.line, a.notes].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <View style={[styles.radio, { borderColor: checked ? t.primary : t.border }]}>
                      {checked && <View style={[styles.radioDot, { backgroundColor: t.primary }]} />}
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Editar ${addressTitle(a)}`}
                    onPress={() => router.push({ pathname: "/address-edit", params: { id: a.id } })}
                    hitSlop={8}
                  >
                    <Text style={{ color: t.text, fontWeight: "700", textDecorationLine: "underline" }}>Editar</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: t.surface }]}>
          <Pressable
            accessibilityRole="button"
            disabled={locating || full}
            onPress={() => void pickCurrentLocation()}
            style={({ pressed }) => [styles.action, { opacity: locating || full ? 0.5 : pressed ? 0.7 : 1, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
          >
            <Icon name="location" size={22} color={t.accent} />
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700", flex: 1 }}>{locating ? "Buscando dónde estás…" : "Usar mi ubicación actual"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={full}
            onPress={() => router.push("/address-edit")}
            style={({ pressed }) => [styles.action, { opacity: full ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            <Icon name="add" size={22} color={t.text} />
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700", flex: 1 }}>Agregar dirección</Text>
          </Pressable>
        </View>
        {full && <Text style={{ color: t.muted }}>Ya tenés {MAX_CUSTOMER_ADDRESSES} direcciones. Borrá una para sumar otra.</Text>}
        {notice && <Text style={{ color: t.danger, fontWeight: "600" }}>{notice}</Text>}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ciudad: ${city?.name ?? "sin elegir"}. Cambiar`}
          onPress={() => router.push("/city")}
          style={({ pressed }) => [styles.cityRow, { backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 }]}
        >
          <Icon name="map" size={20} color={t.text} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>Ciudad</Text>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }}>{city?.name ?? "Elegí tu ciudad"}</Text>
          </View>
          <Text style={{ color: t.text, fontWeight: "700", textDecorationLine: "underline" }}>Cambiar</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  title: { fontFamily: font.display, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  close: { width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  card: { borderRadius: radius.md, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingRight: space.md },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  action: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  cityRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
});
