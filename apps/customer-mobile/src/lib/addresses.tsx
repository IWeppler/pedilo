import { unwrap } from "@pedilo/api-client";
import type { AddressLabel, LatLng } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, useCustomerProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { kv } from "@/lib/storage";

/**
 * Direcciones del cliente (ADR 0034) y desde cuál pide ahora («¿Desde dónde pedís?»). La elegida
 * se recuerda en el teléfono; si se borró, se usa la primera (Casa, si hay).
 */

export type SavedAddress = NonNullable<ReturnType<typeof useCustomerProfile>["data"]>["addresses"][number];

export interface AddressInput {
  label: AddressLabel;
  name: string | null;
  line: string;
  notes: string | null;
  location: LatLng | null;
}

const KEY = "pedilo.deliveryAddressId";

interface DeliveryAddressContext {
  addresses: SavedAddress[];
  /** Desde dónde pide ahora; null si todavía no guardó ninguna. */
  selected: SavedAddress | null;
  select: (id: string) => void;
  ready: boolean;
}

const Ctx = createContext<DeliveryAddressContext | null>(null);

export function DeliveryAddressProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const profile = useCustomerProfile(status === "signedIn");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void kv
      .get(KEY)
      .then(setSelectedId)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    void kv.set(KEY, id).catch(() => undefined);
  }, []);

  const value = useMemo<DeliveryAddressContext>(() => {
    const addresses = profile.data?.addresses ?? [];
    return {
      addresses,
      selected: addresses.find((a) => a.id === selectedId) ?? addresses[0] ?? null,
      select,
      ready: loaded && !profile.isPending,
    };
  }, [profile.data, profile.isPending, selectedId, select, loaded]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeliveryAddress(): DeliveryAddressContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDeliveryAddress fuera de DeliveryAddressProvider");
  return ctx;
}

/** Alta, edición y baja de direcciones. Al terminar refresca el perfil (que las trae). */
export function useAddressMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customer", "me"] });
  const toBody = (a: AddressInput) => ({
    label: a.label,
    name: a.label === "OTHER" ? a.name?.trim() || null : null,
    line: a.line.trim(),
    notes: a.notes?.trim() || null,
    location: a.location,
  });
  return {
    add: useMutation({
      mutationFn: (a: AddressInput) => unwrap(api.POST("/v1/customer/me/addresses", { body: toBody(a) })),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...a }: AddressInput & { id: string }) =>
        unwrap(api.PUT("/v1/customer/me/addresses/{addressId}", { params: { path: { addressId: id } }, body: toBody(a) })),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => unwrap(api.DELETE("/v1/customer/me/addresses/{addressId}", { params: { path: { addressId: id } } })),
      onSuccess: refresh,
    }),
  };
}
