import type { MenuProduct } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyMerchant, merchantCall } from "@/lib/api";

import { setAvailability } from "./actions";
import { NewSectionForm } from "./new-section-form";

type Props = PageProps<"/m/[merchantId]/menu">;

export default function MenuPage({ params }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <Menu params={params} />
    </Suspense>
  );
}

async function Menu({ params }: { params: Props["params"] }) {
  const { merchantId } = await params;
  const [merchant, menu] = await Promise.all([
    getMyMerchant(merchantId),
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } })),
  ]);
  const base = `/m/${merchantId}/menu`;
  const suspended = merchant.status === "SUSPENDED";
  const groups = [
    ...menu.sections.map((s) => ({ section: s, products: menu.products.filter((p) => p.sectionId === s.id) })),
    { section: null, products: menu.products.filter((p) => p.sectionId === null) },
  ].filter((g) => g.section !== null || g.products.length > 0);

  return (
    <>
      <PageHeader
        title="Catálogo"
        description={merchant.displayName}
        actions={
          <>
            <Link href={`/m/${merchantId}`} className={buttonVariants({ variant: "outline" })}>
              Volver
            </Link>
            {!suspended && (
              <Link href={`${base}/products/new`} className={buttonVariants()}>
                Nuevo producto
              </Link>
            )}
          </>
        }
      />

      {suspended ? (
        <Alert variant="destructive">
          <AlertDescription>Tu comercio está suspendido: el catálogo no se puede modificar.</AlertDescription>
        </Alert>
      ) : (
        merchant.status !== "APPROVED" && (
          <Alert>
            <AlertDescription>
              Podés ir armando el catálogo. Los clientes lo van a ver cuando tu comercio esté aprobado.
            </AlertDescription>
          </Alert>
        )
      )}

      {!suspended && <NewSectionForm merchantId={merchantId} />}

      {menu.products.length === 0 && menu.sections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Empezá creando secciones (Pizzas, Empanadas, Bebidas…) y después los productos.
        </p>
      )}

      {groups.map(({ section, products }) => (
        <Card key={section?.id ?? "sin-seccion"}>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              {section ? section.name : "Sin sección («Otros»)"}
              {section && !section.active && <Badge variant="outline">Oculta</Badge>}
            </CardTitle>
            {section && !suspended && (
              <div className="flex gap-1">
                <Link href={`${base}/products/new?sectionId=${section.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  + Producto
                </Link>
                <Link href={`${base}/sections/${section.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Editar sección
                </Link>
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-2">
            {products.length === 0 && <p className="text-sm text-muted-foreground">Sin productos.</p>}
            {products.map((p) => (
              <ProductRow key={p.id} product={p} merchantId={merchantId} editable={!suspended} />
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function ProductRow({ product: p, merchantId, editable }: { product: MenuProduct; merchantId: string; editable: boolean }) {
  const toggle = setAvailability.bind(null, merchantId, p.id, !p.available);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {p.name}
          {!p.active && <Badge variant="outline">Archivado</Badge>}
          {p.active && !p.available && <Badge variant="destructive">Pausado</Badge>}
        </span>
        <span className="text-muted-foreground">
          {p.variants.length > 0 ? `desde ${formatARS(p.fromPriceMinor)}` : formatARS(p.priceMinor)}
          {p.variants.length > 0 && ` · ${p.variants.length} variantes`}
          {p.modifierGroups.length > 0 && ` · ${p.modifierGroups.length} grupos de opciones`}
        </span>
      </div>
      {editable && (
        <div className="flex gap-1">
          {p.active && (
            <form action={toggle}>
              <Button type="submit" variant="outline" size="sm">
                {p.available ? "Pausar" : "Reanudar"}
              </Button>
            </form>
          )}
          <Link href={`/m/${merchantId}/menu/products/${p.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Editar
          </Link>
        </div>
      )}
    </div>
  );
}
