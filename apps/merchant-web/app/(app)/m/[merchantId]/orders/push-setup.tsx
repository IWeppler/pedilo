"use client";

import { BellOff, Smartphone } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { getPushPublicKey, removePushSubscription, savePushSubscription, sendTestPush } from "../push-actions";

/**
 * Avisos con la pestaña cerrada (Web Push, ADR 0009). Cada navegador/dispositivo se activa por
 * separado. En iPhone solo funciona si el panel se agrega a la pantalla de inicio.
 */
type State = "loading" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

export function PushSetup({ merchantId }: { merchantId: string }) {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await detect();
      if (!cancelled) {
        setPublicKey(next.publicKey);
        setState(next.state);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = () =>
    start(async () => {
      setMessage(null);
      if (!publicKey) return;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
        const json = subscription.toJSON();
        const { ok } = await savePushSubscription(merchantId, {
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
        });
        if (!ok) throw new Error("save");
        setState("on");
        setMessage("Listo: vas a recibir avisos aunque cierres la pestaña.");
      } catch {
        setMessage("No pudimos activar los avisos en este navegador. Probá de nuevo.");
      }
    });

  const disable = () =>
    start(async () => {
      setMessage(null);
      const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(merchantId, subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    });

  const test = () =>
    start(async () => {
      const { ok } = await sendTestPush(merchantId);
      setMessage(ok ? "Enviamos un aviso de prueba: debería llegar en unos segundos." : "No pudimos enviar el aviso de prueba.");
    });

  if (state === "loading" || state === "unconfigured") return null;

  return (
    <div className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Smartphone className="size-4 text-muted-foreground" aria-hidden />
        {state === "on" && (
          <>
            <span className="flex-1">Avisos activados en este dispositivo, aunque la pestaña esté cerrada.</span>
            <Button type="button" size="sm" variant="outline" onClick={test} disabled={pending}>
              Probar aviso
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={disable} disabled={pending}>
              <BellOff aria-hidden /> Desactivar
            </Button>
          </>
        )}
        {state === "off" && (
          <>
            <span className="flex-1">Recibí los pedidos nuevos aunque la pestaña esté cerrada.</span>
            <Button type="button" size="sm" onClick={enable} disabled={pending}>
              {pending ? "Activando…" : "Activar en este dispositivo"}
            </Button>
          </>
        )}
        {state === "denied" && (
          <span className="flex-1 text-muted-foreground">
            Las notificaciones están bloqueadas. Habilitalas desde el candado de la barra de direcciones y recargá la página.
          </span>
        )}
        {state === "unsupported" && (
          <span className="flex-1 text-muted-foreground">
            Este navegador no recibe avisos con la pestaña cerrada. En iPhone, agregá el panel a la pantalla de inicio.
          </span>
        )}
      </div>
      {message && <p className="text-muted-foreground">{message}</p>}
    </div>
  );
}

async function detect(): Promise<{ state: State; publicKey: string | null }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { state: "unsupported", publicKey: null };
  }
  const publicKey = await getPushPublicKey().catch(() => null);
  if (!publicKey) return { state: "unconfigured", publicKey: null };
  if (Notification.permission === "denied") return { state: "denied", publicKey };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return { state: subscription && Notification.permission === "granted" ? "on" : "off", publicKey };
}

/** Clave VAPID (base64url) → bytes, como pide `pushManager.subscribe`. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
