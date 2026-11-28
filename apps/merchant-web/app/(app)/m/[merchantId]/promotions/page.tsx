import { formatARS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { merchantCall } from "@/lib/api";

type Props = PageProps<"/m/[merchantId]/promotions">;

export default function PromotionsPage({ params }: Props) {
  return (
    <>
      <PageHeader
        title="Promociones"
        description="Las ofertas se aplican solas y aparecen en la app; los cupones los usa quien tenga el código. El descuento lo pagás vos."
      />
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Promotions params={params} />
      </Suspense>
    </>
  );
}

type Promotion = {
  id: string;
  kind: "OFFER" | "COUPON";
  code: string | null;
  title: string;
  label: string;
  productIds: string[] | null;
  minSubtotalMinor: number;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionsCount: number;
  active: boolean;
  live: boolean;
  state: "LIVE" | "SCHEDULED" | "PAUSED" | "EXHAUSTED" | "ENDED";
};

const STATE: Record<Promotion["state"], { label: string; tone: "default" | "secondary" | "outline" }> = {
  LIVE: { label: "Vigente", tone: "default" },
  SCHEDULED: { label: "Programada", tone: "secondary" },
  PAUSED: { label: "Pausada", tone: "outline" },
  EXHAUSTED: { label: "Agotada", tone: "outline" },
  ENDED: { label: "Terminada", tone: "outline" },
};

async function Promotions({ params }: { params: Props["params"] }) {
  const { merchantId } = await params;
  const list = (await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/promotions", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  )) as Promotion[];
  const base = `/m/${merchantId}/promotions`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Link href={`${base}/new?kind=OFFER`} className={buttonVariants()}>
          Nueva oferta
        </Link>
        <Link href={`${base}/new?kind=COUPON`} className={buttonVariants({ variant: "outline" })}>
          Nuevo cupón
        </Link>
      </div>
      <Card>
        <CardContent>
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no tenés promociones. Una oferta aparece en la app con su etiqueta y ayuda a que te elijan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Promoción</TableHead>
                  <TableHead>Descuento</TableHead>
                  <TableHead className="hidden md:table-cell">Vigencia</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => {
                  const state = STATE[p.state];
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`${base}/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                          {p.title}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {p.kind === "COUPON" ? `Cupón ${p.code}` : "Oferta automática"}
                          {" · "}
                          {p.productIds ? `${p.productIds.length} producto${p.productIds.length === 1 ? "" : "s"}` : "todo el menú"}
                          {p.minSubtotalMinor > 0 ? ` · desde ${formatARS(p.minSubtotalMinor)}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{p.label}</TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {formatDateTime(p.startsAt)}
                        {p.endsAt ? ` → ${formatDateTime(p.endsAt)}` : " → sin fin"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.redemptionsCount}
                        {p.maxRedemptions !== null ? ` / ${p.maxRedemptions}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.tone}>{state.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
