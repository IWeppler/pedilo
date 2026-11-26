import { ApiError } from "@pedilo/api-client";
import { CLAIM_REASON_LABELS, CLAIM_RESOLUTION_LABELS, CLAIM_STATUS_LABELS, claimStateMachine, formatARS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminCall } from "@/lib/api";

import { AdminClaimActions } from "./admin-claim-actions";

const ACTOR: Record<string, string> = { CUSTOMER: "Cliente", MERCHANT: "Comercio", ADMIN: "Pedilo", SYSTEM: "Sistema" };

export default function AdminClaimPage({ params }: PageProps<"/claims/[id]">) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <AdminClaim params={params} />
    </Suspense>
  );
}

async function AdminClaim({ params }: { params: PageProps<"/claims/[id]">["params"] }) {
  const { id } = await params;
  const c = await adminCall((api) => api.GET("/v1/admin/claims/{claimId}", { params: { path: { claimId: id } } })).catch((err: unknown) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  return (
    <>
      <PageHeader
        title={`Reclamo · ${c.merchant.name} · ${c.orderCode}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="outline">{CLAIM_STATUS_LABELS[c.status]}</Badge>
            {c.sensitive && <Badge variant="destructive">Salud o seguridad</Badge>}
            <span>{CLAIM_REASON_LABELS[c.reason]} · pedido de {formatARS(c.orderTotalMinor)}</span>
          </span>
        }
        actions={
          <Link href="/claims" className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Reclamo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="whitespace-pre-wrap">{c.description}</p>
          {c.evidence.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {c.evidence.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ya viene optimizada desde la API */}
                  <img src={url} alt="Foto del reclamo" className="size-28 rounded-md object-cover" />
                </a>
              ))}
            </div>
          )}
          {c.proposal && (
            <p className="rounded-lg border p-3">
              Propuesta del comercio: <strong>{CLAIM_RESOLUTION_LABELS[c.proposal.type]}</strong>
              {c.proposal.amountMinor ? ` de ${formatARS(c.proposal.amountMinor)}` : ""}
              {c.proposal.note && ` — «${c.proposal.note}»`}
            </p>
          )}
          {c.resolutionNote && <p className="text-muted-foreground">Resolución: {c.resolutionNote}</p>}
        </CardContent>
      </Card>
      <AdminClaimActions
        claimId={c.id}
        canResolve={claimStateMachine.canTransition(c.status, "RESOLVED")}
        canClose={claimStateMachine.canTransition(c.status, "CLOSED")}
      />
      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-sm">
            {c.events.map((e, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{formatDateTime(e.createdAt)} · </span>
                <span className="font-medium">{ACTOR[e.actor]}</span> · {e.kind}
                {e.amountMinor ? ` (${formatARS(e.amountMinor)})` : ""}
                {e.body && <span className="block whitespace-pre-wrap pl-4 text-muted-foreground">«{e.body}»</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
