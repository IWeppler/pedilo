/**
 * Da o quita el rol ADMIN a un usuario existente (por id o email). Sirve en cualquier entorno,
 * por ejemplo para crear el primer admin en producción después de que inicie sesión una vez.
 *
 *   npm run admin:grant -w @pedilo/api -- --email vos@ejemplo.com
 *   npm run admin:grant -w @pedilo/api -- --id <uuid> --revoke
 */
import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { users } from "../modules/identity/schema";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    email: { type: "string" },
    revoke: { type: "boolean", default: false },
  },
});

if (!values.id && !values.email) {
  console.error("Indicá --id <uuid> o --email <email>.");
  process.exit(1);
}

const { db, close } = createDb(loadConfig().databaseUrl);
try {
  const where = values.id ? eq(users.id, values.id) : eq(users.email, values.email ?? "");
  const updated = await db
    .update(users)
    .set({ platformRole: values.revoke ? null : "ADMIN" })
    .where(where)
    .returning({ id: users.id, email: users.email, platformRole: users.platformRole });

  if (updated.length === 0) {
    console.error("No existe ese usuario. Tiene que haber iniciado sesión al menos una vez.");
    process.exitCode = 1;
  } else {
    for (const u of updated) console.log(`${u.email ?? u.id}: ${u.platformRole ?? "sin rol"}`);
  }
} finally {
  await close();
}
