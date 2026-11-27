"use client";

import { Bike, BookOpen, ChartColumn, ClipboardList, MessageSquareWarning, Store, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type NavKey = "orders" | "menu" | "couriers" | "reports" | "claims" | "store";

const ITEMS: { key: NavKey; label: string; icon: LucideIcon; path: string }[] = [
  { key: "orders", label: "Pedidos", icon: ClipboardList, path: "/orders" },
  { key: "menu", label: "Catálogo", icon: BookOpen, path: "/menu" },
  { key: "couriers", label: "Repartidores", icon: Bike, path: "/couriers" },
  { key: "reports", label: "Reportes", icon: ChartColumn, path: "/reports" },
  { key: "claims", label: "Reclamos", icon: MessageSquareWarning, path: "/claims" },
  { key: "store", label: "Mi comercio", icon: Store, path: "" },
];

/**
 * Navegación del panel de un comercio. `enabled` dice qué secciones tiene según su estado
 * (por ejemplo, sin aprobar no hay pedidos ni repartidores). «Mi comercio» agrupa datos,
 * sucursales, perfil, avisos y plan y comisiones, así que queda activo en todas las rutas que no
 * son de otra sección. Con el sidebar colapsado se ven solo los íconos (el nombre queda para
 * lectores de pantalla y como tooltip).
 */
export function MerchantNav({
  merchantId,
  enabled,
}: {
  merchantId: string;
  enabled: NavKey[];
}) {
  const pathname = usePathname();
  const base = `/m/${merchantId}`;
  const items = ITEMS.filter((i) => enabled.includes(i.key));
  const sectionActive = items.find((i) => i.path && (pathname === base + i.path || pathname.startsWith(`${base}${i.path}/`)));

  return (
    <nav
      aria-label="Secciones del comercio"
      className="grid gap-0.5"
    >
      {items.map((item) => {
        const active = item.key === "store" ? !sectionActive : sectionActive?.key === item.key;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={base + item.path}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:group-data-[collapsed=true]/sidebar:justify-center md:group-data-[collapsed=true]/sidebar:px-0",
              active
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="md:group-data-[collapsed=true]/sidebar:sr-only">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
