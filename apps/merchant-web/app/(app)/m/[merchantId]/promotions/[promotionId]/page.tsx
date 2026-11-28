import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { PromotionForm } from "@/components/promotion-form";
import { TableSkeleton } from "@/components/table-skeleton";
import { merchantCall } from "@/lib/api";

import { savePromotion } from "../actions";

type Props = PageProps<"/m/[merchantId]/promotions/[promotionId]">;

export default function EditPromotionPage({ params }: Props) {
  return (
    <>
      <PageHeader title="Editar promoción" />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <EditPromotion params={params} />
      </Suspense>
    </>
  );
}

async function EditPromotion({ params }: { params: Props["params"] }) {
  const { merchantId, promotionId } = await params;
  const [list, menu] = await Promise.all([
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/promotions", { params: { path: { merchantId } } }), { notFoundOn404: true }),
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } })),
  ]);
  const promotion = list.find((p) => p.id === promotionId);
  if (!promotion) notFound();
  const products = menu.products.filter((p) => p.active || promotion.productIds?.includes(p.id)).map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Se usó {promotion.redemptionsCount} {promotion.redemptionsCount === 1 ? "vez" : "veces"}
        {promotion.maxRedemptions !== null ? ` de ${promotion.maxRedemptions}` : ""}. Los pedidos ya hechos no cambian.
      </p>
      <PromotionForm
        action={savePromotion.bind(null, merchantId, promotion.id)}
        kind={promotion.kind}
        promotion={promotion}
        products={products}
        cancelHref={`/m/${merchantId}/promotions`}
      />
    </>
  );
}
