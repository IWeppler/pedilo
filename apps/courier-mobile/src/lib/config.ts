import Constants from "expo-constants";

/**
 * URL de la API.
 * - `EXPO_PUBLIC_API_URL` si está definida (staging/producción o una IP fija).
 * - En desarrollo, el mismo host que sirve Metro (`hostUri`, p. ej. "192.168.1.5:8081") con el
 *   puerto 4000: así el celular con Expo Go llega a la API que corre en la notebook sin configurar nada.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host || "localhost"}:4000`;
}

export const API_URL = resolveApiUrl();
