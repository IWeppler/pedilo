"use client";

import type { MerchantBilling } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { COMMISSION_ENTRY_LABELS, formatBps, formatDateTime, formKey, initialFormState, PLAN_LABELS } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { addAdjustment, changePlan } from "./billing-actions";

/** Plan, saldo de comisiones y ajustes de un comercio (ADR 0012). */
export function BillingCard({ merchantId, billing: b }: { merchantId: string; billing: MerchantBilling }) {
  const [planState, planAction] = useActionState(changePlan.bind(null, merchantId), initialFormState);
  const [adjState, adjAction] = useActionState(addAdjustment.bind(null, merchantId), initialFormState);
  const err = adjState.fieldErrors ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan y comisiones</CardTitle>
        <CardDescription>
          Plan {PLAN_LABELS[b.plan.code]} ({formatBps(b.plan.baseRateBps)}, {formatARS(b.plan.monthlyFeeMinor)}/mes) · tope{" "}
          {formatARS(b.capMinor)} · pricing {b.pricing.id}
          {b.categoryDefaulted && " · el rubro no tiene categoría de comisión: se usa la de emprendedores"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <p className="text-sm">
          Saldo adeudado: <span className="text-lg font-semibold tabular-nums">{formatARS(b.balanceMinor)}</span>
        </p>

        <div className="grid gap-6 md:grid-cols-2">
          <form key={formKey(planState.values)} action={planAction} className="grid content-start gap-3">
            <h3 className="text-sm font-medium">Cambiar plan</h3>
            {planState.message && (
              <Alert variant="destructive">
                <AlertDescription>{planState.message}</AlertDescription>
              </Alert>
            )}
            {planState.saved && <p className="text-sm text-emerald-700">Plan actualizado.</p>}
            <FormField id="plan" label="Plan">
              <NativeSelect id="plan" name="plan" defaultValue={b.plan.code}>
                {(["EMPRENDEDOR", "NEGOCIO", "PRO"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABELS[p]} · {formatBps(b.pricing.plans[p].baseRateBps)} · {formatARS(b.pricing.plans[p].monthlyFeeMinor)}/mes
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="reason" label="Motivo (opcional)" hint="Rige desde ahora: los pedidos anteriores no cambian.">
              <Input {...fieldA11y("reason", undefined, true)} maxLength={300} defaultValue={planState.values?.reason ?? ""} />
            </FormField>
            <div>
              <SubmitButton pendingText="Guardando…">Cambiar plan</SubmitButton>
            </div>
          </form>

          <form key={formKey(adjState.values)} action={adjAction} className="grid content-start gap-3">
            <h3 className="text-sm font-medium">Ajuste manual</h3>
            {adjState.message && (
              <Alert variant="destructive">
                <AlertDescription>{adjState.message}</AlertDescription>
              </Alert>
            )}
            {adjState.saved && <p className="text-sm text-emerald-700">Ajuste registrado.</p>}
            <div className="grid grid-cols-2 gap-3">
              <FormField id="direction" label="Tipo">
                <NativeSelect id="direction" name="direction" defaultValue={adjState.values?.direction ?? "credit"}>
                  <option value="credit">Crédito (resta deuda)</option>
                  <option value="charge">Cargo (suma deuda)</option>
                </NativeSelect>
              </FormField>
              <FormField id="amount" label="Monto ($)" error={err.amount ?? err.amountMinor}>
                <Input {...fieldA11y("amount", err.amount)} inputMode="decimal" required defaultValue={adjState.values?.amount ?? ""} />
              </FormField>
            </div>
            <FormField id="description" label="Motivo" error={err.description} hint="Lo ve el comercio en sus movimientos.">
              <Input
                {...fieldA11y("description", err.description, true)}
                required
                minLength={3}
                maxLength={300}
                defaultValue={adjState.values?.description ?? ""}
              />
            </FormField>
            <div>
              <SubmitButton pendingText="Registrando…">Registrar ajuste</SubmitButton>
            </div>
          </form>
        </div>

        {b.entries.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 pr-3 font-medium">Concepto</th>
                <th className="py-2 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {b.entries.slice(0, 20).map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                  <td className="py-1.5 pr-3">
                    <span className="text-muted-foreground">{COMMISSION_ENTRY_LABELS[e.kind]} · </span>
                    {e.description}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatARS(e.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
