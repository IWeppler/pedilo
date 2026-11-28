import { ApiError, fieldErrors, type PublicProduct, unwrap } from "@pedilo/api-client";
import {
  addressTitle,
  distanceMeters,
  FAR_FROM_ADDRESS_METERS,
  formatARSWhole,
  type LatLng,
} from "@pedilo/domain";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, TextInput } from "@/components/text";
import { categoryIcon, Icon, type IconName } from "@/components/icon";
import { Photo } from "@/components/photo";
import { ProductTile } from "@/components/product-tile";
import { describeSlot, SlotPicker } from "@/components/slot-picker";
import { Button, Centered, Loading } from "@/components/ui";
import { api, useBranchSlots, useCustomerProfile, useMerchantCategories, useMerchantMenu, useOrderQuote } from "@/lib/api";
import { openCardPayment } from "@/lib/card-payment";
import { type CartLine, useCart } from "@/lib/cart";
import { useDeliveryAddress } from "@/lib/addresses";
import { useAuth } from "@/lib/auth";
import { positionIfAllowed } from "@/lib/current-position";
import { etaLabel } from "@/lib/merchant-labels";
import { useMyOrders } from "@/lib/my-orders";
import { useQuickAdd } from "@/lib/quick-add";
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
  PROMOTION_UNAVAILABLE: "La promoción se terminó recién. Revisá el total y confirmá de nuevo.",
  COUPON_INVALID: "Ese cupón no existe en este comercio.",
  COUPON_EXPIRED: "Ese cupón ya venció.",
  COUPON_EXHAUSTED: "Ese cupón ya se agotó.",
  COUPON_ALREADY_USED: "Ya usaste este cupón.",
  COUPON_MIN_NOT_MET: "Tu pedido no llega al mínimo de este cupón.",
  COUPON_NOT_APPLICABLE: "Este cupón no aplica a los productos de tu pedido.",
  PICKUP_NOT_AVAILABLE: "El comercio no acepta retiro en el local.",
  DELIVERY_NOT_AVAILABLE: "El comercio no hace envíos.",
};

type PayMethod = "CASH" | "TRANSFER" | "MERCADO_PAGO";
type Row = "zone" | "when" | "pay" | "coupon" | "note";

const PAYMENT: Record<PayMethod, { icon: IconName; label: string; detail: string }> = {
  CASH: { icon: "cash", label: "Efectivo", detail: "" },
  TRANSFER: { icon: "bank", label: "Transferencia", detail: "Al confirmar te mostramos los datos de la cuenta" },
  MERCADO_PAGO: { icon: "card", label: "Tarjeta con Mercado Pago", detail: "Pagás al confirmar; el comercio recibe el pedido cuando se aprueba" },
};

const paymentDetail = (m: PayMethod, mode: "PICKUP" | "DELIVERY") =>
  m === "CASH" ? (mode === "PICKUP" ? "Pagás al retirar" : "Pagás al recibir") : PAYMENT[m].detail;

