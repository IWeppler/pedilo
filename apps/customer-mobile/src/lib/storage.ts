import Storage from "expo-sqlite/kv-store";

/**
 * Almacenamiento clave-valor del teléfono (expo-sqlite kv-store, incluido en Expo Go).
 * En web se usa `storage.web.ts` (localStorage): expo-sqlite en web requiere WebAssembly.
 */
export const kv = {
  get: (key: string): Promise<string | null> => Storage.getItem(key),
  set: (key: string, value: string): Promise<void> => Storage.setItem(key, value),
};
