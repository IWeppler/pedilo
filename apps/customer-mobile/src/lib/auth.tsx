import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { kv } from "./storage";

/**
 * Cuenta del cliente (Supabase Auth, ADR 0026): Google, Apple o email y contraseña
 * (con el email confirmado por link). Sin cuenta no se
 * entra a la app.
 *
 * - Google: OAuth en el navegador del sistema (PKCE) y vuelta a la app por `pedilo://auth/callback`.
 * - Apple: nativo en iPhone (`expo-apple-authentication` + `signInWithIdToken`); en Android, el
 *   mismo OAuth por navegador que Google (Apple no tiene SDK para Android).
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storage: { getItem: kv.get, setItem: kv.set, removeItem: kv.remove },
          persistSession: true,
          autoRefreshToken: true,
          flowType: "pkce",
          // En web, Supabase vuelve a la página con `?code=` y lo canjea solo.
          detectSessionInUrl: Platform.OS === "web",
        },
      })
    : null;

export const authConfigured = supabase !== null;

/**
 * Volvió del link de «Olvidé mi contraseña»: tiene sesión, pero antes de seguir elige la nueva.
 * Se escucha acá y no en React porque en web Supabase canjea el link al crear el cliente, antes de
 * que se monte ningún componente.
 */
let recoveryPending = false;
const recoveryListeners = new Set<() => void>();
function setRecoveryPending(pending: boolean) {
  recoveryPending = pending;
  for (const listener of recoveryListeners) listener();
}
function subscribeRecovery(listener: () => void) {
  recoveryListeners.add(listener);
  return () => void recoveryListeners.delete(listener);
}
supabase?.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") setRecoveryPending(true);
  else if (event === "SIGNED_OUT") setRecoveryPending(false);
});

/** Token de la sesión para la API (`null` = sin sesión: solo rutas públicas de lectura). */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.access_token ?? null;
}

export type SignInProvider = "google" | "apple";
type Status = "loading" | "signedOut" | "signedIn";

/** Resultado de intentar entrar: `null` = listo; `"cancelled"` = el usuario cerró; otro texto = error. */
export type SignInResult = null | "cancelled" | string;

interface AuthValue {
  status: Status;
  user: User | null;
  /** Nombre que dio Google o Apple, para no hacerlo tipear en el registro. */
  suggestedName: string;
  signIn: (provider: SignInProvider) => Promise<SignInResult>;
  /** Ingresar con email y contraseña (`null` = listo; si no, qué pasó). */
  signInWithPassword: (email: string, password: string) => Promise<PasswordResult>;
  /** Crear la cuenta: queda pendiente hasta que confirme el link del email. */
  signUpWithPassword: (email: string, password: string) => Promise<PasswordResult>;
  /** Volver a mandar el email de confirmación. */
  resendConfirmation: (email: string) => Promise<string | null>;
  /** Manda el link para elegir otra contraseña (`null` = enviado; si no, el error). */
  sendPasswordReset: (email: string) => Promise<string | null>;
  /** Entró por el link de recuperación: tiene que elegir la contraseña nueva antes de seguir. */
  recovering: boolean;
  /** Guarda la contraseña nueva y termina la recuperación (`null` = listo; si no, el error). */
  updatePassword: (password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

/**
 * Resultado de email y contraseña: `null` = sesión abierta; `confirm` = falta abrir el link que le
 * mandamos (verifica el email); `error` = qué pasó, para mostrarlo.
 */
export type PasswordResult = null | { kind: "confirm"; email: string } | { kind: "error"; message: string };

const AuthContext = createContext<AuthValue | null>(null);

const redirectTo = () =>
  Platform.OS === "web" ? `${globalThis.location?.origin ?? ""}/auth/callback` : Linking.createURL("auth/callback");

/** OAuth en el navegador del sistema; vuelve con `?code=` y se canjea por la sesión (PKCE). */
async function signInWithBrowser(client: SupabaseClient, provider: SignInProvider): Promise<SignInResult> {
  const to = redirectTo();
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: to, skipBrowserRedirect: Platform.OS !== "web" },
  });
  if (error || !data.url) return "No pudimos abrir el ingreso. Probá de nuevo.";
  // En web, la página se va al proveedor y vuelve a /auth/callback.
  if (Platform.OS === "web") return null;
  const result = await WebBrowser.openAuthSessionAsync(data.url, to);
  if (result.type !== "success") return "cancelled";
  const params = new URL(result.url).searchParams;
  const code = params.get("code");
  if (!code) return params.get("error_description") ?? "No se pudo completar el ingreso.";
  // Si la app ya lo canjeó al abrirse por el link, la sesión está: no es un error.
  const exchanged = await client.auth.exchangeCodeForSession(code);
  if (exchanged.error && !(await client.auth.getSession()).data.session) return "No se pudo completar el ingreso. Probá de nuevo.";
  return null;
}

/** Sign in with Apple nativo (iPhone). Apple da el nombre solo la primera vez: se guarda. */
async function signInWithAppleNative(client: SupabaseClient): Promise<SignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) return "Apple no devolvió la identidad. Probá de nuevo.";
    const { error } = await client.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken });
    if (error) return "No se pudo entrar con Apple. Probá de nuevo.";
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" ");
    if (name) await client.auth.updateUser({ data: { full_name: name } }).catch(() => undefined);
    return null;
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return "cancelled";
    return "No se pudo entrar con Apple. Probá de nuevo.";
  }
}

