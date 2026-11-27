import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { setTokenSource } from "./api";
import { kv } from "./storage";

/**
 * Sesión del repartidor (ADR 0004/0015).
 * - Producción: Supabase Auth con código por email (sin links ni deep links).
 * - Desarrollo: también se puede pegar un token de `npm run dev:token -w @pedilo/api`.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const DEV_TOKEN_KEY = "pedilo.courier.devToken";

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
 * Token para la API: el de desarrollo o el de la sesión de Supabase. Vive fuera de React porque
 * la tarea de ubicación en segundo plano (ADR 0022) corre aunque la app no tenga pantallas.
 */
let devTokenCache: string | null | undefined; // undefined = todavía no se leyó del teléfono
async function currentToken(): Promise<string | null> {
  if (devTokenCache === undefined) devTokenCache = await kv.get(DEV_TOKEN_KEY);
  if (devTokenCache) return devTokenCache;
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}
setTokenSource(currentToken);
/** El login con token pegado solo existe en desarrollo o si no hay Supabase configurado. */
export const devLoginAllowed = __DEV__ || !supabase;

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  email: string | null;
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  signInWithDevToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await kv.get(DEV_TOKEN_KEY);
      const session = stored ? null : (await supabase?.auth.getSession())?.data.session;
      if (cancelled) return;
      devTokenCache = stored;
      setEmail(session?.user.email ?? null);
      setStatus(stored || session ? "signedIn" : "signedOut");
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
    return error.status === 429 ? "Pediste demasiados códigos. Esperá unos minutos." : "No pudimos enviar el código. Probá de nuevo.";
  }, []);

  const verifyCode = useCallback(async (address: string, code: string) => {
    if (!supabase) return "El login por email no está configurado en esta versión.";
    const { error } = await supabase.auth.verifyOtp({ email: address, token: code, type: "email" });
    return error ? "El código no es correcto o venció." : null;
  }, []);

  const signInWithDevToken = useCallback(async (token: string) => {
    await kv.set(DEV_TOKEN_KEY, token);
    devTokenCache = token;
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    await kv.remove(DEV_TOKEN_KEY);
    devTokenCache = null;
    await supabase?.auth.signOut();
    setStatus("signedOut");
  }, []);

  const value = useMemo(
    () => ({ status, email, sendCode, verifyCode, signInWithDevToken, signOut }),
    [status, email, sendCode, verifyCode, signInWithDevToken, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth fuera de AuthProvider");
  return value;
}
