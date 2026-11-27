import { type CourierDeliveryAction, courierDeliveryActions, DELIVERY_STATUS_LABELS, type DeliveryStatus, formatARS } from "@pedilo/domain";
import { useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { Badge, Card } from "@/components/ui";
import { type Delivery, useMyDeliveries } from "@/lib/api";
import { backgroundSupported, useLocationSharing } from "@/lib/location";
import { type PendingAction, useOutbox } from "@/lib/outbox";
import { radius, space, useTheme } from "@/lib/theme";

/** Repartos asignados: retiro, entrega y acciones. Las acciones van por la cola (funcionan sin señal). */
export default function ActiveScreen() {
  const t = useTheme();
  const active = useMyDeliveries("active");
  const { pending, rejected, dismissRejected, flush } = useOutbox();
  const list = active.data ?? [];

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching}
            onRefresh={() => {
              void flush();
              void active.refetch();
            }}
            tintColor={t.primary}
          />
        }
      >
        <Text style={[styles.title, { color: t.text }]}>En curso</Text>

        {list.length > 0 && <LocationNotice />}

        {pending.length > 0 && (
          <View style={[styles.notice, { backgroundColor: t.primarySoft }]} accessibilityLiveRegion="polite">
            <Icon name="sync" size={18} color={t.primary} />
            <Text style={{ color: t.text, flex: 1 }}>
              {pending.length === 1 ? "1 cambio pendiente de enviar" : `${pending.length} cambios pendientes de enviar`}. Se mandan solos cuando vuelva la señal.
            </Text>
          </View>
        )}
        {rejected && (
          <Pressable onPress={dismissRejected} style={[styles.notice, { backgroundColor: t.dangerBg }]}>
            <Icon name="warning" size={18} color={t.danger} />
            <Text style={{ color: t.danger, flex: 1, fontWeight: "600" }}>
              No se pudo marcar «{DELIVERY_STATUS_LABELS[rejected.action.to]}»: {rejected.message}
            </Text>
          </Pressable>
        )}

        {list.length === 0 && (
          <Text style={{ color: t.muted, textAlign: "center", marginTop: space.xl }}>
            {active.isPending ? "Cargando…" : active.isError ? "Sin conexión. Mostramos lo último cuando vuelva." : "No tenés repartos en curso."}
          </Text>
        )}
        {list.map((d) => (
          <DeliveryCard key={d.id} delivery={d} pending={pending.filter((p) => p.deliveryId === d.id)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Si el cliente puede seguir el envío y, si no, qué hacer para que pueda (ADR 0022). */
function LocationNotice() {
  const t = useTheme();
  const { state, canUpgrade, requestBackground, openSettings, retry } = useLocationSharing();
  if (state === "off") return null;

  const ok = state === "background" || state === "foreground";
  const text = {
    background: "Compartís tu ubicación con el comercio y el cliente hasta que termines el envío.",
    foreground: backgroundSupported
      ? "Compartís tu ubicación solo con la app abierta. Con la pantalla apagada el cliente deja de verte."
      : "Compartís tu ubicación solo con la app abierta (en Expo Go no hay segundo plano).",
    denied: "Sin permiso de ubicación el cliente no puede seguir el envío.",
    gpsOff: "Prendé la ubicación del teléfono para que el cliente pueda seguir el envío.",
    unsupported: "Desde la web no se comparte la ubicación: usá la app.",
  }[state];
  const action =
    state === "foreground" && canUpgrade
      ? { label: "Permitir siempre", onPress: () => void requestBackground() }
      : state === "denied"
        ? { label: "Abrir ajustes", onPress: openSettings }
        : state === "gpsOff"
          ? { label: "Reintentar", onPress: retry }
          : null;

  return (
    <View style={[styles.notice, { backgroundColor: ok ? t.successBg : t.dangerBg }]} accessibilityLiveRegion="polite">
      <Icon name={ok ? "location" : "warning"} size={18} color={ok ? t.success : t.danger} />
      <Text style={{ color: ok ? t.success : t.danger, flex: 1, fontWeight: "600" }}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={6}>
          <Text style={{ color: ok ? t.success : t.danger, fontWeight: "800", textDecorationLine: "underline" }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

function DeliveryCard({ delivery: d, pending }: { delivery: Delivery; pending: PendingAction[] }) {
  const t = useTheme();
  const { enqueue } = useOutbox();
  const [withReason, setWithReason] = useState<CourierDeliveryAction | null>(null);
  const [reason, setReason] = useState("");
  const [askPin, setAskPin] = useState<CourierDeliveryAction | null>(null);
  const [pin, setPin] = useState("");
  const waiting = pending.at(-1);
  const pickedUp = d.status === "PICKED_UP" || d.status === "ARRIVING_DROPOFF";

  const run = (a: CourierDeliveryAction, why: string | null = null, code: string | null = null) => {
    void enqueue(d.id, a.to, why, code);
    setWithReason(null);
    setReason("");
    setAskPin(null);
    setPin("");
  };
  const choose = (a: CourierDeliveryAction) => {
    if (a.needsReason) setWithReason(a);
    else if (a.to === "DELIVERED" && d.pinRequired) setAskPin(a);
    else run(a);
  };

  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.reference, { color: t.text }]}>{d.reference}</Text>
        <Badge label={waiting ? `Enviando: ${DELIVERY_STATUS_LABELS[waiting.to]}` : DELIVERY_STATUS_LABELS[d.status as DeliveryStatus]} />
      </View>

      <Stop
        icon="store"
        title={pickedUp ? "Retirado en" : "Retirá en"}
        name={d.pickup.name}
        address={d.pickup.address}
        phone={d.pickup.phone}
        muted={pickedUp}
      />
      <Stop
        icon="location"
        title="Entregá a"
        name={d.recipient?.name ?? "—"}
        address={d.dropoff.address ?? d.dropoff.area}
        notes={d.dropoff.notes}
        phone={d.recipient?.phone ?? null}
        point={d.dropoff.location}
      />
      <Text style={{ color: t.muted }}>{d.packageDescription}</Text>
      {d.cashToCollectMinor > 0 && (
        <View style={[styles.cash, { backgroundColor: t.successBg }]}>
          <Icon name="cash" size={20} color={t.success} />
          <Text style={{ color: t.success, fontWeight: "700", flex: 1 }}>Cobrale {formatARS(d.cashToCollectMinor)} en efectivo al cliente</Text>
        </View>
      )}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        Te pagan {formatARS(d.courierFeeMinor)}
        {d.tipMinor > 0 ? ` + ${formatARS(d.tipMinor)} de propina` : ""}
      </Text>

      {d.pinRequired && !waiting && (
        <Text style={{ color: d.pinLocked ? t.danger : t.muted, fontSize: 13 }}>
          {d.pinLocked
            ? "PIN bloqueado por demasiados intentos: llamá al comercio para que lo desbloquee."
            : "Para marcarlo entregado pedile al cliente su PIN de 4 dígitos."}
        </Text>
      )}

      {waiting ? null : askPin ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            value={pin}
            onChangeText={(v) => setPin(v.replace(/[^0-9]/g, "").slice(0, 4))}
            placeholder="PIN del cliente"
            placeholderTextColor={t.muted}
            accessibilityLabel="PIN de entrega"
            keyboardType="number-pad"
            autoFocus
            style={[styles.input, styles.pin, { backgroundColor: t.surface, color: t.text }]}
          />
          <View style={styles.actions}>
            <ActionButton label="Volver" tone="neutral" onPress={() => setAskPin(null)} />
            <ActionButton label="Confirmar entrega" tone="primary" disabled={pin.length !== 4} onPress={() => run(askPin, null, pin)} />
          </View>
        </View>
      ) : withReason ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Contanos qué pasó"
            placeholderTextColor={t.muted}
            accessibilityLabel="Motivo"
            autoFocus
            style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
          />
          <View style={styles.actions}>
            <ActionButton label="Volver" tone="neutral" onPress={() => setWithReason(null)} />
            <ActionButton label={withReason.label} tone="danger" disabled={reason.trim().length < 3} onPress={() => run(withReason, reason.trim())} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {courierDeliveryActions(d.status as DeliveryStatus).map((a) => (
            <ActionButton key={a.to} label={a.label} tone={a.tone} onPress={() => choose(a)} />
          ))}
        </View>
      )}
    </Card>
  );
}

function Stop({
  icon,
  title,
  name,
  address,
  notes,
  phone,
  muted,
  point,
}: {
  icon: IconName;
  title: string;
  name: string;
  address: string;
  notes?: string | null;
  phone: string | null;
  muted?: boolean;
  /** Punto exacto que marcó el cliente (ADR 0023): se navega ahí en vez de buscar la dirección. */
  point?: { lat: number; lng: number } | null;
}) {
  const t = useTheme();
  return (
    <View style={[styles.stop, { opacity: muted ? 0.55 : 1 }]}>
      <Icon name={icon} size={20} color={t.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: t.text, fontWeight: "700" }}>{name}</Text>
        <Text style={{ color: t.text }}>{address}</Text>
        {notes && <Text style={{ color: t.muted }}>{notes}</Text>}
        {point && <Text style={{ color: t.success, fontSize: 12, fontWeight: "700" }}>El cliente marcó su puerta en el mapa</Text>}
      </View>
      <View style={styles.stopActions}>
        <RoundButton
          icon="map"
          label={`Abrir ${address} en el mapa`}
          onPress={() =>
            void Linking.openURL(
              point
                ? `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
            )
          }
        />
        {phone && <RoundButton icon="phone" label={`Llamar a ${name}`} onPress={() => void Linking.openURL(`tel:${phone.replace(/[^\d+]/g, "")}`)} />}
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[styles.round, { backgroundColor: t.surface }]}>
      <Icon name={icon} size={18} color={t.text} />
    </Pressable>
  );
}

function ActionButton({ label, tone, onPress, disabled }: { label: string; tone: "primary" | "neutral" | "danger"; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  const colors = {
    primary: { bg: t.primary, fg: t.primaryText, border: t.primary },
    neutral: { bg: "transparent", fg: t.text, border: t.border },
    danger: { bg: "transparent", fg: t.danger, border: t.danger },
  }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={{ color: colors.fg, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  title: { fontSize: 26, fontWeight: "800" },
  notice: { flexDirection: "row", gap: space.sm, alignItems: "center", borderRadius: radius.md, padding: space.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reference: { fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  stop: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  stopActions: { flexDirection: "row", gap: space.sm },
  round: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  cash: { flexDirection: "row", gap: space.sm, alignItems: "center", borderRadius: radius.md, padding: space.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  action: { flexGrow: 1, borderWidth: 1.5, borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: space.md, alignItems: "center" },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  pin: { fontSize: 28, fontWeight: "800", letterSpacing: 12, textAlign: "center" },
});
