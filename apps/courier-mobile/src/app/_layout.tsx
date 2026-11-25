import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";

import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { OutboxProvider } from "@/lib/outbox";
import { useTheme } from "@/lib/theme";

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OutboxProvider>
          <Routes />
        </OutboxProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Sin sesión solo existe el login; con sesión, la app (el registro lo decide `(tabs)`). */
function Routes() {
  const { status } = useAuth();
  const t = useTheme();
  if (status === "loading") return <Loading />;
  const signedIn = status === "signedIn";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="register" />
      </Stack.Protected>
    </Stack>
  );
}
