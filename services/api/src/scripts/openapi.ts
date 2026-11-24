/**
 * Escribe services/api/openapi.json a partir de los esquemas de las rutas (ADR 0002 y 0005).
 * No necesita base de datos: solo construye la app y pide el documento.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildApp } from "../app";
import type { Db } from "../db/client";

const app = await buildApp({
  config: { env: "development", logLevel: "silent", corsOrigins: [], orderTokenSecret: "openapi-only-secret" },
  db: {} as Db,
  tokenVerifier: {
    verify: () => Promise.reject(new Error("no usado")),
  },
});
await app.ready();

const out = fileURLToPath(new URL("../../openapi.json", import.meta.url));
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`OpenAPI escrito en ${out}`);
