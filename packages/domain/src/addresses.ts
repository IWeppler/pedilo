/**
 * Direcciones guardadas del cliente (ADR 0034): Casa, Trabajo y otras, hasta 5. En cada pedido el
 * cliente confirma desde dónde pide; si el GPS lo ubica lejos de la elegida, la app sugiere cambiarla.
 */

export const MAX_CUSTOMER_ADDRESSES = 5;

/** A partir de esta distancia entre el GPS y la dirección elegida, la app pregunta si cambiarla. */
export const FAR_FROM_ADDRESS_METERS = 300;

export type AddressLabel = "HOME" | "WORK" | "OTHER";

export const ADDRESS_LABELS: Record<AddressLabel, string> = { HOME: "Casa", WORK: "Trabajo", OTHER: "Otra" };

/** Cómo se nombra una dirección: «Casa», «Trabajo», o el nombre de la otra («Casa de mamá»). */
export function addressTitle(a: { label: AddressLabel; name: string | null }): string {
  return a.label === "OTHER" ? a.name?.trim() || ADDRESS_LABELS.OTHER : ADDRESS_LABELS[a.label];
}
