import type { LatLng } from "@pedilo/domain";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";

import { MapPin } from "@/components/map-pin";
import { Text } from "@/components/text";
import { radius, space, useTheme } from "@/lib/theme";

/** Zoom de cuadra, como el selector. */
const DELTA = 0.003;

/**
 * El punto de entrega ya marcado, en un mapa chico y quieto: se ve de un vistazo si quedó en la
 * casa. Tocarlo abre el selector para corregirlo. En Android usa el modo liviano (una imagen).
 */
export function PinPreview({ pin, onPress }: { pin: LatLng; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Punto de entrega marcado en el mapa. Tocá para corregirlo"
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, { backgroundColor: t.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <View pointerEvents="none" style={styles.map}>
        <MapView
          // Al cambiar el punto se vuelve a montar centrado ahí (la región inicial no se actualiza sola).
          key={`${pin.lat},${pin.lng}`}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          liteMode
          initialRegion={{ latitude: pin.lat, longitude: pin.lng, latitudeDelta: DELTA, longitudeDelta: DELTA }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        />
        <MapPin scale={0.8} />
      </View>
      <View style={styles.caption}>
        <Text style={[styles.captionText, { color: t.text }]}>Punto de entrega</Text>
        <Text style={[styles.action, { color: t.text }]}>Corregir</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: "hidden" },
  map: { height: 150 },
  caption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingVertical: space.sm },
  captionText: { fontSize: 14, fontWeight: "600" },
  action: { fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
});
