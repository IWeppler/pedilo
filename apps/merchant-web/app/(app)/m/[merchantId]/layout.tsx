import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { MerchantNav, type NavKey } from "@/components/merchant-nav";
import { MerchantStatusBadge } from "@/components/merchant-status-badge";
import { NAVBAR_TITLE_ID } from "@/components/page-header";
import { SidebarFrame, SidebarProvider, SidebarToggle } from "@/components/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser, getMyMerchant } from "@/lib/api";

import { logout } from "../../../login/actions";
import { AlertBanner, NotificationBell, OrderAlertsProvider } from "./order-alerts";

type Params = LayoutProps<"/m/[merchantId]">["params"];

/**
 * Panel de un comercio: sidebar con las secciones (Pedidos primero, colapsable a íconos) y la
 * cuenta al pie; a la derecha, el navbar con el título de la página (lo pone `PageHeader`) y la
 * campana de avisos. En celular el sidebar es un cajón.
 * El aviso de pedidos nuevos queda visible en todas las páginas (SPEC §10).
 */
export default function MerchantLayout({ children, params }: LayoutProps<"/m/[merchantId]">) {
  return (
    <OrderAlertsProvider>
      <SidebarProvider>
        <div className="flex min-h-svh flex-1">
          <SidebarFrame>
            <Suspense fallback={<SidebarSkeleton />}>
              <Sidebar params={params} />
            </Suspense>
          </SidebarFrame>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
              <SidebarToggle />
              <div id={NAVBAR_TITLE_ID} className="min-w-0 flex-1" />
              <NotificationBell />
            </header>
            <main data-panel="true" className="group/panel mx-auto grid w-full max-w-5xl content-start gap-6 px-4 py-6 md:px-8">
              <AlertBanner />
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </OrderAlertsProvider>
  );
}

async function Sidebar({ params }: { params: Params }) {
  const { merchantId } = await params;
  const [merchant, me] = await Promise.all([getMyMerchant(merchantId), getCurrentUser()]);
  const approved = merchant.status === "APPROVED";
  const enabled: NavKey[] = [
    ...(approved ? (["orders"] as const) : []),
    "menu",
    ...(approved ? (["couriers", "reports"] as const) : []),
    ...(merchant.status !== "DRAFT" ? (["claims"] as const) : []),
    "store",
  ];

  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b px-4 md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0">
        <Link
          href="/"
          title="Pedilo Comercios"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background"
        >
          {merchant.displayName.charAt(0).toUpperCase()}
        </Link>
        <div className="grid min-w-0 justify-items-start md:group-data-[collapsed=true]/sidebar:hidden">
          <span className="flex min-w-0 max-w-full items-center gap-1 text-sm font-semibold">
            <span className="truncate">{merchant.displayName}</span>
            {approved && (
              <BadgeCheck className="size-4 shrink-0 fill-[#0095f6] text-white" aria-label="Comercio aprobado" role="img" />
            )}
          </span>
          {approved ? (
            <span className="text-xs text-muted-foreground">Pedilo Comercios</span>
          ) : (
            <MerchantStatusBadge status={merchant.status} />
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 md:group-data-[collapsed=true]/sidebar:px-2">
        <MerchantNav merchantId={merchant.id} enabled={enabled} />
      </div>
      <div className="border-t p-2">
        <UserMenu email={me.email ?? me.phone ?? ""} logout={logout} />
      </div>
    </>
  );
}

function SidebarSkeleton() {
  return (
    <div className="grid gap-3 p-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="mt-2 h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}
