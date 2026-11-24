import Link from "next/link";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/api";

import { logout } from "../login/actions";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-4 px-4">
          <Link href="/" className="font-semibold">
            Pedilo <span className="font-normal text-muted-foreground">Comercios</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Suspense fallback={<Skeleton className="h-4 w-32" />}>
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
      <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6">{children}</main>
    </div>
  );
}

async function CurrentUser() {
  const me = await getCurrentUser();
  return <span className="hidden text-sm text-muted-foreground sm:inline">{me.email ?? me.phone ?? ""}</span>;
}
