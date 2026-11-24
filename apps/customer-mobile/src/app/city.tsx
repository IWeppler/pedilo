import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState, Loading } from "@/components/ui";
import { useCities } from "@/lib/api";
import { useCity } from "@/lib/city";
import { space, useTheme } from "@/lib/theme";

/** Elegir ciudad. Se guarda en el teléfono y se puede cambiar desde el inicio. */
export default function CityScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city, setCity } = useCity();
  const cities = useCities();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <Text style={[styles.title, { color: t.text }]}>¿Dónde estás?</Text>
      <Text style={[styles.subtitle, { color: t.muted }]}>Elegí tu ciudad para ver los comercios cerca tuyo.</Text>

      {cities.isPending ? (
        <Loading />
      ) : cities.isError ? (
        <ErrorState message="No pudimos cargar las ciudades. Revisá tu conexión." onRetry={() => cities.refetch()} />
      ) : (
        <FlatList
          data={cities.data}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: t.border }]} />}
          renderItem={({ item }) => {
            const selected = city?.slug === item.slug;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setCity({ slug: item.slug, name: item.name });
                  if (router.canGoBack()) router.back();
                  else router.replace("/");
                }}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View>
                  <Text style={[styles.cityName, { color: t.text }]}>{item.name}</Text>
                  <Text style={{ color: t.muted }}>{item.province}</Text>
                </View>
                {selected && <Text style={{ color: t.text, fontSize: 18 }}>✓</Text>}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.lg, gap: space.sm },
  title: { fontSize: 26, fontWeight: "700", marginTop: space.lg },
  subtitle: { fontSize: 15, marginBottom: space.md },
  row: { paddingVertical: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cityName: { fontSize: 17, fontWeight: "600" },
  separator: { height: StyleSheet.hairlineWidth },
});