export default function CartScreen() {
  const t = useTheme();
  const router = useRouter();
  const { cart, itemCount, subtotalMinor, setQuantity, remove, clear } = useCart();
  const { save } = useMyOrders();
  const menu = useMerchantMenu(cart?.merchantSlug ?? "");
  const categories = useMerchantCategories();

  const branch = menu.data?.merchant.branches.find((b) => b.id === cart?.branchId);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY" | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  // Solo se llega con cuenta y perfil completo (ADR 0026): nombre y teléfono salen de ahí. La
  // dirección es la elegida en «¿Desde dónde pedís?» (ADR 0034) y se cambia desde acá.
  const { status: authStatus } = useAuth();
  const profile = useCustomerProfile(authStatus === "signedIn");
  const { selected: address } = useDeliveryAddress();
  const farFrom = useFarFromAddress(address?.location ?? null);
  const [notes, setNotes] = useState("");
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState<"NOW" | "LATER" | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<PayMethod | null>(null);
  // Cupón (ADR 0030): lo que escribe y el que ya aplicó (el que se cotiza y se manda).
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  // Qué fila de «Entrega y pago» está abierta. `undefined`: todavía no tocó ninguna (se abre sola la que falta).
  const [open, setOpen] = useState<Row | null | undefined>(undefined);

  // Valores efectivos (defaults según lo que ofrece la sucursal).
  const canSchedule = Boolean(branch?.scheduling.enabled);
  const timing = when ?? (branch && !branch.openNow && canSchedule ? "LATER" : "NOW");
  const payments = menu.data?.merchant.payment;
  const paymentMethod: PayMethod =
    payWith ?? (payments?.cash === false ? (payments.transfer ? "TRANSFER" : payments.card ? "MERCADO_PAGO" : "CASH") : "CASH");
  const slots = useBranchSlots(cart?.merchantSlug ?? "", branch?.id, canSchedule && timing === "LATER");
  const mode = fulfillment ?? (branch?.acceptsPickup ? "PICKUP" : branch?.acceptsDelivery ? "DELIVERY" : null);
  const zone = branch?.zones.find((z) => z.id === zoneId) ?? branch?.zones[0];
  const deliveryFee = mode === "DELIVERY" ? (zone?.feeMinor ?? 0) : 0;
  const validPin = address?.location ?? null;
  const belowMinimum = mode === "DELIVERY" && zone ? subtotalMinor < zone.minOrderMinor : false;

  // Cotización (ADR 0030): subtotal, descuento de la promo y total con las reglas de la API.
  const quote = useOrderQuote(
    cart && mode
      ? {
          merchantSlug: cart.merchantSlug,
          branchId: cart.branchId,
          fulfillmentType: mode,
          ...(mode === "DELIVERY" && zone && { deliveryZoneId: zone.id }),
          ...(coupon && { couponCode: coupon }),
          items: cart.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            modifiers: l.modifiers.map((m) => ({ modifierId: m.modifierId, quantity: m.quantity })),
            quantity: l.quantity,
          })),
        }
      : null,
  );
  // El cupón solo viaja si la cotización lo aceptó (si no, cortaría el pedido).
  const couponUsable = Boolean(coupon) && !quote.data?.couponError;

  // Para sumar: disponibles y fuera del pedido; primero los de secciones que el pedido no tiene
  // (la bebida o el postre que falta) y, entre esos, los que tienen foto.
  const suggestions = useMemo(() => {
    if (!menu.data || !cart) return [];
    const inCart = new Set(cart.lines.map((l) => l.productId));
    const seen = new Set<string>();
    const pool = menu.data.sections.flatMap((s) => {
      const coveredSection = s.products.some((p) => inCart.has(p.id));
      return s.products
        .filter((p) => p.available && !inCart.has(p.id) && !seen.has(p.id) && seen.add(p.id))
        .map((p) => ({ p, rank: (coveredSection ? 0 : 2) + (p.imageUrl ? 1 : 0) }));
    });
    return pool
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((x) => x.p);
  }, [menu.data, cart]);
  const quickAdd = useQuickAdd({
    merchantSlug: cart?.merchantSlug ?? "",
    merchantName: cart?.merchantName ?? "",
    branchId: cart?.branchId ?? "",
    open: Boolean(branch?.openNow),
  });

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
              deliveryAddress: {
                line: address!.line,
                notes: address!.notes,
                location: validPin ? { lat: validPin.lat, lng: validPin.lng } : null,
              },
            }),
            notes: notes.trim() || null,
            ...(couponUsable && { couponCode: coupon }),
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
      clear();
      router.replace({ pathname: "/order/[id]", params: { id: order.id } });
      // Con tarjeta el pedido espera el pago: se abre la pantalla de pago enseguida.
      if (paymentMethod === "MERCADO_PAGO") void openCardPayment(order.id, trackingToken);
    },
    onError: (err) => {
      // La sesión venció o falta el registro: se resuelve y el carrito queda como estaba.
      if (err instanceof ApiError && err.status === 401) {
        setError("Tu sesión venció. Entrá de nuevo para confirmar el pedido.");
        router.push("/login");
      } else if (err instanceof ApiError && (err.details as { reason?: string } | undefined)?.reason === "PROFILE_REQUIRED") {
        router.push("/register");
      } else if (err instanceof ApiError && err.code === "CONFLICT") {
        const reason = (err.details as { reason?: string } | undefined)?.reason;
        setError((reason && REASON_MESSAGES[reason]) ?? err.message);
        if (reason === "PROMOTION_UNAVAILABLE" || reason?.startsWith("COUPON_")) void quote.refetch();
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
  // Con la cotización de la API (promo incluida); mientras llega, la cuenta local sin descuento.
  const discount = quote.data?.discountMinor ?? 0;
  const total = quote.data ? quote.data.totalMinor : subtotalMinor + deliveryFee;
  const missing = !profile.data || (mode === "DELIVERY" && !address) || !mode;
  const timingOk = timing === "LATER" ? Boolean(slot) : Boolean(branch?.openNow);
  const hasDelivery = Boolean(branch?.acceptsDelivery && branch.zones.length > 0);
  const prepMinutes = menu.data?.merchant.prepMinutes ?? null;
  const eta =
    prepMinutes == null
      ? null
      : mode === "DELIVERY"
        ? `Llega en ${etaLabel({ prepMinutes, acceptsDelivery: true })}`
        : `Listo en ${prepMinutes} min`;
  const expanded = open === undefined ? (timing === "LATER" && !slot ? "when" : null) : open;
  const toggle = (row: Row | null) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(row === null || row === expanded ? null : row);
  };
  const paymentOptions = (["CASH", "TRANSFER", "MERCADO_PAGO"] as const).filter((m) =>
    m === "CASH" ? (payments?.cash ?? true) : m === "TRANSFER" ? payments?.transfer : payments?.card,
  );
  const couponApplied = Boolean(coupon) && couponUsable && quote.data?.promotion?.code === coupon;
  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCoupon(code);
    toggle(null);
  };
  const openProduct = (p: PublicProduct) =>
    router.push({ pathname: "/product/[slug]/[productId]", params: { slug: cart.merchantSlug, productId: p.id } });
  const canSubmit = !missing && !belowMinimum && timingOk && !submit.isPending;
  // Por qué no se puede confirmar todavía, en una línea pegada al botón (null mientras carga el perfil).
  const blocker = !branch
    ? null
    : !mode
      ? "El comercio no está tomando pedidos por ahora."
      : mode === "DELIVERY" && !address
        ? "Agregá la dirección de entrega."
        : belowMinimum && zone
          ? `Te faltan ${formatARSWhole(zone.minOrderMinor - subtotalMinor)} para el mínimo de envío.`
          : timing === "LATER" && !slot
            ? "Elegí un horario."
            : timing === "NOW" && !branch.openNow
              ? canSchedule
                ? "El comercio está cerrado ahora. Programá el pedido."
                : "El comercio está cerrado ahora."
              : null;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <TopBar title="Tu pedido" onBack={back} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Comercio */}
          <View style={styles.merchant}>
            <View style={[styles.merchantIcon, { backgroundColor: t.surface }]}>
              <Photo
                url={menu.data?.merchant.logoUrl}
                style={StyleSheet.absoluteFill}
                fallback={<Icon name={icon} size={22} color={t.text} />}
              />
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

          {/* Envío o retiro: va antes que los productos porque cambia el costo y el mínimo */}
          {branch && branch.acceptsPickup && hasDelivery && (
            <Segmented
              value={mode}
              onChange={setFulfillment}
              options={[
                { value: "DELIVERY", label: "Envío", detail: minFee === 0 ? "Gratis" : `desde ${formatARSWhole(minFee ?? 0)}` },
                { value: "PICKUP", label: "Retiro", detail: "Sin costo" },
              ]}
            />
          )}
          {/* Con horarios programables, el tiempo va en la fila «Cuándo» */}
          {eta && !canSchedule && branch?.openNow && (
            <View style={styles.etaRow}>
              <Icon name="clock" size={16} color={t.muted} />
              <Text style={[styles.meta, { color: t.text }]}>{eta}</Text>
            </View>
          )}

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
                onEdit={() =>
                  router.push({
                    pathname: "/product/[slug]/[productId]",
                    params: { slug: cart.merchantSlug, productId: l.productId, lineKey: l.key },
                  })
                }
              />
            ))}
          </Card>

          {/* Para sumar: productos del mismo comercio que no están en el pedido */}
          {suggestions.length >= 2 && (
            <>
              <SectionTitle t={t}>¿Le sumás algo?</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestScroll} contentContainerStyle={styles.suggestRow}>
                {suggestions.map((p) => (
                  <ProductTile
                    key={p.id}
                    product={p}
                    offers={menu.data?.offers ?? []}
                    icon={icon}
                    onOpen={() => openProduct(p)}
                    onAdd={() => {
                      if (quickAdd(p)) return true;
                      openProduct(p);
                      return false;
                    }}
                  />
                ))}
              </ScrollView>
            </>
          )}

          {/* Entrega y pago: una fila por dato, con «Cambiar» que abre las opciones en el lugar */}
          {branch && mode && (
            <>
              <SectionTitle t={t}>Entrega y pago</SectionTitle>
              <Card t={t}>
                {mode === "PICKUP" && <DetailRow icon="pickup" title={`Retirás en ${branch.addressLine}`} detail={branch.addressNotes} />}

                {mode === "DELIVERY" &&
                  (address ? (
                    <DetailRow
                      icon="location"
                      title={`${addressTitle(address)} · ${address.line}`}
                      detail={address.notes || "Sin indicaciones"}
                      action="Cambiar"
                      actionLabel="Cambiar desde dónde pedís"
                      onAction={() => router.push("/address")}
                    >
                      {farFrom !== null && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => router.push("/address")}
                          style={[styles.farNotice, { backgroundColor: t.accentSoft }]}
                        >
                          <Icon name="warning" size={18} color={t.accent} />
                          <Text style={[styles.meta, { color: t.text, flex: 1 }]}>
                            Estás a {formatDistance(farFrom)} de {addressTitle(address).toLowerCase()}. ¿Pedís desde otro lado?
                          </Text>
                        </Pressable>
                      )}
                    </DetailRow>
                  ) : (
                    <DetailRow
                      icon="location"
                      title="¿Adónde te lo llevamos?"
                      detail="Falta la dirección de entrega"
                      detailTone="danger"
                      action="Agregar"
                      actionLabel="Agregar dirección de entrega"
                      onAction={() => router.push("/address")}
                    />
                  ))}

                {mode === "DELIVERY" && zone && (
                  <DetailRow
                    icon="delivery"
                    title={`Envío ${zone.feeMinor === 0 ? "gratis" : formatARSWhole(zone.feeMinor)}`}
                    detail={[branch.zones.length > 1 ? zone.name : null, zone.description].filter(Boolean).join(" · ") || null}
                    action={branch.zones.length > 1 ? "Cambiar" : undefined}
                    actionLabel="Cambiar zona de envío"
                    expanded={expanded === "zone"}
                    onAction={() => toggle("zone")}
                  >
                    {expanded === "zone" &&
                      branch.zones.map((z) => (
                        <OptionRow
                          key={z.id}
                          label={z.name}
                          detail={z.description}
                          trailing={z.feeMinor === 0 ? "Gratis" : formatARSWhole(z.feeMinor)}
                          selected={zone.id === z.id}
                          onPress={() => {
                            setZoneId(z.id);
                            toggle(null);
                          }}
                        />
                      ))}
                  </DetailRow>
                )}

                {canSchedule && (
                  <DetailRow
                    icon={timing === "NOW" ? "bolt" : "calendar"}
                    title={timing === "NOW" ? "Lo antes posible" : slot ? describeSlot(slot, branch.timezone) : "Programar"}
                    detail={timing === "NOW" ? eta : slot ? "Pedido programado" : "Elegí un horario"}
                    detailTone={timing === "LATER" && !slot ? "danger" : undefined}
                    action="Cambiar"
                    actionLabel="Cambiar cuándo lo recibís"
                    expanded={expanded === "when"}
                    onAction={() => toggle("when")}
                  >
                    {expanded === "when" && (
                      <>
                        {branch.openNow && (
                          <OptionRow
                            label="Lo antes posible"
                            detail={eta}
                            selected={timing === "NOW"}
                            onPress={() => {
                              setWhen("NOW");
                              toggle(null);
                            }}
                          />
                        )}
                        <OptionRow label="Programar" detail="Elegí día y horario" selected={timing === "LATER"} onPress={() => setWhen("LATER")} />
                        {timing === "LATER" &&
                          (slots.data ? (
                            <SlotPicker
                              data={slots.data}
                              value={slot}
                              onChange={(s) => {
                                setSlot(s);
                                toggle(null);
                              }}
                            />
                          ) : slots.isError ? (
                            <Text style={[styles.meta, { color: t.danger }]}>No pudimos cargar los horarios. Probá de nuevo.</Text>
                          ) : (
                            <Text style={[styles.meta, { color: t.muted }]}>Cargando horarios…</Text>
                          ))}
                      </>
                    )}
                  </DetailRow>
                )}

                <DetailRow
                  icon={PAYMENT[paymentMethod].icon}
                  title={PAYMENT[paymentMethod].label}
                  detail={paymentDetail(paymentMethod, mode)}
                  action={paymentOptions.length > 1 ? "Cambiar" : undefined}
                  actionLabel="Cambiar cómo pagás"
                  expanded={expanded === "pay"}
                  onAction={() => toggle("pay")}
                >
                  {expanded === "pay" &&
                    paymentOptions.map((m) => (
                      <OptionRow
                        key={m}
                        label={PAYMENT[m].label}
                        detail={paymentDetail(m, mode)}
                        selected={paymentMethod === m}
                        onPress={() => {
                          setPayWith(m);
                          toggle(null);
                        }}
                      />
                    ))}
                </DetailRow>

                <DetailRow
                  icon="ticket"
                  title={couponApplied ? `Cupón ${coupon}` : "¿Tenés un cupón?"}
                  detail={
                    couponApplied
                      ? "Aplicado"
                      : coupon && quote.data?.couponError
                        ? (REASON_MESSAGES[quote.data.couponError.reason] ?? quote.data.couponError.message)
                        : coupon && quote.data?.couponOutdone
                          ? "Este pedido ya tiene un descuento mayor: dejamos ese."
                          : null
                  }
                  detailTone={couponApplied ? "success" : coupon && quote.data?.couponError ? "danger" : undefined}
                  action={couponApplied ? "Quitar" : "Agregar"}
                  actionLabel={couponApplied ? "Quitar cupón" : "Agregar cupón"}
                  expanded={expanded === "coupon"}
                  onAction={() => {
                    if (couponApplied) {
                      setCoupon(null);
                      setCouponInput("");
                    } else toggle("coupon");
                  }}
                >
                  {expanded === "coupon" && (
                    <View style={styles.couponRow}>
                      <TextInput
                        value={couponInput}
                        onChangeText={setCouponInput}
                        placeholder="Código del cupón"
                        placeholderTextColor={t.muted}
                        accessibilityLabel="Código del cupón"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={applyCoupon}
                        style={[styles.input, { flex: 1, backgroundColor: t.background, color: t.text }]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        disabled={!couponInput.trim()}
                        onPress={applyCoupon}
                        style={[styles.couponApply, { backgroundColor: t.primary, opacity: couponInput.trim() ? 1 : 0.4 }]}
                      >
                        <Text style={{ color: t.primaryText, fontWeight: "700" }}>Aplicar</Text>
                      </Pressable>
                    </View>
                  )}
                </DetailRow>

                <DetailRow
                  icon="note"
                  title="Nota para el comercio"
                  detail={notes.trim() || "Opcional"}
                  action={notes.trim() ? "Editar" : "Agregar"}
                  actionLabel="Nota para el comercio"
                  expanded={expanded === "note"}
                  onAction={() => toggle("note")}
                  last={!profile.data}
                >
                  {expanded === "note" && (
                    <TextInput
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Por ejemplo: traer cambio de $10.000"
                      placeholderTextColor={t.muted}
                      accessibilityLabel="Nota para el comercio"
                      autoFocus
                      multiline
                      maxLength={200}
                      style={[styles.input, styles.noteInput, { backgroundColor: t.background, color: t.text }]}
                    />
                  )}
                </DetailRow>

                {profile.data && <DetailRow icon="person" title={`A nombre de ${profile.data.displayName}`} detail={profile.data.phone} last />}
              </Card>
            </>
          )}

          {/* Resumen */}
          <SectionTitle t={t}>Resumen</SectionTitle>
          <Card t={t} padded>
            <SummaryRow label="Productos" value={formatARSWhole(subtotalMinor)} />
            {discount > 0 && quote.data?.promotion && (
              <SummaryRow
                label={quote.data.promotion.code ? `Cupón ${quote.data.promotion.code}` : quote.data.promotion.title}
                value={`−${formatARSWhole(discount)}`}
                tone="success"
              />
            )}
            {mode === "DELIVERY" && <SummaryRow label="Envío" value={deliveryFee === 0 ? "Gratis" : formatARSWhole(deliveryFee)} />}
            <View style={[styles.divider, { backgroundColor: t.border }]} />
            <SummaryRow label="Total" value={formatARSWhole(total)} strong />
          </Card>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: t.card, borderColor: t.border }]}>
          {(error || blocker) && (
            <View style={styles.footerStatus} accessibilityLiveRegion="polite">
              <Icon name="warning" size={16} color={error ? t.danger : t.muted} />
              <Text style={[styles.footerStatusText, { color: error ? t.danger : t.text }]}>{error ?? blocker}</Text>
            </View>
          )}
          {discount > 0 && (
            <View style={styles.savings}>
              <Text style={[styles.savingsText, { color: t.success }]}>Ahorrás {formatARSWhole(discount)}</Text>
              <Text style={[styles.meta, { color: t.muted, textDecorationLine: "line-through" }]}>{formatARSWhole(total + discount)}</Text>
            </View>
          )}
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
            <Text style={[styles.confirmText, { color: t.primaryText }]}>{formatARSWhole(total)}</Text>
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

