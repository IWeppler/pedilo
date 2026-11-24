import type { CityMerchant } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CartBar } from "@/components/cart-bar";
import { Badge, Centered, Chip, ErrorState, Loading } from "@/components/ui";
import { useCityMerchants, useMerchantCategories } from "@/lib/api";
import { useCity } from "@/lib/city";
import { useMyOrders } from "@/lib/my-orders";
import { space, useTheme } from "@/lib/theme";

/** Inicio: comercios de la ciudad elegida, con búsqueda y filtro por rubro. Abiertos primero. */
export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city, ready } = useCity();
  const { orders } = useMyOrders();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const categories = useMerchantCategories();
  const merchants = useCityMerchants(city?.slug ?? null, categoryId);

  const rubroName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data]);
  const filtered = useMemo(() => {
    const q = normalize(query);
    return (merchants.data ?? []).filter((m) => !q || normalize(m.displayName).includes(q));
  }, [merchants.data, query]);

  if (!ready) return <Loading />;
  if (!city) return <Redirect href="/city" />;

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: t.text }]}>Pedilo</Text>
        <View style={styles.headerActions}>
          {orders.length > 0 && (
            <Pressable accessibilityRole="button" onPress={() => router.push("/orders")} hitSlop={8}>
              <Text style={[styles.city, { color: t.text }]}>Mis pedidos</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`Ciudad: ${city.name}. Cambiar`} onPress={() => router.push("/city")} hitSlop={8}>
            <Text style={[styles.city, { color: t.text }]}>{city.name} ▾</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar comercios"
        placeholderTextColor={t.muted}
        accessibilityLabel="Buscar comercios"
        style={[styles.search, { backgroundColor: t.surface, color: t.text }]}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Todos" selected={categoryId === null} onPress={() => setCategoryId(null)} />
          {(categories.data ?? []).map((c) => (
            <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
          ))}
        </ScrollView>
      </View>

      {merchants.isPending ? (
        <Loading />
      ) : merchants.isError ? (
        <ErrorState message="No pudimos cargar los comercios. Revisá tu conexión." onRetry={() => merchants.refetch()} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          refreshing={merchants.isRefetching}
          onRefresh={() => merchants.refetch()}
          ListEmptyComponent={
            <Centered>
              <Text style={{ color: t.muted, textAlign: "center" }}>
                {query
                  ? `No hay comercios que coincidan con «${query}».`
                  : categoryId
                    ? `Todavía no hay comercios de ${rubroName.get(categoryId) ?? "este rubro"} en ${city.name}.`
                    : `Todavía no hay comercios en ${city.name}.`}
              </Text>
            </Centered>
          }
          renderItem={({ item }) => (
            <MerchantCard merchant={item} rubro={rubroName.get(item.categoryId)} onPress={() => router.push({ pathname: "/merchant/[slug]", params: { slug: item.slug } })} />
          )}
        />
      )}
      <CartBar />
    </SafeAreaView>
  );
}

function MerchantCard({ merchant: m, rubro, onPress }: { merchant: CityMerchant; rubro: string | undefined; onPress: () => void }) {
  const t = useTheme();
  const delivery = m.acceptsDelivery
    ? m.minDeliveryFeeMinor === 0
      ? "Envío gratis"
      : `Envío desde ${formatARS(m.minDeliveryFeeMinor ?? 0)}`
    : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.displayName}, ${m.openNow ? "abierto" : "cerrado"}`}
      style={({ pressed }) => [styles.card, { backgroundColor: t.surface, opacity: pressed ? 0.7 : m.openNow ? 1 : 0.65 }]}
    >
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { color: t.text }]} numberOfLines={1}>
          {m.displayName}
        </Text>
        <Badge label={m.openNow ? "Abierto" : "Cerrado"} tone={m.openNow ? "success" : "neutral"} />
      </View>
      {rubro && <Text style={{ color: t.muted }}>{rubro}</Text>}
      <Text style={{ color: t.muted, fontSize: 13 }}>{[m.acceptsPickup && "Retiro en el local", delivery].filter(Boolean).join(" · ")}</Text>
    </Pressable>
  );
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md },
  brand: { fontSize: 24, fontWeight: "800" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.lg },
  city: { fontSize: 16, fontWeight: "600" },
  search: { marginHorizontal: space.lg, borderRadius: 12, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.md, flexGrow: 1 },
  card: { borderRadius: 16, padding: space.lg, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  cardTitle: { fontSize: 17, fontWeight: "700", flexShrink: 1 },
});
