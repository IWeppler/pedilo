import type { MerchantDetail } from "@pedilo/api-client";
import { formatCuit } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { MerchantStatusBadge } from "@/components/merchant-status-badge";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyMerchant, getReferenceData } from "@/lib/api";
import { mainLocation } from "@/lib/location";

import { AlertSettings } from "./order-alerts";
import { PushSetup } from "./orders/push-setup";
import { SubmitForReview } from "./submit-button";

type Params = PageProps<"/m/[merchantId]">["params"];

export default function MerchantHomePage({ params }: PageProps<"/m/[merchantId]">) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <MerchantHome params={params} />
    </Suspense>
  );
}

async function MerchantHome({ params }: { params: Params }) {
  const { merchantId } = await params;
  const [merchant, { rubros, cities }] = await Promise.all([getMyMerchant(merchantId), getReferenceData()]);
  const rubro = rubros.find((r) => r.id === merchant.categoryId);
  const cityName = new Map(cities.map((c) => [c.id, c.name]));
  const editable = merchant.status !== "PENDING_REVIEW" && merchant.status !== "SUSPENDED";
  const canSubmit = merchant.status === "DRAFT" || merchant.status === "REJECTED";
  const base = `/m/${merchant.id}`;

  return (
    <>
      {/* Las secciones (pedidos, catálogo, repartidores…) están en el sidebar del layout. */}
      <PageHeader title="Mi comercio" description={<MerchantStatusBadge status={merchant.status} />} />

      <StatusMessage merchant={merchant} />

      {canSubmit && (
        <Card>
          <CardHeader>
            <CardTitle>Para enviar a revisión</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <OnboardingSteps merchant={merchant} />
            {merchant.onboarding.ready ? (
              <SubmitForReview merchantId={merchant.id} resubmit={merchant.status === "REJECTED"} />
            ) : (
              <p className="text-sm text-muted-foreground">Completá lo que falta y vas a poder enviarlo.</p>
            )}
          </CardContent>
        </Card>
      )}

      {merchant.status === "APPROVED" && (
        <Card id="avisos" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Avisos de pedidos</CardTitle>
            <CardDescription>Cómo te enteras de un pedido nuevo en este navegador. Se configura en cada dispositivo.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <AlertSettings />
            <PushSetup merchantId={merchant.id} />
          </CardContent>
        </Card>
      )}

      {merchant.status === "APPROVED" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Plan y comisiones</CardTitle>
              <CardDescription>Tu plan, la comisión por pedido y las liquidaciones semanales.</CardDescription>
            </div>
            <Link href={`${base}/billing`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Ver plan
            </Link>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Datos del comercio</CardTitle>
          {editable && (
            <Link href={`${base}/profile`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Editar
            </Link>
          )}
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Rubro">{rubro?.name ?? "—"}</Item>
            <Item label="Razón social">{merchant.legalName}</Item>
            <Item label="CUIT">
              <span className="font-mono">{formatCuit(merchant.taxId)}</span>
            </Item>
            <Item label="Contacto">
              {merchant.contactPhone}
              {merchant.contactEmail && <span className="block">{merchant.contactEmail}</span>}
            </Item>
          </dl>
        </CardContent>
      </Card>

      <LocationSummary merchant={merchant} cityName={cityName} editable={editable} />
    </>
  );
}

function StatusMessage({ merchant }: { merchant: MerchantDetail }) {
  switch (merchant.status) {
    case "DRAFT":
      return null;
    case "PENDING_REVIEW":
      return (
        <Alert>
          <AlertTitle>Estamos revisando tu comercio</AlertTitle>
          <AlertDescription>
            Lo enviaste el {formatDateTime(merchant.submittedAt)}; mientras dure la revisión no se pueden hacer cambios.
          </AlertDescription>
        </Alert>
      );
    case "REJECTED":
      return (
        <Alert variant="destructive">
          <AlertTitle>Necesitamos que corrijas algo</AlertTitle>
          <AlertDescription>
            {merchant.rejectionReason ?? "Revisá tus datos."} Cuando lo corrijas, volvé a enviarlo a revisión.
          </AlertDescription>
        </Alert>
      );
    case "APPROVED":
      return (
        <Alert>
          <AlertTitle>Tu comercio está aprobado</AlertTitle>
          <AlertDescription>
            Ya aparece en la app. Podés seguir ajustando el catálogo, el local, los horarios y las zonas.
          </AlertDescription>
        </Alert>
      );
    case "SUSPENDED":
      return (
        <Alert variant="destructive">
          <AlertTitle>Tu comercio está suspendido</AlertTitle>
          <AlertDescription>
            {merchant.rejectionReason ? `Motivo: ${merchant.rejectionReason}. ` : ""}No aparece en la app ni recibe pedidos nuevos;
            podés terminar los que tenías en curso. Contactá al equipo de Pedilo.
          </AlertDescription>
        </Alert>
      );
  }
}

/** Resumen del local (dirección, entregas, horario) con el acceso a «Local y entregas». */
function LocationSummary({
  merchant,
  cityName,
  editable,
}: {
  merchant: MerchantDetail;
  cityName: Map<string, string>;
  editable: boolean;
}) {
  const branch = mainLocation(merchant);
  const href = `/m/${merchant.id}/local`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>Local y entregas</CardTitle>
          <CardDescription>Dirección, formas de entrega, horario y zonas de envío.</CardDescription>
        </div>
        <Link href={href} className={buttonVariants({ variant: branch ? "outline" : "default", size: "sm" })}>
          {!editable ? "Ver" : branch ? "Editar" : "Cargar"}
        </Link>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        {!branch ? (
          <p className="text-muted-foreground">Todavía no cargaste la dirección del local.</p>
        ) : (
          <>
            <span>
              {branch.addressLine}, {cityName.get(branch.cityId) ?? ""}
              {!branch.active && <span className="text-muted-foreground"> · no está recibiendo pedidos</span>}
            </span>
            <span className="text-muted-foreground">
              {[branch.acceptsPickup && "Retiro en el local", branch.acceptsDelivery && `Envío (${branch.zones.filter((z) => z.active).length} zonas)`]
                .filter(Boolean)
                .join(" · ") || "Sin formas de entrega"}
              {" · "}
              {branch.hours.length ? "Horario cargado" : "Sin horario"}
            </span>
          </>
        )}
      </CardContent>
    </Card>
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
