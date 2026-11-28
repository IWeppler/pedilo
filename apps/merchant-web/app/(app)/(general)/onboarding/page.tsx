import { Suspense } from "react";

import { MerchantForm } from "@/components/merchant-form";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { getReferenceData } from "@/lib/api";

import { registerMerchant } from "./actions";

export default function OnboardingPage() {
  return (
    <>
      <PageHeader
        title="Registrá tu comercio"
        description="Paso 1 de 2: tus datos y tu local. Después cargás los horarios (y las zonas si hacés envíos) y lo enviás a revisión."
      />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <RegisterForm />
      </Suspense>
    </>
  );
}

async function RegisterForm() {
  const { rubros, cities } = await getReferenceData();
  return <MerchantForm action={registerMerchant} rubros={rubros} cities={cities} cancelHref="/" />;
}
