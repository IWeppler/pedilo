"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronsUpDown, LogOut } from "lucide-react";

/**
 * Cuenta al pie del sidebar: al tocarla se abre un menú con el email y «Salir».
 * Con el sidebar colapsado queda solo la inicial.
 */
export function UserMenu({ email, logout }: { email: string; logout: () => Promise<void> }) {
  const initial = (email.charAt(0) || "?").toUpperCase();
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Cuenta: ${email}`}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[popup-open]:bg-muted md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{initial}</span>
        <span className="min-w-0 flex-1 truncate md:group-data-[collapsed=true]/sidebar:hidden">{email}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground md:group-data-[collapsed=true]/sidebar:hidden" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="w-60 rounded-xl border bg-background p-1 text-sm outline-none">
            <div className="px-3 py-2">
              <p className="text-xs text-muted-foreground">Sesión iniciada como</p>
              <p className="truncate font-medium">{email}</p>
            </div>
            <form action={logout} className="border-t pt-1">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <LogOut className="size-4" aria-hidden /> Salir
              </button>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
