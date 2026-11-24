import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { adminCall } from "@/lib/api";
import { KIND_NEW, parseKind, toTreeRows } from "@/lib/categories";

import { createCategory } from "../actions";
import { CategoryForm } from "../category-form";

type SearchParams = PageProps<"/categories/new">["searchParams"];

export default function NewCategoryPage({ searchParams }: PageProps<"/categories/new">) {
  return (
    <Suspense fallback={<TableSkeleton rows={4} />}>
      <NewCategory searchParams={searchParams} />
    </Suspense>
  );
}

async function NewCategory({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const kind = parseKind(params.kind);
  const parentId = typeof params.parentId === "string" ? params.parentId : undefined;
  const categories = await adminCall((api) => api.GET("/v1/admin/categories", { params: { query: { kind } } }));

  return (
    <>
      <PageHeader title={KIND_NEW[kind]} />
      <CategoryForm
        action={createCategory}
        kind={kind}
        parentOptions={toTreeRows(categories)}
        defaultParentId={parentId}
      />
    </>
  );
}
