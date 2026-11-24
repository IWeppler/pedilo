import { formatARS } from "@pedilo/domain";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCart } from "@/lib/cart";
import { space, useTheme } from "@/lib/theme";

/** Barra fija abajo con el pedido en curso. `onlyFor`: mostrarla solo si el carrito es de ese comercio. */
export function CartBar({ onlyFor }: { onlyFor?: string }) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, itemCount, subtotalMinor } = useCart();
  if (!cart || (onlyFor && cart.merchantSlug !== onlyFor)) return null;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md), backgroundColor: t.background, borderColor: t.border }]}>
      <Pressable
        onPress={() => router.push("/cart")}
        accessibilityRole="button"
        accessibilityLabel={`Ver pedido de ${cart.merchantName}: ${itemCount} productos, ${formatARS(subtotalMinor)}`}
        style={({ pressed }) => [styles.bar, { backgroundColor: t.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[styles.count, { color: t.primaryText, borderColor: t.primaryText }]}>{itemCount}</Text>
        <Text style={[styles.label, { color: t.primaryText, flex: 1 }]} numberOfLines={1}>
          Ver pedido{onlyFor ? "" : ` · ${cart.merchantName}`}
        </Text>
        <Text style={[styles.label, { color: t.primaryText }]}>{formatARS(subtotalMinor)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: 14, paddingVertical: 14, paddingHorizontal: space.lg },
  count: { borderWidth: 1.5, borderRadius: 999, minWidth: 26, textAlign: "center", paddingHorizontal: 6, fontWeight: "700" },
  label: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
});
