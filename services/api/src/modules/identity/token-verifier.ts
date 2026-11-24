import {
  createRemoteJWKSet,
  type CryptoKey,
  errors as joseErrors,
  type JWTPayload,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

/**
 * Verificación de tokens de acceso (ADR 0004).
 * Supabase autentica; la API solo verifica firma, emisor, audiencia y vencimiento.
 */
export interface VerifiedIdentity {
  /** `sub` del token = id del usuario en Supabase y en nuestra tabla `users`. */
  userId: string;
  email: string | null;
  phone: string | null;
}

export interface TokenVerifier {
  /** Lanza `InvalidTokenError` si el token no es válido. */
  verify(token: string): Promise<VerifiedIdentity>;
}

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidTokenError";
  }
}

export const TOKEN_AUDIENCE = "authenticated";
export const LOCAL_DEV_ISSUER = "pedilo-local-dev";

function createVerifier(getKey: JWTVerifyGetKey, issuer: string): TokenVerifier {
  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          issuer,
          audience: TOKEN_AUDIENCE,
          algorithms: ["ES256", "RS256"],
        }));
      } catch (err) {
        if (err instanceof joseErrors.JOSEError) throw new InvalidTokenError(err.code);
        throw err;
      }
      return toIdentity(payload);
    },
  };
}

function toIdentity(payload: JWTPayload): VerifiedIdentity {
  const sub = payload.sub;
  if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) throw new InvalidTokenError("ERR_INVALID_SUB");
  const email = typeof payload.email === "string" && payload.email ? payload.email : null;
  const phone = typeof payload.phone === "string" && payload.phone ? payload.phone : null;
  return { userId: sub.toLowerCase(), email, phone };
}

/** Tokens emitidos por Supabase Auth, verificados con el JWKS público del proyecto. */
export function createSupabaseVerifier(supabaseUrl: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return createVerifier(jwks, `${supabaseUrl}/auth/v1`);
}

/** Tokens firmados con la clave local de desarrollo (y en tests). Nunca en producción. */
export function createLocalVerifier(publicKey: CryptoKey): TokenVerifier {
  return createVerifier(async () => publicKey, LOCAL_DEV_ISSUER);
}
