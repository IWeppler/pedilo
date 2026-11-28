"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** Id del lugar en el navbar del panel donde va el título de cada página. */
export const NAVBAR_TITLE_ID = "navbar-title";

/**
 * Encabezado de página. El título va al lado izquierdo del navbar del panel (por portal); en el
 * contenido quedan solo la descripción y las acciones. Sin navbar (antes de hidratar o fuera del
 * panel) el título se muestra en el contenido.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  // El lugar del navbar existe solo en el navegador; en el servidor se renderiza sin él.
  const slot = useSyncExternalStore(noopSubscribe, () => document.getElementById(NAVBAR_TITLE_ID), () => null);

  // Dentro del panel (main con data-panel) el título va al navbar: antes de hidratar queda oculto
  // a la vista para que no salte del contenido al navbar.
  const heading = (
    <h1 className="truncate text-xl font-semibold tracking-tight group-data-[panel=true]/panel:sr-only">{title}</h1>
  );
  const inNavbar = slot !== null;

  return (
    <>
      {inNavbar &&
        createPortal(<h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>, slot)}
      {(!inNavbar || description || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            {!inNavbar && heading}
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
    </>
  );
}

const noopSubscribe = () => () => {};
