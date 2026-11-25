import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Cada archivo levanta su propio Postgres en memoria (PGlite) y aplica las migraciones.
    testTimeout: 20_000,
    // Inicializar PGlite (WASM) en muchos workers a la vez satura la CPU en el arranque en frío:
    // con 10+ archivos en paralelo algún beforeAll pasaba los 60 s. Pocos workers y más margen.
    hookTimeout: 120_000,
    maxWorkers: 4,
  },
});
