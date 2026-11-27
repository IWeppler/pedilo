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
 * Seguimiento en vivo (ADR 0022). El repartidor comparte su ubicación mientras tiene un reparto
 * en `ACTIVE_COURIER_STATUSES`; el comercio la ve todo ese tiempo y el cliente solo desde que
 * el paquete salió del comercio.
 */
export const CUSTOMER_TRACKING_STATUSES: readonly DeliveryStatus[] = [S.PICKED_UP, S.ARRIVING_DROPOFF];

/** Un punto más viejo que esto no se muestra: el repartidor perdió señal o cerró la app. */
export const COURIER_LOCATION_MAX_AGE_MS = 10 * 60 * 1000;

/** Cada cuánto manda su ubicación la app del repartidor (y a partir de cuántos metros). */
export const COURIER_LOCATION_INTERVAL_MS = 15_000;
export const COURIER_LOCATION_DISTANCE_M = 10;

/**
 * ¿Se puede exponer la dirección exacta de entrega al repartidor?
 * Nunca antes de la asignación (SPEC §9.2).
 */
export function canRevealDropoffAddress(status: DeliveryStatus): boolean {
  return ACTIVE_COURIER_STATUSES.includes(status) || status === S.DELIVERED;
}

// ---------------------------------------------------------------------------
// Repartidores (SPEC §9.2–9.3, ADR 0014)
// ---------------------------------------------------------------------------

export const CourierStatus = {
  /** Se registró; un admin tiene que verificar identidad y vehículo. */
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type CourierStatus = (typeof CourierStatus)[keyof typeof CourierStatus];

export const Vehicle = { WALK: "WALK", BIKE: "BIKE", MOTO: "MOTO", CAR: "CAR" } as const;
export type Vehicle = (typeof Vehicle)[keyof typeof Vehicle];

export const VEHICLE_LABELS: Record<Vehicle, string> = { WALK: "A pie", BIKE: "Bicicleta", MOTO: "Moto", CAR: "Auto" };

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  DELIVERY_NEEDED: "Necesita repartidor",
  OFFERED: "Buscando repartidor",
  OFFER_EXPIRED: "Nadie aceptó",
  ASSIGNED: "Repartidor asignado",
  ARRIVING_PICKUP: "Yendo al comercio",
  PICKED_UP: "Retirado",
  ARRIVING_DROPOFF: "Llegando",
  DELIVERED: "Entregado",
  COURIER_CANCELLED: "El repartidor canceló",
  DELIVERY_FAILED: "No se pudo entregar",
  CANCELLED: "Cancelado",
};

export interface CourierDeliveryAction {
  to: DeliveryStatus;
  label: string;
  tone: "primary" | "neutral" | "danger";
  /** Requiere motivo (cancelar o no poder entregar). */
  needsReason: boolean;
}

/** Lo que puede hacer el repartidor asignado en cada estado. */
export function courierDeliveryActions(status: DeliveryStatus): CourierDeliveryAction[] {
  const cancel: CourierDeliveryAction = { to: S.COURIER_CANCELLED, label: "No puedo hacerlo", tone: "danger", needsReason: true };
  const fail: CourierDeliveryAction = { to: S.DELIVERY_FAILED, label: "No se pudo entregar", tone: "danger", needsReason: true };
  switch (status) {
    case S.ASSIGNED:
      return [
        { to: S.ARRIVING_PICKUP, label: "Voy al comercio", tone: "neutral", needsReason: false },
        { to: S.PICKED_UP, label: "Ya lo retiré", tone: "primary", needsReason: false },
        cancel,
      ];
    case S.ARRIVING_PICKUP:
      return [{ to: S.PICKED_UP, label: "Ya lo retiré", tone: "primary", needsReason: false }, cancel];
    case S.PICKED_UP:
      return [
        { to: S.ARRIVING_DROPOFF, label: "Llegando", tone: "neutral", needsReason: false },
        { to: S.DELIVERED, label: "Entregado", tone: "primary", needsReason: false },
        fail,
      ];
    case S.ARRIVING_DROPOFF:
      return [{ to: S.DELIVERED, label: "Entregado", tone: "primary", needsReason: false }, fail];
    default:
      return [];
  }
}
