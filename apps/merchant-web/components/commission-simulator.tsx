"use client";

import type { PlanCode, PricingVersionDoc } from "@pedilo/api-client";
import { calculateCommission, formatARS, hasSinglePlan, type MerchantCategory } from "@pedilo/domain";
import { formatBps, parsePesosToMinor, PLAN_LABELS } from "@pedilo/web-utils";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PLANS: PlanCode[] = ["EMPRENDEDOR", "NEGOCIO", "PRO"];

/**
 * Simulador (SPEC §6.2): comisión de un pedido en cada plan, con los mismos tramos, tope y
 * redondeo que usa la API (`calculateCommission` de @pedilo/domain).
 */
export function CommissionSimulator({
  pricing,
  category,
  currentPlan,
}: {
  pricing: PricingVersionDoc;
  category: MerchantCategory;
  currentPlan: PlanCode;
}) {
  const [raw, setRaw] = useState("25000");
  const [ordersPerMonth, setOrdersPerMonth] = useState("100");
  const basis = parsePesosToMinor(raw);
  const monthly = Number.parseInt(ordersPerMonth, 10);
  const valid = basis !== undefined && Number.isSafeInteger(basis) && basis >= 0;
  // Comisión plana (ADR 0033): una sola fila, sin comparar planes.
  const single = hasSinglePlan(pricing);
  const plans = single ? [currentPlan] : PLANS;
  const cap = pricing.capsByCategory[category];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="sim-amount">Subtotal de productos del pedido ($)</Label>
          <Input id="sim-amount" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} aria-describedby="sim-hint" />
          <p id="sim-hint" className="text-xs text-muted-foreground">
            Sin envío ni propina: la comisión se calcula sobre los productos.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sim-orders">Pedidos por mes (para comparar)</Label>
          <Input id="sim-orders" type="number" min={0} value={ordersPerMonth} onChange={(e) => setOrdersPerMonth(e.target.value)} />
        </div>
      </div>

      {!valid ? (
        <p className="text-sm text-destructive">Ingresá un monto válido.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {!single && <th className="py-2 pr-3 font-medium">Plan</th>}
                <th className="py-2 pr-3 font-medium">{single ? "Comisión" : "Tasa base"}</th>
                <th className="py-2 pr-3 text-right font-medium">Comisión del pedido</th>
                <th className="py-2 pr-3 text-right font-medium">Mensualidad</th>
                <th className="py-2 text-right font-medium">Costo por mes estimado</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const terms = pricing.plans[plan];
                const r = calculateCommission({ basisMinor: basis, baseRateBps: terms.baseRateBps, category, pricing });
                const perMonth = Number.isFinite(monthly) && monthly >= 0 ? r.commissionMinor * monthly + terms.monthlyFeeMinor : null;
                return (
                  <tr key={plan} className={cn("border-b last:border-0", !single && plan === currentPlan && "bg-muted/60")}>
                    {!single && (
                      <td className="py-2 pr-3 font-medium">
                        {PLAN_LABELS[plan]} {plan === currentPlan && <span className="text-xs text-muted-foreground">(tu plan)</span>}
                      </td>
                    )}
                    <td className="py-2 pr-3">{formatBps(terms.baseRateBps)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatARS(r.commissionMinor)}
                      {r.capApplied && <span className="block text-xs text-muted-foreground">tope del rubro</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatARS(terms.monthlyFeeMinor)}</td>
                    <td className="py-2 text-right tabular-nums">{perMonth === null ? "—" : formatARS(perMonth)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            {pricing.brackets.length > 1 && "Tramos: el porcentaje baja sobre el excedente, nunca sobre todo el pedido. "}
            {cap === null ? "Sin tope por pedido. " : `Tope por pedido de tu rubro: ${formatARS(cap)}. `}
            No incluye el costo del procesador de pagos.
          </p>
        </div>
      )}
    </div>
  );
}
