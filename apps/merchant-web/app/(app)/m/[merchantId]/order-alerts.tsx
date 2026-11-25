"use client";

import { BellRing, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { acknowledgeOrders } from "./orders/actions";

/**
 * Avisos de pedidos nuevos (SPEC §10), en todas las páginas del comercio:
 * - Pulso cada 5 s (también al volver a la pestaña). Si cambió algún pedido, recarga los datos.
 * - Mientras haya pedidos sin ver: banner, título que parpadea, sonido repetido (si el comercio
 *   lo activó) y una notificación del sistema por pedido (si dio permiso).
 * - «Visto» (o aceptar/rechazar) apaga la alarma para esos pedidos.
 *
 * Límite conocido: con la pestaña en segundo plano el navegador puede espaciar el pulso hasta
 * 1 por minuto. El push con la pestaña cerrada llega después (ADR 0008).
 */

interface Pulse {
  version: string;
  activeCount: number;
  waiting: Array<{ id: string; code: string; createdAt: string; acceptDeadlineAt: string | null; acknowledged: boolean }>;
}

const PULSE_MS = 5_000;
const BEEP_EVERY_MS = 4_000;
const SOUND_KEY = "pedilo.alerts.sound";
const BASE_TITLE = "Pedilo Comercios";

export function OrderAlerts() {
  const { merchantId } = useParams<{ merchantId: string }>();
  const router = useRouter();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const soundOn = useSyncExternalStore(subscribePrefs, () => localStorage.getItem(SOUND_KEY) === "on", () => false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const notifications = useSyncExternalStore(subscribePrefs, notificationPermission, () => "unsupported" as const);
  const [acking, startAck] = useTransition();
  const lastVersion = useRef<string | null>(null);
  const notified = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);

  const unseen = pulse?.waiting.filter((w) => !w.acknowledged) ?? [];
  const unseenKey = unseen.map((w) => w.id).join(",");

  // Pulso.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const check = async () => {
      window.clearTimeout(timer);
      try {
        const res = await fetch(`/api/m/${merchantId}/orders/pulse`, { cache: "no-store" });
        if (res.status === 401 || res.redirected) return; // sesión vencida: la próxima navegación lleva al login
        if (res.ok) {
          const next = (await res.json()) as Pulse;
          if (stopped) return;
          if (lastVersion.current !== null && lastVersion.current !== next.version) router.refresh();
          lastVersion.current = next.version;
          setPulse(next);
        }
      } catch {
        // Sin conexión: se reintenta en el próximo ciclo.
      }
      if (!stopped) timer = window.setTimeout(check, PULSE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [merchantId, router]);

  // Sonido: el navegador solo permite audio después de un toque del usuario.
  const ensureAudio = useCallback(() => {
    audio.current ??= new AudioContext();
    if (audio.current.state === "suspended") void audio.current.resume();
    setAudioBlocked(audio.current.state !== "running");
  }, []);

  useEffect(() => {
    if (!soundOn) return;
    const unlock = () => ensureAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundOn, ensureAudio]);

  // Alarma mientras haya pedidos sin ver.
  useEffect(() => {
    if (!unseenKey) {
      document.title = pulse && pulse.activeCount > 0 ? `(${pulse.activeCount}) ${BASE_TITLE}` : BASE_TITLE;
      return;
    }
    const count = unseenKey.split(",").length;
    let flip = false;
    const titleTimer = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? `🔔 ${count === 1 ? "Pedido nuevo" : `${count} pedidos nuevos`}` : BASE_TITLE;
    }, 1_000);

    let beepTimer: number | undefined;
    if (soundOn) {
      const ring = () => {
        const ctx = audio.current;
        if (ctx?.state === "running") beep(ctx);
        else setAudioBlocked(true);
      };
      ring();
      beepTimer = window.setInterval(ring, BEEP_EVERY_MS);
    }
    return () => {
      window.clearInterval(titleTimer);
      window.clearInterval(beepTimer);
      document.title = BASE_TITLE;
    };
  }, [unseenKey, soundOn, pulse]);

  // Una notificación del sistema por pedido nuevo.
  useEffect(() => {
    if (notifications !== "granted") return;
    for (const w of unseen) {
      if (notified.current.has(w.id)) continue;
      notified.current.add(w.id);
      const n = new Notification("Pedido nuevo en Pedilo", {
        body: `${w.code}: aceptalo o rechazalo desde el panel.`,
        tag: `order-${w.id}`,
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        router.push(`/m/${merchantId}/orders`);
        n.close();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se dispara por la lista de ids, no por cada pulso
  }, [unseenKey, notifications]);

  const enableSound = () => {
    setPref(SOUND_KEY, "on");
    ensureAudio();
    if (audio.current) beep(audio.current); // prueba: que el comercio escuche cómo suena
  };
  const disableSound = () => {
    setPref(SOUND_KEY, "off");
  };
  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    await Notification.requestPermission();
    window.dispatchEvent(new Event(PREFS_EVENT));
  };
  const acknowledge = () => {
    const ids = unseen.map((w) => w.id);
    startAck(async () => {
      const { ok } = await acknowledgeOrders(merchantId, ids);
      if (ok) {
        setPulse((p) => (p ? { ...p, waiting: p.waiting.map((w) => (ids.includes(w.id) ? { ...w, acknowledged: true } : w)) } : p));
        router.refresh();
      }
    });
  };

  const needsSetup = !soundOn || notifications === "default";

  return (
    <div className="grid gap-2">
      {unseen.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-primary px-4 py-3 text-primary-foreground shadow-md">
          <BellRing className="size-5 shrink-0 animate-pulse" aria-hidden />
          <div className="grid flex-1 gap-0.5">
            <p className="font-semibold">
              {unseen.length === 1 ? "Tenés un pedido nuevo" : `Tenés ${unseen.length} pedidos nuevos`}:{" "}
              <span className="font-mono">{unseen.map((w) => w.code).join(", ")}</span>
            </p>
            <DeadlineHint deadline={unseen[0]!.acceptDeadlineAt} />
          </div>
          <div className="flex gap-2">
            <Link
              href={`/m/${merchantId}/orders`}
              className="rounded-md bg-primary-foreground px-3 py-1.5 text-sm font-semibold text-primary"
            >
              Ver pedidos
            </Link>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"
              onClick={acknowledge}
              disabled={acking}
            >
              {acking ? "…" : "Visto"}
            </Button>
          </div>
        </div>
      )}

      {soundOn && audioBlocked && unseen.length > 0 && (
        <p className="text-sm font-medium text-destructive">Tocá cualquier parte de la página para que suene la alarma.</p>
      )}

      {needsSetup && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
          <span className="text-muted-foreground">Para no perder pedidos:</span>
          {!soundOn && (
            <Button type="button" size="sm" variant="outline" onClick={enableSound}>
              <Volume2 aria-hidden /> Activar sonido
            </Button>
          )}
          {notifications === "default" && (
            <Button type="button" size="sm" variant="outline" onClick={() => void enableNotifications()}>
              <BellRing aria-hidden /> Activar notificaciones
            </Button>
          )}
        </div>
      )}
      {soundOn && (
        <button
          type="button"
          onClick={disableSound}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <VolumeX className="size-3.5" aria-hidden /> Silenciar alarma
        </button>
      )}
      {notifications === "denied" && (
        <p className="text-xs text-muted-foreground">
          Las notificaciones están bloqueadas para este sitio. Podés habilitarlas desde el candado de la barra de direcciones.
        </p>
      )}
    </div>
  );
}

