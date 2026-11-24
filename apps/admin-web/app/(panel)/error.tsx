"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>No se pudo cargar esta sección</AlertTitle>
      <AlertDescription className="grid gap-3">
        <p>Puede que la API no esté disponible. {error.digest && <code className="text-xs">({error.digest})</code>}</p>
        <div>
          <Button variant="outline" size="sm" onClick={reset}>
            Reintentar
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
