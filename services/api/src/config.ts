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
    corsOrigins: env.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
