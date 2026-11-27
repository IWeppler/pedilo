import { Redirect, Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/text";
import { Icon } from "@/components/icon";
import { Button, ErrorState, Loading } from "@/components/ui";
import { useMe, useMyDeliveries } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LocationSharingProvider } from "@/lib/location";
import { font, space, useTheme } from "@/lib/theme";

/**
 * Pestañas: Ofertas, En curso y Perfil. Antes de mostrarlas: sin perfil → registro; perfil sin
 * aprobar → pantalla de espera (no puede ver ofertas hasta que Pedilo lo habilite).
 */
export default function TabsLayout() {
  const t = useTheme();
  const me = useMe();
  const active = useMyDeliveries("active", me.data?.status === "APPROVED");

  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorState message="No pudimos conectar con Pedilo. Revisá tu conexión." onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Redirect href="/register" />;
  if (me.data.status !== "APPROVED") return <NotApproved status={me.data.status} reason={me.data.statusReason} />;

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

function NotApproved({ status, reason }: { status: string; reason: string | null }) {
  const t = useTheme();
  const { signOut } = useAuth();
  const pending = status === "PENDING_REVIEW";
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.background }]}>
      <View style={[styles.icon, { backgroundColor: pending ? t.primarySoft : t.dangerBg }]}>
        <Icon name={pending ? "clock" : "warning"} size={40} color={pending ? t.primary : t.danger} />
      </View>
      <Text style={[styles.title, { color: t.text }]}>
        {pending ? "Estamos revisando tus datos" : status === "SUSPENDED" ? "Tu cuenta está suspendida" : "No pudimos aprobar tu registro"}
      </Text>
      <Text style={{ color: t.muted, textAlign: "center" }}>
        {pending ? "Cuando Pedilo te habilite vas a poder recibir ofertas. Esta pantalla se actualiza sola." : (reason ?? "Escribinos para más información.")}
      </Text>
      <Button label="Salir" variant="outline" onPress={() => void signOut()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl },
  icon: { width: 88, height: 88, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.display, fontSize: 22, fontWeight: "800", textAlign: "center" },
});
