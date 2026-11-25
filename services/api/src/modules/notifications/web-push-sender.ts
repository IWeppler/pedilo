import { sendNotification, setVapidDetails, WebPushError } from "web-push";

import type { PushSender } from "./service";

/** Envío real con la librería `web-push` y claves VAPID (ADR 0009). */
export function createWebPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): PushSender {
  setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(sub, payload) {
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          // Un aviso de pedido viejo no sirve: el servicio de push lo descarta pasada 1 h. Urgencia alta: despierta el teléfono.
          { TTL: 60 * 60, urgency: "high", timeout: 10_000 },
        );
        return { ok: true };
      } catch (err) {
        if (err instanceof WebPushError) {
          // 404/410: el navegador dio de baja la suscripción.
          const gone = err.statusCode === 404 || err.statusCode === 410;
          return { ok: false, gone, error: `HTTP ${err.statusCode}: ${err.body?.slice(0, 200) ?? err.message}` };
        }
        return { ok: false, gone: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
