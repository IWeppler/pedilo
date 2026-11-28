import { addressTitle } from "@pedilo/domain";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/icon";
import { Text } from "@/components/text";
import { useCustomerProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCity } from "@/lib/city";
import { font, radius, space, useTheme } from "@/lib/theme";

/** Pestaña «Cuenta»: quién sos y lo que podés configurar (datos, dirección, ciudad, avisos). */
export default function ProfileScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const profile = useCustomerProfile(true).data;
  const { city } = useCity();

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.who}>
          <View style={[styles.avatar, { backgroundColor: t.accentSoft }]}>
            <Text style={[styles.avatarText, { color: t.accent }]}>{(profile?.displayName ?? user?.email ?? "?").trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.text }]} numberOfLines={1} accessibilityRole="header">
              {profile?.displayName ?? "Tu cuenta"}
            </Text>
            {user?.email && (
              <Text style={{ color: t.muted, fontSize: 14 }} numberOfLines={1}>
                {user.email}
              </Text>
            )}
          </View>
        </View>

        <Group>
          <Item icon="person" label="Tus datos" detail={profile ? `${profile.displayName} · ${profile.phone}` : undefined} onPress={() => router.push("/account")} />
          <Item
            icon="location"
            label="Tus direcciones"
            detail={profile?.addresses.length ? profile.addresses.map((a) => addressTitle(a)).join(" · ") : "Sin cargar"}
            onPress={() => router.push("/address")}
          />
          <Item icon="map" label="Ciudad" detail={city?.name ?? "Sin elegir"} onPress={() => router.push("/city")} />
          <Item icon="bell" label="Avisos" detail="Cómo van tus pedidos" onPress={() => router.push("/notifications")} last />
        </Group>

        <Group>
          <Item icon="logout" label="Salir" onPress={() => void signOut()} last />
        </Group>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.group, { backgroundColor: t.surface }]}>{children}</View>;
}

function Item({ icon, label, detail, onPress, last }: { icon: IconName; label: string; detail?: string | undefined; onPress: () => void; last?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}: ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={22} color={t.text} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemLabel, { color: t.text }]}>{label}</Text>
        {detail && (
          <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <Icon name="chevronRight" size={18} color={t.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, gap: space.lg },
  who: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  avatar: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: font.display, fontSize: 24, fontWeight: "800" },
  name: { fontFamily: font.display, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  group: { borderRadius: radius.md, paddingHorizontal: space.lg },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  itemLabel: { fontSize: 16, fontWeight: "600" },
});