function LineRow({
  line: l,
  icon,
  last,
  onDecrease,
  onIncrease,
  onEdit,
}: {
  line: CartLine;
  icon: IconName;
  last: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.line, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      <View style={[styles.thumb, { backgroundColor: t.background }]}>
        <Photo url={l.imageUrl} style={StyleSheet.absoluteFill} fallback={<Icon name={icon} size={24} color={t.muted} />} />
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
        <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${l.productName}`} onPress={onEdit} hitSlop={8} style={styles.lineEdit}>
          <Text style={[styles.rowAction, { color: t.text }]}>Editar</Text>
        </Pressable>
        <View style={styles.lineFooter}>
          <Text style={[styles.linePrice, { color: t.text }]}>{formatARSWhole(l.unitPriceMinor * l.quantity)}</Text>
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

/** Selector de dos o tres opciones excluyentes (envío o retiro), con el costo debajo de cada una. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string; detail: string }[];
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surface }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${o.label}, ${o.detail}`}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: t.primary }]}
          >
            <Text style={[styles.segmentLabel, { color: selected ? t.primaryText : t.text }]}>{o.label}</Text>
            <Text style={[styles.segmentDetail, { color: selected ? t.primaryText : t.muted, opacity: selected ? 0.8 : 1 }]}>{o.detail}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Un dato del pedido: ícono, valor y, si se puede cambiar, la acción a la derecha. Las opciones
 * se abren debajo, en el mismo lugar (`children`), y la acción pasa a «Listo».
 */
