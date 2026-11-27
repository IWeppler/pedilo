import { ApiError, fieldErrors, unwrap } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, TextInput } from "@/components/text";
import { categoryIcon, Icon, type IconName } from "@/components/icon";
import { describeSlot, SlotPicker } from "@/components/slot-picker";
import { Button, Centered, Loading } from "@/components/ui";
import { api, useBranchSlots, useMerchantCategories, useMerchantMenu } from "@/lib/api";
import { openCardPayment } from "@/lib/card-payment";
import { type CartLine, useCart } from "@/lib/cart";
import { useMyOrders } from "@/lib/my-orders";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

const newIdempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** Mensajes para los errores de negocio de POST /v1/public/orders (ADR 0007). */
const REASON_MESSAGES: Record<string, string> = {
  BRANCH_CLOSED: "El comercio cerró hace un momento. Probá más tarde.",
  SCHEDULING_DISABLED: "El comercio dejó de aceptar pedidos programados.",
  SLOT_UNAVAILABLE: "Ese horario ya no está disponible. Elegí otro.",
  SLOT_FULL: "Ese horario se llenó. Elegí otro.",
  PAYMENT_METHOD_NOT_AVAILABLE: "El comercio dejó de aceptar ese medio de pago. Elegí otro.",
  PRODUCT_UNAVAILABLE: "Un producto de tu pedido ya no está disponible. Sacalo y probá de nuevo.",
  ITEM_INVALID: "Un producto cambió en el menú. Sacalo y volvé a agregarlo.",
  MIN_ORDER_NOT_MET: "No llegás al pedido mínimo de la zona.",
  PICKUP_NOT_AVAILABLE: "El comercio no acepta retiro en el local.",
  DELIVERY_NOT_AVAILABLE: "El comercio no hace envíos.",
};

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { cart, itemCount, subtotalMinor, setQuantity, remove, clear } = useCart();
  const { contact, setContact, save } = useMyOrders();
  const menu = useMerchantMenu(cart?.merchantSlug ?? "");
  const categories = useMerchantCategories();

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
  const [when, setWhen] = useState<"NOW" | "LATER" | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<"CASH" | "TRANSFER" | "MERCADO_PAGO" | null>(null);

  // Valores efectivos (defaults según lo que ofrece la sucursal).
  const canSchedule = Boolean(branch?.scheduling.enabled);
  const timing = when ?? (branch && !branch.openNow && canSchedule ? "LATER" : "NOW");
  const payments = menu.data?.merchant.payment;
  const paymentMethod =
    payWith ?? (payments?.cash === false ? (payments.transfer ? "TRANSFER" : payments.card ? "MERCADO_PAGO" : "CASH") : "CASH");
  const slots = useBranchSlots(cart?.merchantSlug ?? "", branch?.id, canSchedule && timing === "LATER");
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
            paymentMethod,
            ...(timing === "LATER" && slot && { scheduledFor: slot }),
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
      // Con tarjeta el pedido espera el pago: se abre la pantalla de pago enseguida.
      if (paymentMethod === "MERCADO_PAGO") void openCardPayment(order.id, trackingToken);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "CONFLICT") {
        const reason = (err.details as { reason?: string } | undefined)?.reason;
        setError((reason && REASON_MESSAGES[reason]) ?? err.message);
        if (reason === "SLOT_FULL" || reason === "SLOT_UNAVAILABLE") {
          setSlot(null);
          void slots.refetch();
        }
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

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  if (!cart) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <TopBar title="Tu pedido" onBack={back} />
        <Centered>
          <View style={[styles.emptyIcon, { backgroundColor: t.surface }]}>
            <Icon name="cart" size={40} color={t.text} />
          </View>
          <Text style={[styles.emptyTitle, { color: t.text }]}>Tu pedido está vacío</Text>
          <Text style={{ color: t.muted, textAlign: "center" }}>Elegí un comercio y agregá productos.</Text>
          <Button label="Ver comercios" onPress={back} />
        </Centered>
      </SafeAreaView>
    );
  }
  if (menu.isPending) return <Loading />;

  const icon = categoryIcon(categories.data?.find((c) => c.id === menu.data?.merchant.categoryId)?.slug);
  const minFee = branch && branch.zones.length > 0 ? Math.min(...branch.zones.map((z) => z.feeMinor)) : null;
  const total = subtotalMinor + deliveryFee;
  const missing =
    !name.trim() || phone.replace(/\D/g, "").length < 8 || (mode === "DELIVERY" && addressLine.trim().length < 3) || !mode;
  const timingOk = timing === "LATER" ? Boolean(slot) : Boolean(branch?.openNow);
  const canSubmit = !missing && !belowMinimum && timingOk && !submit.isPending;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TopBar title="Tu pedido" onBack={back} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Comercio */}
          <View style={styles.merchant}>
            <View style={[styles.merchantIcon, { backgroundColor: t.background }]}>
              <Icon name={icon} size={22} color={t.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.merchantName, { color: t.text }]} numberOfLines={1}>
                {cart.merchantName}
              </Text>
              <Text style={[styles.meta, { color: t.muted }]}>
                {itemCount === 1 ? "1 producto" : `${itemCount} productos`}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={back} hitSlop={8}>
              <Text style={[styles.link, { color: t.text, textDecorationLine: "underline" }]}>+ Agregar más</Text>
            </Pressable>
          </View>

          {/* Productos */}
          <Card t={t}>
            {cart.lines.map((l, i) => (
              <LineRow
                key={l.key}
                line={l}
                icon={icon}
                last={i === cart.lines.length - 1}
                onDecrease={() => (l.quantity === 1 ? remove(l.key) : setQuantity(l.key, l.quantity - 1))}
                onIncrease={() => setQuantity(l.key, Math.min(50, l.quantity + 1))}
              />
            ))}
          </Card>

          {/* Entrega */}
          {branch && (
            <>
              <SectionTitle t={t}>¿Cómo lo recibís?</SectionTitle>
              <View style={styles.modes}>
                {branch.acceptsPickup && (
                  <ModeOption
                    icon="pickup"
                    label="Retiro"
                    detail="Sin costo"
                    selected={mode === "PICKUP"}
                    onPress={() => setFulfillment("PICKUP")}
                  />
                )}
                {branch.acceptsDelivery && branch.zones.length > 0 && (
                  <ModeOption
                    icon="delivery"
                    label="Envío"
                    detail={minFee === 0 ? "Gratis" : `desde ${formatARS(minFee ?? 0)}`}
                    selected={mode === "DELIVERY"}
                    onPress={() => setFulfillment("DELIVERY")}
                  />
                )}
              </View>

              {mode === "PICKUP" && (
                <Card t={t}>
                  <View style={styles.infoRow}>
                    <Icon name="location" size={20} color={t.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.meta, { color: t.muted }]}>Retirás en</Text>
                      <Text style={[styles.infoText, { color: t.text }]}>
                        {branch.addressLine}
                        {branch.addressNotes ? ` · ${branch.addressNotes}` : ""}
                      </Text>
                    </View>
                  </View>
                </Card>
              )}

              {mode === "DELIVERY" && (
                <>
                  {branch.zones.length > 1 && (
                    <Card t={t}>
                      {branch.zones.map((z, i) => {
                        const selected = zone?.id === z.id;
                        return (
                          <Pressable
                            key={z.id}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            onPress={() => setZoneId(z.id)}
                            style={[styles.zone, i < branch.zones.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
                          >
                            <View style={[styles.radio, { borderColor: selected ? t.primary : t.border }]}>
                              {selected && <View style={[styles.radioDot, { backgroundColor: t.primary }]} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.infoText, { color: t.text, fontWeight: selected ? "700" : "500" }]}>{z.name}</Text>
                              {z.description && <Text style={[styles.meta, { color: t.muted }]}>{z.description}</Text>}
                            </View>
                            <Text style={[styles.infoText, { color: t.text }]}>{z.feeMinor === 0 ? "Gratis" : formatARS(z.feeMinor)}</Text>
                          </Pressable>
                        );
                      })}
                    </Card>
                  )}
                  {branch.zones.length === 1 && zone?.description && <Text style={[styles.meta, { color: t.muted }]}>{zone.description}</Text>}
                  <Card t={t} padded>
                    <Field label="Dirección" value={addressLine} onChange={setAddressLine} placeholder="Calle y número" autoComplete="street-address" />
                    <Field label="Indicaciones (opcional)" value={addressNotes} onChange={setAddressNotes} placeholder="Piso, timbre, referencia" />
                  </Card>
                </>
              )}
            </>
          )}

          {/* Cuándo */}
          {branch && canSchedule && (
            <>
              <SectionTitle t={t}>¿Cuándo?</SectionTitle>
              <View style={styles.modes}>
                {branch.openNow && (
                  <ModeOption icon="bolt" label="Lo antes posible" detail="Ahora" selected={timing === "NOW"} onPress={() => setWhen("NOW")} />
                )}
                <ModeOption
                  icon="calendar"
                  label="Programar"
                  detail={slot && timing === "LATER" ? describeSlot(slot, branch.timezone) : "Elegí el horario"}
                  selected={timing === "LATER"}
                  onPress={() => setWhen("LATER")}
                />
              </View>
              {timing === "LATER" && (
                <Card t={t} padded>
                  {slots.data ? (
                    <SlotPicker data={slots.data} value={slot} onChange={setSlot} />
                  ) : slots.isError ? (
                    <Text style={[styles.meta, { color: t.danger }]}>No pudimos cargar los horarios. Probá de nuevo.</Text>
                  ) : (
                    <Text style={[styles.meta, { color: t.muted }]}>Cargando horarios…</Text>
                  )}
                </Card>
              )}
            </>
          )}

          {/* Pago */}
          {(payments?.transfer || payments?.card) && (
            <>
              <SectionTitle t={t}>¿Cómo pagás?</SectionTitle>
              <View style={styles.modes}>
                {payments.cash && (
                  <ModeOption
                    icon="cash"
                    label="Efectivo"
                    detail="Al recibir o retirar"
                    selected={paymentMethod === "CASH"}
                    onPress={() => setPayWith("CASH")}
                  />
                )}
                {payments.transfer && (
                  <ModeOption
                    icon="bank"
                    label="Transferencia"
                    detail="Te pasamos el alias"
                    selected={paymentMethod === "TRANSFER"}
                    onPress={() => setPayWith("TRANSFER")}
                  />
                )}
                {payments.card && (
                  <ModeOption
                    icon="card"
                    label="Tarjeta"
                    detail="Con Mercado Pago"
                    selected={paymentMethod === "MERCADO_PAGO"}
                    onPress={() => setPayWith("MERCADO_PAGO")}
                  />
                )}
              </View>
            </>
          )}

          {/* Datos */}
          <SectionTitle t={t}>Tus datos</SectionTitle>
          <Card t={t} padded>
            <Field label="Nombre" value={name} onChange={setName} placeholder="Para que el comercio sepa quién pidió" autoComplete="name" />
            <Field label="Teléfono" value={phone} onChange={setPhone} placeholder="3491 123456" keyboardType="phone-pad" autoComplete="tel" />
            <Field label="Nota para el comercio (opcional)" value={notes} onChange={setNotes} placeholder="Por ejemplo: traer cambio de $10.000" />
          </Card>

          {/* Resumen */}
          <SectionTitle t={t}>Resumen</SectionTitle>
          <Card t={t} padded>
            <SummaryRow label="Productos" value={formatARS(subtotalMinor)} />
            {mode === "DELIVERY" && <SummaryRow label="Envío" value={deliveryFee === 0 ? "Gratis" : formatARS(deliveryFee)} />}
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <SummaryRow label="Total" value={formatARS(total)} strong />
            <View style={[styles.payment, { backgroundColor: t.surface }]}>
              <Icon name={paymentMethod === "TRANSFER" ? "bank" : paymentMethod === "MERCADO_PAGO" ? "card" : "cash"} size={18} color={t.success} />
              <Text style={[styles.meta, { color: t.text, flex: 1 }]}>
                {paymentMethod === "TRANSFER"
                  ? "Pagás por transferencia: al confirmar te mostramos los datos de la cuenta"
                  : paymentMethod === "MERCADO_PAGO"
                  ? "Pagás con tarjeta al confirmar. El comercio recibe el pedido cuando se aprueba el pago"
                  : "Pagás en efectivo al recibir o retirar"}
              </Text>
            </View>
          </Card>

          {belowMinimum && zone && <Notice t={t}>El pedido mínimo para {zone.name} es {formatARS(zone.minOrderMinor)}.</Notice>}
          {branch && !branch.openNow && timing === "NOW" && (
            <Notice t={t}>El comercio está cerrado ahora{canSchedule ? ". Podés programar el pedido." : "."}</Notice>
          )}
          {error && <Notice t={t}>{error}</Notice>}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: t.card, borderColor: t.border }]}>
          <Pressable
            onPress={() => {
              setError(null);
              submit.mutate();
            }}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            style={({ pressed }) => [styles.confirm, { backgroundColor: t.primary, opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.confirmText, { color: t.primaryText }]}>{submit.isPending ? "Enviando…" : "Confirmar pedido"}</Text>
            <Text style={[styles.confirmText, { color: t.primaryText }]}>{formatARS(total)}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        onPress={onBack}
        hitSlop={8}
        style={[styles.backButton, { backgroundColor: t.surface }]}
      >
        <Icon name="back" size={20} color={t.text} />
      </Pressable>
      <Text style={[styles.topTitle, { color: t.text }]}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

function SectionTitle({ t, children }: { t: Theme; children: ReactNode }) {
  return <Text style={[styles.section, { color: t.text }]}>{children}</Text>;
}

function Card({ t, padded, children }: { t: Theme; padded?: boolean; children: ReactNode }) {
  return <View style={[styles.card, padded && styles.cardPadded, { backgroundColor: t.surface }]}>{children}</View>;
}

function Notice({ t, children }: { t: Theme; children: ReactNode }) {
  return (
    <View style={[styles.notice, { backgroundColor: t.dangerBg }]} accessibilityLiveRegion="polite">
      <Icon name="warning" size={18} color={t.danger} />
      <Text style={[styles.noticeText, { color: t.danger }]}>{children}</Text>
    </View>
  );
}

function LineRow({
  line: l,
  icon,
  last,
  onDecrease,
  onIncrease,
}: {
  line: CartLine;
  icon: IconName;
  last: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.line, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      <View style={[styles.thumb, { backgroundColor: t.background }]}>
        <Icon name={icon} size={24} color={t.muted} />
      </View>
      <View style={styles.lineBody}>
        <Text style={[styles.lineName, { color: t.text }]}>
          {l.productName}
          {l.variantName ? ` (${l.variantName})` : ""}
        </Text>
        {l.modifiers.length > 0 && (
          <Text style={[styles.meta, { color: t.muted }]}>
            {l.modifiers.map((m) => `${m.quantity > 1 ? `${m.quantity}× ` : ""}${m.name}`).join(", ")}
          </Text>
        )}
        {l.notes && <Text style={[styles.meta, { color: t.muted, fontStyle: "italic" }]}>«{l.notes}»</Text>}
        <View style={styles.lineFooter}>
          <Text style={[styles.linePrice, { color: t.text }]}>{formatARS(l.unitPriceMinor * l.quantity)}</Text>
          <View style={[styles.qty, { backgroundColor: t.surface }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={l.quantity === 1 ? `Quitar ${l.productName}` : `Uno menos de ${l.productName}`}
              onPress={onDecrease}
              style={[styles.qtyBtn, { backgroundColor: t.card }]}
              hitSlop={6}
            >
              <Icon name={l.quantity === 1 ? "trash" : "remove"} size={16} color={l.quantity === 1 ? t.danger : t.text} />
            </Pressable>
            <Text style={[styles.qtyValue, { color: t.text }]}>{l.quantity}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Uno más de ${l.productName}`}
              onPress={onIncrease}
              style={[styles.qtyBtn, { backgroundColor: t.primary }]}
              hitSlop={6}
            >
              <Icon name="add" size={16} color={t.primaryText} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function ModeOption({
  icon,
  label,
  detail,
  selected,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${detail}`}
      style={({ pressed }) => [
        styles.mode,
                {
          backgroundColor: t.surface,
          borderColor: selected ? t.primary : "transparent",
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.modeIcon, { backgroundColor: selected ? t.primary : t.background }]}>
        <Icon name={icon} size={22} color={selected ? t.primaryText : t.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.modeLabel, { color: t.text }]}>{label}</Text>
        <Text style={[styles.meta, { color: t.muted }]}>{detail}</Text>
      </View>
    </Pressable>
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
    <View style={{ gap: 6 }}>
      <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
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
  const style = { color: t.text, fontSize: strong ? 18 : 15, fontWeight: strong ? ("800" as const) : ("400" as const) };
  return (
    <View style={styles.summaryRow}>
      <Text style={[style, !strong && { color: t.muted }]}>{label}</Text>
      <Text style={style}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingTop: space.sm, gap: space.md, paddingBottom: space.xl },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  backButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },

  emptyIcon: { width: 88, height: 88, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: font.display, fontSize: 20, fontWeight: "700" },

  merchant: { flexDirection: "row", alignItems: "center", gap: space.md },
  merchantIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  merchantName: { fontFamily: font.display, fontSize: 17, fontWeight: "700" },
  link: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 13 },

  card: { borderRadius: radius.lg, paddingHorizontal: space.md },
  cardPadded: { paddingVertical: space.md, gap: space.md },

  line: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  lineBody: { flex: 1, gap: 2 },
  lineName: { fontSize: 15, fontWeight: "700" },
  lineFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xs },
  linePrice: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },
  qty: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.pill, padding: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  qtyValue: { fontSize: 15, fontWeight: "700", minWidth: 18, textAlign: "center" },

  section: { fontFamily: font.display, fontSize: 18, fontWeight: "700", marginTop: space.sm },
  modes: { flexDirection: "row", gap: space.md },
  mode: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.lg, borderWidth: 2, padding: space.md },
  modeIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  modeLabel: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },

  infoRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  infoText: { fontSize: 15 },
  zone: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill },

  fieldLabel: { fontSize: 13, fontWeight: "600" },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  divider: { height: StyleSheet.hairlineWidth },
  payment: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, padding: space.md },

  notice: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, padding: space.md },
  noticeText: { fontSize: 14, fontWeight: "600", flex: 1 },

  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  confirm: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    height: 54,
  },
  confirmText: { fontFamily: font.display, fontSize: 16, fontWeight: "700" },
});
