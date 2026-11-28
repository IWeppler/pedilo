import type { LatLng } from "@pedilo/domain";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { radius, space, useTheme } from "@/lib/theme";

/** En web no hay mapa nativo: el punto marcado se muestra como una fila (ver `pin-preview.tsx`). */
export function PinPreview({ onPress }: { pin: LatLng; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, { backgroundColor: t.successBg }]}>
      <Icon name="check" size={20} color={t.success} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: t.success, fontWeight: "700" }}>Ubicación marcada</Text>
        <Text style={{ fontSize: 13, color: t.muted }}>Tocá para corregirla</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
});
