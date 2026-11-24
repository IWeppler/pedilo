import { ApiError, fieldErrors, unwrap } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Centered, Chip, Loading } from "@/components/ui";
import { api, useMerchantMenu } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useMyOrders } from "@/lib/my-orders";
import { space, useTheme } from "@/lib/theme";

const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** Mensajes para los errores de negocio de POST /v1/public/orders (ADR 0007). */
const REASON_MESSAGES: Record<string, string> = {
  BRANCH_CLOSED: "El comercio cerró hace un momento. Probá más tarde.",
  PRODUCT_UNAVAILABLE: "Un producto de tu pedido ya no está disponible. Sacalo y probá de nuevo.",
  ITEM_INVALID: "Un producto cambió en el menú. Sacalo y volvé a agregarlo.",
  MIN_ORDER_NOT_MET: "No llegás al pedido mínimo de la zona.",
  PICKUP_NOT_AVAILABLE: "El comercio no acepta retiro en el local.",
  DELIVERY_NOT_AVAILABLE: "El comercio no hace envíos.",
};

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { cart, subtotalMinor, setQuantity, remove, clear } = useCart();
  const { contact, setContact, save } = useMyOrders();
  const menu = useMerchantMenu(cart?.merchantSlug ?? "");

  const branch = menu.data?.merchant.branches.find((b) => b.id === cart?.branchId);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY" | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone);
  const [addressLine, setAddressLine] = useState(contact.addressLine);
  const [addressNotes, setAddressNotes] = useState(contact.addressNotes);
  const [notes, setNotes] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);

  // Valores efectivos (defaults según lo que ofrece la sucursal).
  const mode = fulfillment ?? (branch?.acceptsPickup ? "PICKUP" : branch?.acceptsDelivery ? "DELIVERY" : null);
  const zone = branch?.zones.find((z) => z.id === zoneId) ?? branch?.zones[0];
  const deliveryFee = mode === "DELIVERY" ? (zone?.feeMinor ?? 0) : 0;
  const belowMinimum = mode === "DELIVERY" && zone ? subtotalMinor < zone.minOrderMinor : false;

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/public/orders", {
          params: { header: { "idempotency-key": idempotencyKey } },
          body: {
            merchantSlug: cart!.merchantSlug,
            branchId: cart!.branchId,
            fulfillmentType: mode!,
            ...(mode === "DELIVERY" && {
              deliveryZoneId: zone?.id,
              deliveryAddress: { line: addressLine.trim(), notes: addressNotes.trim() || null },
            }),
            customer: { name: name.trim(), phone: phone.trim() },
            notes: notes.trim() || null,
            items: cart!.lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              modifiers: l.modifiers.map((m) => ({ modifierId: m.modifierId, quantity: m.quantity })),
              quantity: l.quantity,
              notes: l.notes,
            })),
          },
        }),
      ),
    onSuccess: ({ order, trackingToken }) => {
      save({ id: order.id, token: trackingToken, code: order.code, merchantName: order.merchant.name, createdAt: order.createdAt });
      setContact({ name: name.trim(), phone: phone.trim(), addressLine: addressLine.trim(), addressNotes: addressNotes.trim() });
      clear();
      router.replace({ pathname: "/order/[id]", params: { id: order.id } });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        const reason = (err.details as { reason?: string } | undefined)?.reason;
        setError((reason && REASON_MESSAGES[reason]) ?? err.message);
      } else if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
        const fields = Object.keys(fieldErrors(err));
        const labels = fields.map((f) =>
          f.startsWith("customer.phone") ? "teléfono" : f.startsWith("customer.name") ? "nombre" : f.startsWith("deliveryAddress") ? "dirección" : f,
        );
        setError(`Revisá: ${[...new Set(labels)].join(", ")}.`);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("No pudimos enviar el pedido. Revisá tu conexión y probá de nuevo.");
      }
    },
  });

  if (!cart) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <Centered>
          <Text style={{ color: t.muted }}>Tu pedido está vacío.</Text>
          <Button label="Ver comercios" variant="outline" onPress={() => router.replace("/")} />
        </Centered>
      </SafeAreaView>
    );
  }
  if (menu.isPending) return <Loading />;

  const missing =
    !name.trim() || phone.replace(/\D/g, "").length < 8 || (mode === "DELIVERY" && addressLine.trim().length < 3) || !mode;
  const canSubmit = !missing && !belowMinimum && Boolean(branch?.openNow) && !submit.isPending;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <Text style={{ color: t.text, fontSize: 16 }}>‹ Seguir pidiendo</Text>
          </Pressable>
          <Text style={[styles.title, { color: t.text }]}>Tu pedido</Text>
          <Text style={{ color: t.muted }}>{cart.merchantName}</Text>

          {cart.lines.map((l) => (
            <View key={l.key} style={[styles.line, { borderColor: t.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: t.text, fontWeight: "600", fontSize: 16 }}>
                  {l.productName}
                  {l.variantName ? ` (${l.variantName})` : ""}
                </Text>
                {l.modifiers.length > 0 && (
                  <Text style={{ color: t.muted }}>
                    {l.modifiers.map((m) => `${m.quantity > 1 ? `${m.quantity}× ` : ""}${m.name}`).join(", ")}
                  </Text>
                )}
                {l.notes && <Text style={{ color: t.muted, fontStyle: "italic" }}>«{l.notes}»</Text>}
                <Text style={{ color: t.text }}>{formatARS(l.unitPriceMinor * l.quantity)}</Text>
              </View>
              <View style={styles.qty}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={l.quantity === 1 ? `Quitar ${l.productName}` : `Uno menos de ${l.productName}`}
                  onPress={() => (l.quantity === 1 ? remove(l.key) : setQuantity(l.key, l.quantity - 1))}
                  style={[styles.qtyBtn, { borderColor: t.border }]}
                  hitSlop={6}
                >
                  <Text style={{ color: t.text, fontSize: 18 }}>{l.quantity === 1 ? "×" : "−"}</Text>
                </Pressable>
                <Text style={{ color: t.text, minWidth: 18, textAlign: "center" }}>{l.quantity}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Uno más de ${l.productName}`}
                  onPress={() => setQuantity(l.key, Math.min(50, l.quantity + 1))}
                  style={[styles.qtyBtn, { borderColor: t.border }]}
                  hitSlop={6}
                >
                  <Text style={{ color: t.text, fontSize: 18 }}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {branch && (
            <>
              <Text style={[styles.section, { color: t.text }]}>¿Cómo lo recibís?</Text>
              <View style={styles.row}>
                {branch.acceptsPickup && <Chip label="Retiro en el local" selected={mode === "PICKUP"} onPress={() => setFulfillment("PICKUP")} />}
                {branch.acceptsDelivery && branch.zones.length > 0 && (
                  <Chip label="Envío a domicilio" selected={mode === "DELIVERY"} onPress={() => setFulfillment("DELIVERY")} />
                )}
              </View>
              {mode === "PICKUP" && <Text style={{ color: t.muted }}>Retirás en {branch.addressLine}.</Text>}
              {mode === "DELIVERY" && (
                <>
                  <Text style={{ color: t.muted }}>Zona de entrega</Text>
                  <View style={styles.wrapRow}>
                    {branch.zones.map((z) => (
                      <Chip key={z.id} label={`${z.name} · ${formatARS(z.feeMinor)}`} selected={zone?.id === z.id} onPress={() => setZoneId(z.id)} />
                    ))}
                  </View>
                  {zone?.description && <Text style={{ color: t.muted }}>{zone.description}</Text>}
                  <Field label="Dirección" value={addressLine} onChange={setAddressLine} placeholder="Calle y número" autoComplete="street-address" />
                  <Field label="Indicaciones (opcional)" value={addressNotes} onChange={setAddressNotes} placeholder="Piso, timbre, referencia" />
                </>
              )}
            </>
          )}

          <Text style={[styles.section, { color: t.text }]}>Tus datos</Text>
          <Field label="Nombre" value={name} onChange={setName} placeholder="Para que el comercio sepa quién pidió" autoComplete="name" />
          <Field label="Teléfono" value={phone} onChange={setPhone} placeholder="3491 123456" keyboardType="phone-pad" autoComplete="tel" />
          <Field label="Nota para el comercio (opcional)" value={notes} onChange={setNotes} placeholder="Por ejemplo: traer cambio de $10.000" />

          <View style={[styles.summary, { borderColor: t.border }]}>
            <SummaryRow label="Productos" value={formatARS(subtotalMinor)} />
            {mode === "DELIVERY" && <SummaryRow label="Envío" value={formatARS(deliveryFee)} />}
            <SummaryRow label="Total (pagás en efectivo)" value={formatARS(subtotalMinor + deliveryFee)} strong />
          </View>
          {belowMinimum && zone && (
            <Text style={{ color: t.danger }}>El pedido mínimo para {zone.name} es {formatARS(zone.minOrderMinor)}.</Text>
          )}
          {branch && !branch.openNow && <Text style={{ color: t.danger }}>El comercio está cerrado ahora.</Text>}
          {error && <Text style={{ color: t.danger }} accessibilityLiveRegion="polite">{error}</Text>}
        </ScrollView>

        <View style={[styles.footer, { borderColor: t.border }]}>
          <Button
            label={submit.isPending ? "Enviando…" : `Confirmar pedido · ${formatARS(subtotalMinor + deliveryFee)}`}
            disabled={!canSubmit}
            onPress={() => {
              setError(null);
              submit.mutate();
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "phone-pad" | "default";
  autoComplete?: "name" | "tel" | "street-address";
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        accessibilityLabel={label}
        keyboardType={keyboardType ?? "default"}
        autoComplete={autoComplete}
        style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
      />
    </View>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  const style = { color: t.text, fontSize: strong ? 17 : 15, fontWeight: strong ? ("700" as const) : ("400" as const) };
  return (
    <View style={styles.summaryRow}>
      <Text style={style}>{label}</Text>
      <Text style={style}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  title: { fontSize: 26, fontWeight: "800" },
  line: { flexDirection: "row", gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  qty: { flexDirection: "row", alignItems: "center", gap: space.sm },
  qtyBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  section: { fontSize: 18, fontWeight: "700", marginTop: space.md },
  row: { flexDirection: "row", gap: space.sm },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { borderRadius: 12, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  summary: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, gap: space.sm, marginTop: space.md },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: space.lg },
});
