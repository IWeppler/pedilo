import { DeliveryStatus } from "./deliveries";
import { defineStateMachine } from "./state-machine";

/**
 * Pedido comercial. SPEC §7.
 *
 * Los estados de pedido y de pago son máquinas independientes: los reembolsos viven en
 * `PaymentStatus` (payments.ts), no acá, para que un pedido entregado siga figurando como
 * entregado aunque después tenga un reembolso parcial.
 */

export const FulfillmentType = {
  PICKUP: "PICKUP",
  DELIVERY: "DELIVERY",
} as const;
export type FulfillmentType = (typeof FulfillmentType)[keyof typeof FulfillmentType];

export const OrderStatus = {
  DRAFT: "DRAFT",
  QUOTED: "QUOTED",
  /** Pago digital iniciado, esperando confirmación servidor a servidor. */
  PENDING_PAYMENT: "PENDING_PAYMENT",
  /** Pedido enviado al comercio (pago digital confirmado, o efectivo/transferencia). */
  PLACED: "PLACED",
  ACCEPTED: "ACCEPTED",
  PREPARING: "PREPARING",
  READY: "READY",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  PICKED_UP: "PICKED_UP",
  PICKED_UP_BY_COURIER: "PICKED_UP_BY_COURIER",
  DELIVERED: "DELIVERED",
  DELIVERY_FAILED: "DELIVERY_FAILED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

const S = OrderStatus;

export const orderStateMachine = defineStateMachine<OrderStatus>("order", {
  [S.DRAFT]: [S.QUOTED, S.CANCELLED],
  // La cotización tiene duración limitada.
  [S.QUOTED]: [S.PENDING_PAYMENT, S.PLACED, S.EXPIRED, S.CANCELLED],
  // Pasa a PLACED solo con confirmación verificada del PSP (webhook + consulta).
  [S.PENDING_PAYMENT]: [S.PLACED, S.EXPIRED, S.CANCELLED],
  // EXPIRED = el comercio no aceptó dentro del plazo configurado.
  [S.PLACED]: [S.ACCEPTED, S.REJECTED, S.EXPIRED, S.CANCELLED],
  [S.ACCEPTED]: [S.PREPARING, S.CANCELLED],
  [S.PREPARING]: [S.READY, S.CANCELLED],
  [S.READY]: [S.READY_FOR_PICKUP, S.PICKED_UP_BY_COURIER, S.CANCELLED],
  [S.READY_FOR_PICKUP]: [S.PICKED_UP, S.CANCELLED],
  [S.PICKED_UP_BY_COURIER]: [S.DELIVERED, S.DELIVERY_FAILED],
  [S.PICKED_UP]: [],
  [S.DELIVERED]: [],
  [S.DELIVERY_FAILED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
  [S.EXPIRED]: [],
});

/** Estados que solo tienen sentido para una modalidad de entrega. */
const PICKUP_ONLY: readonly OrderStatus[] = [S.READY_FOR_PICKUP, S.PICKED_UP];
const DELIVERY_ONLY: readonly OrderStatus[] = [S.PICKED_UP_BY_COURIER, S.DELIVERED, S.DELIVERY_FAILED];

/** Próximos estados válidos teniendo en cuenta si el pedido es retiro o envío. */
export function nextOrderStatuses(
  from: OrderStatus,
  fulfillment: FulfillmentType,
): readonly OrderStatus[] {
  const excluded = fulfillment === FulfillmentType.PICKUP ? DELIVERY_ONLY : PICKUP_ONLY;
  return orderStateMachine.next(from).filter((s) => !excluded.includes(s));
}

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: FulfillmentType,
): boolean {
  return nextOrderStatuses(from, fulfillment).includes(to);
}

// ---------------------------------------------------------------------------
// Textos y acciones (compartidos por el panel del comercio y la app del cliente)
// ---------------------------------------------------------------------------

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "Borrador",
  QUOTED: "Cotizado",
  PENDING_PAYMENT: "Esperando el pago",
  PLACED: "Esperando confirmación",
  ACCEPTED: "Aceptado",
  PREPARING: "En preparación",
  READY: "Listo",
  READY_FOR_PICKUP: "Listo para retirar",
  PICKED_UP: "Retirado",
  PICKED_UP_BY_COURIER: "En camino",
  DELIVERED: "Entregado",
  DELIVERY_FAILED: "No se pudo entregar",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
  EXPIRED: "Vencido",
};

