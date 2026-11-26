"use client";

import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import { Trash2 } from "lucide-react";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Closure = { id: string; startsOn: string; endsOn: string; reason: string };

const dateFormat = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const pretty = (d: string) => dateFormat.format(new Date(`${d}T12:00:00Z`));

/** Feriados y vacaciones (ADR 0018): días completos en los que la sucursal no recibe pedidos. */
export function ClosuresEditor({
  closures,
  add,
  remove,
  disabled,
}: {
  closures: Closure[];
  add: (prev: FormState, formData: FormData) => Promise<FormState>;
  remove: (closureId: string) => Promise<FormState>;
  disabled?: boolean;
}) {
  const [state, addAction] = useActionState(add, initialFormState);
  const v = state.values;

  return (
    <div className="grid gap-4">
      {closures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay cierres cargados.</p>
      ) : (
        <ul className="grid gap-2">
          {closures.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span>
                <span className="font-medium">{c.reason}</span> ·{" "}
                {c.startsOn === c.endsOn ? pretty(c.startsOn) : `del ${pretty(c.startsOn)} al ${pretty(c.endsOn)}`}
              </span>
              {!disabled && (
                <form
                  action={async () => {
                    await remove(c.id);
                  }}
                >
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Quitar cierre: ${c.reason}`}>
                    <Trash2 aria-hidden /> Quitar
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <form key={formKey(v)} action={addAction} className="grid gap-3">
          {state.message && (
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              Desde
              <Input type="date" name="startsOn" required defaultValue={v?.startsOn ?? ""} className="w-40" />
            </label>
            <label className="grid gap-1 text-sm">
              Hasta
              <Input type="date" name="endsOn" required defaultValue={v?.endsOn ?? ""} className="w-40" />
            </label>
            <label className="grid gap-1 text-sm">
              Motivo (lo ve el cliente)
              <Input name="reason" required minLength={2} maxLength={80} placeholder="Feriado" defaultValue={v?.reason ?? ""} className="w-48" />
            </label>
            <SubmitButton pendingText="Agregando…">Agregar cierre</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
