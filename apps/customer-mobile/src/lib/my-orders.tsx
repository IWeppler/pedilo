import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from "react";

import { kv } from "./storage";

/**
 * Pedidos hechos desde este teléfono, con su token de seguimiento (ADR 0007: pedido como
 * invitado). También recuerda los datos de contacto y la última dirección para no retipearlos.
 */
export interface SavedOrder {
  id: string;
  token: string;
  code: string;
  merchantName: string;
  createdAt: string;
}

export interface CustomerContact {
  name: string;
  phone: string;
  addressLine: string;
  addressNotes: string;
}

interface MyOrdersContextValue {
  orders: SavedOrder[];
  contact: CustomerContact;
  save: (order: SavedOrder) => void;
  tokenFor: (orderId: string) => string | undefined;
  setContact: (contact: CustomerContact) => void;
}

const ORDERS_KEY = "pedilo.orders";
const CONTACT_KEY = "pedilo.contact";
const EMPTY_CONTACT: CustomerContact = { name: "", phone: "", addressLine: "", addressNotes: "" };
const MAX_SAVED = 30;

const MyOrdersContext = createContext<MyOrdersContextValue | null>(null);

export function MyOrdersProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [contact, setContactState] = useState<CustomerContact>(EMPTY_CONTACT);

  useEffect(() => {
    kv.get(ORDERS_KEY)
      .then((raw) => raw && setOrders(JSON.parse(raw) as SavedOrder[]))
      .catch(() => {});
    kv.get(CONTACT_KEY)
      .then((raw) => raw && setContactState({ ...EMPTY_CONTACT, ...(JSON.parse(raw) as Partial<CustomerContact>) }))
      .catch(() => {});
  }, []);

  const save = useCallback((order: SavedOrder) => {
    setOrders((prev) => {
      const next = [order, ...prev.filter((o) => o.id !== order.id)].slice(0, MAX_SAVED);
      kv.set(ORDERS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setContact = useCallback((next: CustomerContact) => {
    setContactState(next);
    kv.set(CONTACT_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const value = useMemo<MyOrdersContextValue>(
    () => ({ orders, contact, save, setContact, tokenFor: (id) => orders.find((o) => o.id === id)?.token }),
    [orders, contact, save, setContact],
  );
  return <MyOrdersContext value={value}>{children}</MyOrdersContext>;
}

export function useMyOrders(): MyOrdersContextValue {
  const value = use(MyOrdersContext);
  if (!value) throw new Error("useMyOrders debe usarse dentro de <MyOrdersProvider>");
  return value;
}
