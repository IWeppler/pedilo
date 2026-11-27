import * as WebBrowser from "expo-web-browser";

import { API_URL } from "./config";

/**
 * Abre la pantalla de pago con tarjeta (Card Payment Brick, servida por la API) en el navegador
 * del sistema. El token de seguimiento va en el fragmento de la URL: no llega a logs. Al terminar,
 * la página vuelve a `pedilo://order/{id}` y se cierra sola (ADR 0021).
 */
export async function openCardPayment(orderId: string, trackingToken: string): Promise<void> {
  const url = `${API_URL}/pay/${encodeURIComponent(orderId)}#t=${encodeURIComponent(trackingToken)}`;
  await WebBrowser.openAuthSessionAsync(url, "pedilo://");
}
