import { ApiError, createApiClient, type paths, unwrap } from "@pedilo/api-client";
import { useQuery } from "@tanstack/react-query";

import { API_URL } from "./config";

/** De dónde sale el token en cada request (lo fija `AuthProvider`). */
let tokenSource: () => Promise<string | null> = async () => null;
export function setTokenSource(source: () => Promise<string | null>) {
  tokenSource = source;
}

export const api = createApiClient({ baseUrl: API_URL, getToken: () => tokenSource() });

type JsonOf<T> = T extends { content: { "application/json": infer B } } ? B : never;
export type Courier = JsonOf<paths["/v1/courier/me"]["get"]["responses"][200]>;
export type Offer = JsonOf<paths["/v1/courier/offers"]["get"]["responses"][200]>[number];
export type Delivery = JsonOf<paths["/v1/courier/deliveries"]["get"]["responses"][200]>[number];

/** `null` = todavía no se registró como repartidor. */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["courier", "me"],
    enabled,
    queryFn: async (): Promise<Courier | null> => {
      try {
        return await unwrap(api.GET("/v1/courier/me"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // El admin puede aprobarlo mientras mira la pantalla.
    refetchInterval: (q) => (q.state.data?.status === "PENDING_REVIEW" ? 30_000 : false),
  });
}

/**
 * Ofertas abiertas. Se consultan cada 8 s con la app en primer plano: el push no garantiza
 * entrega inmediata (SPEC §9.3), así que la consulta periódica es la red de seguridad.
 */
export function useOffers(enabled: boolean) {
  return useQuery({
    queryKey: ["courier", "offers"],
    enabled,
    queryFn: () => unwrap(api.GET("/v1/courier/offers")),
    refetchInterval: 8_000,
  });
}

export function useMyDeliveries(scope: "active" | "done", enabled = true) {
  return useQuery({
    queryKey: ["courier", "deliveries", scope],
    enabled,
    queryFn: () => unwrap(api.GET("/v1/courier/deliveries", { params: { query: { scope } } })),
    refetchInterval: scope === "active" ? 15_000 : false,
  });
}

export type Balance = JsonOf<paths["/v1/courier/balances"]["get"]["responses"][200]>[number];

/** Saldos con cada comercio (pagos que te deben y efectivo que debés rendir). */
export function useBalances() {
  return useQuery({ queryKey: ["courier", "balances"], queryFn: () => unwrap(api.GET("/v1/courier/balances")) });
}

export function useCities() {
  return useQuery({ queryKey: ["cities"], queryFn: () => unwrap(api.GET("/v1/cities")), staleTime: 60 * 60 * 1000 });
}
