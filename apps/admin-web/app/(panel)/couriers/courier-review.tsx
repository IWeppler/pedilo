"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { reviewCourier } from "./actions";

type Decision = "APPROVED" | "REJECTED" | "SUSPENDED";

/** Aprobar directo; rechazar o suspender piden motivo (lo ve el repartidor). */
export function CourierReview({ courierId, status }: { courierId: string; status: string }) {
  const [withReason, setWithReason] = useState<Decision | null>(null);
  const [state, action, pending] = useActionState(reviewCourier.bind(null, courierId), initialFormState);

  const options: Decision[] =
    status === "PENDING_REVIEW" ? ["APPROVED", "REJECTED"] : status === "APPROVED" ? ["SUSPENDED"] : ["APPROVED"];
  const label: Record<Decision, string> = { APPROVED: status === "PENDING_REVIEW" ? "Aprobar" : "Habilitar", REJECTED: "Rechazar", SUSPENDED: "Suspender" };

  return (
    <form action={action} className="grid content-start gap-2">
      {withReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={withReason} />
          <Input name="reason" required minLength={3} maxLength={300} placeholder="Motivo" className="w-56" aria-label="Motivo" autoFocus />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            {pending ? "…" : label[withReason]}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setWithReason(null)}>
            Volver
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) =>
            o === "APPROVED" ? (
              <Button key={o} type="submit" name="status" value={o} size="sm" disabled={pending}>
                {label[o]}
              </Button>
            ) : (
              <Button key={o} type="button" size="sm" variant="outline" onClick={() => setWithReason(o)}>
                {label[o]}…
              </Button>
            ),
          )}
        </div>
      )}
      {state.message && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
