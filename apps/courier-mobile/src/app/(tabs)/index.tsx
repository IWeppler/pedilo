import { ApiError, unwrap } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Icon } from "@/components/icon";
import { Card, Loading } from "@/components/ui";
import { api, type Offer, useMe, useOffers } from "@/lib/api";
import { font, radius, space, useTheme } from "@/lib/theme";

const timeFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Bandeja de ofertas (SPEC §9.2). Sin la dirección exacta: se ve recién al aceptar. Aceptar
 * necesita conexión: nunca se acepta «offline» (SPEC §9.3).
 */
export default function OffersScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const available = me.data?.available ?? false;
  const offers = useOffers(available);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (next: boolean) => unwrap(api.PATCH("/v1/courier/me", { body: { available: next } })),
    onSuccess: (data) => {
      queryClient.setQueryData(["courier", "me"], data);
      void queryClient.invalidateQueries({ queryKey: ["courier", "offers"] });
    },
    // Si la API respondió, su mensaje dice qué pasó; si no llegó a responder, es la conexión.
    onError: (err) =>
      setMessage(
        err instanceof ApiError
          ? `No se pudo cambiar tu disponibilidad: ${err.message}`
          : "No se pudo cambiar tu disponibilidad: no hay conexión con Pedilo. Probá de nuevo.",
      ),
  });

  const accept = useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/v1/courier/offers/{deliveryId}/accept", { params: { path: { deliveryId: id } } })),
    onSuccess: async () => {
      setMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["courier"] });
      router.navigate("/active");
    },
    onError: (err) => {
      const reason = err instanceof ApiError ? (err.details as { reason?: string } | undefined)?.reason : undefined;
      setMessage(
        reason === "OFFER_TAKEN"
          ? "Otro repartidor la aceptó primero."
          : reason === "OFFER_EXPIRED"
            ? "La oferta venció."
            : err instanceof ApiError
              ? err.message
              : "Sin conexión: para aceptar una oferta necesitás señal.",
      );
      void queryClient.invalidateQueries({ queryKey: ["courier", "offers"] });
    },
  });

  const decline = useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/v1/courier/offers/{deliveryId}/decline", { params: { path: { deliveryId: id } } })),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["courier", "offers"] }),
  });

  if (me.isPending) return <Loading />;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.background }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>Ofertas</Text>
        <View style={[styles.availability, { backgroundColor: available ? t.successBg : t.surface }]}>
          <Text style={{ color: available ? t.success : t.muted, fontWeight: "700" }}>{available ? "Disponible" : "No disponible"}</Text>
          <Switch
            value={available}
            onValueChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending}
            accessibilityLabel="Disponible para recibir ofertas"
            trackColor={{ true: t.success, false: t.border }}
          />
        </View>
      </View>
      {message && (
        <Pressable onPress={() => setMessage(null)} style={[styles.notice, { backgroundColor: t.dangerBg }]} accessibilityLiveRegion="polite">
          <Icon name="warning" size={18} color={t.danger} />
          <Text style={{ color: t.danger, fontWeight: "600", flex: 1 }}>{message}</Text>
        </Pressable>
      )}

      {!available ? (
        <View style={styles.empty}>
          <Text style={{ color: t.muted, textAlign: "center" }}>Activá «Disponible» para empezar a recibir ofertas de tu ciudad.</Text>
        </View>
      ) : (
        <FlatList
          data={offers.data ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()} tintColor={t.primary} />}
          ListEmptyComponent={
            <Text style={{ color: t.muted, textAlign: "center", marginTop: space.xl }}>
              {offers.isPending ? "Buscando ofertas…" : offers.isError ? "Sin conexión. Reintentamos solos." : "No hay ofertas ahora. Se actualiza sola."}
            </Text>
          }
          renderItem={({ item }) => (
            <OfferCard
              offer={item}
              busy={accept.isPending || decline.isPending}
              onAccept={() => accept.mutate(item.id)}
              onDecline={() => decline.mutate(item.id)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function OfferCard({ offer: o, busy, onAccept, onDecline }: { offer: Offer; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const t = useTheme();
  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.fee, { color: t.text }]}>{formatARS(o.courierFeeMinor + o.tipMinor)}</Text>
        <Text style={{ color: t.muted }}>vence {timeFormat.format(new Date(o.expiresAt))}</Text>
      </View>
      <Line icon="store" text={`${o.pickupName} · ${o.pickupAddress}`} />
      <Line icon="location" text={`Destino: ${o.dropoffArea} (la dirección exacta se ve al aceptar)`} />
      <Line icon="orders" text={o.packageDescription} />
      {o.cashToCollectMinor > 0 && <Line icon="cash" text={`Cobrás ${formatARS(o.cashToCollectMinor)} en efectivo al cliente`} />}
      <View style={styles.actions}>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, { borderColor: t.border, opacity: busy ? 0.5 : pressed ? 0.8 : 1 }]}
        >
          <Text style={{ color: t.text, fontWeight: "700" }}>No me interesa</Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, { backgroundColor: t.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1 }]}
        >
          <Text style={{ color: t.primaryText, fontWeight: "800", fontSize: 16 }}>Aceptar</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function Line({ icon, text }: { icon: "store" | "location" | "orders" | "cash"; text: string }) {
  const t = useTheme();
  return (
    <View style={styles.line}>
      <Icon name={icon} size={18} color={t.muted} />
      <Text style={{ color: t.text, flex: 1 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.md },
  title: { fontFamily: font.display, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  availability: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.pill, paddingLeft: space.md, paddingRight: 4 },
  notice: { flexDirection: "row", gap: space.sm, alignItems: "center", marginHorizontal: space.lg, borderRadius: radius.md, padding: space.md },
  empty: { flex: 1, justifyContent: "center", padding: space.xl },
  list: { padding: space.lg, gap: space.md },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  fee: { fontFamily: font.display, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  actions: { flexDirection: "row", gap: space.md, marginTop: space.sm },
  secondary: { flex: 1, borderWidth: 1.5, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingVertical: 14 },
  primary: { flex: 1.4, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingVertical: 14 },
});
