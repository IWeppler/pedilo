import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
    SUPABASE_URL: z.url().optional(),
    DEV_KEYS_DIR: z.string().default(".dev-keys"),
    /** Firma de los tokens de seguimiento de pedidos (ADR 0007). Obligatorio en producción. */
    ORDER_TOKEN_SECRET: z.string().min(16).optional(),
    /** Minutos que tiene el comercio para aceptar un pedido antes de que venza solo (SPEC §7.1). */
    ORDER_ACCEPT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(240).default(15),
    /** Cada cuántos segundos el worker busca pedidos vencidos. 0 lo desactiva (p. ej. si corre en otro proceso). */
    ORDER_EXPIRY_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
    /** Web Push (ADR 0009). Sin las dos claves, los avisos quedan en la outbox como SKIPPED. Generar con `npm run push:keys`. */
    VAPID_PUBLIC_KEY: z.string().min(20).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    /** Contacto para los servicios de push: `mailto:...` o una URL https. */
    VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "Debe empezar con mailto: o https://").optional(),
    /** Cada cuántos segundos se envían los avisos pendientes. 0 apaga el worker. */
    PUSH_OUTBOX_SWEEP_SECONDS: z.coerce.number().int().min(0).max(3600).default(5),
    /**
     * Detrás de un proxy/balanceador: cuántos saltos confiar para leer la IP real (x-forwarded-for).
     * 0 = no confiar (conexión directa). Sin esto, el límite por IP vería la IP del proxy.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    /** Pedidos nuevos por IP cada 10 minutos (ADR 0010). 0 lo desactiva. */
    ORDER_RATE_LIMIT_PER_IP: z.coerce.number().int().min(0).max(1000).default(6),
    /** Pedidos en curso a la vez por teléfono en un mismo comercio. 0 lo desactiva. */
    ORDER_MAX_ACTIVE_PER_PHONE: z.coerce.number().int().min(0).max(100).default(3),
    /** Pedidos por teléfono en 24 h, en todos los comercios. 0 lo desactiva. */
    ORDER_MAX_DAILY_PER_PHONE: z.coerce.number().int().min(0).max(1000).default(12),
    /** Liquidación semanal (ADR 0013): zona del corte de los lunes 00:00. */
    SETTLEMENT_TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),
    /** Días desde el corte hasta el vencimiento de cada liquidación. */
    SETTLEMENT_DUE_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    /** Cada cuántos minutos el worker intenta cerrar la semana. 0 lo apaga. */
    SETTLEMENT_SWEEP_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
    /** Fotos (ADR 0017): disco local en desarrollo, Supabase Storage en producción. */
    MEDIA_STORAGE: z.enum(["local", "supabase"]).default("local"),
    MEDIA_LOCAL_DIR: z.string().default(".media"),
    /** Clave secreta de Supabase (solo servidor) y bucket público para las fotos. */
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default("media"),
    /** Avisos al cliente por Expo Push (ADR 0020). El token de acceso es opcional. */
    EXPO_PUSH_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    EXPO_ACCESS_TOKEN: z.string().min(10).optional(),
    // 8081/8082: Expo en modo web durante el desarrollo.
    CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://localhost:8081,http://localhost:8082"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "En producción SUPABASE_URL es obligatoria: los tokens locales de desarrollo están prohibidos",
      });
    }
    if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({ code: "custom", path: ["VAPID_PRIVATE_KEY"], message: "VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY van juntas" });
    }
    if (env.NODE_ENV === "production" && env.VAPID_PUBLIC_KEY && !env.VAPID_SUBJECT) {
      ctx.addIssue({ code: "custom", path: ["VAPID_SUBJECT"], message: "En producción VAPID_SUBJECT es obligatorio" });
    }
    if (env.MEDIA_STORAGE === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["SUPABASE_SECRET_KEY"], message: "MEDIA_STORAGE=supabase necesita SUPABASE_URL y SUPABASE_SECRET_KEY" });
    }
    if (env.NODE_ENV === "production" && env.MEDIA_STORAGE === "local") {
      ctx.addIssue({ code: "custom", path: ["MEDIA_STORAGE"], message: "En producción las fotos van a Supabase Storage (MEDIA_STORAGE=supabase)" });
    }
    if (env.NODE_ENV === "production" && !env.ORDER_TOKEN_SECRET) {
      ctx.addIssue({ code: "custom", path: ["ORDER_TOKEN_SECRET"], message: "En producción ORDER_TOKEN_SECRET es obligatorio" });
    }
  });

export interface Config {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  auth: { mode: "supabase"; supabaseUrl: string } | { mode: "local"; devKeysDir: string };
  corsOrigins: string[];
  orderTokenSecret: string;
  orders: { acceptTimeoutMs: number; expirySweepMs: number };
  push: { vapid: { publicKey: string; privateKey: string; subject: string } | null; outboxSweepMs: number };
  trustProxyHops: number;
  limits: OrderLimits;
  settlement: { timeZone: string; dueDays: number; sweepMs: number };
  expoPush: { enabled: boolean; accessToken?: string | undefined };
  media: { driver: "local"; dir: string } | { driver: "supabase"; url: string; secretKey: string; bucket: string };
}

/** Límites anti-abuso de pedidos anónimos (ADR 0010). 0 = desactivado. */
export interface OrderLimits {
  perIpPer10Min: number;
  maxActivePerPhone: number;
  maxDailyPerPhone: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    auth: env.SUPABASE_URL
      ? { mode: "supabase", supabaseUrl: env.SUPABASE_URL.replace(/\/+$/, "") }
      : { mode: "local", devKeysDir: env.DEV_KEYS_DIR },
    orderTokenSecret: env.ORDER_TOKEN_SECRET ?? "dev-only-order-token-secret",
    orders: {
      acceptTimeoutMs: env.ORDER_ACCEPT_TIMEOUT_MINUTES * 60 * 1000,
      expirySweepMs: env.ORDER_EXPIRY_SWEEP_SECONDS * 1000,
    },
    push: {
      vapid:
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? "mailto:dev@localhost" }
          : null,
      outboxSweepMs: env.PUSH_OUTBOX_SWEEP_SECONDS * 1000,
    },
    trustProxyHops: env.TRUST_PROXY_HOPS,
    limits: {
      perIpPer10Min: env.ORDER_RATE_LIMIT_PER_IP,
      maxActivePerPhone: env.ORDER_MAX_ACTIVE_PER_PHONE,
      maxDailyPerPhone: env.ORDER_MAX_DAILY_PER_PHONE,
    },
    settlement: {
      timeZone: env.SETTLEMENT_TIMEZONE,
      dueDays: env.SETTLEMENT_DUE_DAYS,
      sweepMs: env.SETTLEMENT_SWEEP_MINUTES * 60 * 1000,
    },
    expoPush: { enabled: env.EXPO_PUSH_ENABLED, ...(env.EXPO_ACCESS_TOKEN && { accessToken: env.EXPO_ACCESS_TOKEN }) },
    media:
      env.MEDIA_STORAGE === "supabase"
        ? { driver: "supabase", url: env.SUPABASE_URL!.replace(/\/+$/, ""), secretKey: env.SUPABASE_SECRET_KEY!, bucket: env.SUPABASE_STORAGE_BUCKET }
        : { driver: "local", dir: env.MEDIA_LOCAL_DIR },
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
