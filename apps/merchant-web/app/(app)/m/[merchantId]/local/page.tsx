import { formatARS } from "@pedilo/domain";
import Link from "next/link";
import { Suspense } from "react";

import { ClosuresEditor } from "@/components/closures-editor";
import { HoursEditor } from "@/components/hours-editor";
import { LocationForm } from "@/components/location-form";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { PageHeader } from "@/components/page-header";
import { PrepTimeForm } from "@/components/prep-time-form";
import { SchedulingForm } from "@/components/scheduling-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyMerchant, getReferenceData, operationsLocked } from "@/lib/api";
import { mainLocation } from "@/lib/location";

import { addClosure, createBranch, removeClosure, saveHours, savePrepTime, saveScheduling, updateBranch } from "../actions";

type Props = PageProps<"/m/[merchantId]/local">;

/**
 * Local y entregas: dirección, formas de entrega, horario, cierres, pedidos programados y zonas.
 * Por detrás es la única sucursal del comercio; el panel no habla de sucursales.
 */
export default function LocalPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <Local params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Local({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const [merchant, { cities }] = await Promise.all([getMyMerchant(merchantId), getReferenceData()]);
  const branch = mainLocation(merchant);
  const locked = operationsLocked(merchant.status);
  // Todavía no se envió a revisión (o hay que corregir algo): se muestra lo que falta completar.
  const pendingReview = merchant.status === "DRAFT" || merchant.status === "REJECTED";
  const zonesBase = branch ? `/m/${merchant.id}/branches/${branch.id}/zones` : "";

  return (
    <>
      <PageHeader title="Local y entregas" description="Dónde estás, cómo entregás y cuándo recibís pedidos." />

      {locked && (
        <Alert>
          <AlertDescription>{locked}</AlertDescription>
        </Alert>
      )}

      {!branch && query.incompleto && (
        <Alert>
          <AlertDescription>Tu comercio quedó registrado. Falta la dirección del local: cargala acá abajo.</AlertDescription>
        </Alert>
      )}

      {pendingReview && !merchant.onboarding.ready && (
        <Card>
          <CardHeader>
            <CardTitle>Para enviar a revisión</CardTitle>
            <CardDescription>Completá esto y lo enviás desde «Mi comercio».</CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingSteps merchant={merchant} />
          </CardContent>
        </Card>
      )}

      <Card id="direccion" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>Dirección y formas de entrega</CardTitle>
          {!branch && <CardDescription>Empezá por acá: después cargás el horario.</CardDescription>}
        </CardHeader>
        <CardContent>
          {locked ? (
            branch ? (
              <p className="text-sm text-muted-foreground">
                {branch.addressLine} · {branch.acceptsPickup ? "Retiro en el local" : "Sin retiro"} ·{" "}
                {branch.acceptsDelivery ? "Con envío" : "Sin envío"}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin dirección cargada.</p>
            )
          ) : (
            <LocationForm
              key={branch?.id ?? "nuevo"}
              action={branch ? updateBranch.bind(null, merchant.id, branch.id) : createBranch.bind(null, merchant.id)}
              cities={cities}
              merchantName={merchant.displayName}
              branch={branch}
            />
          )}
        </CardContent>
      </Card>

      {branch && (
        <>
          <Card id="horario" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Horario de atención</CardTitle>
              <CardDescription>Los días y horas en que recibís pedidos.</CardDescription>
            </CardHeader>
            <CardContent>
              <HoursEditor action={saveHours.bind(null, merchant.id, branch.id)} hours={branch.hours} disabled={locked !== null} />
            </CardContent>
          </Card>

          <Card id="zonas" className="scroll-mt-20">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle>Zonas de envío</CardTitle>
                <CardDescription>
                  {branch.acceptsDelivery
                    ? "Cada zona tiene su costo de envío y pedido mínimo."
                    : "No tenés activado el envío a domicilio. Activalo arriba, en las formas de entrega, para cargar zonas."}
                </CardDescription>
              </div>
              {branch.acceptsDelivery && !locked && (
                <Link href={`${zonesBase}/new`} className={buttonVariants({ size: "sm" })}>
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
                      <Link href={`${zonesBase}/${z.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        Editar
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          <Card id="cierres" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>Cierres excepcionales</CardTitle>
              <CardDescription>Feriados, vacaciones o días que no abrís: ganan al horario semanal y no se toman pedidos.</CardDescription>
            </CardHeader>
            <CardContent>
              <ClosuresEditor
                closures={branch.closures}
                add={addClosure.bind(null, merchant.id, branch.id)}
                remove={removeClosure.bind(null, merchant.id, branch.id)}
                disabled={locked !== null}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tiempo de preparación</CardTitle>
              <CardDescription>Con esto la app le muestra al cliente cuánto va a tardar su pedido.</CardDescription>
            </CardHeader>
            <CardContent>
              <PrepTimeForm action={savePrepTime.bind(null, merchant.id)} prepMinutes={merchant.prepMinutes} disabled={locked !== null} />
            </CardContent>
          </Card>

          <Card id="programados" className="scroll-mt-20">
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
        </>
      )}
    </>
  );
}
