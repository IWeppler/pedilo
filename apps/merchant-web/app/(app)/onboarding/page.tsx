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
        description="Paso 1 de 3: tus datos. Después cargás la sucursal con horarios y formas de entrega, y lo enviás a revisión."
      />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <RegisterForm />
      </Suspense>
    </>
  );
}

async function RegisterForm() {
  const { rubros } = await getReferenceData();
  return <MerchantForm action={registerMerchant} rubros={rubros} cancelHref="/" />;
}
