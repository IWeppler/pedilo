import { Linking, Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { type CourierLocation, googleMapsUrl } from "@/lib/courier-location";
import { radius, space, useTheme } from "@/lib/theme";

/** En web no hay mapa nativo (`react-native-maps` no corre en navegador): se abre Google Maps. */
export function CourierMap({ location, courierName }: { location: CourierLocation; courierName: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void Linking.openURL(googleMapsUrl(location))}
      style={[styles.box, { backgroundColor: t.background }]}
    >
      <View style={[styles.icon, { backgroundColor: t.primary }]}>
        <Icon name="map" size={20} color={t.primaryText} />
      </View>
      <Text style={{ color: t.text, fontWeight: "700", flex: 1 }}>Ver dónde está {courierName} en el mapa</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  icon: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});
