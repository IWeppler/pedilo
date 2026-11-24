import { Suspense } from "react";

import { BranchForm } from "@/components/branch-form";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getMyMerchant, getReferenceData, operationsLocked } from "@/lib/api";

import { createBranch } from "../../actions";

type Props = PageProps<"/m/[merchantId]/branches/new">;

export default function NewBranchPage({ params }: Props) {
  return (
    <>
      <PageHeader title="Nueva sucursal" description="Después de crearla cargás el horario y, si hacés envíos, las zonas." />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <NewBranch params={params} />
      </Suspense>
    </>
  );
}

async function NewBranch({ params }: { params: Props["params"] }) {
  const { merchantId } = await params;
  const [merchant, { cities }] = await Promise.all([getMyMerchant(merchantId), getReferenceData()]);
  const locked = operationsLocked(merchant.status);
  if (locked) {
    return (
      <Alert>
        <AlertDescription>{locked}</AlertDescription>
      </Alert>
    );
  }
  return <BranchForm action={createBranch.bind(null, merchant.id)} cities={cities} cancelHref={`/m/${merchant.id}`} />;
}
