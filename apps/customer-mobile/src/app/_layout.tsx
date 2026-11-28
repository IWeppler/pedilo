import { ApiError } from "@pedilo/api-client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { fontAssets } from "@/components/text";
import { ErrorState, Loading } from "@/components/ui";
import { useAccountOrders, useCustomerProfile } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { CityProvider } from "@/lib/city";
import { MyOrdersProvider, useMyOrders } from "@/lib/my-orders";
import { useTheme } from "@/lib/theme";

// La pantalla de inicio queda hasta que cargan las tipografías.
void SplashScreen.preventAutoHideAsync();

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

/** Trae los pedidos hechos con la cuenta desde otros celulares (ADR 0026). */
function AccountSync() {
  const accountOrders = useAccountOrders(true);
  const { merge } = useMyOrders();
  useEffect(() => {
    if (!accountOrders.data) return;
    merge(accountOrders.data.map((o) => ({ id: o.id, token: o.trackingToken, code: o.code, merchantName: o.merchantName, createdAt: o.createdAt })));
  }, [accountOrders.data, merge]);
  return null;
}

/**
 * Sin cuenta no se entra a la app (ADR 0026): primero el ingreso, después nombre, teléfono y
 * dirección, y recién ahí los comercios.
 */
function Routes() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { status, recovering, signOut } = useAuth();
  const signedIn = status === "signedIn";
  // Volvió del link de «¿Olvidaste tu contraseña?»: primero elige la nueva.
  const resetting = signedIn && recovering;
  const profile = useCustomerProfile(signedIn && !resetting);
  // Al salir, no queda nada de la cuenta anterior en memoria.
  useEffect(() => {
    if (status === "signedOut") queryClient.removeQueries({ queryKey: ["customer"] });
  }, [status, queryClient]);

  if (status === "loading" || (signedIn && !resetting && profile.isPending)) return <Loading />;
  if (signedIn && !resetting && profile.isError) {
    const err = profile.error;
    // La API no acepta la sesión (venció o es de otro proyecto): reintentar no sirve, hay que volver a entrar.
    if (err instanceof ApiError && err.status === 401) {
      return <ErrorState message="Tu sesión ya no es válida. Ingresá de nuevo." onRetry={() => void signOut()} retryLabel="Volver a ingresar" />;
    }
    return (
      <ErrorState
        message={
          err instanceof ApiError
            ? `Pedilo respondió con un error (${err.status}). Probá de nuevo en un rato.`
            : "No pudimos conectar con Pedilo. Revisá tu conexión."
        }
        onRetry={() => void profile.refetch()}
      />
    );
  }
  const registered = signedIn && !resetting && profile.data !== null;

  return (
    <>
      {registered && <AccountSync />}
      {/* Los avisos push solo existen en el celular; en web esta API no está. */}
      {registered && Platform.OS !== "web" && <NotificationRouter />}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.background } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={resetting}>
          <Stack.Screen name="reset-password" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !resetting && !registered}>
          <Stack.Screen name="register" />
        </Stack.Protected>
        <Stack.Protected guard={registered}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="city" options={{ presentation: "modal" }} />
          <Stack.Screen name="merchant/[slug]" />
          <Stack.Screen name="product/[slug]/[productId]" options={{ presentation: "modal" }} />
          <Stack.Screen name="cart" />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="account" options={{ presentation: "modal" }} />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="address" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Screen name="auth/callback" />
      </Stack>
    </>
  );
}

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
      <CityProvider>
        <CartProvider>
          <MyOrdersProvider>
            <Routes />
          </MyOrdersProvider>
        </CartProvider>
      </CityProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
