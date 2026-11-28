import { ApiError, createApiClient, type paths, unwrap } from "@pedilo/api-client";
import { isOrderFinal } from "@pedilo/domain";
import { useQuery } from "@tanstack/react-query";

import { currentAccessToken } from "./auth";
import { API_URL } from "./config";

/**
 * Cliente de la API. Con sesión (Google o Apple, ADR 0026) manda el token: así el pedido queda en
 * la cuenta. Sin sesión, todo sigue como invitado.
 */
export const api = createApiClient({ baseUrl: API_URL, getToken: currentAccessToken });

/** Perfil del cliente con cuenta. `null` = entró pero todavía no completó nombre y teléfono. */
export function useCustomerProfile(enabled: boolean) {
  return useQuery({
    queryKey: ["customer", "me"],
    enabled,
    queryFn: async () => {
      try {
        return await unwrap(api.GET("/v1/customer/me"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Pedidos hechos con la cuenta, desde cualquier celular (con su token de seguimiento). */
export function useAccountOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["customer", "orders"],
    enabled,
    queryFn: () => unwrap(api.GET("/v1/customer/orders")),
  });
}

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

/** Tipos de comida del inicio (Hamburguesas, Pizzas…), en el orden que elige Pedilo (ADR 0027). */
export function useFoodTypes() {
  return useQuery({
    queryKey: ["categories", "PRODUCT", "featured"],
    queryFn: () => unwrap(api.GET("/v1/categories", { params: { query: { kind: "PRODUCT", featured: "true" } } })),
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Comercios de la ciudad. Con `foodTypeId`, solo los que venden ese tipo de comida; con `rubroId`,
 * solo los de ese rubro. Se pueden combinar.
 */
export function useCityMerchants(citySlug: string | null, foodTypeId: string | null, rubroId: string | null = null) {
  return useQuery({
    queryKey: ["city-merchants", citySlug, foodTypeId, rubroId],
    queryFn: () =>
      unwrap(
        api.GET("/v1/public/cities/{citySlug}/merchants", {
          params: {
            path: { citySlug: citySlug! },
            query: { ...(foodTypeId && { productCategoryId: foodTypeId }), ...(rubroId && { categoryId: rubroId }) },
          },
        }),
      ),
    enabled: citySlug !== null,
    // "Abierto ahora" cambia con la hora: se refresca seguido.
    staleTime: 60 * 1000,
  });
}

type QuoteBody = paths["/v1/public/orders/quote"]["post"]["requestBody"]["content"]["application/json"];

/**
 * Cotización del checkout (ADR 0030): descuento de la promo y total con las reglas de la API. Se
 * vuelve a pedir cuando cambia el carrito, la forma de entrega, la zona o el cupón.
 */
export function useOrderQuote(body: QuoteBody | null) {
  return useQuery({
    queryKey: ["order-quote", body],
    queryFn: () => unwrap(api.POST("/v1/public/orders/quote", { body: body! })),
    enabled: body !== null,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}

/** Ofertas vigentes de la ciudad, para el banner del inicio (ADR 0030). */
export function useCityOffers(citySlug: string | null) {
  return useQuery({
    queryKey: ["city-offers", citySlug],
    queryFn: () => unwrap(api.GET("/v1/public/cities/{citySlug}/offers", { params: { path: { citySlug: citySlug! } } })),
    enabled: citySlug !== null,
    staleTime: 2 * 60 * 1000,
  });
}

/** «Platos para probar»: productos con foto de los comercios de la ciudad (ADR 0028). */
export function useCityDishes(citySlug: string | null) {
  return useQuery({
    queryKey: ["city-dishes", citySlug],
    queryFn: () => unwrap(api.GET("/v1/public/cities/{citySlug}/dishes", { params: { path: { citySlug: citySlug! } } })),
    enabled: citySlug !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/** Seguimiento de un pedido con su token. Se refresca cada 10 s mientras no esté finalizado. */
export function useOrder(orderId: string, token: string | undefined) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () =>
      unwrap(api.GET("/v1/public/orders/{orderId}", { params: { path: { orderId }, header: { "x-order-token": token! } } })),
    enabled: Boolean(token),
    // Con el repartidor en camino se refresca más seguido para mover el mapa (ADR 0022).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && isOrderFinal(data.status)) return false;
      return data?.tracking?.courierLocation ? 5_000 : 10_000;
    },
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
