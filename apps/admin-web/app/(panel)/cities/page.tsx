import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCall } from "@/lib/api";

export default function CitiesPage() {
  return (
    <>
      <PageHeader
        title="Ciudades"
        description="Las ciudades activas aparecen en las apps. Para sacar una, desactivala: no se borran."
        actions={
          <Link href="/cities/new" className={buttonVariants()}>
            Nueva ciudad
          </Link>
        }
      />
      <Card>
        <CardContent>
          <Suspense fallback={<TableSkeleton />}>
            <CitiesTable />
          </Suspense>
        </CardContent>
      </Card>
    </>
  );
}

async function CitiesTable() {
  const cities = await adminCall((api) => api.GET("/v1/admin/cities"));

  if (cities.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay ciudades cargadas.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Provincia</TableHead>
          <TableHead className="hidden sm:table-cell">Slug</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cities.map((city) => (
          <TableRow key={city.id}>
            <TableCell className="font-medium">{city.name}</TableCell>
            <TableCell>{city.province}</TableCell>
            <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{city.slug}</TableCell>
            <TableCell>
              <StatusBadge active={city.active} />
            </TableCell>
            <TableCell>
              <Link
                href={`/cities/${city.id}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                aria-label={`Editar ${city.name}`}
              >
                Editar
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
