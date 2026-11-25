"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/merchants", label: "Comercios" },
  { href: "/settlements", label: "Liquidaciones" },
  { href: "/couriers", label: "Repartidores" },
  { href: "/cities", label: "Ciudades" },
  { href: "/categories", label: "Categorías" },
] as const;

const linkClass = "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted";

/**
 * Navegación principal con el ítem activo marcado. Lee la URL (`usePathname`), así que con
 * Cache Components tiene que renderizarse dentro de un <Suspense> con `MainNavFallback`.
 */
export function MainNav() {
  const pathname = usePathname();
  return (
    <>
      {NAV_ITEMS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(linkClass, active ? "bg-muted text-foreground" : "text-muted-foreground")}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}

/** Misma navegación sin estado activo, para el shell estático. */
export function MainNavFallback() {
  return (
    <>
      {NAV_ITEMS.map(({ href, label }) => (
        <Link key={href} href={href} className={cn(linkClass, "text-muted-foreground")}>
          {label}
        </Link>
      ))}
    </>
  );
}
