import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { ZoneForm } from "@/components/zone-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getMyMerchant, operationsLocked } from "@/lib/api";

import { updateZone } from "../../../../actions";

type Props = PageProps<"/m/[merchantId]/branches/[branchId]/zones/[zoneId]">;

export default function EditZonePage({ params }: Props) {
  return (
    <>
      <PageHeader title="Editar zona de envío" />
      <Suspense fallback={<TableSkeleton rows={4} />}>
        <EditZone params={params} />
      </Suspense>
    </>
  );
}

async function EditZone({ params }: { params: Props["params"] }) {
  const { merchantId, branchId, zoneId } = await params;
  const merchant = await getMyMerchant(merchantId);
  const zone = merchant.branches.find((b) => b.id === branchId)?.zones.find((z) => z.id === zoneId);
  if (!zone) notFound();
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
      action={updateZone.bind(null, merchantId, branchId, zoneId)}
      zone={zone}
      cancelHref={`/m/${merchantId}/branches/${branchId}#zonas`}
    />
  );
}
