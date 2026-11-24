import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from "react";

import { kv } from "./storage";

/**
 * Carrito de UN comercio (SPEC US-202: nunca se mezclan comercios). Se guarda en el teléfono.
 * Los precios son una estimación para mostrar: la API los recalcula al confirmar.
 */
export interface CartLine {
  key: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  modifiers: { modifierId: string; name: string; quantity: number; priceDeltaMinor: number }[];
  quantity: number;
  unitPriceMinor: number;
  notes: string | null;
}

export interface Cart {
  merchantSlug: string;
  merchantName: string;
  branchId: string;
  lines: CartLine[];
}

interface CartContextValue {
  cart: Cart | null;
  itemCount: number;
  subtotalMinor: number;
  /** Agrega una línea. Si el carrito es de otro comercio, lo reemplaza (la UI pide confirmación antes). */
  add: (merchant: Omit<Cart, "lines">, line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "pedilo.cart";
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    kv.get(STORAGE_KEY)
      .then((raw) => raw && setCart(JSON.parse(raw) as Cart))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    kv.set(STORAGE_KEY, cart ? JSON.stringify(cart) : "").catch(() => {});
  }, [cart, loaded]);

  const add = useCallback<CartContextValue["add"]>((merchant, line) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setCart((current) => {
      const same = current && current.merchantSlug === merchant.merchantSlug && current.branchId === merchant.branchId;
      const base: Cart = same ? current : { ...merchant, lines: [] };
      return { ...base, lines: [...base.lines, { ...line, key }] };
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setCart((c) => (c ? { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, quantity } : l)) } : c));
  }, []);

  const remove = useCallback((key: string) => {
    setCart((c) => {
      if (!c) return c;
      const lines = c.lines.filter((l) => l.key !== key);
      return lines.length ? { ...c, lines } : null;
    });
  }, []);

  const clear = useCallback(() => setCart(null), []);

  const value = useMemo<CartContextValue>(() => {
    const lines = cart?.lines ?? [];
    return {
      cart,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalMinor: lines.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
    };
  }, [cart, add, setQuantity, remove, clear]);

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartContextValue {
  const value = use(CartContext);
  if (!value) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return value;
}
