import { formatARS, VEHICLE_LABELS } from "@pedilo/domain";
import { Redirect, Tabs } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Icon } from "@/components/icon";
import { ErrorState, Loading } from "@/components/ui";
import { type Courier, useCities, useMe, useMyDeliveries } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LocationSharingProvider } from "@/lib/location";
import { font, radius, space, useTheme } from "@/lib/theme";

/**
 * Pestañas: Ofertas, En curso y Perfil. Antes de mostrarlas: sin perfil → registro; perfil sin
 * aprobar → «Recibimos tus datos» (no puede ver ofertas hasta que Pedilo lo habilite).
 */
export default function TabsLayout() {
  const t = useTheme();
  const me = useMe();
  const active = useMyDeliveries("active", me.data?.status === "APPROVED");

  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState message="No pudimos conectar con Pedilo. Revisá tu conexión." onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Redirect href="/register" />;
  if (me.data.status !== "APPROVED") return <NotApproved courier={me.data} />;

  const activeCount = active.data?.length ?? 0;
  return (
    <LocationSharingProvider active={activeCount > 0}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: t.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Ofertas", tabBarIcon: ({ color }) => <Icon name="bell" color={color} /> }} />
      <Tabs.Screen
        name="active"
        options={{
          title: "En curso",
          tabBarIcon: ({ color }) => <Icon name="delivery" color={color} />,
          tabBarBadge: activeCount > 0 ? activeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: t.accent, color: t.accentText, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Perfil", tabBarIcon: ({ color }) => <Icon name="person" color={color} /> }} />
    </Tabs>
    </LocationSharingProvider>
  );
}

/**
 * Perfil sin habilitar. Recién enviado (o en revisión) muestra lo que se mandó y se actualiza
 * solo cada 30 s (`useMe`): cuando Pedilo lo aprueba, aparecen las pestañas.
 */
function NotApproved({ courier }: { courier: Courier }) {
  const t = useTheme();
  const { signOut, email } = useAuth();
  const cities = useCities();
  const pending = courier.status === "PENDING_REVIEW";
  const cityName = cities.data?.find((c) => c.id === courier.cityId)?.name;
  const rows: [string, string][] = [
    ["Nombre", courier.displayName],
    ["Celular", courier.phone],
    ["Vehículo", VEHICLE_LABELS[courier.vehicle]],
    ...(cityName ? ([["Ciudad", cityName]] as [string, string][]) : []),
    ["Pago mínimo", courier.minFeeMinor > 0 ? formatARS(courier.minFeeMinor) : "Sin mínimo"],
  ];

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={[styles.icon, { backgroundColor: pending ? t.successBg : t.dangerBg }]}>
          <Icon name={pending ? "check" : "warning"} size={30} color={pending ? t.success : t.danger} />
        </View>
        <View style={{ gap: space.sm }}>
          <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
            {pending ? "Recibimos tus datos" : courier.status === "SUSPENDED" ? "Tu cuenta está suspendida" : "No pudimos aprobar tu registro"}
          </Text>
          <Text style={[styles.lede, { color: t.muted }]} accessibilityLiveRegion="polite">
            {pending
              ? "Pedilo los revisa y te habilita para recibir ofertas. No tenés que hacer nada más: cuando te aprueben, esta pantalla cambia sola."
              : (courier.statusReason ?? "Escribinos para saber más.")}
          </Text>
        </View>

        {pending && (
          <View style={[styles.summary, { backgroundColor: t.surface }]}>
            {rows.map(([label, value], i) => (
              <View key={label} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
                <Text style={[styles.rowLabel, { color: t.muted }]}>{label}</Text>
                <Text style={[styles.rowValue, { color: t.text }]} selectable>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={8} style={styles.signOut}>
          <Text style={[styles.signOutText, { color: t.muted }]}>{email ? `Salir de ${email}` : "Salir"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: "center", gap: 28, padding: space.xl },
  icon: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.display, fontSize: 32, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  lede: { fontSize: 16, lineHeight: 23, maxWidth: 360 },
  summary: { borderRadius: radius.md, paddingHorizontal: space.lg },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.lg, paddingVertical: 14 },
  rowLabel: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  signOut: { alignSelf: "flex-start", paddingVertical: space.xs },
  signOutText: { fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },
});
