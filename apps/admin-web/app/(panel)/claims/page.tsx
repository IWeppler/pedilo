import type { ClaimStatus } from "@pedilo/domain";
import { CLAIM_REASON_LABELS, CLAIM_STATUS_LABELS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { adminCall } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS: Array<ClaimStatus | "ALL"> = ["ESCALATED", "OPEN", "DISPUTED", "AGREED_REFUND", "RESOLVED", "ALL"];

export default function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  return (
    <>
      <PageHeader title="Reclamos" description="Pedilo interviene en los escalados: sin respuesta del comercio, en desacuerdo o de salud y seguridad." />
      <Suspense fallback={<TableSkeleton />}>
        <ClaimsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ClaimsSection({ searchParams }: { searchParams: PageProps<"/claims">["searchParams"] }) {
  const raw = (await searchParams).status;
  const status = TABS.includes(raw as ClaimStatus) ? (raw as ClaimStatus | "ALL") : "ESCALATED";
  const list = await adminCall((api) => api.GET("/v1/admin/claims", { params: { query: status === "ALL" ? {} : { status } } }));
  return (
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit" aria-label="Estado">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/claims?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn("rounded-md px-3 py-1 text-sm font-medium", tab === status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {tab === "ALL" ? "Todos" : CLAIM_STATUS_LABELS[tab]}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm text-muted-foreground">No hay reclamos en este estado.</p>}
      {list.map((c) => (
        <Link key={c.id} href={`/claims/${c.id}`}>
          <Card className="hover:bg-muted/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {c.merchant.name} · <span className="font-mono">{c.orderCode}</span> · {CLAIM_REASON_LABELS[c.reason]}
                </span>
                <span className="line-clamp-1 text-muted-foreground">{c.description}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {c.sensitive && <Badge variant="destructive">Salud o seguridad</Badge>}
                <Badge variant="outline">{CLAIM_STATUS_LABELS[c.status]}</Badge>
                <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
