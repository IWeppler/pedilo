import { StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { useTheme } from "@/lib/theme";

const HEAD = 40;

/**
 * Pin de entrega fijo sobre un mapa: la punta (no el centro) cae en el centro del contenedor.
 * Lo usan el selector del mapa (ADR 0023) y la vista previa de la dirección. `scale` lo achica.
 */
export function MapPin({ scale = 1 }: { scale?: number }) {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[styles.wrap, { transform: [{ translateX: -HEAD / 2 }, { translateY: -(HEAD + 10) }, { scale }] }]}>
      <View style={[styles.head, { backgroundColor: t.primary }]}>
        <Icon name="home" size={20} color={t.primaryText} />
      </View>
      <View style={[styles.tip, { borderTopColor: t.primary }]} />
      <View style={styles.shadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: "50%", top: "50%", alignItems: "center", transformOrigin: "bottom" },
  head: { width: HEAD, height: HEAD, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#ffffff" },
  tip: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -2,
  },
  shadow: { width: 10, height: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.25)", marginTop: 1 },
});
