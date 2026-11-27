import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Centered } from "@/components/ui";
import { useMyOrders } from "@/lib/my-orders";
import { font, radius, space, useTheme } from "@/lib/theme";

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" });

/** Pedidos hechos desde este teléfono. El estado se ve al entrar a cada uno. */
export default function MyOrdersScreen() {
  const t = useTheme();
  const router = useRouter();
  const { orders } = useMyOrders();

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <Text style={[styles.title, { color: t.text }]}>Mis pedidos</Text>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ gap: space.sm, flexGrow: 1 }}
        ListEmptyComponent={
          <Centered>
            <Text style={{ color: t.muted }}>Todavía no hiciste pedidos desde este teléfono.</Text>
          </Centered>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{item.merchantName}</Text>
              <Text style={{ color: t.muted }}>
                {item.code} · {dateFormat.format(new Date(item.createdAt))}
              </Text>
            </View>
            <Text style={{ color: t.muted, fontSize: 18 }}>›</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.lg, gap: space.md },
  title: { fontFamily: font.display, fontSize: 26, fontWeight: "800" },
  card: { borderRadius: radius.md, padding: space.lg, flexDirection: "row", alignItems: "center" },
});
