import { ApiError, type Order, unwrap } from "@pedilo/api-client";
import { customerCanCancel, formatARS, isOrderFinal, ORDER_STATUS_LABELS } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Button, ErrorState, Loading } from "@/components/ui";
import { api, useOrder } from "@/lib/api";
import { useMyOrders } from "@/lib/my-orders";
import { space, useTheme } from "@/lib/theme";

type Status = Order["status"];

const PICKUP_STEPS: Status[] = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP"];
const DELIVERY_STEPS: Status[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "PICKED_UP_BY_COURIER", "DELIVERED"];
const FAILED: Status[] = ["REJECTED", "CANCELLED", "EXPIRED", "DELIVERY_FAILED"];

/** Seguimiento de un pedido hecho desde este teléfono (se actualiza solo cada 10 s). */
export default function OrderScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tokenFor } = useMyOrders();
  const token = tokenFor(id);
  const order = useOrder(id, token);
  const queryClient = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/public/orders/{orderId}/cancel", {
          params: { path: { orderId: id }, header: { "x-order-token": token! } },
          body: {},
        }),
      ),
    onSuccess: (updated) => queryClient.setQueryData(["order", id], updated),
    onError: (err) => setCancelError(err instanceof ApiError ? err.message : "No pudimos cancelar. Probá de nuevo."),
  });

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
  const currentIndex = steps.indexOf(o.status);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} />}
      >
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12}>
          <Text style={{ color: t.text, fontSize: 16 }}>‹ Volver</Text>
        </Pressable>

        <Text style={{ color: t.muted }}>
          Pedido {o.code} · {o.merchant.name}
        </Text>
        <Text style={[styles.status, { color: failed ? t.danger : t.text }]} accessibilityLiveRegion="polite">
          {ORDER_STATUS_LABELS[o.status]}
        </Text>
        {o.statusReason && failed && <Text style={{ color: t.text, fontSize: 16 }}>Motivo: {o.statusReason}</Text>}
        {o.status === "PLACED" && <Text style={{ color: t.muted }}>Esperando que {o.merchant.name} confirme tu pedido.</Text>}
        {o.status === "READY_FOR_PICKUP" && (
          <Text style={{ color: t.text, fontSize: 16 }}>Ya podés pasar a buscarlo por {o.branch.address}.</Text>
        )}

        {!failed && (
          <View style={styles.steps}>
            {steps.map((s, i) => {
              const done = i <= currentIndex;
              return (
                <View key={s} style={styles.step}>
                  <View style={[styles.dot, { backgroundColor: done ? t.primary : "transparent", borderColor: done ? t.primary : t.border }]} />
                  <Text style={{ color: done ? t.text : t.muted, fontWeight: i === currentIndex ? "700" : "400", fontSize: 15 }}>
                    {ORDER_STATUS_LABELS[s]}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={[styles.box, { backgroundColor: t.surface }]}>
          <View style={styles.rowBetween}>
            <Text style={{ color: t.text, fontWeight: "700" }}>{o.fulfillmentType === "PICKUP" ? "Retiro en el local" : "Envío a domicilio"}</Text>
            <Badge label="Efectivo" />
          </View>
          <Text style={{ color: t.muted }}>
            {o.delivery ? `${o.delivery.addressLine}${o.delivery.addressNotes ? ` (${o.delivery.addressNotes})` : ""}` : o.branch.address}
          </Text>
        </View>

        {o.items.map((item) => (
          <View key={item.id} style={styles.rowBetween}>
            <Text style={{ color: t.text, flex: 1 }}>
              {item.quantity} × {item.productName}
              {item.variantName ? ` (${item.variantName})` : ""}
              {item.options.length > 0 ? `\n${item.options.map((op) => op.name).join(", ")}` : ""}
            </Text>
            <Text style={{ color: t.text }}>{formatARS(item.totalMinor)}</Text>
          </View>
        ))}
        {o.deliveryFeeMinor > 0 && (
          <View style={styles.rowBetween}>
            <Text style={{ color: t.muted }}>Envío</Text>
            <Text style={{ color: t.muted }}>{formatARS(o.deliveryFeeMinor)}</Text>
          </View>
        )}
        <View style={styles.rowBetween}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>Total</Text>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 17 }}>{formatARS(o.totalMinor)}</Text>
        </View>

        {customerCanCancel(o.status) && (
          <Button
            label={cancel.isPending ? "Cancelando…" : "Cancelar pedido"}
            variant="outline"
            disabled={cancel.isPending}
            onPress={() => {
              setCancelError(null);
              cancel.mutate();
            }}
            style={{ marginTop: space.md }}
          />
        )}
        {cancelError && <Text style={{ color: t.danger }}>{cancelError}</Text>}
        {isOrderFinal(o.status) && <Button label="Hacer otro pedido" variant="outline" onPress={() => router.replace("/")} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  status: { fontSize: 28, fontWeight: "800" },
  steps: { gap: space.sm, marginVertical: space.sm },
  step: { flexDirection: "row", alignItems: "center", gap: space.md },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  box: { borderRadius: 12, padding: space.md, gap: 4 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
});
