"use client";

import { Bike, MapPin, MessageSquareWarning, ReceiptText, Store, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/merchants", label: "Comercios", icon: Store },
  { href: "/settlements", label: "Liquidaciones", icon: ReceiptText },
  { href: "/couriers", label: "Repartidores", icon: Bike },
  { href: "/claims", label: "Reclamos", icon: MessageSquareWarning },
  { href: "/cities", label: "Ciudades", icon: MapPin },
  { href: "/categories", label: "Categorías", icon: Tags },
];

const linkClass =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0";
const idleClass = "text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * Navegación del sidebar con el ítem activo marcado. Con el sidebar colapsado se ven solo los
 * íconos (el nombre queda para lectores de pantalla y como tooltip). Lee la URL (`usePathname`),
 * así que con Cache Components va dentro de un <Suspense> con `MainNavFallback`.
 */
export function MainNav() {
  const pathname = usePathname();
  return <NavList isActive={(href) => pathname === href || pathname.startsWith(`${href}/`)} />;
}

/** Misma navegación sin estado activo, para el shell estático. */
export function MainNavFallback() {
  return <NavList isActive={() => false} />;
}

function NavList({ isActive }: { isActive: (href: string) => boolean }) {
  return (
    <nav aria-label="Secciones" className="grid gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(linkClass, active ? "bg-foreground font-medium text-background" : idleClass)}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="md:group-data-[collapsed=true]/sidebar:sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
