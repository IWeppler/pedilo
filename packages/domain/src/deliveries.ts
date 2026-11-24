import { defineStateMachine } from "./state-machine";

/**
 * Reparto (servicio logístico). SPEC §9.0 y §9.2.
 *
 * Este módulo NO conoce los pedidos: no importa nada de `orders.ts`.
 * Un delivery puede existir sin pedido del marketplace (`source = MERCHANT_REQUEST`).
 */

export const DeliverySource = {
  /** Creado a partir de un pedido de Pedilo (único caso habilitado en el MVP). */
  ORDER: "ORDER",
  /** Solicitado por un comercio para una venta de otro canal (posterior al MVP). */
  MERCHANT_REQUEST: "MERCHANT_REQUEST",
} as const;
export type DeliverySource = (typeof DeliverySource)[keyof typeof DeliverySource];

export const DeliveryStatus = {
  DELIVERY_NEEDED: "DELIVERY_NEEDED",
  OFFERED: "OFFERED",
  OFFER_EXPIRED: "OFFER_EXPIRED",
  ASSIGNED: "ASSIGNED",
  ARRIVING_PICKUP: "ARRIVING_PICKUP",
  PICKED_UP: "PICKED_UP",
  ARRIVING_DROPOFF: "ARRIVING_DROPOFF",
  DELIVERED: "DELIVERED",
  COURIER_CANCELLED: "COURIER_CANCELLED",
  DELIVERY_FAILED: "DELIVERY_FAILED",
  /** Cancelado por el comercio o porque se canceló el pedido de origen. */
  CANCELLED: "CANCELLED",
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

const S = DeliveryStatus;

export const deliveryStateMachine = defineStateMachine<DeliveryStatus>("delivery", {
  // ASSIGNED directo = el comercio asigna un repartidor propio sin publicar oferta.
  [S.DELIVERY_NEEDED]: [S.OFFERED, S.ASSIGNED, S.CANCELLED],
  [S.OFFERED]: [S.ASSIGNED, S.OFFER_EXPIRED, S.CANCELLED],
  // Si nadie aceptó: se vuelve a ofertar (p. ej. con más tarifa), se asigna propio o se cancela.
  [S.OFFER_EXPIRED]: [S.OFFERED, S.ASSIGNED, S.CANCELLED],
  [S.ASSIGNED]: [S.ARRIVING_PICKUP, S.PICKED_UP, S.COURIER_CANCELLED, S.CANCELLED],
  [S.ARRIVING_PICKUP]: [S.PICKED_UP, S.COURIER_CANCELLED, S.CANCELLED],
  // Reasignación controlada tras cancelación del repartidor.
  [S.COURIER_CANCELLED]: [S.OFFERED, S.ASSIGNED, S.CANCELLED],
  // Con el paquete en manos del repartidor ya no se "cancela": termina entregado o fallido.
  [S.PICKED_UP]: [S.ARRIVING_DROPOFF, S.DELIVERED, S.DELIVERY_FAILED],
  [S.ARRIVING_DROPOFF]: [S.DELIVERED, S.DELIVERY_FAILED],
  [S.DELIVERED]: [],
  [S.DELIVERY_FAILED]: [],
  [S.CANCELLED]: [],
});

/** Estados en los que hay un repartidor asignado y activo sobre el delivery. */
export const ACTIVE_COURIER_STATUSES: readonly DeliveryStatus[] = [
  S.ASSIGNED,
  S.ARRIVING_PICKUP,
  S.PICKED_UP,
  S.ARRIVING_DROPOFF,
];

/**
 * ¿Se puede exponer la dirección exacta de entrega al repartidor?
 * Nunca antes de la asignación (SPEC §9.2).
 */
export function canRevealDropoffAddress(status: DeliveryStatus): boolean {
  return ACTIVE_COURIER_STATUSES.includes(status) || status === S.DELIVERED;
}
