import { createApiClient, unwrap } from "@pedilo/api-client";
import { isOrderFinal } from "@pedilo/domain";
import { useQuery } from "@tanstack/react-query";

import { API_URL } from "./config";

/** Cliente de la API. Por ahora solo endpoints públicos (sin sesión). */
export const api = createApiClient({ baseUrl: API_URL });

export function useCities() {
  return useQuery({
    queryKey: ["cities"],
    queryFn: () => unwrap(api.GET("/v1/cities")),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMerchantCategories() {
  return useQuery({
    queryKey: ["categories", "MERCHANT"],
    queryFn: () => unwrap(api.GET("/v1/categories", { params: { query: { kind: "MERCHANT" } } })),
    staleTime: 60 * 60 * 1000,
  });
}

export function useCityMerchants(citySlug: string | null, categoryId: string | null) {
  return useQuery({
    queryKey: ["city-merchants", citySlug, categoryId],
    queryFn: () =>
      unwrap(
        api.GET("/v1/public/cities/{citySlug}/merchants", {
          params: { path: { citySlug: citySlug! }, query: categoryId ? { categoryId } : {} },
        }),
      ),
    enabled: citySlug !== null,
    // "Abierto ahora" cambia con la hora: se refresca seguido.
    staleTime: 60 * 1000,
  });
}

/** Seguimiento de un pedido con su token. Se refresca cada 10 s mientras no esté finalizado. */
export function useOrder(orderId: string, token: string | undefined) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () =>
      unwrap(api.GET("/v1/public/orders/{orderId}", { params: { path: { orderId }, header: { "x-order-token": token! } } })),
    enabled: Boolean(token),
    refetchInterval: (query) => (query.state.data && isOrderFinal(query.state.data.status) ? false : 10_000),
  });
}

export function useMerchantMenu(slug: string) {
  return useQuery({
    queryKey: ["merchant-menu", slug],
    queryFn: () => unwrap(api.GET("/v1/public/merchants/{slug}", { params: { path: { slug } } })),
    staleTime: 60 * 1000,
  });
}

/** Franjas para programar un pedido (ADR 0011). Se refrescan cada minuto: los cupos cambian. */
export function useBranchSlots(slug: string, branchId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["branch-slots", slug, branchId],
    queryFn: () =>
      unwrap(
        api.GET("/v1/public/merchants/{slug}/branches/{branchId}/slots", { params: { path: { slug, branchId: branchId! } } }),
      ),
    enabled: enabled && Boolean(branchId),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
