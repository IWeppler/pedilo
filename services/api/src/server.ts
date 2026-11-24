import { buildApp } from "./app";
import { createTokenVerifier } from "./auth";
import { loadConfig } from "./config";
import { createDb } from "./db/client";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const tokenVerifier = await createTokenVerifier(config);
const app = await buildApp({ config, db, tokenVerifier });

if (config.auth.mode === "local") {
  app.log.warn("Auth en modo LOCAL: se aceptan tokens de `npm run dev:token`. Solo para desarrollo.");
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "cerrando");
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.env !== "production") app.log.info(`Documentación: http://localhost:${config.port}/docs`);
} catch (err) {
  app.log.error(err);
  await close();
  process.exit(1);
}
