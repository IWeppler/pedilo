import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { ProductEditor } from "@/components/product-editor";
import { TableSkeleton } from "@/components/table-skeleton";
import { merchantCall } from "@/lib/api";

import { saveProduct } from "../../actions";

type Props = PageProps<"/m/[merchantId]/menu/products/new">;

export default function NewProductPage({ params, searchParams }: Props) {
  return (
    <>
      <PageHeader title="Nuevo producto" />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <NewProduct params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewProduct({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const menu = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  );
  const sectionId = typeof query.sectionId === "string" ? query.sectionId : undefined;
  return (
    <ProductEditor
      action={saveProduct.bind(null, merchantId, null)}
      sections={menu.sections}
      defaultSectionId={sectionId}
      cancelHref={`/m/${merchantId}/menu`}
    />
  );
}
