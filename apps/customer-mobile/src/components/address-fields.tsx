import type { LatLng } from "@pedilo/domain";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { LocationPicker } from "@/components/location-picker";
import { Text, TextInput } from "@/components/text";
import { radius, space, useTheme } from "@/lib/theme";

export interface AddressValue {
  line: string;
  notes: string;
  /** Punto marcado en el mapa (ADR 0023) para `line`. Si cambia la dirección, deja de valer. */
  pin: (LatLng & { forLine: string }) | null;
}

export const validPinOf = (a: AddressValue): LatLng | null =>
  a.pin && a.pin.forLine === a.line.trim() ? { lat: a.pin.lat, lng: a.pin.lng } : null;

/**
 * Dirección de entrega: calle y número, indicaciones y el punto en el mapa. La usan el registro
 * (dirección guardada en la cuenta) y el checkout cuando el cliente la cambia.
 */
export function AddressFields({
  value,
  onChange,
  cityName,
  fallback,
  inputBackground,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  cityName?: string | undefined;
  /** Dónde abrir el mapa si no se encuentra la dirección (p. ej. la sucursal). */
  fallback: LatLng | null;
  /** Fondo de los campos: contrasta con lo que hay atrás. */
  inputBackground: string;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const line = value.line.trim();
  const pin = validPinOf(value);
  const canPin = line.length >= 3;

  return (
    <View style={{ gap: space.md }}>
      <Input label="Dirección" value={value.line} onChange={(v) => onChange({ ...value, line: v })} placeholder="Calle y número" background={inputBackground} autoComplete="street-address" />
      <Input label="Indicaciones (opcional)" value={value.notes} onChange={(v) => onChange({ ...value, notes: v })} placeholder="Piso, timbre, referencia" background={inputBackground} />
      <Pressable
        accessibilityRole="button"
        disabled={!canPin}
        onPress={() => setPicking(true)}
        style={[styles.pinRow, { backgroundColor: pin ? t.successBg : inputBackground, opacity: canPin ? 1 : 0.5 }]}
      >
        <Icon name={pin ? "check" : "map"} size={20} color={pin ? t.success : t.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, color: pin ? t.success : t.text, fontWeight: "700" }}>
            {pin ? "Ubicación marcada en el mapa" : "Marcar en el mapa"}
          </Text>
          <Text style={{ fontSize: 13, color: t.muted }}>
            {pin ? "Tocá para corregirla" : canPin ? "Así el repartidor llega justo a tu puerta" : "Primero escribí la dirección"}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={t.muted} />
      </Pressable>
      <LocationPicker
        visible={picking}
        addressQuery={[line, cityName].filter(Boolean).join(", ")}
        initial={pin}
        fallback={fallback}
        onClose={() => setPicking(false)}
        onConfirm={(p) => {
          onChange({ ...value, pin: { ...p, forLine: line } });
          setPicking(false);
        }}
      />
    </View>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  background,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  background: string;
  autoComplete?: "street-address";
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        autoComplete={autoComplete}
        style={[styles.input, { backgroundColor: background, color: t.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pinRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
});
