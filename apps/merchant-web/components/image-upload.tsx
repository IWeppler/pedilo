"use client";

import { type FormState, initialFormState } from "@pedilo/web-utils";
import { ImagePlus, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Subir, reemplazar o quitar una foto (ADR 0017). La API la achica y la pasa a WebP, así que se
 * puede subir directo la foto del celular. `aspect` solo cambia la vista previa.
 */
export function ImageUpload({
  label,
  hint,
  currentUrl,
  upload,
  remove,
  aspect = "square",
}: {
  label: string;
  hint?: string;
  currentUrl: string | null;
  upload: (prev: FormState, formData: FormData) => Promise<FormState>;
  remove: () => Promise<FormState>;
  aspect?: "square" | "wide";
}) {
  const [state, uploadAction, uploading] = useActionState(upload, initialFormState);
  const [removeState, removeAction, removing] = useActionState(remove, initialFormState);
  const [localError, setLocalError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const error = localError ?? state.message ?? removeState.message;

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-lg border bg-muted",
            aspect === "square" ? "size-28" : "h-28 w-72",
          )}
        >
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- ya viene optimizada (WebP) desde la API
            <img src={currentUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="grid gap-2">
          <form ref={form} action={uploadAction}>
            <label className={cn("inline-flex cursor-pointer", uploading && "pointer-events-none opacity-60")}>
              <input
                type="file"
                name="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setLocalError(null);
                  if (!file) return;
                  if (file.size > MAX_BYTES) {
                    setLocalError("La imagen supera los 8 MB.");
                    e.target.value = "";
                    return;
                  }
                  form.current?.requestSubmit();
                }}
              />
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
                <ImagePlus className="size-4" aria-hidden />
                {uploading ? "Subiendo…" : currentUrl ? "Cambiar foto" : "Subir foto"}
              </span>
            </label>
          </form>
          {currentUrl && (
            <form action={removeAction}>
              <Button type="submit" size="sm" variant="ghost" disabled={removing}>
                <Trash2 aria-hidden /> {removing ? "Quitando…" : "Quitar"}
              </Button>
            </form>
          )}
          {hint && <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
