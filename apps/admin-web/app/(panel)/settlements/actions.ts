"use server";

import { errorToFormState, type FormState, formValues, optionalText, parsePesosToMinor, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { adminCall } from "@/lib/api";

/** Cierra la última semana a mano (el worker lo hace solo los lunes). */
export async function closeWeek(): Promise<FormState> {
  let created: number;
  try {
    ({ created } = await adminCall((api) => api.POST("/v1/admin/settlements/close")));
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath("/settlements");
  return { saved: true, message: created === 0 ? "No había nada nuevo para liquidar." : `Se emitieron ${created} liquidaciones.` };
}

/** Registra un pago del comercio contra una liquidación (monto en pesos). */
export async function recordPayment(settlementId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const amount = parsePesosToMinor(text(formData, "amount"));
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) {
    return { message: "Revisá los campos marcados.", fieldErrors: { amount: "Monto inválido" }, values };
  }
  const paidOn = optionalText(formData, "paidOn");
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/settlements/{settlementId}/payments", {
        params: { path: { settlementId } },
        body: {
          amountMinor: amount,
          method: text(formData, "method") as "TRANSFER" | "CASH" | "OTHER",
          reference: optionalText(formData, "reference") ?? null,
          // Fecha sin hora: mediodía en Argentina, para que no cambie de día por la zona horaria.
          ...(paidOn && { paidAt: `${paidOn}T12:00:00-03:00` }),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/settlements/${settlementId}`);
  revalidatePath("/settlements");
  return { saved: true };
}