function DetailRow({
  icon,
  title,
  detail,
  detailTone,
  action,
  actionLabel,
  onAction,
  expanded,
  last,
  children,
}: {
  icon: IconName;
  title: string;
  detail?: string | null;
  detailTone?: "danger" | "success";
  action?: string;
  actionLabel?: string;
  onAction?: () => void;
  expanded?: boolean;
  last?: boolean;
  children?: ReactNode;
}) {
  const t = useTheme();
  const detailColor = detailTone === "danger" ? t.danger : detailTone === "success" ? t.success : t.muted;
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      <View style={styles.detailHead}>
        <Icon name={icon} size={20} color={t.text} />
        <View style={styles.detailText}>
          <Text style={[styles.detailTitle, { color: t.text }]}>{title}</Text>
          {detail ? <Text style={[styles.meta, { color: detailColor }]}>{detail}</Text> : null}
        </View>
        {action && onAction && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel ?? action}
            accessibilityState={expanded === undefined ? undefined : { expanded }}
            onPress={onAction}
            hitSlop={8}
          >
            <Text style={[styles.rowAction, { color: t.text }]}>{expanded ? "Listo" : action}</Text>
          </Pressable>
        )}
      </View>
      {children ? <View style={styles.detailBody}>{children}</View> : null}
    </View>
  );
}

