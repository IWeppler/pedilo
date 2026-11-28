import Link from "next/link";
import { Suspense } from "react";

import { MainNav, MainNavFallback } from "@/components/nav-link";
import { NAVBAR_TITLE_ID } from "@/components/page-header";
import { SidebarFrame, SidebarProvider, SidebarToggle } from "@/components/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMenu } from "@/components/user-menu";
import { getCurrentAdmin } from "@/lib/api";

import { logout } from "../login/actions";

/**
 * Panel de admin, con la misma estructura que el de comercios: sidebar con las secciones
 * (colapsable a íconos) y la cuenta al pie; a la derecha, el navbar con el título de la página
 * (lo pone `PageHeader`). En celular el sidebar es un cajón.
 */
export default function PanelLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider>
      <div className="flex min-h-svh flex-1">
        <SidebarFrame>
          <div className="flex h-14 items-center gap-3 border-b px-4 md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0">
            <Link
              href="/"
              title="Pedilo Admin"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background"
            >
              P
            </Link>
            <div className="grid min-w-0 md:group-data-[collapsed=true]/sidebar:hidden">
              <span className="truncate text-sm font-semibold">Pedilo</span>
              <span className="text-xs text-muted-foreground">Admin</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 md:group-data-[collapsed=true]/sidebar:px-2">
            <Suspense fallback={<MainNavFallback />}>
              <MainNav />
            </Suspense>
          </div>
          <div className="border-t p-2">
            <Suspense fallback={<Skeleton className="h-12 w-full" />}>
              <CurrentUser />
            </Suspense>
          </div>
        </SidebarFrame>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
            <SidebarToggle />
            <div id={NAVBAR_TITLE_ID} className="min-w-0 flex-1" />
          </header>
          <main data-panel="true" className="group/panel mx-auto grid w-full max-w-5xl content-start gap-6 px-4 py-6 md:px-8">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

/** Valida la sesión de admin en cada carga; si no es válida redirige al login. */
async function CurrentUser() {
  const me = await getCurrentAdmin();
  return <UserMenu email={me.email ?? me.id} logout={logout} />;
}
