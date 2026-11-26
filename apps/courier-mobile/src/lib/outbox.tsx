import { ApiError, unwrap } from "@pedilo/api-client";
import type { DeliveryStatus } from "@pedilo/domain";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { api } from "./api";
import { kv } from "./storage";

/**
 * Cola persistente de cambios de estado (SPEC §9.3): cada acción del repartidor («retirado»,
 * «entregado»…) se guarda en el teléfono con un `eventId` y se manda en orden. Sin señal queda
 * pendiente y se reintenta al volver la conexión o al abrir la app; el servidor deduplica por
 * `eventId`, así un reintento nunca duplica nada.
 *
 * Lo pendiente se muestra como pendiente: nunca como confirmado.
 */

export interface PendingAction {
  eventId: string;
  deliveryId: string;
  to: DeliveryStatus;
  reason: string | null;
  /** PIN de entrega que dio el cliente (solo para «entregado»). */
  pin?: string | null;
  createdAt: string;
}

interface OutboxValue {
  pending: PendingAction[];
  /** Último rechazo del servidor (acción inválida, reparto cancelado…), para mostrarlo. */
  rejected: { action: PendingAction; message: string } | null;
  enqueue: (deliveryId: string, to: DeliveryStatus, reason?: string | null, pin?: string | null) => Promise<void>;
  flush: () => Promise<void>;
  dismissRejected: () => void;
}

const KEY = "pedilo.courier.outbox";
const RETRY_MS = 10_000;
const OutboxContext = createContext<OutboxValue | null>(null);

const newEventId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export function OutboxProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [rejected, setRejected] = useState<OutboxValue["rejected"]>(null);
  const queue = useRef<PendingAction[]>([]);
  const flushing = useRef(false);

  const persist = useCallback(async (next: PendingAction[]) => {
    queue.current = next;
    setPending(next);
    await kv.set(KEY, JSON.stringify(next));
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (queue.current.length > 0) {
        const action = queue.current[0]!;
        try {
          await unwrap(
            api.POST("/v1/courier/deliveries/{deliveryId}/status", {
              params: { path: { deliveryId: action.deliveryId } },
              body: { to: action.to, reason: action.reason, eventId: action.eventId, ...(action.pin && { pin: action.pin }) },
            }),
          );
        } catch (err) {
          // Sin conexión o error del servidor: se reintenta más tarde, en el mismo orden.
          if (!(err instanceof ApiError) || err.status >= 500 || err.status === 401) break;
          // El servidor la rechazó (4xx): reintentar no sirve. Se descarta y se avisa.
          setRejected({ action, message: err.message });
        }
        await persist(queue.current.slice(1));
        await queryClient.invalidateQueries({ queryKey: ["courier", "deliveries"] });
      }
    } finally {
      flushing.current = false;
    }
  }, [persist, queryClient]);

  // Al abrir la app: recuperar lo que quedó sin mandar.
  useEffect(() => {
    void (async () => {
      const raw = await kv.get(KEY);
      queue.current = raw ? (JSON.parse(raw) as PendingAction[]) : [];
      setPending(queue.current);
      void flush();
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void flush();
    });
    return () => sub.remove();
  }, [flush]);

  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => void flush(), RETRY_MS);
    return () => clearInterval(id);
  }, [pending.length, flush]);

  const enqueue = useCallback(
    async (deliveryId: string, to: DeliveryStatus, reason: string | null = null, pin: string | null = null) => {
      await persist([...queue.current, { eventId: newEventId(), deliveryId, to, reason, pin, createdAt: new Date().toISOString() }]);
      await flush();
    },
    [persist, flush],
  );

  const value = useMemo(
    () => ({ pending, rejected, enqueue, flush, dismissRejected: () => setRejected(null) }),
    [pending, rejected, enqueue, flush],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxValue {
  const value = useContext(OutboxContext);
  if (!value) throw new Error("useOutbox fuera de OutboxProvider");
  return value;
}
