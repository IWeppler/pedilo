import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CryptoKey, exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

import { LOCAL_DEV_ISSUER, TOKEN_AUDIENCE } from "./token-verifier";

/**
 * Claves locales para firmar tokens de desarrollo y de tests (ADR 0004).
 * Imitan los tokens de Supabase (mismo `aud`, `sub` UUID) pero con otro emisor,
 * así nunca se confunden con tokens reales.
 */
export interface DevKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

const ALG = "ES256";

export async function generateDevKeyPair(): Promise<DevKeyPair> {
  return generateKeyPair(ALG, { extractable: true });
}

export async function loadOrCreateDevKeys(dir: string): Promise<DevKeyPair> {
  const file = path.resolve(dir, "dev-signing-key.json");
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as { privateJwk: JWK; publicJwk: JWK };
    return {
      privateKey: (await importJWK(stored.privateJwk, ALG)) as CryptoKey,
      publicKey: (await importJWK(stored.publicJwk, ALG)) as CryptoKey,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const pair = await generateDevKeyPair();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      { privateJwk: await exportJWK(pair.privateKey), publicJwk: await exportJWK(pair.publicKey) },
      null,
      2,
    ),
  );
  return pair;
}

export interface DevTokenClaims {
  sub: string;
  email?: string;
  phone?: string;
}

export async function signDevToken(
  privateKey: CryptoKey,
  claims: DevTokenClaims,
  expiresIn = "12h",
): Promise<string> {
  const payload: Record<string, string> = {};
  if (claims.email) payload.email = claims.email;
  if (claims.phone) payload.phone = claims.phone;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuer(LOCAL_DEV_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}
