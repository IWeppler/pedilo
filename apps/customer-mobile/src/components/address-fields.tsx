import type { LatLng } from "@pedilo/domain";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { LocationPicker } from "@/components/location-picker";
import { PinPreview } from "@/components/pin-preview";
import { Text, TextInput } from "@/components/text";
import { radius, space, useTheme } from "@/lib/theme";

export interface AddressValue {
  line: string;
  notes: string;
  /** Punto marcado en el mapa (ADR 0023) para `line`. Si cambia la dirección, deja de valer. */
  pin: (LatLng & { forLine: string }) | null;
}

/** Lo que acepta la API en las indicaciones de una dirección. */
export const ADDRESS_NOTES_MAX = 200;

export const validPinOf = (a: AddressValue): LatLng | null =>
  a.pin && a.pin.forLine === a.line.trim() ? { lat: a.pin.lat, lng: a.pin.lng } : null;

/**
 * Dirección de entrega: calle y número, el punto en el mapa y las indicaciones. La usan el
 * registro y «Nueva dirección». Con `suggestedPin` (el GPS) el mapa se abre solo para confirmar
 * el punto: el GPS del teléfono puede errar por media cuadra.
 */
export function AddressFields({
  value,
  onChange,
  cityName,
  fallback,
  inputBackground,
  suggestedPin = null,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  cityName?: string | undefined;
  /** Dónde abrir el mapa si no se encuentra la dirección (p. ej. la sucursal). */
  fallback: LatLng | null;
  /** Fondo de los campos: contrasta con lo que hay atrás. */
  inputBackground: string;
  /** Punto sugerido (GPS) que el cliente todavía no confirmó: abre el mapa al entrar. */
  suggestedPin?: LatLng | null;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(suggestedPin !== null && !value.pin);
  const line = value.line.trim();
  const pin = validPinOf(value);
  const canPin = line.length >= 3;

  return (
    <View style={{ gap: space.md }}>
      <Input label="Dirección" value={value.line} onChange={(v) => onChange({ ...value, line: v })} placeholder="Calle y número" background={inputBackground} autoComplete="street-address" />
      {pin ? (
        <PinPreview pin={pin} onPress={() => setPicking(true)} />
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={!canPin}
          onPress={() => setPicking(true)}
          style={[styles.pinRow, { backgroundColor: inputBackground, opacity: canPin ? 1 : 0.5 }]}
        >
          <Icon name="map" size={20} color={t.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: t.text, fontWeight: "700" }}>Marcar en el mapa</Text>
            <Text style={{ fontSize: 13, color: t.muted }}>{canPin ? "Así el repartidor llega justo a tu puerta" : "Primero escribí la dirección"}</Text>
          </View>
          <Icon name="chevronRight" size={18} color={t.muted} />
        </Pressable>
      )}
      <Input
        label="Indicaciones (opcional)"
        value={value.notes}
        onChange={(v) => onChange({ ...value, notes: v })}
        placeholder="Piso, timbre, portón verde…"
        background={inputBackground}
        maxLength={ADDRESS_NOTES_MAX}
      />
      <LocationPicker
        visible={picking}
        addressQuery={[line, cityName].filter(Boolean).join(", ")}
        initial={pin ?? suggestedPin}
        fallback={fallback}
        hint={!pin && suggestedPin ? "Lo ubicamos con el GPS. Si el pin no quedó en tu puerta, mové el mapa." : undefined}
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
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  background: string;
  autoComplete?: "street-address";
  /** Con tope, se muestra cuántos caracteres van. */
  maxLength?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.labelRow}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
        {maxLength !== undefined && (
          <Text style={{ color: t.muted, fontSize: 12 }} accessibilityLabel={`${value.length} de ${maxLength} caracteres`}>
            {value.length}/{maxLength}
          </Text>
        )}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        autoComplete={autoComplete}
        maxLength={maxLength}
        style={[styles.input, { backgroundColor: background, color: t.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  pinRow: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
});
