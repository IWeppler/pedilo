import type { CategoryKind } from "@pedilo/api-client";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCall } from "@/lib/api";
import { commissionShortLabel, KIND_LABELS, KIND_NEW, parseKind, toTreeRows } from "@/lib/categories";
import { cn } from "@/lib/utils";

type SearchParams = PageProps<"/categories">["searchParams"];

export default function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  return (
    <>
      <PageHeader
        title="Categorías"
        description="Los rubros clasifican comercios y definen el tope de comisión. Las categorías de producto ordenan el catálogo."
      />
      <Suspense fallback={<TableSkeleton />}>
        <CategoriesSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CategoriesSection({ searchParams }: { searchParams: SearchParams }) {
  const kind = parseKind((await searchParams).kind);
  const categories = await adminCall((api) => api.GET("/v1/admin/categories", { params: { query: { kind } } }));
  const rows = toTreeRows(categories);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KindTabs current={kind} />
        <Link href={`/categories/new?kind=${kind}`} className={buttonVariants()}>
          {KIND_NEW[kind]}
        </Link>
      </div>
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay {KIND_LABELS[kind].toLowerCase()}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  {kind === "MERCHANT" && <TableHead>Comisión</TableHead>}
                  {kind === "PRODUCT" && <TableHead>En el inicio</TableHead>}
                  <TableHead className="hidden sm:table-cell">Orden</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-0">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ category: c, depth }) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-baseline gap-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                        {depth > 0 && <span className="text-muted-foreground" aria-hidden>└</span>}
                        <span className="font-medium">{c.name}</span>
                        <span className="hidden font-mono text-xs text-muted-foreground md:inline">{c.slug}</span>
                      </div>
                    </TableCell>
                    {kind === "MERCHANT" && <TableCell>{commissionShortLabel(c.commissionCategory)}</TableCell>}
                    {kind === "PRODUCT" && (
                      <TableCell className="tabular-nums">
                        {c.featuredOrder != null ? c.featuredOrder : <span className="text-muted-foreground">No</span>}
                      </TableCell>
                    )}
                    <TableCell className="hidden tabular-nums sm:table-cell">{c.sortOrder}</TableCell>
                    <TableCell>
                      <StatusBadge active={c.active} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/categories/new?kind=${kind}&parentId=${c.id}`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                          aria-label={`Agregar subcategoría a ${c.name}`}
                        >
                          + Sub
                        </Link>
                        <Link
                          href={`/categories/${c.id}`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                          aria-label={`Editar ${c.name}`}
                        >
                          Editar
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KindTabs({ current }: { current: CategoryKind }) {
  return (
    <nav className="inline-flex rounded-lg bg-muted p-1" aria-label="Tipo de categoría">
      {(["MERCHANT", "PRODUCT"] as const).map((kind) => (
        <Link
          key={kind}
          href={`/categories?kind=${kind}`}
          aria-current={kind === current ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            kind === current ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {KIND_LABELS[kind]}
        </Link>
      ))}
    </nav>
  );
}
