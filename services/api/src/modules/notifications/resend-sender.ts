import type { EmailSender } from "./email";

/**
 * Envío por la API HTTP de Resend (ADR 0032). El mismo proveedor sirve de SMTP para los emails de
 * Supabase Auth (confirmación y contraseña), así todo sale del mismo dominio verificado.
 * La clave de idempotencia evita duplicados si un reintento llega después de un envío que sí salió.
 */
export function createResendSender(opts: { apiKey: string; from: string; replyTo?: string | undefined }): EmailSender {
  return {
    async send(message) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: opts.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(opts.replyTo && { reply_to: opts.replyTo }),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const json = (await res.json().catch(() => ({}))) as { id?: string };
          return { ok: true, id: json.id ?? null };
        }
        const detail = await res.text().catch(() => "");
        // 4xx (salvo 429): el pedido está mal (dirección inválida, dominio sin verificar): reintentar no sirve.
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        return { ok: false, permanent, error: `Resend HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
      } catch (err) {
        return { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
