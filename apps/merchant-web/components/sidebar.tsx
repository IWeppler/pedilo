"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, Suspense, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * Sidebar del panel. En escritorio se colapsa a solo íconos (la elección queda guardada en el
 * navegador); en celular es un cajón que se abre desde el botón del navbar y se cierra al navegar.
 * Los hijos leen el estado con el grupo de Tailwind `group/sidebar` y `data-collapsed`.
 */

const COLLAPSED_KEY = "pedilo.sidebar.collapsed";
const EVENT = "pedilo:sidebar";

interface SidebarState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("Falta SidebarProvider");
  return ctx;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, () => localStorage.getItem(COLLAPSED_KEY) === "1", () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = () => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <SidebarContext.Provider value={{ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }}>{children}</SidebarContext.Provider>
  );
}

/** En celular, el cajón se cierra al ir a otra página. En su propio Suspense por `usePathname`. */
function CloseOnNavigate() {
  const { setMobileOpen } = useSidebar();
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);
  return null;
}

export function SidebarFrame({ children }: { children: ReactNode }) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();

  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigate />
      </Suspense>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" aria-hidden onClick={() => setMobileOpen(false)} />
      )}
      <aside
        id="panel-sidebar"
        data-collapsed={collapsed}
        className={cn(
          "group/sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar transition-[transform,width] duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:sticky md:top-0 md:z-auto md:h-svh md:translate-x-0",
          collapsed ? "md:w-16" : "md:w-60",
        )}
      >
        {children}
      </aside>
    </>
  );
}

/** Botón del navbar: colapsa el sidebar en escritorio y abre el cajón en celular. */
export function SidebarToggle() {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const base =
    "inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
  return (
    <>
      <button
        type="button"
        className={cn(base, "md:hidden")}
        aria-label="Abrir menú"
        aria-controls="panel-sidebar"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        className={cn(base, "hidden md:inline-flex")}
        aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        aria-controls="panel-sidebar"
        aria-expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
      </button>
    </>
  );
}
