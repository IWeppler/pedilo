import type { Config } from "./config";
import { loadOrCreateDevKeys } from "./modules/identity/dev-keys";
import {
  createLocalVerifier,
  createSupabaseVerifier,
  type TokenVerifier,
} from "./modules/identity/token-verifier";

/** Elige el verificador según la configuración (ADR 0004). */
export async function createTokenVerifier(config: Config): Promise<TokenVerifier> {
  if (config.auth.mode === "supabase") return createSupabaseVerifier(config.auth.supabaseUrl);
  if (config.env === "production") {
    throw new Error("Tokens locales prohibidos en producción");
  }
  const keys = await loadOrCreateDevKeys(config.auth.devKeysDir);
  return createLocalVerifier(keys.publicKey);
}
