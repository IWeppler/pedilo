import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Cada archivo levanta su propio Postgres en memoria (PGlite) y aplica las migraciones.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
