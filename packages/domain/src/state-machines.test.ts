import { describe, expect, it } from "vitest";

import { claimStateMachine, ClaimStatus } from "./claims";
import { canRevealDropoffAddress, deliveryStateMachine, DeliveryStatus } from "./deliveries";
import {
  canTransitionOrder,
  customerCanCancel,
  isOrderFinal,
  merchantOrderActions,
  ORDER_STATUS_LABELS,
  FulfillmentType,
  nextOrderStatuses,
  orderStateMachine,
  OrderStatus,
  orderStatusForDeliveryStatus,
} from "./orders";
import { paymentStateMachine, PaymentStatus } from "./payments";
import { InvalidTransitionError, type StateMachine } from "./state-machine";

const machines: Array<[string, StateMachine<string>]> = [
  ["order", orderStateMachine],
  ["payment", paymentStateMachine],
  ["delivery", deliveryStateMachine],
  ["claim", claimStateMachine],
];

describe.each(machines)("máquina %s — integridad", (_name, machine) => {
  it("todas las transiciones apuntan a estados existentes", () => {
    for (const from of machine.states) {
      for (const to of machine.next(from)) {
        expect(machine.states).toContain(to);
      }
    }
  });

  it("no hay transiciones a sí mismo", () => {
    for (const s of machine.states) expect(machine.next(s)).not.toContain(s);
  });

  it("todo estado no terminal puede llegar a algún terminal", () => {
    for (const start of machine.states) {
      const seen = new Set<string>();
      const queue = [start];
      let reachesTerminal = false;
      while (queue.length > 0) {
        const s = queue.shift()!;
        if (seen.has(s)) continue;
        seen.add(s);
        if (machine.isTerminal(s)) reachesTerminal = true;
        queue.push(...machine.next(s));
      }
      expect(reachesTerminal, `${start} no llega a un estado terminal`).toBe(true);
    }
  });
});

describe("pedido", () => {
  const { PICKUP, DELIVERY } = FulfillmentType;

  it("camino feliz de envío", () => {
    const path = [
      OrderStatus.DRAFT,
      OrderStatus.QUOTED,
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.PICKED_UP_BY_COURIER,
      OrderStatus.DELIVERED,
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransitionOrder(path[i - 1]!, path[i]!, DELIVERY)).toBe(true);
    }
  });

  it("un retiro no puede pasar a 'retirado por repartidor', ni un envío a 'listo para retirar'", () => {
    expect(nextOrderStatuses(OrderStatus.READY, PICKUP)).not.toContain(OrderStatus.PICKED_UP_BY_COURIER);
    expect(nextOrderStatuses(OrderStatus.READY, DELIVERY)).not.toContain(OrderStatus.READY_FOR_PICKUP);
  });

  it("no se acepta un pedido con pago digital sin confirmar", () => {
    expect(orderStateMachine.canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.ACCEPTED)).toBe(false);
  });

  it("una vez retirado por el repartidor ya no se cancela", () => {
    expect(orderStateMachine.canTransition(OrderStatus.PICKED_UP_BY_COURIER, OrderStatus.CANCELLED)).toBe(false);
  });

  it("assertTransition lanza un error descriptivo", () => {
    expect(() => orderStateMachine.assertTransition(OrderStatus.DELIVERED, OrderStatus.PREPARING)).toThrow(
      InvalidTransitionError,
    );
  });

  it("solo retiro, entrega y falla del delivery mueven el estado del pedido", () => {
    expect(orderStatusForDeliveryStatus(DeliveryStatus.PICKED_UP)).toBe(OrderStatus.PICKED_UP_BY_COURIER);
    expect(orderStatusForDeliveryStatus(DeliveryStatus.DELIVERED)).toBe(OrderStatus.DELIVERED);
    expect(orderStatusForDeliveryStatus(DeliveryStatus.DELIVERY_FAILED)).toBe(OrderStatus.DELIVERY_FAILED);
    expect(orderStatusForDeliveryStatus(DeliveryStatus.OFFERED)).toBeNull();
    expect(orderStatusForDeliveryStatus(DeliveryStatus.COURIER_CANCELLED)).toBeNull();
  });
});

describe("pago", () => {
  it("un reembolso requiere confirmación: no se pasa de aprobado a reembolsado directo", () => {
    expect(paymentStateMachine.canTransition(PaymentStatus.APPROVED, PaymentStatus.REFUNDED)).toBe(false);
  });

  it("reembolso bloqueado por saldo puede reintentarse o ir a revisión manual", () => {
    expect(paymentStateMachine.next(PaymentStatus.REFUND_BLOCKED)).toEqual([
      PaymentStatus.REFUND_PENDING,
      PaymentStatus.MANUAL_REVIEW,
    ]);
  });
});

describe("delivery", () => {
  it("con el paquete en manos del repartidor no se cancela", () => {
    expect(deliveryStateMachine.canTransition(DeliveryStatus.PICKED_UP, DeliveryStatus.CANCELLED)).toBe(false);
  });

  it("si nadie acepta la oferta se puede volver a ofertar o asignar propio", () => {
    expect(deliveryStateMachine.next(DeliveryStatus.OFFER_EXPIRED)).toEqual(
      expect.arrayContaining([DeliveryStatus.OFFERED, DeliveryStatus.ASSIGNED]),
    );
  });

  it("la dirección exacta no se revela antes de la asignación", () => {
    expect(canRevealDropoffAddress(DeliveryStatus.OFFERED)).toBe(false);
    expect(canRevealDropoffAddress(DeliveryStatus.DELIVERY_NEEDED)).toBe(false);
    expect(canRevealDropoffAddress(DeliveryStatus.ASSIGNED)).toBe(true);
  });
});

describe("reclamo", () => {
  it("un reclamo nuevo pasa primero por el comercio o se escala", () => {
    expect(claimStateMachine.next(ClaimStatus.OPEN)).toEqual([ClaimStatus.MERCHANT_REVIEW, ClaimStatus.ESCALATED]);
  });
});

describe("acciones del comercio sobre pedidos", () => {
  const all = Object.values(OrderStatus);

  it("cada acción ofrecida es una transición válida para esa forma de entrega", () => {
    for (const fulfillment of [FulfillmentType.PICKUP, FulfillmentType.DELIVERY]) {
      for (const status of all) {
        for (const action of merchantOrderActions(status, fulfillment)) {
          expect(canTransitionOrder(status, action.to, fulfillment), `${status} → ${action.to} (${fulfillment})`).toBe(true);
        }
      }
    }
  });

  it("los estados finales no tienen acciones; rechazar y cancelar piden motivo", () => {
    for (const status of all.filter(isOrderFinal)) expect(merchantOrderActions(status, FulfillmentType.PICKUP)).toEqual([]);
    const placed = merchantOrderActions(OrderStatus.PLACED, FulfillmentType.DELIVERY);
    expect(placed.find((a) => a.to === OrderStatus.REJECTED)?.needsReason).toBe(true);
  });

  it("el cliente cancela solo antes de la aceptación", () => {
    expect(customerCanCancel(OrderStatus.PLACED)).toBe(true);
    expect(customerCanCancel(OrderStatus.ACCEPTED)).toBe(false);
  });

  it("todos los estados tienen texto", () => {
    for (const status of all) expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
  });
});
