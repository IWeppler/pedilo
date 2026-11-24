import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { ProductEditor } from "@/components/product-editor";
import { TableSkeleton } from "@/components/table-skeleton";
import { merchantCall } from "@/lib/api";

import { saveProduct } from "../../actions";

type Props = PageProps<"/m/[merchantId]/menu/products/[productId]">;

export default function EditProductPage({ params }: Props) {
  return (
    <>
      <PageHeader title="Editar producto" />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <EditProduct params={params} />
      </Suspense>
    </>
  );
}

async function EditProduct({ params }: { params: Props["params"] }) {
  const { merchantId, productId } = await params;
  const menu = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  );
  const product = menu.products.find((p) => p.id === productId);
  if (!product) notFound();
  return (
    <ProductEditor
      action={saveProduct.bind(null, merchantId, product.id)}
      sections={menu.sections}
      product={product}
      cancelHref={`/m/${merchantId}/menu`}
    />
  );
}
