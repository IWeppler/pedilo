import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ImageUpload } from "@/components/image-upload";
import { PageHeader } from "@/components/page-header";
import { ProductEditor } from "@/components/product-editor";
import { TableSkeleton } from "@/components/table-skeleton";
import { getProductTypes, merchantCall } from "@/lib/api";

import { removeProductImage, saveProduct, uploadProductImage } from "../../actions";

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
  const [menu, productTypes] = await Promise.all([
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } }), { notFoundOn404: true }),
    getProductTypes(),
  ]);
  const product = menu.products.find((p) => p.id === productId);
  if (!product) notFound();
  return (
    <>
      <ImageUpload
        label="Foto"
        hint="Sacala de cerca y con buena luz. Podés subir la foto del celular: la achicamos nosotros."
        currentUrl={product.imageUrl}
        upload={uploadProductImage.bind(null, merchantId, product.id)}
        remove={removeProductImage.bind(null, merchantId, product.id)}
      />
      <ProductEditor
      action={saveProduct.bind(null, merchantId, product.id)}
      sections={menu.sections}
      productTypes={productTypes}
      product={product}
      cancelHref={`/m/${merchantId}/menu`}
      />
    </>
  );
}
