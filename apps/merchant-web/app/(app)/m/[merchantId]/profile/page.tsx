import { Suspense } from "react";

import { MerchantForm } from "@/components/merchant-form";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getMyMerchant, getReferenceData, operationsLocked } from "@/lib/api";

import { updateProfile } from "../actions";

export default function ProfilePage({ params }: PageProps<"/m/[merchantId]/profile">) {
  return (
    <>
      <PageHeader title="Datos del comercio" />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Profile params={params} />
      </Suspense>
    </>
  );
}

async function Profile({ params }: { params: PageProps<"/m/[merchantId]/profile">["params"] }) {
  const { merchantId } = await params;
  const [merchant, { rubros }] = await Promise.all([getMyMerchant(merchantId), getReferenceData()]);
  const locked = operationsLocked(merchant.status);
  if (locked) {
    return (
      <Alert>
        <AlertDescription>{locked}</AlertDescription>
      </Alert>
    );
  }
  return (
    <MerchantForm
      action={updateProfile.bind(null, merchant.id)}
      rubros={rubros}
      merchant={merchant}
      cancelHref={`/m/${merchant.id}`}
    />
  );
}
