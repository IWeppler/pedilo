import { ApiError } from "@pedilo/api-client";
import { formatARS, formatCuit } from "@pedilo/domain";
import { formatDateTime, ONBOARDING_ISSUE_LABELS, scheduleByDay } from "@pedilo/web-utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { MerchantStatusBadge } from "@/components/merchant-status-badge";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminCall } from "@/lib/api";
import { commissionLabel } from "@/lib/categories";

import { ReviewActions } from "./review-actions";

export default function MerchantReviewPage({ params }: PageProps<"/merchants/[id]">) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <MerchantReview params={params} />
    </Suspense>
  );
}

async function MerchantReview({ params }: { params: PageProps<"/merchants/[id]">["params"] }) {
  const { id } = await params;
  const merchant = await adminCall((api) => api.GET("/v1/admin/merchants/{id}", { params: { path: { id } } })).catch(
    (err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    },
  );
  const [rubros, cities] = await Promise.all([
    adminCall((api) => api.GET("/v1/admin/categories", { params: { query: { kind: "MERCHANT" } } })),
    adminCall((api) => api.GET("/v1/admin/cities")),
  ]);
  const rubro = rubros.find((r) => r.id === merchant.categoryId);
  const cityName = new Map(cities.map((c) => [c.id, `${c.name}, ${c.province}`]));
  const branchName = new Map(merchant.branches.map((b) => [b.id, b.name]));

  return (
    <>
      <PageHeader
        title={merchant.displayName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <MerchantStatusBadge status={merchant.status} />
            {merchant.submittedAt && <span>Enviado {formatDateTime(merchant.submittedAt)}</span>}
            {merchant.reviewedAt && <span>· Revisado {formatDateTime(merchant.reviewedAt)}</span>}
          </span>
        }
        actions={
          <Link href={`/merchants?status=${merchant.status}`} className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />

      {merchant.status === "REJECTED" && merchant.rejectionReason && (
        <Alert variant="destructive">
          <AlertTitle>Motivo del rechazo</AlertTitle>
          <AlertDescription>{merchant.rejectionReason}</AlertDescription>
        </Alert>
      )}

      {merchant.onboarding.problems.length > 0 && (
        <Alert>
          <AlertTitle>Checklist incompleto</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {merchant.onboarding.problems.map((p, i) => (
                <li key={i}>
                  {p.branchId ? `${branchName.get(p.branchId) ?? "Sucursal"}: ` : ""}
                  {ONBOARDING_ISSUE_LABELS[p.issue]}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos del comercio</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Razón social">{merchant.legalName}</Item>
            <Item label="CUIT">
              <span className="font-mono">{formatCuit(merchant.taxId)}</span>
            </Item>
            <Item label="Rubro">
              {rubro ? rubro.name : "—"}
              {rubro?.commissionCategory && (
                <span className="block text-xs text-muted-foreground">{commissionLabel(rubro.commissionCategory)}</span>
              )}
            </Item>
            <Item label="Dueño">{merchant.owner?.email ?? merchant.owner?.id ?? "—"}</Item>
            <Item label="Teléfono de contacto">{merchant.contactPhone}</Item>
            <Item label="Email de contacto">{merchant.contactEmail ?? "—"}</Item>
          </dl>
        </CardContent>
      </Card>

      {merchant.branches.map((branch) => (
        <Card key={branch.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Sucursal {branch.name}
              {!branch.active && <span className="text-xs font-normal text-muted-foreground">(inactiva)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <dl className="grid content-start gap-3 text-sm">
              <Item label="Dirección">
                {branch.addressLine}
                {branch.addressNotes && <span className="block text-xs text-muted-foreground">{branch.addressNotes}</span>}
              </Item>
              <Item label="Ciudad">{cityName.get(branch.cityId) ?? "—"}</Item>
              <Item label="Entregas">
                {[branch.acceptsPickup && "Retiro en el local", branch.acceptsDelivery && "Envío a domicilio"]
                  .filter(Boolean)
                  .join(" · ") || "Ninguna"}
              </Item>
              {branch.acceptsDelivery && (
                <Item label="Zonas de envío">
                  {branch.zones.length === 0 ? (
                    "Sin zonas"
                  ) : (
                    <ul className="grid gap-1">
                      {branch.zones.map((z) => (
                        <li key={z.id} className={z.active ? "" : "text-muted-foreground line-through"}>
                          {z.name}: envío {formatARS(z.feeMinor)}, mínimo {formatARS(z.minOrderMinor)}
                          {z.description && <span className="block text-xs text-muted-foreground">{z.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Item>
              )}
            </dl>
            <div className="grid content-start gap-1 text-sm">
              <span className="text-muted-foreground">Horario</span>
              <table className="w-full">
                <tbody>
                  {scheduleByDay(branch.hours).map((d) => (
                    <tr key={d.weekday}>
                      <td className="py-0.5 pr-3">{d.label}</td>
                      <td className={d.closed ? "text-muted-foreground" : "tabular-nums"}>{d.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {merchant.status === "PENDING_REVIEW" && (
        <ReviewActions merchantId={merchant.id} ready={merchant.onboarding.ready} />
      )}
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
