import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { PromotionForm } from "@/components/promotion-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { merchantCall } from "@/lib/api";

import { savePromotion } from "../actions";

type Props = PageProps<"/m/[merchantId]/promotions/new">;

export default function NewPromotionPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={8} />}>
      <NewPromotion params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function NewPromotion({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const kind = query.kind === "COUPON" ? "COUPON" : "OFFER";
  const menu = await merchantCall((api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } }), {
    notFoundOn404: true,
  });
  const products = menu.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      <PageHeader
        title={kind === "COUPON" ? "Nuevo cupón" : "Nueva oferta"}
        description={kind === "COUPON" ? "Un código que el cliente escribe al pedir." : "Se aplica sola a los pedidos que cumplen y aparece en la app."}
      />
      <PromotionForm action={savePromotion.bind(null, merchantId, null)} kind={kind} products={products} cancelHref={`/m/${merchantId}/promotions`} />
    </>
  );
}
