import { redirect } from "next/navigation";
import { Suspense } from "react";

type Props = PageProps<"/m/[merchantId]/branches/new">;

/** El panel ya no maneja sucursales: el local se carga y se edita en «Local y entregas». */
export default function Page({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <ToLocal params={params} />
    </Suspense>
  );
}

async function ToLocal({ params }: { params: Props["params"] }): Promise<null> {
  const { merchantId } = await params;
  redirect(`/m/${merchantId}/local`);
}
