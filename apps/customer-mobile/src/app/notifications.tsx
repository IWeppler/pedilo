import { isOrderFinal, ORDER_STATUS_LABELS } from "@pedilo/domain";
import { useRouter } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { Centered, ErrorState, Loading } from "@/components/ui";
import { useAccountOrders } from "@/lib/api";
import { font, radius, space, useTheme } from "@/lib/theme";

const timeFormat = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Avisos (campana del inicio): cómo van tus pedidos, los que están en curso primero. Tocar uno abre
 * su seguimiento. Los push con la app cerrada llegan aparte (ADR 0020).
 */
export default function NotificationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const orders = useAccountOrders(true);
  const list = [...(orders.data ?? [])].sort(
    (a, b) => Number(isOrderFinal(a.status)) - Number(isOrderFinal(b.status)) || b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={8}
          style={[styles.back, { backgroundColor: t.surface }]}
        >
          <Icon name="back" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
          Avisos
        </Text>
        <View style={styles.back} />
      </View>

      {orders.isPending ? (
        <Loading />
      ) : orders.isError ? (
        <ErrorState message="No pudimos cargar tus avisos. Revisá tu conexión." onRetry={() => void orders.refetch()} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} tintColor={t.primary} />}
          ListEmptyComponent={
            <Centered>
              <Icon name="bell" size={32} color={t.muted} />
              <Text style={{ color: t.muted, textAlign: "center" }}>Acá te avisamos cómo van tus pedidos.</Text>
            </Centered>
          }
          renderItem={({ item }) => {
            const active = !isOrderFinal(item.status);
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
                style={({ pressed }) => [styles.row, { backgroundColor: active ? t.accentSoft : t.surface, opacity: pressed ? 0.75 : 1 }]}
              >
                <View style={[styles.dot, { backgroundColor: active ? t.accent : "transparent" }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowTitle, { color: t.text }]}>
                    {item.merchantName}: {ORDER_STATUS_LABELS[item.status].toLowerCase()}
                  </Text>
                  <Text style={{ color: t.muted, fontSize: 14 }}>
                    Pedido {item.code} · {timeFormat.format(new Date(item.createdAt))}
                  </Text>
                </View>
                <Icon name="chevronRight" size={18} color={t.muted} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },
  list: { padding: space.lg, gap: space.sm, flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.lg },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  rowTitle: { fontSize: 15, fontWeight: "700" },
});
