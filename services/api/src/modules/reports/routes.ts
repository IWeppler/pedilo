import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import { merchantEarnings } from "./service";

const totalsSchema = z.object({
  orders: z.number().int().describe("Pedidos completados (entregados o retirados)"),
  salesMinor: z.number().int().describe("Total cobrado por esos pedidos: productos + envío"),
  deliveryFeesMinor: z.number().int().describe("Parte de las ventas que corresponde a envíos"),
  commissionMinor: z.number().int().describe("Comisión Pedilo del período (devengos y ajustes del ledger)"),
  refundsMinor: z.number().int().describe("Devuelto a clientes en reclamos"),
  netMinor: z.number().int().describe("Ventas − comisión − devoluciones"),
  averageTicketMinor: z.number().int().nullable(),
});

const earningsSchema = z.object({
  from: z.string().describe("Primer día del período (YYYY-MM-DD, zona horaria del comercio)"),
  to: z.string().describe("Último día del período (hoy)"),
  timeZone: z.string(),
  totals: totalsSchema,
  previous: totalsSchema.describe("Mismos totales en el período anterior de igual duración, para comparar"),
  salesByPaymentMethod: z.object({ CASH: z.number().int(), TRANSFER: z.number().int(), MERCADO_PAGO: z.number().int() }),
  days: z.array(
    z.object({
      date: z.string(),
      orders: z.number().int(),
      salesMinor: z.number().int(),
      commissionMinor: z.number().int(),
      refundsMinor: z.number().int(),
      netMinor: z.number().int(),
      cumulativeNetMinor: z.number().int().describe("Ganancia neta acumulada desde el primer día del período"),
    }),
  ),
});

export const reportRoutes: FastifyPluginAsyncZod<{ db: Db; timeZone: string }> = async (app, { db, timeZone }) => {
  app.get(
    "/merchants/:merchantId/reports/earnings",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["reports"],
        summary: "Ganancias del comercio por día y acumuladas",
        description:
          "Ventas de pedidos completados, comisión Pedilo y devoluciones por reclamos, día por día en la zona horaria de la liquidación. Incluye los totales del período anterior para comparar.",
        security: [{ bearerAuth: [] }],
        params: z.object({ merchantId: z.uuid() }),
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
        response: { 200: earningsSchema, ...errorResponses },
      },
    },
    (request) =>
      merchantEarnings(db, request.params.merchantId, authOf(request).userId, { days: request.query.days, timeZone }),
  );
};
