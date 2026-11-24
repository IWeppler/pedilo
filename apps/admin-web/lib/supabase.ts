import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase Auth del lado del servidor (ADR 0004). La sesión vive en cookies que maneja
 * `@supabase/ssr`; `proxy.ts` la refresca en cada request.
 * Sin estas variables el panel queda en modo desarrollo (token pegado a mano).
 */
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export async function createSupabaseServer() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase no está configurado (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  const store = await cookies();
  return createServerClient(env.url, env.key, {
    // Nombre propio: en localhost las cookies no distinguen puerto y los dos paneles se pisarían.
    cookieOptions: { name: "sb-pedilo-admin" },
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        // En Server Components no se pueden escribir cookies; ahí el refresco lo hace proxy.ts.
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {}
      },
    },
  });
}
