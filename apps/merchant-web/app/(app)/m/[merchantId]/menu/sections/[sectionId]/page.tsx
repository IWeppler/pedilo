import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { merchantCall } from "@/lib/api";

import { updateSection } from "../../actions";
import { SectionForm } from "./section-form";

type Props = PageProps<"/m/[merchantId]/menu/sections/[sectionId]">;

export default function EditSectionPage({ params }: Props) {
  return (
    <>
      <PageHeader title="Editar sección" />
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <EditSection params={params} />
      </Suspense>
    </>
  );
}

async function EditSection({ params }: { params: Props["params"] }) {
  const { merchantId, sectionId } = await params;
  const menu = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/menu", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  );
  const section = menu.sections.find((s) => s.id === sectionId);
  if (!section) notFound();
  return (
    <SectionForm
      action={updateSection.bind(null, merchantId, section.id)}
      section={section}
      cancelHref={`/m/${merchantId}/menu`}
    />
  );
}