function OptionRow({
  label,
  detail,
  trailing,
  selected,
  onPress,
}: {
  label: string;
  detail?: string | null;
  trailing?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={styles.option}>
      <View style={[styles.radio, { borderColor: selected ? t.primary : t.border }]}>
        {selected && <View style={[styles.radioDot, { backgroundColor: t.primary }]} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoText, { color: t.text, fontWeight: selected ? "700" : "500" }]}>{label}</Text>
        {detail ? <Text style={[styles.meta, { color: t.muted }]}>{detail}</Text> : null}
      </View>
      {trailing && <Text style={[styles.infoText, { color: t.text }]}>{trailing}</Text>}
    </Pressable>
  );
}

function SummaryRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "success" }) {
  const t = useTheme();
  const color = tone === "success" ? t.success : t.text;
  const style = { color, fontSize: strong ? 18 : 15, fontWeight: strong ? ("800" as const) : tone ? ("600" as const) : ("400" as const) };
  return (
    <View style={styles.summaryRow}>
      <Text style={[style, !strong && !tone && { color: t.muted }]}>{label}</Text>
      <Text style={style}>{value}</Text>
    </View>
  );
}

/**
 * Distancia entre el GPS y la dirección elegida, si supera FAR_FROM_ADDRESS_METERS (ADR 0034). Solo
 * con el permiso de ubicación ya dado: el checkout nunca lo pide.
 */