function DeadlineHint({ deadline }: { deadline: string | null }) {
  const minutes = useMinutesLeft(deadline);
  if (minutes === null) return null;
  return (
    <p className="text-sm opacity-90">
      {minutes > 0 ? `El más antiguo vence en ${minutes} min si no lo aceptás.` : "El más antiguo está por vencer."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Preferencias del navegador (sonido, permiso de notificaciones) y reloj
// ---------------------------------------------------------------------------

const PREFS_EVENT = "pedilo:alert-prefs";

function subscribePrefs(onChange: () => void) {
  window.addEventListener(PREFS_EVENT, onChange);
  window.addEventListener("storage", onChange); // otra pestaña cambió el sonido
  window.addEventListener("focus", onChange); // permiso cambiado desde la barra del navegador
  return () => {
    window.removeEventListener(PREFS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("focus", onChange);
  };
}

function setPref(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(PREFS_EVENT));
}

const notificationPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";

const CLOCK_MS = 15_000;
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, CLOCK_MS);
  return () => window.clearInterval(id);
}
// Redondeado a 15 s: el snapshot es estable entre renders.
const clockSnapshot = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS;

/** Minutos que faltan hasta `deadline`, actualizado cada 15 s (null sin plazo o en el servidor). */
export function useMinutesLeft(deadline: string | null): number | null {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null);
  if (!deadline || now === null) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 60_000));
}

/** Dos tonos cortos (sin archivo de audio). */
function beep(ctx: AudioContext) {
  const start = ctx.currentTime;
  for (const [i, freq] of [880, 660, 880].entries()) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }
}
