/**
 * Genera un token de desarrollo firmado con la clave local (ADR 0004).
 *
 *   npm run dev:token -w @pedilo/api                      → usuario "dev"
 *   npm run dev:token -w @pedilo/api -- --name ana        → otro usuario estable
 *   npm run dev:token -w @pedilo/api -- --admin           → además lo hace ADMIN en la base
 *
 * El mismo --name genera siempre el mismo id, así el usuario se mantiene entre tokens.
 */
import { parseArgs } from "node:util";

import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { users } from "../modules/identity/schema";
import { loadOrCreateDevKeys, signDevToken } from "../modules/identity/dev-keys";
import { devUserEmail, devUserId } from "./dev-users";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "dev" },
    admin: { type: "boolean", default: false },
  },
});

const config = loadConfig();
if (config.env === "production" || config.auth.mode !== "local") {
  console.error("dev:token solo funciona en desarrollo y sin SUPABASE_URL configurada.");
  process.exit(1);
}

const name = values.name ?? "dev";
const userId = devUserId(name);
const email = devUserEmail(name);

const keys = await loadOrCreateDevKeys(config.auth.devKeysDir);
const token = await signDevToken(keys.privateKey, { sub: userId, email });

if (values.admin) {
  const { db, close } = createDb(config.databaseUrl);
  try {
    await db
      .insert(users)
      .values({ id: userId, email, platformRole: "ADMIN" })
      .onConflictDoUpdate({ target: users.id, set: { platformRole: "ADMIN" } });
  } finally {
    await close();
  }
}

console.error(`Usuario: ${name} (${userId})${values.admin ? " — ADMIN" : ""}. Válido 12 h.\n`);
console.log(token);

