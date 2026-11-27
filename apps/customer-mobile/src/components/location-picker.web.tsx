import * as Location from "expo-location";
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { Button } from "@/components/ui";
import type { LocationPickerProps } from "@/components/location-picker";
import { font, radius, space, useTheme } from "@/lib/theme";

/**
 * En web no hay mapa nativo (`react-native-maps`): se ofrece usar la ubicación del navegador.
 * Sirve si el cliente está en el lugar de entrega; si no, alcanza con la dirección escrita.
 */
export function LocationPicker({ visible, onConfirm, onClose }: LocationPickerProps) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locateMe = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) throw new Error("denied");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onConfirm({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      setError("No pudimos obtener tu ubicación desde el navegador.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: t.background }]}>
          <Text style={[styles.title, { color: t.text }]}>¿Estás en el lugar de entrega?</Text>
          <Text style={{ color: t.muted }}>
            Usamos la ubicación de tu navegador para que el repartidor llegue justo a tu puerta. Para moverla en un mapa, usá la app.
          </Text>
          {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
          <Button label={busy ? "Buscando…" : "Usar mi ubicación actual"} disabled={busy} onPress={() => void locateMe()} />
          <Button label="Cancelar" variant="outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: space.lg },
  card: { width: "100%", maxWidth: 420, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  title: { fontFamily: font.display, fontSize: 20, fontWeight: "800" },
});
