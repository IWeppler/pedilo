import { ApiError } from "@pedilo/api-client";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { adminCall } from "@/lib/api";
import { KIND_SINGULAR, selfAndDescendants, toTreeRows } from "@/lib/categories";

import { updateCategory } from "../actions";
import { CategoryForm } from "../category-form";

type Params = PageProps<"/categories/[id]">["params"];

export default function EditCategoryPage({ params }: PageProps<"/categories/[id]">) {
  return (
    <Suspense fallback={<TableSkeleton rows={4} />}>
      <EditCategory params={params} />
    </Suspense>
  );
}

async function EditCategory({ params }: { params: Params }) {
  const { id } = await params;
  const category = await adminCall((api) =>
    api.GET("/v1/admin/categories/{id}", { params: { path: { id } } }),
  ).catch((err: unknown) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });

  const siblings = await adminCall((api) =>
    api.GET("/v1/admin/categories", { params: { query: { kind: category.kind } } }),
  );
  // No se puede elegir como padre a sí misma ni a un descendiente (la API también lo rechaza).
  const excluded = selfAndDescendants(siblings, category.id);
  const parentOptions = toTreeRows(siblings).filter((row) => !excluded.has(row.category.id));

  return (
    <>
      <PageHeader title={`Editar ${KIND_SINGULAR[category.kind]}`} description={category.name} />
      <CategoryForm
        action={updateCategory.bind(null, category.id)}
        kind={category.kind}
        category={category}
        parentOptions={parentOptions}
      />
    </>
  );
}
