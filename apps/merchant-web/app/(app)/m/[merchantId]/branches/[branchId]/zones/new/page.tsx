import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { ZoneForm } from "@/components/zone-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getMyMerchant, operationsLocked } from "@/lib/api";

import { createZone } from "../../../../actions";

type Props = PageProps<"/m/[merchantId]/branches/[branchId]/zones/new">;

export default function NewZonePage({ params }: Props) {
  return (
    <>
      <PageHeader title="Nueva zona de envío" />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <NewZone params={params} />
      </Suspense>
    </>
  );
}

async function NewZone({ params }: { params: Props["params"] }) {
  const { merchantId, branchId } = await params;
  const merchant = await getMyMerchant(merchantId);
  if (!merchant.branches.some((b) => b.id === branchId)) notFound();
  const locked = operationsLocked(merchant.status);
  if (locked) {
    return (
      <Alert>
        <AlertDescription>{locked}</AlertDescription>
      </Alert>
    );
  }
  return (
    <ZoneForm
      action={createZone.bind(null, merchantId, branchId)}
      cancelHref={`/m/${merchantId}/branches/${branchId}#zonas`}
    />
  );
}