function useFarFromAddress(target: LatLng | null): number | null {
  // Se guarda para qué punto se midió: al cambiar de dirección, la medición vieja deja de valer.
  const [far, setFar] = useState<{ key: string; meters: number } | null>(null);
  const lat = target?.lat;
  const lng = target?.lng;
  const key = `${lat},${lng}`;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let cancelled = false;
    void positionIfAllowed().then((here) => {
      if (cancelled || !here) return;
      const meters = distanceMeters(here, { lat, lng });
      setFar(meters > FAR_FROM_ADDRESS_METERS ? { key: `${lat},${lng}`, meters } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);
  return far && far.key === key && lat !== undefined ? far.meters : null;
}

const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

const styles = StyleSheet.create({
  farNotice: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, padding: space.sm },
  couponRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  couponApply: { borderRadius: radius.md, paddingHorizontal: space.lg, height: 46, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  content: { padding: space.lg, paddingTop: space.sm, gap: space.md, paddingBottom: space.xl },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.sm },
  backButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },

  etaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -space.xs },
  segmented: { flexDirection: "row", borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, alignItems: "center", borderRadius: radius.pill, paddingVertical: 7 },
  segmentLabel: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },
  segmentDetail: { fontSize: 12 },

  suggestScroll: { marginHorizontal: -space.lg, flexGrow: 0 },
  suggestRow: { paddingHorizontal: space.lg, gap: space.md },

  detailRow: { paddingVertical: space.md, gap: space.sm },
  detailHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  detailText: { flex: 1, gap: 2 },
  detailTitle: { fontSize: 15, fontWeight: "600" },
  detailBody: { paddingLeft: 20 + space.md, gap: space.xs },
  rowAction: { fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  noteInput: { minHeight: 72, textAlignVertical: "top" },

  emptyIcon: { width: 88, height: 88, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontFamily: font.display, fontSize: 20, fontWeight: "700" },

  merchant: { flexDirection: "row", alignItems: "center", gap: space.md },
  merchantIcon: { width: 44, height: 44, borderRadius: radius.sm, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  merchantName: { fontFamily: font.display, fontSize: 17, fontWeight: "700" },
  link: { fontSize: 14, fontWeight: "700" },
  meta: { fontSize: 13 },

  card: { borderRadius: radius.lg, paddingHorizontal: space.md },
  cardPadded: { paddingVertical: space.md, gap: space.md },

  line: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  lineBody: { flex: 1, gap: 2 },
  lineEdit: { alignSelf: "flex-start", marginTop: 2 },
  lineName: { fontSize: 15, fontWeight: "700" },
  lineFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xs },
  linePrice: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },
  qty: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.pill, padding: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  qtyValue: { fontSize: 15, fontWeight: "700", minWidth: 18, textAlign: "center" },

  section: { fontFamily: font.display, fontSize: 18, fontWeight: "700", marginTop: space.sm },

  infoText: { fontSize: 15 },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill },

  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  divider: { height: StyleSheet.hairlineWidth },

  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  footerStatus: { flexDirection: "row", alignItems: "center", gap: space.sm },
  footerStatusText: { fontSize: 14, fontWeight: "600", flex: 1 },
  savings: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: space.xl },
  savingsText: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },
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
