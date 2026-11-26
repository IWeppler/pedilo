import { CLAIM_REASON_LABELS, CLAIM_STATUS_LABELS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = PageProps<"/m/[merchantId]/claims">;

export default function ClaimsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Claims params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Reclamos de clientes (ADR 0019). Tenés 24 h para proponer una solución; después interviene Pedilo. */
async function Claims({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const scope = query.scope === "all" ? "all" : "open";
  const list = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/claims", { params: { path: { merchantId }, query: { scope } } }),
    { notFoundOn404: true },
  );

  return (
    <>
      <PageHeader
        title="Reclamos"
        description="Proponé una solución dentro de las 24 h: si no, el reclamo pasa a Pedilo."
        actions={
          <Link href={`/m/${merchantId}`} className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />
      <nav className="inline-flex w-fit rounded-lg bg-muted p-1" aria-label="Reclamos">
        {(
          [
            ["open", "Abiertos"],
            ["all", "Todos"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/m/${merchantId}/claims?scope=${value}`}
            aria-current={scope === value ? "page" : undefined}
            className={cn("rounded-md px-3 py-1 text-sm font-medium", scope === value ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm text-muted-foreground">{scope === "open" ? "No hay reclamos abiertos." : "Todavía no hubo reclamos."}</p>}
      <div className="grid gap-3">
        {list.map((c) => (
          <Link key={c.id} href={`/m/${merchantId}/claims/${c.id}`}>
            <Card className="hover:bg-muted/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    <span className="font-mono">{c.orderCode}</span> · {CLAIM_REASON_LABELS[c.reason]}
                  </span>
                  <span className="text-muted-foreground line-clamp-1">{c.description}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.sensitive && <Badge variant="destructive">Salud o seguridad</Badge>}
                  <Badge variant={c.status === "OPEN" ? "default" : "outline"}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                  {c.status === "OPEN" && <span className="text-xs text-muted-foreground">Respondé antes de {formatDateTime(c.merchantDueAt)}</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
