import type { MerchantDetail } from "@pedilo/api-client";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";

/**
 * Los pasos para enviar el comercio a revisión, marcados según lo que devuelve la API. Lo que falta
 * es información a completar (no un error): círculo gris y un enlace a dónde se carga. Se usa
 * igual en «Mi comercio» y en «Local y entregas».
 */
export function OnboardingSteps({ merchant }: { merchant: MerchantDetail }) {
  const issues = new Set(merchant.onboarding.problems.map((p) => p.issue));
  const local = `/m/${merchant.id}/local`;
  const noLocation = issues.has("NO_ACTIVE_BRANCH");
  const steps = [
    { label: "Datos del comercio", done: true, href: `/m/${merchant.id}/profile` },
    { label: "Dirección del local, recibiendo pedidos", done: !noLocation, href: `${local}#direccion` },
    { label: "Horario de atención", done: !noLocation && !issues.has("BRANCH_WITHOUT_HOURS"), href: `${local}#horario` },
    {
      label: "Retiro en el local, o envío con al menos una zona",
      done: !noLocation && !issues.has("BRANCH_WITHOUT_FULFILLMENT"),
      href: `${local}#zonas`,
    },
  ];

  return (
    <ol className="grid gap-1 text-sm">
      {steps.map((s) => {
        const content = (
          <>
            {s.done ? (
              <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={s.done ? "text-muted-foreground" : "font-medium"}>{s.label}</span>
            <span className="sr-only">{s.done ? "(completo)" : "(falta completar)"}</span>
          </>
        );
        return (
          <li key={s.label}>
            {!s.done ? (
              <Link href={s.href} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted">
                {content}
                <span className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground">
                  Completar <ChevronRight className="size-3.5" aria-hidden />
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-2 py-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
