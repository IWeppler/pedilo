import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";

import { CartProvider } from "@/lib/cart";
import { CityProvider } from "@/lib/city";
import { MyOrdersProvider } from "@/lib/my-orders";
import { useTheme } from "@/lib/theme";

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
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="city" options={{ presentation: "modal" }} />
              <Stack.Screen name="merchant/[slug]" />
              <Stack.Screen name="product/[slug]/[productId]" options={{ presentation: "modal" }} />
              <Stack.Screen name="cart" />
              <Stack.Screen name="order/[id]" />
              <Stack.Screen name="orders" />
            </Stack>
          </MyOrdersProvider>
        </CartProvider>
      </CityProvider>
    </QueryClientProvider>
  );
}
