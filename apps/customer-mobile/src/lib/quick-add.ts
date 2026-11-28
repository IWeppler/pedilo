import type { PublicProduct } from "@pedilo/api-client";
import { priceSelection } from "@pedilo/domain";
import { useCallback } from "react";

import { useCart } from "@/lib/cart";

/**
 * Agregar con el «+» sin abrir la ficha. Solo si el producto no pide elegir nada (sin variantes ni
 * opciones obligatorias: la misma regla de `priceSelection` que usa la ficha), el comercio está
 * abierto y el carrito está vacío o es de este comercio (reemplazar otro pedido lo confirma la ficha).
 * Devuelve `false` cuando no se pudo: quien llama abre la ficha.
 */
export function useQuickAdd(merchant: { merchantSlug: string; merchantName: string; branchId: string; open: boolean }) {
  const { cart, add } = useCart();
  const { merchantSlug, merchantName, branchId, open } = merchant;
  return useCallback(
    (p: PublicProduct): boolean => {
      const r = priceSelection(p, { variantId: null, modifiers: [] });
      if (!r.ok || !open || !branchId) return false;
      if (cart && (cart.merchantSlug !== merchantSlug || cart.branchId !== branchId)) return false;
      add(
        { merchantSlug, merchantName, branchId },
        {
          productId: p.id,
          productName: p.name,
          imageUrl: p.imageUrl,
          variantId: null,
          variantName: null,
          modifiers: [],
          quantity: 1,
          unitPriceMinor: r.unitPriceMinor,
          notes: null,
        },
      );
      return true;
    },
    [cart, add, merchantSlug, merchantName, branchId, open],
  );
}
