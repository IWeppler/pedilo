import { ApiError, unwrap } from "@pedilo/api-client";
import { type NextRequest, NextResponse } from "next/server";

import { apiClient } from "@/lib/api";
import { getToken } from "@/lib/session";

/**
 * Pulso del tablero (SPEC §10): el navegador lo consulta cada pocos segundos. Pasa por acá
 * porque el token vive en una cookie httpOnly y el navegador no lo ve.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/m/[merchantId]/orders/pulse">) {
  const { merchantId } = await ctx.params;
  const token = await getToken();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const pulse = await unwrap(
      apiClient(token).GET("/v1/merchants/{merchantId}/orders/pulse", { params: { path: { merchantId } } }),
    );
    return NextResponse.json(pulse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    return NextResponse.json({ error: "pulse_failed" }, { status });
  }
}
