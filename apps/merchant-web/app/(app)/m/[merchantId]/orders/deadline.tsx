"use client";

import { useMinutesLeft } from "../order-alerts";

/** «Vence en 12 min»: cuánto le queda al comercio para aceptar un pedido. */
export function Deadline({ at }: { at: string | null }) {
  const minutes = useMinutesLeft(at);
  if (minutes === null) return null;
  return (
    <span className={minutes <= 3 ? "font-semibold text-destructive" : undefined}>
      {minutes > 0 ? `Vence en ${minutes} min` : "Venciendo…"}
    </span>
  );
}
