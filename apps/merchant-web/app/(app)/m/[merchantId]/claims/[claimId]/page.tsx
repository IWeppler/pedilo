import { CLAIM_REASON_LABELS, CLAIM_RESOLUTION_LABELS, CLAIM_STATUS_LABELS, formatARS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

import { ClaimActions } from "./claim-actions";

type Props = PageProps<"/m/[merchantId]/claims/[claimId]">;

const ACTOR: Record<string, string> = { CUSTOMER: "Cliente", MERCHANT: "Vos", ADMIN: "Pedilo", SYSTEM: "Pedilo" };
const KIND: Record<string, string> = {
  OPENED: "abrió el reclamo",
  EVIDENCE: "agregó una foto",
  PROPOSAL: "propuso una solución",
  ACCEPTED: "aceptó la propuesta",
  REJECTED: "no aceptó la propuesta",
  ESCALATED: "lo pasó a Pedilo",
  REFUNDED: "registró la devolución",
  RESOLVED: "lo resolvió",
  CLOSED: "lo cerró",
};

export default function ClaimPage({ params }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <ClaimDetail params={params} />
    </Suspense>
  );
}

async function ClaimDetail({ params }: { params: Props["params"] }) {
  const { merchantId, claimId } = await params;
  const c = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/claims/{claimId}", { params: { path: { merchantId, claimId } } }),
    { notFoundOn404: true },
  );

  return (
    <>
      <PageHeader
        title={`Reclamo del pedido ${c.orderCode}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="outline">{CLAIM_STATUS_LABELS[c.status]}</Badge>
            {c.sensitive && <Badge variant="destructive">Salud o seguridad: lo gestiona Pedilo</Badge>}
            <span>{CLAIM_REASON_LABELS[c.reason]}</span>
          </span>
        }
        actions={
          <Link href={`/m/${merchantId}/claims`} className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Lo que dice el cliente</CardTitle>
          <CardDescription>
            Pedido de {formatARS(c.orderTotalMinor)} · abierto {formatDateTime(c.createdAt)}
            {c.status === "OPEN" && ` · respondé antes de ${formatDateTime(c.merchantDueAt)}`}
          </CardDescription>
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
              Tu propuesta: <strong>{CLAIM_RESOLUTION_LABELS[c.proposal.type]}</strong>
              {c.proposal.amountMinor ? ` de ${formatARS(c.proposal.amountMinor)}` : ""}
              {c.proposal.note && ` — «${c.proposal.note}»`}
            </p>
          )}
          {c.resolutionNote && c.status === "RESOLVED" && <p className="text-muted-foreground">Resolución: {c.resolutionNote}</p>}
        </CardContent>
      </Card>

      <ClaimActions merchantId={merchantId} claim={c} />

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-sm">
            {c.events.map((e, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{formatDateTime(e.createdAt)} · </span>
                <span className="font-medium">{ACTOR[e.actor]}</span> {e.kind === "MESSAGE" ? "escribió" : (KIND[e.kind] ?? e.kind)}
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