/**
 * Lo que ve el cliente. La aceptación sigue siendo manual (ADR 0008), pero el cliente no ve la
 * espera: desde que el pedido llega al comercio dice «Pedido confirmado». Si el comercio lo
 * rechaza o no responde, pasa a rechazado o vencido como siempre.
 */
export const CUSTOMER_ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ...ORDER_STATUS_LABELS,
  PLACED: "Pedido confirmado",
  ACCEPTED: "Pedido confirmado",
  EXPIRED: "No se pudo tomar",
};

/** Para el seguimiento del cliente, «recibido» y «aceptado» son el mismo paso. */
export const customerOrderStep = (status: OrderStatus): OrderStatus => (status === "ACCEPTED" ? "PLACED" : status);

export const isOrderFinal = (status: OrderStatus) => orderStateMachine.isTerminal(status);

/** El cliente solo puede cancelar mientras el comercio no lo aceptó (ADR 0007). */
export const customerCanCancel = (status: OrderStatus) => status === S.PLACED;

export interface MerchantOrderAction {
  to: OrderStatus;
  label: string;
  tone: "primary" | "neutral" | "danger";
  /** Requiere motivo (lo ve el cliente). */
  needsReason: boolean;
}

/**
 * Acciones del comercio en cada estado. Al marcar "listo" un pedido de retiro, la API lo pasa
 * además a READY_FOR_PICKUP en el mismo paso (avisa al cliente que puede ir a buscarlo).
 */
export function merchantOrderActions(status: OrderStatus, fulfillment: FulfillmentType): MerchantOrderAction[] {
  const pickup = fulfillment === FulfillmentType.PICKUP;
  // Estados que no existen para esta forma de entrega: sin acciones.
  if ((pickup ? DELIVERY_ONLY : PICKUP_ONLY).includes(status)) return [];
  const cancel: MerchantOrderAction = { to: S.CANCELLED, label: "Cancelar pedido", tone: "danger", needsReason: true };
  switch (status) {
    case S.PLACED:
      return [
        { to: S.ACCEPTED, label: "Aceptar", tone: "primary", needsReason: false },
        { to: S.REJECTED, label: "Rechazar", tone: "danger", needsReason: true },
      ];
    case S.ACCEPTED:
      return [{ to: S.PREPARING, label: "Empezar a preparar", tone: "primary", needsReason: false }, cancel];
    case S.PREPARING:
      return [
        { to: S.READY, label: pickup ? "Listo para retirar" : "Listo para enviar", tone: "primary", needsReason: false },
        cancel,
      ];
    case S.READY:
      return pickup
        ? [{ to: S.READY_FOR_PICKUP, label: "Avisar que está listo", tone: "primary", needsReason: false }, cancel]
        : [{ to: S.PICKED_UP_BY_COURIER, label: "Salió el envío", tone: "primary", needsReason: false }, cancel];
    case S.READY_FOR_PICKUP:
      return [{ to: S.PICKED_UP, label: "Lo retiró", tone: "primary", needsReason: false }, cancel];
    case S.PICKED_UP_BY_COURIER:
      return [
        { to: S.DELIVERED, label: "Entregado", tone: "primary", needsReason: false },
        { to: S.DELIVERY_FAILED, label: "No se pudo entregar", tone: "danger", needsReason: true },
      ];
    default:
      return [];
  }
}

/**
 * Traduce un evento del delivery al estado del pedido (SPEC §9.0).
 * Devuelve `null` si ese cambio del delivery no mueve el estado del pedido
 * (p. ej. ofertas o reasignaciones: siguen siendo asunto del reparto).
 *
 * El sentido de la dependencia es único: pedidos conoce los estados del reparto,
 * el reparto nunca conoce los del pedido.
 */
export function orderStatusForDeliveryStatus(status: DeliveryStatus): OrderStatus | null {
  switch (status) {
    case DeliveryStatus.PICKED_UP:
      return S.PICKED_UP_BY_COURIER;
    case DeliveryStatus.DELIVERED:
      return S.DELIVERED;
    case DeliveryStatus.DELIVERY_FAILED:
      return S.DELIVERY_FAILED;
    default:
      return null;
  }
}
