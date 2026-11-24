import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import type { Db } from "../../db/client";
import { forbidden, unauthorized } from "../../lib/errors";
import { UserStatus } from "./schema";
import { type AuthContext, isAdmin, resolveUser } from "./service";
import { InvalidTokenError, type TokenVerifier } from "./token-verifier";

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario autenticado, o `null` si el request no trae token. */
    auth: AuthContext | null;
  }
}

interface AuthPluginOptions {
  db: Db;
  tokenVerifier: TokenVerifier;
}

/**
 * Lee `Authorization: Bearer <token>`, lo verifica y carga el usuario y sus roles.
 * Sin token: `request.auth = null` (las rutas públicas siguen funcionando).
 * Token inválido o vencido: 401 siempre, aunque la ruta sea pública.
 */
export const authPlugin = fp<AuthPluginOptions>(
  async (app, { db, tokenVerifier }) => {
    app.decorateRequest("auth", null);

    app.addHook("onRequest", async (request) => {
      const header = request.headers.authorization;
      if (!header) return;

      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match?.[1]) throw unauthorized("Formato de Authorization inválido");

      let identity;
      try {
        identity = await tokenVerifier.verify(match[1]);
      } catch (err) {
        if (err instanceof InvalidTokenError) throw unauthorized("Token inválido o vencido");
        throw err;
      }

      const auth = await resolveUser(db, identity);
      if (auth.status === UserStatus.SUSPENDED) throw forbidden("Usuario suspendido");
      request.auth = auth;
    });
  },
  { name: "auth" },
);

/** Hook `onRequest` de ruta: exige usuario autenticado. Corre antes de validar el body, así un anónimo no aprende la forma del endpoint. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.auth) throw unauthorized();
}

/** Hook `onRequest` de ruta: exige rol de plataforma ADMIN. */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.auth) throw unauthorized();
  if (!isAdmin(request.auth)) throw forbidden();
}

/** Devuelve el usuario autenticado; usar solo detrás de `requireAuth`/`requireAdmin`. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
