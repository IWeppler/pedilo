import { Tabs, useRouter } from "expo-router";

import { Icon } from "@/components/icon";
import { useCart } from "@/lib/cart";
import { useTheme } from "@/lib/theme";

/**
 * Barra de pestañas: Inicio, Pedidos y Carrito.
 * «Carrito» no es una pestaña real: abre la pantalla del carrito encima (así el pedido
 * se arma y se confirma sin la barra de abajo).
 */
export default function TabsLayout() {
  const t = useTheme();
  const router = useRouter();
  const { itemCount } = useCart();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.background, borderTopColor: t.border, elevation: 0 },
        tabBarLabelStyle: { fontSize: 11, fontFamily: "HankenGrotesk_600SemiBold" },
        sceneStyle: { backgroundColor: t.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Inicio", tabBarIcon: ({ color }) => <Icon name="home" color={color} /> }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: "Pedidos", tabBarIcon: ({ color }) => <Icon name="orders" color={color} /> }}
      />
      <Tabs.Screen
        name="bag"
        options={{
          title: "Carrito",
          tabBarIcon: ({ color }) => <Icon name="cart" color={color} />,
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: { backgroundColor: t.accent, color: t.accentText, fontSize: 11 },
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/cart");
          },
        }}
      />
    </Tabs>
  );
}
