import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { setTokenSource } from "./api";
import { unregisterForOffers } from "./push";
import { kv } from "./storage";

/**
 * Sesión del repartidor (ADR 0004/0015).
 * Supabase Auth con código por email (sin links ni deep links ni contraseña).
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
/** Donde versiones anteriores guardaban un token de desarrollo: se borra al abrir. */
const LEGACY_DEV_TOKEN_KEY = "pedilo.courier.devToken";

/** Supabase guarda la sesión en el teléfono (expo-sqlite kv) y la renueva sola. */
const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storage: { getItem: kv.get, setItem: kv.set, removeItem: kv.remove },
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

export const supabaseConfigured = supabase !== null;

/**
 * Token de la sesión para la API. Vive fuera de React porque la tarea de ubicación en segundo
 * plano (ADR 0022) corre aunque la app no tenga pantallas.
 */
async function currentToken(): Promise<string | null> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}
setTokenSource(currentToken);

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  email: string | null;
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      void kv.remove(LEGACY_DEV_TOKEN_KEY).catch(() => null);
      const session = (await supabase?.auth.getSession())?.data.session;
      if (cancelled) return;
      setEmail(session?.user.email ?? null);
      setStatus(session ? "signedIn" : "signedOut");
    })();
    const sub = supabase?.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
      setStatus((prev) => (session ? "signedIn" : prev === "loading" ? prev : "signedOut"));
    });
    // Supabase recomienda renovar el token solo con la app en primer plano.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void supabase?.auth.startAutoRefresh();
      else void supabase?.auth.stopAutoRefresh();
    });
    return () => {
      cancelled = true;
      sub?.data.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const sendCode = useCallback(async (address: string) => {
    if (!supabase) return "El login por email no está configurado en esta versión.";
    const { error } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
    if (!error) return null;
    return error.status === 429 ? "Pediste muchos códigos seguidos. Esperá un minuto y pedí otro." : "No se pudo enviar el código. Revisá el email y probá de nuevo.";
  }, []);

  const verifyCode = useCallback(async (address: string, code: string) => {
    if (!supabase) return "El login por email no está configurado en esta versión.";
    const { error } = await supabase.auth.verifyOtp({ email: address, token: code, type: "email" });
    return error ? "Ese código no es correcto o ya venció. Revisá el último email o pedí otro." : null;
  }, []);

  const signOut = useCallback(async () => {
    // Antes de perder la sesión: este celular deja de recibir ofertas de esta cuenta.
    await unregisterForOffers();
    await supabase?.auth.signOut();
    setStatus("signedOut");
  }, []);

  const value = useMemo(
    () => ({ status, email, sendCode, verifyCode, signOut }),
    [status, email, sendCode, verifyCode, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fuera de AuthProvider");
  return value;
}
