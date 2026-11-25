import { formatARS } from "@pedilo/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BranchForm } from "@/components/branch-form";
import { HoursEditor } from "@/components/hours-editor";
import { PageHeader } from "@/components/page-header";
import { SchedulingForm } from "@/components/scheduling-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyMerchant, getReferenceData, operationsLocked } from "@/lib/api";

import { saveHours, saveScheduling, updateBranch } from "../../actions";

type Props = PageProps<"/m/[merchantId]/branches/[branchId]">;

export default function BranchPage({ params }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <BranchDetail params={params} />
    </Suspense>
  );
}

async function BranchDetail({ params }: { params: Props["params"] }) {
  const { merchantId, branchId } = await params;
  const [merchant, { cities }] = await Promise.all([getMyMerchant(merchantId), getReferenceData()]);
  const branch = merchant.branches.find((b) => b.id === branchId);
  if (!branch) notFound();

  const locked = operationsLocked(merchant.status);
  const base = `/m/${merchant.id}/branches/${branch.id}`;

  return (
    <>
      <PageHeader
        title={`Sucursal ${branch.name}`}
        description={merchant.displayName}
        actions={
          <Link href={`/m/${merchant.id}`} className={buttonVariants({ variant: "outline" })}>
            Volver al comercio
          </Link>
        }
      />

      {locked && (
        <Alert>
          <AlertDescription>{locked}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Horario</CardTitle>
          <CardDescription>Los días y horas en que la sucursal recibe pedidos.</CardDescription>
        </CardHeader>
        <CardContent>
          <HoursEditor
            action={saveHours.bind(null, merchant.id, branch.id)}
            hours={branch.hours}
            disabled={locked !== null}
          />
        </CardContent>
      </Card>

      <Card id="programados">
        <CardHeader>
          <CardTitle>Pedidos programados</CardTitle>
          <CardDescription>Que el cliente elija para cuándo quiere el pedido.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulingForm
            action={saveScheduling.bind(null, merchant.id, branch.id)}
            scheduling={branch.scheduling}
            disabled={locked !== null}
          />
        </CardContent>
      </Card>

      <Card id="zonas">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Zonas de envío</CardTitle>
            <CardDescription>
              {branch.acceptsDelivery
                ? "Cada zona tiene su costo de envío y pedido mínimo."
                : "Esta sucursal no hace envíos. Activalo en los datos de la sucursal para cargar zonas."}
            </CardDescription>
          </div>
          {branch.acceptsDelivery && !locked && (
            <Link href={`${base}/zones/new`} className={buttonVariants({ size: "sm" })}>
              Agregar zona
            </Link>
          )}
        </CardHeader>
        {branch.acceptsDelivery && (
          <CardContent className="grid gap-2">
            {branch.zones.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay zonas.</p>}
            {branch.zones.map((z) => (
              <div key={z.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="grid">
                  <span className="font-medium">
                    {z.name} {!z.active && <span className="font-normal text-muted-foreground">(inactiva)</span>}
                  </span>
                  <span className="text-muted-foreground">
                    Envío {formatARS(z.feeMinor)} · Mínimo {formatARS(z.minOrderMinor)}
                  </span>
                  {z.description && <span className="text-xs text-muted-foreground">{z.description}</span>}
                </div>
                {!locked && (
                  <Link href={`${base}/zones/${z.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    Editar
                  </Link>
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la sucursal</CardTitle>
        </CardHeader>
        <CardContent>
          {locked ? (
            <p className="text-sm text-muted-foreground">
              {branch.addressLine} · {branch.acceptsPickup ? "Retiro en el local" : "Sin retiro"} ·{" "}
              {branch.acceptsDelivery ? "Con envío" : "Sin envío"}
            </p>
          ) : (
            <BranchForm action={updateBranch.bind(null, merchant.id, branch.id)} cities={cities} branch={branch} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
