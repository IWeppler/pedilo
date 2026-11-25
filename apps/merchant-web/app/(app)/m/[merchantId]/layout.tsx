import { Suspense } from "react";

import { OrderAlerts } from "./order-alerts";

/** Páginas de un comercio: el aviso de pedidos nuevos queda visible en todas (SPEC §10). */
export default function MerchantLayout({ children }: LayoutProps<"/m/[merchantId]">) {
  return (
    <>
      <Suspense fallback={null}>
        <OrderAlerts />
      </Suspense>
      {children}
    </>
  );
}
