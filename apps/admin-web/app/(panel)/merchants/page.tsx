import type { MerchantStatus } from "@pedilo/api-client";
import { formatDateTime, MERCHANT_STATUS_LABELS } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCall } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS: MerchantStatus[] = ["PENDING_REVIEW", "APPROVED", "REJECTED", "DRAFT", "SUSPENDED"];

function parseStatus(value: unknown): MerchantStatus {
  return TABS.includes(value as MerchantStatus) ? (value as MerchantStatus) : "PENDING_REVIEW";
}

export default function MerchantsPage({ searchParams }: PageProps<"/merchants">) {
  return (
    <>
      <PageHeader
        title="Comercios"
        description="Revisá las solicitudes de alta. La cola en revisión muestra primero la más antigua."
      />
      <Suspense fallback={<TableSkeleton />}>
        <MerchantsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MerchantsSection({ searchParams }: { searchParams: PageProps<"/merchants">["searchParams"] }) {
  const status = parseStatus((await searchParams).status);
  const [merchants, rubros] = await Promise.all([
    adminCall((api) => api.GET("/v1/admin/merchants", { params: { query: { status } } })),
    adminCall((api) => api.GET("/v1/admin/categories", { params: { query: { kind: "MERCHANT" } } })),
  ]);
  const rubroName = new Map(rubros.map((r) => [r.id, r.name]));

  return (
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit" aria-label="Estado">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/merchants?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              tab === status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MERCHANT_STATUS_LABELS[tab]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent>
          {merchants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay comercios en estado «{MERCHANT_STATUS_LABELS[status].toLowerCase()}».
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comercio</TableHead>
                  <TableHead className="hidden md:table-cell">Rubro</TableHead>
                  <TableHead className="hidden lg:table-cell">Dueño</TableHead>
                  <TableHead className="hidden sm:table-cell">Sucursales</TableHead>
                  <TableHead>{status === "PENDING_REVIEW" ? "Enviado" : "Actualizado"}</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merchants.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="grid">
                        <span className="font-medium">{m.displayName}</span>
                        <span className="text-xs text-muted-foreground">{m.legalName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{rubroName.get(m.categoryId) ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{m.owner?.email ?? "—"}</TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{m.branchCount}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDateTime(status === "PENDING_REVIEW" ? m.submittedAt : m.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/merchants/${m.id}`}
                        className={buttonVariants({ variant: status === "PENDING_REVIEW" ? "default" : "ghost", size: "sm" })}
                      >
                        {status === "PENDING_REVIEW" ? "Revisar" : "Ver"}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {merchants.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {merchants.length} comercio{merchants.length === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}
