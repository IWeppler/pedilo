"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Refresca el tablero cada `intervalMs` mientras la pestaña está visible (polling de respaldo,
 * SPEC §10) y muestra la cantidad de pedidos nuevos en el título de la pestaña.
 * Realtime, sonido y push llegan después.
 */
export function AutoRefresh({ intervalMs, newCount }: { intervalMs: number; newCount: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, router]);

  useEffect(() => {
    const base = "Pedidos — Pedilo";
    document.title = newCount > 0 ? `(${newCount}) ${base}` : base;
  }, [newCount]);

  return null;
}
