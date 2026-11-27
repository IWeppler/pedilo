import { ApiError, type Order, unwrap } from "@pedilo/api-client";
import { CUSTOMER_TRACKING_STATUSES, customerCanCancel, type DeliveryStatus, formatARS, isOrderFinal, ORDER_STATUS_LABELS, VEHICLE_LABELS, type Vehicle } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Icon, type IconName } from "@/components/icon";
import { ClaimSection } from "@/components/claim-section";
import { CourierMap } from "@/components/courier-map";
import { describeSlot } from "@/components/slot-picker";
import { Badge, Button, ErrorState, Loading } from "@/components/ui";
import { api, useOrder } from "@/lib/api";
import { locationAgeLabel } from "@/lib/courier-location";
import { openCardPayment } from "@/lib/card-payment";
import { useMyOrders } from "@/lib/my-orders";
import { registerOrderForPush } from "@/lib/push";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

type Status = Order["status"];

/** Todas las sucursales están hoy en Argentina; el pedido no trae la zona horaria. */
const ORDER_TIMEZONE = "America/Argentina/Buenos_Aires";

const PICKUP_STEPS: Status[] = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP"];
const DELIVERY_STEPS: Status[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "PICKED_UP_BY_COURIER", "DELIVERED"];
const FAILED: Status[] = ["REJECTED", "CANCELLED", "EXPIRED", "DELIVERY_FAILED"];
const COMPLETED: Status[] = ["PICKED_UP", "DELIVERED"];

const STATUS_ICON: Partial<Record<Status, IconName>> = {
  PLACED: "clock",
  ACCEPTED: "check",
  PREPARING: "food",
  READY: "pickup",
  READY_FOR_PICKUP: "pickup",
  PICKED_UP_BY_COURIER: "delivery",
  PICKED_UP: "check",
  DELIVERED: "check",
};

