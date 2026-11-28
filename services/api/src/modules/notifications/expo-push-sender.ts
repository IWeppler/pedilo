import type { ExpoPushSender } from "./service";

/**
 * Envío por el servicio de push de Expo (ADR 0020): no necesita credenciales para empezar
 * (`EXPO_ACCESS_TOKEN` es opcional, para proteger el envío). Para que llegue a Android, la app
 * tiene que ser un build propio con FCM configurado en EAS; Expo Go no recibe push desde el SDK 53.
 */
export function createExpoPushSender(opts: { accessToken?: string | undefined } = {}): ExpoPushSender {
  return {
    async send(expoToken, payload) {
      // Un aviso con vencimiento (una oferta) no tiene que llegar tarde: el servicio lo descarta.
      const ttl = payload.expiresAt
        ? Math.max(1, Math.floor((new Date(payload.expiresAt).getTime() - Date.now()) / 1000))
        : 60 * 60;
      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(opts.accessToken && { authorization: `Bearer ${opts.accessToken}` }),
          },
          body: JSON.stringify({
            to: expoToken,
            title: payload.title,
            body: payload.body,
            data: { url: payload.url, tag: payload.tag },
            sound: "default",
            priority: "high",
            ttl,
            ...(payload.channelId && { channelId: payload.channelId }),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return { ok: false, gone: false, error: `HTTP ${res.status}` };
        const json = (await res.json()) as { data?: { status: "ok" | "error"; message?: string; details?: { error?: string } } };
        if (json.data?.status === "ok") return { ok: true };
        // El celular desinstaló la app o revocó el permiso: el token no sirve más.
        const gone = json.data?.details?.error === "DeviceNotRegistered";
        return { ok: false, gone, error: json.data?.message ?? "Expo Push rechazó el aviso" };
      } catch (err) {
        return { ok: false, gone: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
