import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { CartProvider } from "@/lib/cart";
import { CityProvider } from "@/lib/city";
import { MyOrdersProvider } from "@/lib/my-orders";
import { useTheme } from "@/lib/theme";

/** Tocar un aviso abre la pantalla que trae (p. ej. el seguimiento del pedido con el reclamo). */
function NotificationRouter() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/order/")) router.push(url as never);
  }, [response, router]);
  return null;
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const t = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <CityProvider>
        <CartProvider>
          <MyOrdersProvider>
            <NotificationRouter />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="city" options={{ presentation: "modal" }} />
              <Stack.Screen name="merchant/[slug]" />
              <Stack.Screen name="product/[slug]/[productId]" options={{ presentation: "modal" }} />
              <Stack.Screen name="cart" />
              <Stack.Screen name="order/[id]" />
            </Stack>
          </MyOrdersProvider>
        </CartProvider>
      </CityProvider>
    </QueryClientProvider>
  );
}
