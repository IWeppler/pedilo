import { MIN_RATINGS_PUBLIC } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

type Props = PageProps<"/m/[merchantId]/ratings">;

export default function RatingsPage({ params }: Props) {
  return (
    <>
      <PageHeader title="Calificaciones" description="Lo que opinan tus clientes después de cada pedido. Los comentarios solo los ves vos." />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Ratings params={params} />
      </Suspense>
    </>
  );
}

const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function Ratings({ params }: { params: Props["params"] }) {
  const { merchantId } = await params;
  const data = await merchantCall((api) => api.GET("/v1/merchants/{merchantId}/ratings", { params: { path: { merchantId } } }), {
    notFoundOn404: true,
  });
  const s = data.summary;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Promedio</CardTitle>
          <CardDescription>
            {!s
              ? "Todavía no te calificaron. Los clientes pueden hacerlo hasta 14 días después de recibir o retirar su pedido."
              : data.public
                ? "Se muestra en la app junto a tu comercio."
                : `En la app aparece cuando tengas ${MIN_RATINGS_PUBLIC} calificaciones (te faltan ${MIN_RATINGS_PUBLIC - s.count}).`}
          </CardDescription>
        </CardHeader>
        {s && (
          <CardContent className="flex flex-wrap items-center gap-8">
            <div>
              <p className="text-5xl font-semibold tabular-nums">{fmt(s.average)}</p>
              <p className="text-sm text-muted-foreground">
                de 5 · {s.count} {s.count === 1 ? "calificación" : "calificaciones"}
              </p>
            </div>
            <ul className="grid min-w-56 flex-1 gap-1.5" aria-label="Cuántas de cada cantidad de estrellas">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = s.distribution[stars - 1] ?? 0;
                return (
                  <li key={stars} className="flex items-center gap-2 text-sm">
                    <span className="w-6 tabular-nums">{stars}★</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-foreground" style={{ width: `${(n / s.count) * 100}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums text-muted-foreground">{n}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        )}
      </Card>

      {data.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Últimas calificaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.recent.map((r) => (
                <li key={r.id} className="grid gap-1 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span aria-label={`${r.stars} de 5 estrellas`} className="tracking-wider">
                      {"★".repeat(r.stars)}
                      <span className="text-muted-foreground/40">{"★".repeat(5 - r.stars)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Pedido {r.orderCode} · {formatDateTime(r.createdAt)}
                    </span>
                  </div>
                  {r.comment ? <p className="text-sm">«{r.comment}»</p> : <p className="text-sm text-muted-foreground">Sin comentario.</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
