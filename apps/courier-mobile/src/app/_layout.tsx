import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";

import { fontAssets } from "@/components/text";
import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
// Registra la tarea de ubicación en segundo plano al arrancar (ADR 0022).
import "@/lib/location";
import { OutboxProvider } from "@/lib/outbox";
import { useTheme } from "@/lib/theme";

// La pantalla de inicio queda hasta que cargan las tipografías.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const fontsReady = fontsLoaded || Boolean(fontError);
  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync();
  }, [fontsReady]);
  // Si una fuente no carga, la app sigue con la del sistema en vez de quedarse trabada.
  if (!fontsReady) return null;

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
