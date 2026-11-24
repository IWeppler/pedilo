"use client";

import { useSyncExternalStore } from "react";

const STEP_MS = 30_000;

function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, STEP_MS);
  return () => window.clearInterval(id);
}
// Redondeado a 30 s: el snapshot es estable entre renders.
const getSnapshot = () => Math.floor(Date.now() / STEP_MS) * STEP_MS;
const getServerSnapshot = () => null;

/** "Recién" / "Hace 12 min", calculado en el navegador y actualizado cada 30 segundos. */
export function Elapsed({ since }: { since: string }) {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (now === null) return null;
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  return <>{minutes === 0 ? "Recién" : `Hace ${minutes} min`}</>;
}
