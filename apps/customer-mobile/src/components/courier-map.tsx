import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import { Icon } from "@/components/icon";
import type { CourierLocation } from "@/lib/courier-location";
import { radius, useTheme } from "@/lib/theme";

/** Zoom de barrio: alcanza para ver por qué calle viene. */
const DELTA = 0.012;

/**
 * Mapa con el repartidor (ADR 0022). Sigue al repartidor cuando se mueve. Muestra al cliente
 * solo si ya dio permiso de ubicación (no lo pide acá).
 */
export function CourierMap({ location, courierName }: { location: CourierLocation; courierName: string }) {
  const t = useTheme();
  const map = useRef<MapView>(null);
  const [showMe, setShowMe] = useState(false);
  // Android dibuja el marcador propio como imagen: se deja de redibujar cuando ya se pintó.
  const [tracksView, setTracksView] = useState(true);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync()
      .then((p) => setShowMe(p.granted))
      .catch(() => null);
  }, []);

  useEffect(() => {
    map.current?.animateCamera({ center: { latitude: location.lat, longitude: location.lng } }, { duration: 600 });
  }, [location.lat, location.lng]);

  useEffect(() => {
    const id = setTimeout(() => setTracksView(false), 800);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: location.lat, longitude: location.lng, latitudeDelta: DELTA, longitudeDelta: DELTA }}
        showsUserLocation={showMe}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        accessibilityLabel={`Mapa con la ubicación de ${courierName}`}
      >
        <Marker
          coordinate={{ latitude: location.lat, longitude: location.lng }}
          title={courierName}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracksView}
        >
          <View style={[styles.marker, { backgroundColor: t.primary, borderColor: "#ffffff" }]}>
            <Icon name="delivery" size={20} color={t.primaryText} />
          </View>
        </Marker>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 220, borderRadius: radius.md, overflow: "hidden" },
  marker: { width: 38, height: 38, borderRadius: 999, borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
