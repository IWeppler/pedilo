import type { MerchantDetail } from "@pedilo/api-client";

/**
 * El local del comercio. Por detrás es una sucursal: el panel trabaja con una sola (la activa, o
 * la primera si ninguna lo está) aunque la API admita varias.
 */
export function mainLocation(merchant: MerchantDetail) {
  return merchant.branches.find((b) => b.active) ?? merchant.branches[0];
}
