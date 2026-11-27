import type { LatLng } from "@pedilo/domain";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { Button } from "@/components/ui";
import { font, radius, space, useTheme } from "@/lib/theme";

/** Zoom de cuadra: se distingue una casa de la de al lado. */
const DELTA = 0.004;

export interface LocationPickerProps {
  visible: boolean;
  /** Lo que escribió el cliente, para centrar el mapa ahí («Belgrano 456, Tostado»). */
  addressQuery: string;
  /** Punto ya marcado antes (se abre ahí). */
  initial: LatLng | null;
  /** Si no se encuentra la dirección ni la ubicación del teléfono: la sucursal. */
  fallback: LatLng | null;
  onConfirm: (point: LatLng) => void;
  onClose: () => void;
}

/**
 * Marcar el punto exacto de entrega (ADR 0023). El pin queda fijo en el centro y se mueve el mapa
 * debajo: con el dedo es más preciso que arrastrar un marcador chico.
 *
 * Arranca en el punto ya marcado, si no en la dirección escrita (geocodificada en el teléfono),
 * si no en la ubicación actual y si no en la sucursal.
 */
export function LocationPicker({ visible, addressQuery, initial, fallback, onConfirm, onClose }: LocationPickerProps) {
  const t = useTheme();
  const map = useRef<MapView>(null);
  const [start, setStart] = useState<LatLng | null>(null);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const found = initial ?? (await geocode(addressQuery)) ?? (await currentPosition()) ?? fallback;
      if (cancelled) return;
      if (!found) setNotice("No pudimos ubicar la dirección. Mové el mapa hasta tu casa.");
      const point = found ?? { lat: -34.6037, lng: -58.3816 };
      setStart(point);
      setCenter(point);
    })();
    return () => {
      cancelled = true;
      setStart(null);
      setCenter(null);
      setNotice(null);
    };
    // Solo al abrir: después manda lo que el cliente mueve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const goToMe = async () => {
    setLocating(true);
    const me = await currentPosition(true);
    setLocating(false);
    if (!me) return setNotice("No pudimos obtener tu ubicación. Revisá que el GPS esté prendido.");
    setNotice(null);
    map.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: DELTA, longitudeDelta: DELTA }, 500);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.background }}>
        {start ? (
          <MapView
            ref={map}
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
            initialRegion={{ latitude: start.lat, longitude: start.lng, latitudeDelta: DELTA, longitudeDelta: DELTA }}
            onRegionChangeComplete={(r) => setCenter({ lat: r.latitude, lng: r.longitude })}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={t.primary} />
            <Text style={{ color: t.muted }}>Buscando la dirección…</Text>
          </View>
        )}

        {/* Pin fijo: la punta marca el centro del mapa. */}
        {start && (
          <View pointerEvents="none" style={styles.pinWrap}>
            <View style={[styles.pinHead, { backgroundColor: t.primary }]}>
              <Icon name="home" size={20} color={t.primaryText} />
            </View>
            <View style={[styles.pinTip, { borderTopColor: t.primary }]} />
            <View style={styles.pinShadow} />
          </View>
        )}

        <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            onPress={onClose}
            hitSlop={8}
            style={[styles.round, { backgroundColor: t.background }]}
          >
            <Icon name="close" size={20} color={t.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ir a mi ubicación"
            onPress={() => void goToMe()}
            hitSlop={8}
            style={[styles.round, { backgroundColor: t.background }]}
          >
            {locating ? <ActivityIndicator color={t.primary} /> : <Icon name="location" size={20} color={t.text} />}
          </Pressable>
        </SafeAreaView>

        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: t.background }]}>
          <Text style={[styles.title, { color: t.text }]}>¿Dónde te lo dejamos?</Text>
          <Text style={{ color: t.muted }}>
            Mové el mapa hasta que el pin quede en tu puerta{addressQuery.trim() ? ` (${addressQuery.split(",")[0]!.trim()})` : ""}.
          </Text>
          {notice && <Text style={{ color: t.danger, fontWeight: "600" }}>{notice}</Text>}
          <Button label="Confirmar ubicación" disabled={!center} onPress={() => center && onConfirm(center)} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/** La dirección escrita → coordenadas, con el geocodificador del teléfono. */
async function geocode(query: string): Promise<LatLng | null> {
  if (query.trim().length < 3 || !(await ensurePermission(false))) return null;
  try {
    const [hit] = await Location.geocodeAsync(query);
    return hit ? { lat: hit.latitude, lng: hit.longitude } : null;
  } catch {
    return null;
  }
}

async function currentPosition(ask = false): Promise<LatLng | null> {
  if (!(await ensurePermission(ask))) return null;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 });
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

/** Pide el permiso solo si ya se puede preguntar (y `ask`, o si todavía no se preguntó nunca). */
async function ensurePermission(ask: boolean): Promise<boolean> {
  const p = await Location.getForegroundPermissionsAsync();
  if (p.granted) return true;
  if (!p.canAskAgain || (!ask && p.status !== Location.PermissionStatus.UNDETERMINED)) return false;
  return (await Location.requestForegroundPermissionsAsync()).granted;
}

const PIN_HEAD = 40;
const styles = StyleSheet.create({
  loading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: space.sm },
  pinWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    alignItems: "center",
    // La punta del pin (no su centro) cae sobre el centro del mapa.
    transform: [{ translateX: -PIN_HEAD / 2 }, { translateY: -(PIN_HEAD + 10) }],
  },
  pinHead: { width: PIN_HEAD, height: PIN_HEAD, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#ffffff" },
  pinTip: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10, borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -2 },
  pinShadow: { width: 10, height: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.25)", marginTop: 1 },
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", padding: space.lg },
  round: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", elevation: 3, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, elevation: 8, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12 },
  title: { fontFamily: font.display, fontSize: 20, fontWeight: "800" },
});