/**
 * Canjea el `code` cuando la app se abre por un link (ingreso, confirmación del email o
 * recuperación; lo usa la ruta /auth/callback). `false` = el link no sirvió: venció, ya se usó o se
 * abrió en otro dispositivo (PKCE guarda la otra mitad en el que lo pidió).
 */
export async function completeSignInFromUrl(code: string | undefined): Promise<boolean> {
  if (!supabase) return false;
  if ((await supabase.auth.getSession()).data.session) return true;
  if (!code) return false;
  const { error } = await supabase.auth.exchangeCodeForSession(code).catch(() => ({ error: true }));
  return !error;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(supabase ? "loading" : "signedOut");
  const [user, setUser] = useState<User | null>(null);
  const recovering = useSyncExternalStore(subscribeRecovery, () => recoveryPending, () => false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setStatus(data.session ? "signedIn" : "signedOut");
    });
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "signedIn" : "signedOut");
    });
    // Supabase recomienda renovar el token solo con la app en primer plano.
    const appState =
      Platform.OS === "web"
        ? null
        : AppState.addEventListener("change", (state) => {
            if (state === "active") void supabase!.auth.startAutoRefresh();
            else void supabase!.auth.stopAutoRefresh();
          });
    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
      appState?.remove();
    };
  }, []);

  const signIn = useCallback(async (provider: SignInProvider): Promise<SignInResult> => {
    if (!supabase) return "El ingreso con cuenta no está configurado en esta versión.";
    try {
      return provider === "apple" && Platform.OS === "ios" ? await signInWithAppleNative(supabase) : await signInWithBrowser(supabase, provider);
    } catch {
      return "No hay conexión. Probá de nuevo.";
    }
  }, []);

  // El email se verifica con el link de confirmación: no hace falta verificar el teléfono por SMS.
  const signInWithPassword = useCallback(async (email: string, password: string): Promise<PasswordResult> => {
    if (!supabase) return { kind: "error", message: "El ingreso no está configurado en esta versión." };
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error) return null;
      if (error.code === "email_not_confirmed") return { kind: "confirm", email };
      if (error.code === "invalid_credentials") return { kind: "error", message: "El email o la contraseña no coinciden." };
      if (error.status === 429) return { kind: "error", message: "Hubo muchos intentos seguidos. Esperá un minuto y probá de nuevo." };
      return { kind: "error", message: "No pudimos ingresar. Probá de nuevo." };
    } catch {
      return { kind: "error", message: "No hay conexión. Revisala y probá de nuevo." };
    }
  }, []);

  const signUpWithPassword = useCallback(async (email: string, password: string): Promise<PasswordResult> => {
    if (!supabase) return { kind: "error", message: "El ingreso no está configurado en esta versión." };
    try {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
      if (error) {
        if (error.code === "weak_password") return { kind: "error", message: "Elegí una contraseña más segura: al menos 8 caracteres, con letras y números." };
        if (error.code === "user_already_exists") return { kind: "error", message: "Ya hay una cuenta con ese email. Ingresá con tu contraseña." };
        if (error.status === 429) return { kind: "error", message: "Hubo muchos intentos seguidos. Esperá un minuto y probá de nuevo." };
        return { kind: "error", message: "No pudimos crear la cuenta. Probá de nuevo." };
      }
      // Si el proyecto no pide confirmar el email, la sesión ya está abierta.
      return data.session ? null : { kind: "confirm", email };
    } catch {
      return { kind: "error", message: "No hay conexión. Revisala y probá de nuevo." };
    }
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    if (!supabase) return "El ingreso no está configurado en esta versión.";
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo() } });
      if (!error) return null;
      return error.status === 429 ? "Ya te mandamos uno hace poco. Esperá un minuto." : "No pudimos mandar el email. Probá de nuevo.";
    } catch {
      return "No hay conexión. Revisala y probá de nuevo.";
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!supabase) return "El ingreso no está configurado en esta versión.";
    try {
      // Supabase responde igual exista o no la cuenta: no se revela qué emails están registrados.
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
      if (!error) return null;
      return error.status === 429 ? "Ya te mandamos un link hace poco. Esperá un minuto." : "No pudimos mandar el email. Probá de nuevo.";
    } catch {
      return "No hay conexión. Revisala y probá de nuevo.";
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) return "El ingreso no está configurado en esta versión.";
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (error.code === "same_password") return "Elegí una contraseña distinta de la anterior.";
        if (error.code === "weak_password") return "Elegí una contraseña más segura: al menos 8 caracteres, con letras y números.";
        if (error.code === "session_expired" || error.status === 401) return "El link venció. Pedí otro desde «¿Olvidaste tu contraseña?».";
        return "No pudimos guardar la contraseña. Probá de nuevo.";
      }
      setRecoveryPending(false);
      return null;
    } catch {
      return "No hay conexión. Revisala y probá de nuevo.";
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setUser(null);
    setStatus("signedOut");
  }, []);

  const suggestedName = (user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "") as string;
  const value = useMemo(
    () => ({
      status,
      user,
      suggestedName,
      signIn,
      signInWithPassword,
      signUpWithPassword,
      resendConfirmation,
      sendPasswordReset,
      recovering,
      updatePassword,
      signOut,
    }),
    [status, user, suggestedName, signIn, signInWithPassword, signUpWithPassword, resendConfirmation, sendPasswordReset, recovering, updatePassword, signOut],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return value;
}

// Cierra la pestaña del navegador si la app se abrió desde la vuelta del OAuth (web).
WebBrowser.maybeCompleteAuthSession();
