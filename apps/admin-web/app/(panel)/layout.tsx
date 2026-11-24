import { Suspense } from "react";

import { MainNav, MainNavFallback } from "@/components/nav-link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAdmin } from "@/lib/api";

import { logout } from "../login/actions";

export default function PanelLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
          <span className="font-semibold">Pedilo Admin</span>
          <nav className="flex items-center gap-1" aria-label="Secciones">
            <Suspense fallback={<MainNavFallback />}>
              <MainNav />
            </Suspense>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Suspense fallback={<Skeleton className="h-4 w-40" />}>
              <CurrentUser />
            </Suspense>
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                Salir
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6">{children}</main>
    </div>
  );
}

/** Valida la sesión de admin en cada carga; si no es válida redirige al login. */
async function CurrentUser() {
  const me = await getCurrentAdmin();
  return <span className="hidden text-sm text-muted-foreground sm:inline">{me.email ?? me.id}</span>;
}
