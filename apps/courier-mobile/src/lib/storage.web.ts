/** Versión web de `storage.ts`: localStorage (solo para probar la app en el navegador). */
export const kv = {
  get: async (key: string): Promise<string | null> => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string): Promise<void> => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Sin almacenamiento disponible (modo privado).
    }
  },
  remove: async (key: string): Promise<void> => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Sin almacenamiento disponible.
    }
  },
};
