import createClient from "openapi-fetch";

import type { paths } from "./schema";

export type { paths } from "./schema";

/**
 * Cliente tipado de la API de Pedilo.
 *
 * Los tipos salen de `services/api/openapi.json` (`npm run generate -w @pedilo/api-client`).
 * Rutas, parámetros, bodies y respuestas se chequean en tiempo de compilación:
 *
 *   const api = createApiClient({ baseUrl, getToken });
 *   const cities = await unwrap(api.GET("/v1/cities"));
 */
export interface ApiClientOptions {
  baseUrl: string;
  /** Devuelve el token de acceso actual, o nada si el usuario no inició sesión. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Para tests o runtimes con fetch propio. */
  fetch?: (request: Request) => Promise<Response>;
}

export function createApiClient({ baseUrl, getToken, fetch }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, ...(fetch && { fetch }) });
  if (getToken) {
    client.use({
      async onRequest({ request }) {
        const token = await getToken();
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        return request;
      },
    });
  }
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

// ---------------------------------------------------------------------------
// Tipos de conveniencia derivados del contrato
// ---------------------------------------------------------------------------

type JsonOf<T> = T extends { content: { "application/json": infer B } } ? B : never;

export type Me = JsonOf<paths["/v1/me"]["get"]["responses"][200]>;
export type City = JsonOf<paths["/v1/cities"]["get"]["responses"][200]>[number];
export type Category = JsonOf<paths["/v1/categories"]["get"]["responses"][200]>[number];
export type CategoryKind = Category["kind"];
export type CommissionCategory = NonNullable<Category["commissionCategory"]>;

export type CreateCityBody = JsonOf<NonNullable<paths["/v1/admin/cities"]["post"]["requestBody"]>>;
export type UpdateCityBody = JsonOf<NonNullable<paths["/v1/admin/cities/{id}"]["patch"]["requestBody"]>>;
export type CreateCategoryBody = JsonOf<NonNullable<paths["/v1/admin/categories"]["post"]["requestBody"]>>;
export type UpdateCategoryBody = JsonOf<NonNullable<paths["/v1/admin/categories/{id}"]["patch"]["requestBody"]>>;

export type MyMerchant = JsonOf<paths["/v1/me/merchants"]["get"]["responses"][200]>[number];
export type MerchantDetail = JsonOf<paths["/v1/merchants/{merchantId}"]["get"]["responses"][200]>;
export type MerchantStatus = MerchantDetail["status"];
export type Branch = MerchantDetail["branches"][number];
export type DeliveryZone = Branch["zones"][number];
export type OpeningRange = Branch["hours"][number];
export type OnboardingProblem = MerchantDetail["onboarding"]["problems"][number];
export type AdminMerchantSummary = JsonOf<paths["/v1/admin/merchants"]["get"]["responses"][200]>[number];
export type AdminMerchantDetail = JsonOf<paths["/v1/admin/merchants/{id}"]["get"]["responses"][200]>;

export type RegisterMerchantBody = JsonOf<NonNullable<paths["/v1/merchants"]["post"]["requestBody"]>>;
export type UpdateMerchantBody = JsonOf<NonNullable<paths["/v1/merchants/{merchantId}"]["patch"]["requestBody"]>>;
export type CreateBranchBody = JsonOf<
  NonNullable<paths["/v1/merchants/{merchantId}/branches"]["post"]["requestBody"]>
>;
export type CreateZoneBody = JsonOf<
  NonNullable<paths["/v1/merchants/{merchantId}/branches/{branchId}/zones"]["post"]["requestBody"]>
>;

export type MerchantMenu = JsonOf<paths["/v1/merchants/{merchantId}/menu"]["get"]["responses"][200]>;
export type MenuSection = MerchantMenu["sections"][number];
export type MenuProduct = MerchantMenu["products"][number];
export type MenuVariant = MenuProduct["variants"][number];
export type MenuModifierGroup = MenuProduct["modifierGroups"][number];
export type MenuModifier = MenuModifierGroup["modifiers"][number];
export type ProductBody = JsonOf<
  NonNullable<paths["/v1/merchants/{merchantId}/menu/products"]["post"]["requestBody"]>
>;
export type PublicMerchantMenu = JsonOf<paths["/v1/public/merchants/{slug}"]["get"]["responses"][200]>;
export type PublicBranch = PublicMerchantMenu["merchant"]["branches"][number];
export type PublicMenuSection = PublicMerchantMenu["sections"][number];
export type PublicProduct = PublicMenuSection["products"][number];
export type CityMerchant = JsonOf<
  paths["/v1/public/cities/{citySlug}/merchants"]["get"]["responses"][200]
>[number];

export type Order = JsonOf<paths["/v1/public/orders/{orderId}"]["get"]["responses"][200]>;
export type OrderStatus = Order["status"];
export type CreateOrderBody = JsonOf<NonNullable<paths["/v1/public/orders"]["post"]["requestBody"]>>;
export type CreateOrderResult = JsonOf<paths["/v1/public/orders"]["post"]["responses"][201]>;
export type PaymentMethod = CreateOrderBody["paymentMethod"] & string;
export type BranchSlots = JsonOf<
  paths["/v1/public/merchants/{slug}/branches/{branchId}/slots"]["get"]["responses"][200]
>;
export type BranchScheduling = Branch["scheduling"];
export type PaymentSettings = MerchantDetail["payment"];
export type MerchantOrder = JsonOf<paths["/v1/merchants/{merchantId}/orders"]["get"]["responses"][200]>[number];
export type MerchantBilling = JsonOf<paths["/v1/merchants/{merchantId}/billing"]["get"]["responses"][200]>;
export type PricingVersionDoc = MerchantBilling["pricing"];
export type PlanCode = MerchantBilling["plan"]["code"];
export type Settlement = MerchantBilling["settlements"][number];
export type SettlementStatus = Settlement["status"];
export type SettlementDetail = JsonOf<paths["/v1/admin/settlements/{settlementId}"]["get"]["responses"][200]>;

// ---------------------------------------------------------------------------
// Errores (forma estable, ADR 0005)
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

/**
 * Devuelve `data` o lanza `ApiError`. Evita repetir el chequeo de `error` en cada llamada.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok || error !== undefined) {
    if (isApiErrorBody(error)) {
      throw new ApiError(response.status, error.error.code, error.error.message, error.error.details);
    }
    throw new ApiError(response.status, "UNKNOWN", `La API respondió ${response.status}`);
  }
  return data as T;
}

/**
 * Convierte un error de validación de la API en `{ campo: mensaje }` para mostrar en formularios.
 * Los paths llegan como "/name" o "/address/street" → "name", "address.street".
 */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_ERROR" || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const item of err.details as Array<{ path?: unknown; message?: unknown }>) {
    if (typeof item?.path !== "string" || typeof item.message !== "string") continue;
    const key = item.path.replace(/^\//, "").replaceAll("/", ".") || "_form";
    out[key] ??= item.message;
  }
  return out;
}
