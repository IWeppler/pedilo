import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { adminCall } from "@/lib/api";
import { ApiError } from "@pedilo/api-client";

import { updateCity } from "../actions";
import { CityForm } from "../city-form";

export default function EditCityPage({ params }: PageProps<"/cities/[id]">) {
  return (
    <>
      <PageHeader title="Editar ciudad" />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <EditCity params={params} />
      </Suspense>
    </>
  );
}

async function EditCity({ params }: { params: PageProps<"/cities/[id]">["params"] }) {
  const { id } = await params;
  const city = await adminCall((api) => api.GET("/v1/admin/cities/{id}", { params: { path: { id } } })).catch(
    (err: unknown) => {
      // id inexistente o con formato inválido → 404 del panel.
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    },
  );
  return <CityForm action={updateCity.bind(null, city.id)} city={city} />;
}
