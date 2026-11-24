import type { PublicProduct } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CartBar } from "@/components/cart-bar";
import { Badge, Centered, ErrorState, Loading } from "@/components/ui";
import { useMerchantMenu } from "@/lib/api";
import { space, useTheme } from "@/lib/theme";

/** Menú de un comercio: datos de la sucursal y productos por sección, con búsqueda. */
export default function MerchantScreen() {
  const t = useTheme();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const menu = useMerchantMenu(slug);
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = normalize(query);
    return (menu.data?.sections ?? [])
      .map((s) => ({
        key: s.id ?? "otros",
        title: s.name,
        data: s.products.filter((p) => !q || normalize(`${p.name} ${p.description ?? ""}`).includes(q)),
      }))
      .filter((s) => s.data.length > 0);
  }, [menu.data, query]);

  if (menu.isPending) return <Loading />;
  if (menu.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <ErrorState message="No pudimos cargar este comercio." onRetry={() => menu.refetch()} />
      </SafeAreaView>
    );
  }

  const { merchant } = menu.data;
  // MVP: se muestra la primera sucursal activa (la mayoría de los comercios del piloto tiene una).
  const branch = merchant.branches[0];
  const fees = branch?.zones.map((z) => z.feeMinor) ?? [];

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={12}>
              <Text style={[styles.back, { color: t.text }]}>‹ Volver</Text>
            </Pressable>
            <Text style={[styles.title, { color: t.text }]}>{merchant.displayName}</Text>
            {branch && (
              <>
                <View style={styles.row}>
                  <Badge label={branch.openNow ? "Abierto ahora" : "Cerrado ahora"} tone={branch.openNow ? "success" : "neutral"} />
                </View>
                <Text style={{ color: t.muted }}>
                  {branch.addressLine}
                  {branch.addressNotes ? ` · ${branch.addressNotes}` : ""}
                </Text>
                <Text style={{ color: t.muted }}>
                  {[
                    branch.acceptsPickup && "Retiro en el local",
                    branch.acceptsDelivery && fees.length > 0 && `Envío desde ${formatARS(Math.min(...fees))}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </>
            )}
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar en el menú"
              placeholderTextColor={t.muted}
              accessibilityLabel="Buscar en el menú"
              style={[styles.search, { backgroundColor: t.surface, color: t.text }]}
              clearButtonMode="while-editing"
            />
          </View>
        }
        ListEmptyComponent={
          <Centered>
            <Text style={{ color: t.muted, textAlign: "center" }}>
              {query ? `Nada coincide con «${query}».` : "Este comercio todavía no cargó su menú."}
            </Text>
          </Centered>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: t.text, backgroundColor: t.background }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            onPress={() => router.push({ pathname: "/product/[slug]/[productId]", params: { slug, productId: item.id } })}
          />
        )}
      />
      <CartBar onlyFor={slug} />
    </SafeAreaView>
  );
}

function ProductRow({ product: p, onPress }: { product: PublicProduct; onPress: () => void }) {
  const t = useTheme();
  const price = p.variants.length > 0 ? `desde ${formatARS(p.fromPriceMinor)}` : formatARS(p.priceMinor);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${price}${p.available ? "" : ", sin stock"}`}
      style={({ pressed }) => [styles.product, { borderColor: t.border, opacity: pressed ? 0.6 : p.available ? 1 : 0.5 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.productName, { color: t.text }]}>{p.name}</Text>
        {p.description && (
          <Text style={{ color: t.muted }} numberOfLines={2}>
            {p.description}
          </Text>
        )}
        <Text style={[styles.price, { color: t.text }]}>{price}</Text>
      </View>
      {!p.available && <Badge label="Sin stock" tone="danger" />}
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
  content: { paddingBottom: space.xl, flexGrow: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  back: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 26, fontWeight: "800" },
  row: { flexDirection: "row", gap: space.sm },
  search: { borderRadius: 12, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16, marginTop: space.sm },
  sectionTitle: { fontSize: 18, fontWeight: "700", paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  product: {
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  productName: { fontSize: 16, fontWeight: "600" },
  price: { fontSize: 15, fontWeight: "600", marginTop: 2 },
});
