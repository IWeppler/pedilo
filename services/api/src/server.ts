import { buildApp } from "./app";
import { createTokenVerifier } from "./auth";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { startIntervalWorker } from "./lib/interval-worker";
import { processEmailOutbox } from "./modules/notifications/email";
import { processOutbox } from "./modules/notifications/service";
import { createResendSender } from "./modules/notifications/resend-sender";
import { createExpoPushSender } from "./modules/notifications/expo-push-sender";
import { createWebPushSender } from "./modules/notifications/web-push-sender";
import { closeSettlementWeek } from "./modules/billing/settlements";
import { escalateOverdueClaims } from "./modules/claims/service";
import { expireOffers, purgeStaleCourierLocations } from "./modules/deliveries/service";
import { expireOverdueOrders, expireUnpaidOrders } from "./modules/orders/service";
import { createMercadoPagoGateway } from "./modules/payments/gateway";
import { type PaymentsContext, processRefunds } from "./modules/payments/service";
import { createSecretBox } from "./lib/secret-box";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl, config.dbPoolMax);
const tokenVerifier = await createTokenVerifier(config);
const mp = config.mercadoPago;
const paymentsCtx: PaymentsContext | null = mp
  ? {
      gateway: createMercadoPagoGateway({ appId: mp.appId, clientSecret: mp.clientSecret, redirectUri: mp.redirectUri, testMode: mp.testMode }),
      box: createSecretBox(mp.encryptionKey),
      publicKey: mp.publicKey,
      notificationUrl: mp.notificationUrl,
      acceptTimeoutMs: config.orders.acceptTimeoutMs,
    }
  : null;
const app = await buildApp({
  config,
  db,
  tokenVerifier,
  payments: paymentsCtx && mp ? { ctx: paymentsCtx, webhookSecret: mp.webhookSecret, panelUrl: mp.panelUrl } : null,
});
if (!mp) app.log.warn("Mercado Pago sin configurar (MP_CLIENT_ID/MP_CLIENT_SECRET/MP_PUBLIC_KEY/MP_TOKEN_ENCRYPTION_KEY): sin pago con tarjeta.");
else app.log.info({ testMode: mp.testMode, webhook: mp.notificationUrl !== null }, "Mercado Pago habilitado");

if (config.auth.mode === "local") {
  app.log.warn("Auth en modo LOCAL: se aceptan tokens de `npm run dev:token`. Solo para desarrollo.");
}

// Workers dentro del proceso (ADR 0008/0009): el estado vive en la base, así que son durables.
const pushSender = config.push.vapid ? createWebPushSender(config.push.vapid) : null;
if (!pushSender) app.log.warn("Web Push sin configurar (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY): los avisos push se omiten.");
const expoPushSender = config.expoPush.enabled ? createExpoPushSender({ accessToken: config.expoPush.accessToken }) : null;
const emailSender = config.email.resend ? createResendSender(config.email.resend) : null;
if (!emailSender) app.log.warn("Email sin configurar (RESEND_API_KEY/EMAIL_FROM): los emails al cliente se omiten.");
const workers = [
  startIntervalWorker({ name: "order-expiry", intervalMs: config.orders.expirySweepMs, log: app.log, run: () => expireOverdueOrders(db) }),
  startIntervalWorker({
    name: "push-outbox",
    intervalMs: config.push.outboxSweepMs,
    log: app.log,
    run: () => processOutbox(db, pushSender, new Date(), 20, expoPushSender),
  }),
  startIntervalWorker({
    name: "email-outbox",
    intervalMs: config.push.outboxSweepMs,
    log: app.log,
    run: () => processEmailOutbox(db, emailSender, { appUrl: config.email.customerAppUrl }),
  }),
  startIntervalWorker({ name: "unpaid-expiry", intervalMs: 60_000, log: app.log, run: () => expireUnpaidOrders(db) }),
  ...(paymentsCtx
    ? [startIntervalWorker({ name: "refunds", intervalMs: 30_000, log: app.log, run: () => processRefunds(db, paymentsCtx) })]
    : []),
  startIntervalWorker({ name: "offer-expiry", intervalMs: config.orders.expirySweepMs, log: app.log, run: () => expireOffers(db) }),
  // Ubicaciones de repartidores que dejaron de mandar (ADR 0022: retención limitada).
  startIntervalWorker({ name: "courier-locations", intervalMs: 5 * 60 * 1000, log: app.log, run: () => purgeStaleCourierLocations(db) }),
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
