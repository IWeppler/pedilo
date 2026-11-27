import { Suspense } from "react";

import { MerchantForm } from "@/components/merchant-form";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { ImageUpload } from "@/components/image-upload";
import { MercadoPagoCard } from "@/components/mercado-pago-card";
import { PaymentSettingsForm } from "@/components/payment-settings-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyMerchant, getReferenceData, merchantCall, operationsLocked } from "@/lib/api";

import {
  connectMercadoPago,
  disconnectMercadoPago,
  removeMerchantImage,
  savePaymentSettings,
  updateProfile,
  uploadMerchantImage,
} from "../actions";

export default function ProfilePage({ params, searchParams }: PageProps<"/m/[merchantId]/profile">) {
  return (
    <>
      <PageHeader title="Datos del comercio" />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Profile params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Profile({
  params,
  searchParams,
}: {
  params: PageProps<"/m/[merchantId]/profile">["params"];
  searchParams: PageProps<"/m/[merchantId]/profile">["searchParams"];
}) {
  const { merchantId } = await params;
  const { mp } = await searchParams;
  const [merchant, { rubros }, mpConnection] = await Promise.all([
    getMyMerchant(merchantId),
    getReferenceData(),
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/mercadopago", { params: { path: { merchantId } } })),
  ]);
  const locked = operationsLocked(merchant.status);
  if (locked) {
    return (
      <Alert>
        <AlertDescription>{locked}</AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      <MerchantForm
        action={updateProfile.bind(null, merchant.id)}
        rubros={rubros}
        merchant={merchant}
        cancelHref={`/m/${merchant.id}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Logo y portada</CardTitle>
          <CardDescription>Se ven en la app, en la lista de comercios y arriba de tu menú.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <ImageUpload
            label="Logo"
            hint="Cuadrado, se recorta al centro."
            currentUrl={merchant.logoUrl}
            upload={uploadMerchantImage.bind(null, merchant.id, "logo")}
            remove={removeMerchantImage.bind(null, merchant.id, "logo")}
          />
          <ImageUpload
            label="Portada"
            hint="Horizontal (por ejemplo, el local o un plato). Se recorta a 1600 × 640."
            currentUrl={merchant.coverUrl}
            upload={uploadMerchantImage.bind(null, merchant.id, "cover")}
            remove={removeMerchantImage.bind(null, merchant.id, "cover")}
            aspect="wide"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medios de pago</CardTitle>
          <CardDescription>Cómo te pueden pagar los clientes. Se puede cambiar en cualquier momento.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentSettingsForm action={savePaymentSettings.bind(null, merchant.id)} payment={merchant.payment} />
        </CardContent>
      </Card>

      <MercadoPagoCard
        connection={mpConnection}
        result={typeof mp === "string" ? mp : undefined}
        connect={connectMercadoPago.bind(null, merchant.id)}
        disconnect={disconnectMercadoPago.bind(null, merchant.id)}
      />
    </>
  );
}