/** Seguimiento de un pedido hecho desde este teléfono (se actualiza solo cada 10 s). */
export default function OrderScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tokenFor } = useMyOrders();
  const token = tokenFor(id);
  const order = useOrder(id, token);
  // Avisos de este pedido al celular (reclamos, ADR 0020). En Expo Go no hace nada.
  useEffect(() => {
    if (token) void registerOrderForPush(id, token);
  }, [id, token]);
  const queryClient = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Cancelar pide un segundo toque para confirmar (no se usan diálogos del sistema).
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/public/orders/{orderId}/cancel", {
          params: { path: { orderId: id }, header: { "x-order-token": token! } },
          body: {},
        }),
      ),
    onSuccess: (updated) => {
      setConfirmingCancel(false);
      queryClient.setQueryData(["order", id], updated);
    },
    onError: (err) => setCancelError(err instanceof ApiError ? err.message : "No pudimos cancelar. Probá de nuevo."),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!token) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <ErrorState message="No encontramos este pedido en este teléfono." onRetry={() => router.replace("/")} />
      </SafeAreaView>
    );
  }
  if (order.isPending) return <Loading />;
  if (order.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <ErrorState message="No pudimos cargar el pedido. Revisá tu conexión." onRetry={() => order.refetch()} />
      </SafeAreaView>
    );
  }

  const o = order.data;
  const steps = o.fulfillmentType === "PICKUP" ? PICKUP_STEPS : DELIVERY_STEPS;
  const failed = FAILED.includes(o.status);
  const completed = COMPLETED.includes(o.status);
  const currentIndex = steps.indexOf(o.status);
  const final = isOrderFinal(o.status);

  const hero = failed
    ? { bg: t.dangerBg, fg: t.danger, iconBg: t.danger, iconFg: "#ffffff" }
    : completed
      ? { bg: t.successBg, fg: t.success, iconBg: t.success, iconFg: "#ffffff" }
      : { bg: t.primary, fg: t.primaryText, iconBg: "rgba(255,255,255,0.14)", iconFg: t.primaryText };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={back}
          hitSlop={8}
          style={[styles.backButton, { backgroundColor: t.surface }]}
        >
          <Icon name="back" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: t.text }]}>Pedido {o.code}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} tintColor={t.primary} />}
      >
        {/* Estado actual */}
        <View style={[styles.hero, { backgroundColor: hero.bg }]}>
          <View style={[styles.heroIcon, { backgroundColor: hero.iconBg }]}>
            <Icon name={failed ? "warning" : (STATUS_ICON[o.status] ?? "clock")} size={34} color={hero.iconFg} />
          </View>
          <View style={styles.heroBody}>
            <Text style={[styles.heroMerchant, { color: hero.fg }]} numberOfLines={1}>
              {o.merchant.name}
            </Text>
            <Text style={[styles.heroStatus, { color: hero.fg }]} accessibilityLiveRegion="polite">
              {ORDER_STATUS_LABELS[o.status]}
            </Text>
            {statusMessage(o) && <Text style={[styles.heroMessage, { color: hero.fg }]}>{statusMessage(o)}</Text>}
          </View>
        </View>
        {!final && <Text style={[styles.autoRefresh, { color: t.muted }]}>Se actualiza solo · deslizá para refrescar</Text>}

        {/* Pago con tarjeta pendiente (ADR 0021): el comercio lo recibe cuando se aprueba. */}
        {o.status === "PENDING_PAYMENT" && (
          <Button
            label="Pagar con tarjeta"
            onPress={() => void openCardPayment(o.id, token).then(() => order.refetch())}
          />
        )}

        {/* Repartidor de Pedilo y PIN de entrega (ADR 0016) */}
        {o.tracking && (o.tracking.pin || o.tracking.courier) && (
          <Card t={t} padded>
            {o.tracking.courier && (
              <View style={styles.rowStart}>
                <Icon name="delivery" size={20} color={t.text} />
                <Text style={[styles.infoTitle, { color: t.text, flex: 1 }]}>
                  Te lo lleva {o.tracking.courier.name} ({VEHICLE_LABELS[o.tracking.courier.vehicle as Vehicle].toLowerCase()})
                </Text>
              </View>
            )}
            {/* Seguimiento en vivo (ADR 0022): desde que el repartidor retiró el pedido. */}
            {o.tracking.courier && o.tracking.courierLocation ? (
              <View style={{ gap: space.xs }}>
                <CourierMap location={o.tracking.courierLocation} courierName={o.tracking.courier.name} />
                <Text style={[styles.meta, { color: t.muted }]}>
                  Ubicación de {o.tracking.courier.name} {locationAgeLabel(o.tracking.courierLocation.recordedAt)}
                </Text>
              </View>
            ) : (
              o.tracking.courier &&
              CUSTOMER_TRACKING_STATUSES.includes(o.tracking.status as DeliveryStatus) && (
                <Text style={[styles.meta, { color: t.muted }]}>Ya está en camino. Cuando tengamos su ubicación la vas a ver acá en el mapa.</Text>
              )
            )}
            {o.tracking.pin && (
              <View style={{ gap: 4 }}>
                <Text style={[styles.meta, { color: t.muted }]}>PIN de entrega: dáselo al repartidor cuando te entregue el pedido.</Text>
                <Text selectable style={[styles.pin, { color: t.text }]} accessibilityLabel={`PIN de entrega ${o.tracking.pin.split("").join(" ")}`}>
                  {o.tracking.pin}
                </Text>
              </View>
            )}
          </Card>
        )}

        {/* Progreso */}
        {!failed && (
          <Card t={t}>
            {steps.map((s, i) => (
              <Step key={s} label={ORDER_STATUS_LABELS[s]} state={i < currentIndex || (i === currentIndex && completed) ? "done" : i === currentIndex ? "current" : "pending"} last={i === steps.length - 1} t={t} />
            ))}
          </Card>
        )}

        {/* Entrega */}
        <Card t={t}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: t.background }]}>
              <Icon name={o.fulfillmentType === "PICKUP" ? "pickup" : "delivery"} size={20} color={t.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.infoTitle, { color: t.text }]}>{o.fulfillmentType === "PICKUP" ? "Retiro en el local" : "Envío a domicilio"}</Text>
              <Text style={[styles.meta, { color: t.muted }]}>
                {o.delivery ? `${o.delivery.addressLine}${o.delivery.addressNotes ? ` (${o.delivery.addressNotes})` : ""}` : o.branch.address}
              </Text>
            </View>
            <Badge label={o.paymentMethod === "TRANSFER" ? "Transferencia" : "Efectivo"} />
          </View>
          {o.scheduledFor && (
            <View style={[styles.infoRow, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
              <View style={[styles.infoIcon, { backgroundColor: t.background }]}>
                <Icon name="calendar" size={20} color={t.text} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.infoTitle, { color: t.text }]}>Programado</Text>
                <Text style={[styles.meta, { color: t.muted }]}>
                  {describeSlot(o.scheduledFor, ORDER_TIMEZONE)} · franja de 30 min
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* Transferencia */}
        {o.transfer && !(failed && o.paymentStatus !== "APPROVED") && (
          <>
            <Text style={[styles.section, { color: t.text }]}>Transferencia</Text>
            <Card t={t} padded>
              {o.paymentStatus === "APPROVED" ? (
                <View style={styles.rowStart}>
                  <Icon name="check" size={20} color={t.success} />
                  <Text style={[styles.infoTitle, { color: t.success, flex: 1 }]}>El comercio confirmó que le llegó tu transferencia.</Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.meta, { color: t.muted }]}>
                    Transferí {formatARS(o.totalMinor)} a esta cuenta. Mantené apretado un dato para copiarlo. El comercio
                    confirma cuando le llega.
                  </Text>
                  <TransferRow t={t} label="Titular" value={o.transfer.holder} />
                  {o.transfer.alias && <TransferRow t={t} label="Alias" value={o.transfer.alias} />}
                  {o.transfer.cbu && <TransferRow t={t} label="CBU / CVU" value={o.transfer.cbu} />}
                  <TransferRow t={t} label="Monto" value={formatARS(o.totalMinor)} />
                </>
              )}
            </Card>
          </>
        )}

        {/* Detalle */}
        <Text style={[styles.section, { color: t.text }]}>Detalle</Text>
        <Card t={t} padded>
          {o.items.map((item) => (
            <View key={item.id} style={styles.item}>
              <View style={[styles.qtyPill, { backgroundColor: t.background }]}>
                <Text style={[styles.qtyText, { color: t.text }]}>{item.quantity}×</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.itemName, { color: t.text }]}>
                  {item.productName}
                  {item.variantName ? ` (${item.variantName})` : ""}
                </Text>
                {item.options.length > 0 && <Text style={[styles.meta, { color: t.muted }]}>{item.options.map((op) => op.name).join(", ")}</Text>}
              </View>
              <Text style={[styles.itemPrice, { color: t.text }]}>{formatARS(item.totalMinor)}</Text>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: t.border }]} />
          {o.deliveryFeeMinor > 0 && (
            <View style={styles.rowBetween}>
              <Text style={[styles.meta, { color: t.muted, fontSize: 15 }]}>Envío</Text>
              <Text style={{ color: t.text, fontSize: 15 }}>{formatARS(o.deliveryFeeMinor)}</Text>
            </View>
          )}
          <View style={styles.rowBetween}>
            <Text style={[styles.total, { color: t.text }]}>Total</Text>
            <Text style={[styles.total, { color: t.text }]}>{formatARS(o.totalMinor)}</Text>
          </View>
        </Card>

        {/* Acciones */}
        {customerCanCancel(o.status) &&
          (confirmingCancel ? (
            <View style={[styles.confirmBox, { backgroundColor: t.dangerBg }]}>
              <Text style={[styles.confirmText, { color: t.danger }]}>¿Seguro que querés cancelar el pedido?</Text>
              <View style={styles.confirmActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmingCancel(false)}
                  disabled={cancel.isPending}
                  style={[styles.confirmButton, { backgroundColor: t.card }]}
                >
                  <Text style={[styles.confirmButtonText, { color: t.text }]}>No, seguir</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setCancelError(null);
                    cancel.mutate();
                  }}
                  disabled={cancel.isPending}
                  style={[styles.confirmButton, { backgroundColor: t.danger, opacity: cancel.isPending ? 0.6 : 1 }]}
                >
                  <Text style={[styles.confirmButtonText, { color: "#ffffff" }]}>{cancel.isPending ? "Cancelando…" : "Sí, cancelar"}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setConfirmingCancel(true)} style={styles.cancelLink} hitSlop={8}>
              <Text style={[styles.cancelLinkText, { color: t.danger }]}>Cancelar pedido</Text>
            </Pressable>
          ))}
        {cancelError && <Text style={{ color: t.danger, textAlign: "center" }}>{cancelError}</Text>}
        <ClaimSection orderId={o.id} token={token} orderStatus={o.status} />
        {final && <Button label="Hacer otro pedido" onPress={() => router.replace("/")} style={{ marginTop: space.sm }} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function TransferRow({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={[styles.meta, { color: t.muted }]}>{label}</Text>
      <Text selectable style={[styles.infoTitle, { color: t.text, flexShrink: 1, textAlign: "right" }]}>
        {value}
      </Text>
    </View>
  );
}

/** Texto de ayuda según el estado. */
function statusMessage(o: Order): string | null {
  if (FAILED.includes(o.status)) return o.statusReason ? `Motivo: ${o.statusReason}` : null;
  switch (o.status) {
    case "PENDING_PAYMENT":
      return `Falta pagar con tarjeta. ${o.merchant.name} recibe el pedido cuando se aprueba el pago (tenés 30 minutos).`;
    case "PLACED":
      return o.scheduledFor
        ? `Pedido programado para ${describeSlot(o.scheduledFor, ORDER_TIMEZONE)}. Esperando que ${o.merchant.name} lo confirme.`
        : `Esperando que ${o.merchant.name} confirme tu pedido.`;
    case "ACCEPTED":
      return "El comercio confirmó tu pedido.";
    case "PREPARING":
      return "Están preparando tu pedido.";
    case "READY_FOR_PICKUP":
      return `Ya podés pasar a buscarlo por ${o.branch.address}.`;
    case "PICKED_UP_BY_COURIER":
      return "Tu pedido va en camino.";
    case "PICKED_UP":
    case "DELIVERED":
      return "¡Que lo disfrutes!";
    default:
      return null;
  }
}

function Card({ t, padded, children }: { t: Theme; padded?: boolean; children: ReactNode }) {
  return <View style={[styles.card, padded && styles.cardPadded, { backgroundColor: t.surface }]}>{children}</View>;
}

function Step({ label, state, last, t }: { label: string; state: "done" | "current" | "pending"; last: boolean; t: Theme }) {
  const active = state !== "pending";
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View
          style={[
            styles.stepDot,
            state === "done" && { backgroundColor: t.primary, borderColor: t.primary },
            state === "current" && { backgroundColor: t.background, borderColor: t.primary },
            state === "pending" && { backgroundColor: "transparent", borderColor: t.border },
          ]}
        >
          {state === "done" && <Icon name="check" size={14} color={t.primaryText} />}
          {state === "current" && <View style={[styles.stepInner, { backgroundColor: t.primary }]} />}
        </View>
        {!last && <View style={[styles.stepLine, { backgroundColor: state === "done" ? t.primary : t.border }]} />}
      </View>
      <Text
        style={[
          styles.stepLabel,
          { color: active ? t.text : t.muted, fontWeight: state === "current" ? "800" : active ? "600" : "400" },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingTop: space.sm, gap: space.md, paddingBottom: space.xl },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  backButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },

  hero: { flexDirection: "row", alignItems: "center", gap: space.lg, borderRadius: radius.lg, padding: space.lg },
  heroIcon: { width: 64, height: 64, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  heroBody: { flex: 1, gap: 2 },
  heroMerchant: { fontSize: 13, fontWeight: "600", opacity: 0.9 },
  heroStatus: { fontFamily: font.display, fontSize: 24, fontWeight: "800" },
  heroMessage: { fontSize: 14, opacity: 0.95 },
  autoRefresh: { fontSize: 12, textAlign: "center", marginTop: -space.xs },

  card: { borderRadius: radius.lg, paddingHorizontal: space.md },
  cardPadded: { paddingVertical: space.md, gap: space.md },

  step: { flexDirection: "row", gap: space.md },
  stepRail: { alignItems: "center", width: 26 },
  stepDot: { width: 26, height: 26, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: space.md },
  stepInner: { width: 10, height: 10, borderRadius: radius.pill },
  stepLine: { width: 2, flex: 1, minHeight: 14 },
  stepLabel: { fontSize: 15, paddingTop: space.md + 3, paddingBottom: space.sm, flex: 1 },

  infoRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  infoIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  infoTitle: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 13 },

  section: { fontFamily: font.display, fontSize: 18, fontWeight: "700", marginTop: space.sm },
  item: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  qtyPill: { borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 3, minWidth: 36, alignItems: "center" },
  qtyText: { fontFamily: font.display, fontSize: 13, fontWeight: "700" },
  itemName: { fontSize: 15, fontWeight: "600" },
  itemPrice: { fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowStart: { flexDirection: "row", alignItems: "center", gap: space.sm },
  pin: { fontFamily: font.display, fontSize: 36, fontWeight: "800", letterSpacing: 14, fontVariant: ["tabular-nums"] },
  total: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },

  cancelLink: { alignSelf: "center", paddingVertical: space.sm },
  cancelLinkText: { fontSize: 15, fontWeight: "700" },
  confirmBox: { borderRadius: radius.lg, padding: space.md, gap: space.md },
  confirmText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  confirmActions: { flexDirection: "row", gap: space.sm },
  confirmButton: { flex: 1, borderRadius: radius.pill, paddingVertical: 12, alignItems: "center" },
  confirmButtonText: { fontSize: 15, fontWeight: "700" },
});
