"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { closeWeek } from "./actions";

export function CloseWeekButton() {
  const [state, action, pending] = useActionState(closeWeek, initialFormState);
  return (
    <form action={action} className="flex items-center gap-2">
      {state.message && <span className="text-sm text-muted-foreground">{state.message}</span>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Cerrando…" : "Cerrar semana ahora"}
      </Button>
    </form>
  );
}
