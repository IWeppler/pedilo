import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Connection {
  available: boolean;
  connected: boolean;
  status: "CONNECTED" | "NEEDS_REAUTH" | null;
  liveMode: boolean | null;
  connectedAt: string | null;
}

/**
 * Cobro con tarjeta (ADR 0021): el comercio conecta su cuenta de Mercado Pago. La plata entra a su
 * cuenta y Mercado Pago le descuenta la comisión de Pedilo en el momento.
 */
export function MercadoPagoCard({
  connection,
  result,
  connect,
  disconnect,
}: {
  connection: Connection;
  result: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Tarjeta con Mercado Pago
          {connection.connected && <Badge>Conectado{connection.liveMode === false ? " · prueba" : ""}</Badge>}
        </CardTitle>
        <CardDescription>
          Tus clientes pagan con tarjeta en la app. La plata entra a tu cuenta de Mercado Pago y la comisión de Pedilo se descuenta
          en el momento (no se suma a tu liquidación semanal).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result === "connected" && (
          <Alert>
            <AlertDescription>¡Listo! Tu cuenta de Mercado Pago quedó conectada y ya podés recibir pagos con tarjeta.</AlertDescription>
          </Alert>
        )}
        {result === "error" && (
          <Alert variant="destructive">
            <AlertDescription>No se pudo conectar la cuenta. Probá de nuevo; el link vence a los 10 minutos.</AlertDescription>
          </Alert>
        )}
        {connection.status === "NEEDS_REAUTH" && (
          <Alert variant="destructive">
            <AlertDescription>La conexión venció: volvé a conectar tu cuenta para seguir cobrando con tarjeta.</AlertDescription>
          </Alert>
        )}
        {!connection.available ? (
          <p className="text-sm text-muted-foreground">El pago con tarjeta todavía no está habilitado en Pedilo.</p>
        ) : connection.connected ? (
          <form action={disconnect}>
            <SubmitButton variant="outline">Desconectar Mercado Pago</SubmitButton>
          </form>
        ) : (
          <form action={connect}>
            <SubmitButton>Conectar Mercado Pago</SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
