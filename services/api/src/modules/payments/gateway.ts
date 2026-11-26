import { MercadoPagoConfig, Payment, PaymentRefund } from "mercadopago";

/**
 * Lo que Pedilo necesita de Mercado Pago (ADR 0021), detrás de una interfaz: así los tests usan un
 * proveedor falso y otro PSP (SPEC §8.1) se puede enchufar sin tocar pedidos ni reclamos.
 */

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** `user_id` de Mercado Pago del comercio. */
  userId: string;
  expiresInSeconds: number;
  liveMode: boolean;
  scope: string | null;
}

export interface CreatePaymentInput {
  /** Pesos con dos decimales como número (la API de Payments usa unidades). */
  transactionAmount: number;
  applicationFee: number;
  token: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: { email: string; identification: { type: string; number: string } };
  description: string;
  externalReference: string;
  notificationUrl: string | null;
}

export interface ProviderPayment {
  id: string;
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  transactionAmount: number;
}

export interface ProviderRefund {
  id: string;
  status: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Error que no se arregla reintentando (4xx): datos inválidos, saldo insuficiente, etc. */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface PaymentGateway {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  createPayment(sellerToken: string, input: CreatePaymentInput, idempotencyKey: string): Promise<ProviderPayment>;
  getPayment(sellerToken: string, paymentId: string): Promise<ProviderPayment>;
  /** `amount` null = total. */
  refund(sellerToken: string, paymentId: string, amount: number | null, idempotencyKey: string): Promise<ProviderRefund>;
}

export interface MercadoPagoSettings {
  appId: string;
  clientSecret: string;
  redirectUri: string;
  /** Pide tokens de prueba del comercio conectado (cuentas de prueba). */
  testMode: boolean;
}

const API = "https://api.mercadopago.com";

function toTokens(json: Record<string, unknown>): OAuthTokens {
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    userId: String(json.user_id),
    expiresInSeconds: Number(json.expires_in ?? 15_552_000),
    liveMode: Boolean(json.live_mode),
    scope: typeof json.scope === "string" ? json.scope : null,
  };
}

function wrapError(err: unknown): GatewayError {
  const e = err as { status?: number; message?: string; cause?: unknown };
  const status = typeof e.status === "number" ? e.status : null;
  return new GatewayError(e.message ?? "Error de Mercado Pago", status, status !== null && status >= 400 && status < 500);
}

const toPayment = (p: { id?: number | string; status?: string; status_detail?: string; external_reference?: string; transaction_amount?: number }): ProviderPayment => ({
  id: String(p.id),
  status: p.status ?? "unknown",
  statusDetail: p.status_detail ?? null,
  externalReference: p.external_reference ?? null,
  transactionAmount: Number(p.transaction_amount ?? 0),
});

/** Implementación real: SDK oficial para pagos y reembolsos; REST para OAuth (necesita `test_token`). */
export function createMercadoPagoGateway(settings: MercadoPagoSettings): PaymentGateway {
  const sdk = (token: string) => new MercadoPagoConfig({ accessToken: token, options: { timeout: 10_000 } });

  async function oauth(body: Record<string, string>): Promise<OAuthTokens> {
    const res = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: settings.appId, client_secret: settings.clientSecret, ...body }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new GatewayError(String(json.message ?? json.error ?? `OAuth HTTP ${res.status}`), res.status, res.status < 500);
    }
    return toTokens(json);
  }

  return {
    authorizationUrl(state) {
      const params = new URLSearchParams({
        client_id: settings.appId,
        response_type: "code",
        platform_id: "mp",
        state,
        redirect_uri: settings.redirectUri,
      });
      return `https://auth.mercadopago.com/authorization?${params.toString()}`;
    },
    exchangeCode: (code) =>
      oauth({
        grant_type: "authorization_code",
        code,
        redirect_uri: settings.redirectUri,
        ...(settings.testMode && { test_token: "true" }),
      }),
    refresh: (refreshToken) => oauth({ grant_type: "refresh_token", refresh_token: refreshToken }),

    async createPayment(sellerToken, input, idempotencyKey) {
      try {
        const res = await new Payment(sdk(sellerToken)).create({
          body: {
            transaction_amount: input.transactionAmount,
            application_fee: input.applicationFee,
            token: input.token,
            payment_method_id: input.paymentMethodId,
            ...(input.issuerId && { issuer_id: Number(input.issuerId) }),
            installments: input.installments,
            payer: { email: input.payer.email, identification: input.payer.identification },
            description: input.description,
            external_reference: input.externalReference,
            ...(input.notificationUrl && { notification_url: input.notificationUrl }),
          },
          requestOptions: { idempotencyKey },
        });
        return toPayment(res);
      } catch (err) {
        throw wrapError(err);
      }
    },

    async getPayment(sellerToken, paymentId) {
      try {
        return toPayment(await new Payment(sdk(sellerToken)).get({ id: paymentId }));
      } catch (err) {
        throw wrapError(err);
      }
    },

    async refund(sellerToken, paymentId, amount, idempotencyKey) {
      try {
        const client = new PaymentRefund(sdk(sellerToken));
        const res =
          amount === null
            ? await client.total({ payment_id: paymentId, requestOptions: { idempotencyKey } })
            : await client.create({ payment_id: paymentId, body: { amount }, requestOptions: { idempotencyKey } });
        return { id: String(res.id), status: String(res.status ?? "approved") };
      } catch (err) {
        throw wrapError(err);
      }
    },
  };
}
