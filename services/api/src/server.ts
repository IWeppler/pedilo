import { buildApp } from "./app";
import { createTokenVerifier } from "./auth";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { startIntervalWorker } from "./lib/interval-worker";
import { processOutbox } from "./modules/notifications/service";
import { createExpoPushSender } from "./modules/notifications/expo-push-sender";
import { createWebPushSender } from "./modules/notifications/web-push-sender";
import { closeSettlementWeek } from "./modules/billing/settlements";
import { escalateOverdueClaims } from "./modules/claims/service";
import { expireOffers } from "./modules/deliveries/service";
import { expireOverdueOrders } from "./modules/orders/service";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const tokenVerifier = await createTokenVerifier(config);
const app = await buildApp({ config, db, tokenVerifier });

if (config.auth.mode === "local") {
  app.log.warn("Auth en modo LOCAL: se aceptan tokens de `npm run dev:token`. Solo para desarrollo.");
}

// Workers dentro del proceso (ADR 0008/0009): el estado vive en la base, así que son durables.
const pushSender = config.push.vapid ? createWebPushSender(config.push.vapid) : null;
if (!pushSender) app.log.warn("Web Push sin configurar (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY): los avisos push se omiten.");
const customerPushSender = config.expoPush.enabled ? createExpoPushSender({ accessToken: config.expoPush.accessToken }) : null;
const workers = [
  startIntervalWorker({ name: "order-expiry", intervalMs: config.orders.expirySweepMs, log: app.log, run: () => expireOverdueOrders(db) }),
  startIntervalWorker({
    name: "push-outbox",
    intervalMs: config.push.outboxSweepMs,
    log: app.log,
    run: () => processOutbox(db, pushSender, new Date(), 20, customerPushSender),
  }),
  startIntervalWorker({ name: "offer-expiry", intervalMs: config.orders.expirySweepMs, log: app.log, run: () => expireOffers(db) }),
  // Reclamos sin respuesta del comercio a tiempo → Pedilo (ADR 0019).
  startIntervalWorker({ name: "claim-escalation", intervalMs: 5 * 60 * 1000, log: app.log, run: () => escalateOverdueClaims(db) }),
  // Liquidación semanal (ADR 0013): idempotente, así que alcanza con intentarlo cada tanto.
  startIntervalWorker({
    name: "settlement-close",
    intervalMs: config.settlement.sweepMs,
    log: app.log,
    run: () => closeSettlementWeek(db, { config: config.settlement }),
  }),
];

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "cerrando");
  await Promise.all(workers.map((w) => w.stop()));
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
