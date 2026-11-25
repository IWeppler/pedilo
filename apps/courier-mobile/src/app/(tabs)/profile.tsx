import { unwrap } from "@pedilo/api-client";
import { formatARS, VEHICLE_LABELS } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Card, Field, Loading } from "@/components/ui";
import { api, useMe, useMyDeliveries } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { space, useTheme } from "@/lib/theme";

const dateFormat = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Perfil, tarifa mínima e historial de repartos terminados. */
export default function ProfileScreen() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { email, signOut } = useAuth();
  const me = useMe();
  const done = useMyDeliveries("done");
  const [minFee, setMinFee] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (minFeeMinor: number) => unwrap(api.PATCH("/v1/courier/me", { body: { minFeeMinor } })),
    onSuccess: (data) => {
      queryClient.setQueryData(["courier", "me"], data);
      setMinFee(null);
    },
  });

  if (!me.data) return <Loading />;
  const c = me.data;
  const minFeeValue = minFee ?? String(c.minFeeMinor / 100);
  const parsed = Math.round(Number(minFeeValue.replace(",", ".")) * 100);
  const earned = (done.data ?? []).filter((d) => d.status === "DELIVERED").reduce((n, d) => n + d.courierFeeMinor + d.tipMinor, 0);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: t.text }]}>Perfil</Text>
        <Card>
          <Text style={[styles.name, { color: t.text }]}>{c.displayName}</Text>
          <Text style={{ color: t.muted }}>
            {VEHICLE_LABELS[c.vehicle]} · {c.phone}
            {email ? ` · ${email}` : ""}
          </Text>
        </Card>

        <Card>
          <Field
            label="Pago mínimo por envío ($)"
            value={minFeeValue}
            onChangeText={setMinFee}
            keyboardType="decimal-pad"
          />
          <Text style={{ color: t.muted, fontSize: 13 }}>No vas a ver ofertas que paguen menos que esto.</Text>
          {minFee !== null && (
            <Button
              label={save.isPending ? "Guardando…" : "Guardar"}
              disabled={save.isPending || !Number.isSafeInteger(parsed) || parsed < 0}
              onPress={() => save.mutate(parsed)}
            />
          )}
          {save.isError && <Text style={{ color: t.danger }}>No pudimos guardar. Revisá tu conexión.</Text>}
        </Card>

        <Text style={[styles.section, { color: t.text }]}>Últimos repartos</Text>
        <Card>
          <Text style={{ color: t.text }}>
            Entregados: {(done.data ?? []).filter((d) => d.status === "DELIVERED").length} · te pagaron {formatARS(earned)}
          </Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>Lo cobrás directo del comercio: Pedilo solo lo registra.</Text>
          {(done.data ?? []).map((d) => (
            <View key={d.id} style={styles.row}>
              <Text style={{ color: t.text, flex: 1 }}>
                {d.reference} · {d.pickup.name}
                {d.status === "DELIVERY_FAILED" ? " · no se entregó" : ""}
              </Text>
              <Text style={{ color: t.muted }}>{d.deliveredAt ? dateFormat.format(new Date(d.deliveredAt)) : ""}</Text>
            </View>
          ))}
          {done.data?.length === 0 && <Text style={{ color: t.muted }}>Todavía no hiciste repartos.</Text>}
        </Card>

        <Button label="Cerrar sesión" variant="outline" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  title: { fontSize: 26, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800" },
  section: { fontSize: 18, fontWeight: "800", marginTop: space.sm },
  row: { flexDirection: "row", gap: space.sm, justifyContent: "space-between" },
});
