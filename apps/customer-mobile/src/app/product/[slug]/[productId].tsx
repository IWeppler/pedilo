import type { PublicProduct } from "@pedilo/api-client";
import { formatARSWhole, priceSelection, SelectionError } from "@pedilo/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Text, TextInput } from "@/components/text";
import { Photo } from "@/components/photo";
import { categoryIcon, Icon, type IconName } from "@/components/icon";
import { Badge, ErrorState, Loading } from "@/components/ui";
import { useMerchantCategories, useMerchantMenu } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { font, radius, space, useTheme } from "@/lib/theme";

/**
 * Detalle de producto: variante, opciones y cantidad. El precio y las validaciones salen de
 * `priceSelection` (@pedilo/domain), la misma regla que va a usar la API en el checkout.
 */
export default function ProductScreen() {
  const t = useTheme();
  const router = useRouter();
  const { slug, productId } = useLocalSearchParams<{ slug: string; productId: string }>();
  const menu = useMerchantMenu(slug);
  const categories = useMerchantCategories();
  const product = useMemo(
    () => menu.data?.sections.flatMap((s) => s.products).find((p) => p.id === productId),
    [menu.data, productId],
  );

  if (menu.isPending) return <Loading />;
  if (!product) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <ErrorState message="Este producto ya no está disponible." onRetry={() => router.back()} />
      </SafeAreaView>
    );
  }
  const merchant = menu.data!.merchant;
  const branch = merchant.branches[0];
  const categorySlug = categories.data?.find((c) => c.id === merchant.categoryId)?.slug;
  return (
    <ProductDetail
      product={product}
      merchant={{ merchantSlug: merchant.slug, merchantName: merchant.displayName, branchId: branch?.id ?? "" }}
      branchOpen={branch?.openNow ?? false}
      icon={categoryIcon(categorySlug)}
      onClose={() => router.back()}
    />
  );
}

function ProductDetail({
  product,
  merchant,
  branchOpen,
  icon,
  onClose,
}: {
  product: PublicProduct;
  merchant: { merchantSlug: string; merchantName: string; branchId: string };
  branchOpen: boolean;
  icon: IconName;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { cart, add } = useCart();
  const [notes, setNotes] = useState("");
  const [variantId, setVariantId] = useState<string | null>(
    // Si hay una sola variante disponible, viene elegida.
    product.variants.filter((v) => v.available).length === 1 ? product.variants.find((v) => v.available)!.id : null,
  );
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);

  const result = priceSelection(product, {
    variantId,
    modifiers: Object.entries(picks)
      .filter(([, q]) => q > 0)
      .map(([modifierId, q]) => ({ modifierId, quantity: q })),
  });

  const groupCount = (groupId: string) =>
    product.modifierGroups.find((g) => g.id === groupId)!.modifiers.reduce((n, m) => n + (picks[m.id] ?? 0), 0);

  const setPick = (groupId: string, modifierId: string, next: number) => {
    const group = product.modifierGroups.find((g) => g.id === groupId)!;
    setPicks((prev) => {
      // Grupo de una sola elección: elegir una opción reemplaza a la anterior.
      if (group.maxSelect === 1 && next > 0) {
        const cleared = { ...prev };
        for (const m of group.modifiers) delete cleared[m.id];
        return { ...cleared, [modifierId]: 1 };
      }
      return { ...prev, [modifierId]: next };
    });
  };

  const hint = selectionHint(product, result);
  const total = result.ok ? result.unitPriceMinor * quantity : null;
  const otherMerchant = cart && cart.merchantSlug !== merchant.merchantSlug ? cart.merchantName : null;
  const canAdd = result.ok && branchOpen && merchant.branchId !== "";
  const basePrice = product.variants.length > 0 ? `desde ${formatARSWhole(product.fromPriceMinor)}` : formatARSWhole(product.priceMinor);

  const addToCart = () => {
    if (!result.ok) return;
    const variant = product.variants.find((v) => v.id === result.variantId);
    const modifiers = product.modifierGroups.flatMap((g) =>
      g.modifiers
        .filter((m) => (picks[m.id] ?? 0) > 0)
        .map((m) => ({ modifierId: m.id, name: m.name, quantity: picks[m.id]!, priceDeltaMinor: m.priceDeltaMinor })),
    );
    add(merchant, {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      modifiers,
      quantity,
      unitPriceMinor: result.unitPriceMinor,
      notes: notes.trim() || null,
    });
    onClose();
  };

  // En iOS la pantalla es una hoja (sheet) y no necesita margen superior; en Android ocupa todo.
  const topGap = Platform.OS === "ios" ? space.md : insets.top + space.sm;

  return (
    <View style={[styles.screen, { backgroundColor: t.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Foto del producto o, si no tiene, el ícono del rubro */}
          <View style={[styles.hero, { backgroundColor: t.surface, paddingTop: topGap }]}>
            <Photo
              url={product.imageUrl}
              style={StyleSheet.absoluteFill}
              accessibilityLabel={product.name}
              fallback={
                <View style={[styles.heroArt, { backgroundColor: t.card }]}>
                  <Icon name={icon} size={64} color={t.muted} />
                </View>
              }
            />
          </View>

          <View style={[styles.sheet, { backgroundColor: t.background }]}>
            <Text style={[styles.title, { color: t.text }]}>{product.name}</Text>
            <Text style={[styles.basePrice, { color: t.text }]}>{basePrice}</Text>
            {product.description && <Text style={[styles.description, { color: t.muted }]}>{product.description}</Text>}
            {!product.available && <Badge label="Sin stock por ahora" tone="danger" />}

            {product.variants.length > 0 && (
              <Group title="Elegí una opción" required done={variantId !== null} rule="Obligatorio">
                {product.variants.map((v, i) => (
                  <OptionRow
                    key={v.id}
                    label={v.name}
                    price={formatARSWhole(v.priceMinor)}
                    selected={variantId === v.id}
                    disabled={!v.available}
                    kind="radio"
                    last={i === product.variants.length - 1}
                    onPress={() => setVariantId(v.id)}
                  />
                ))}
              </Group>
            )}

            {product.modifierGroups.map((g) => {
              const count = groupCount(g.id);
              const full = count >= g.maxSelect;
              return (
                <Group key={g.id} title={g.name} required={g.minSelect > 0} done={count >= g.minSelect && count > 0} rule={groupRule(g.minSelect, g.maxSelect)}>
                  {g.modifiers.map((m, i) => {
                    const q = picks[m.id] ?? 0;
                    const price = m.priceDeltaMinor > 0 ? `+ ${formatARSWhole(m.priceDeltaMinor)}` : "";
                    const last = i === g.modifiers.length - 1;
                    if (m.maxQuantity > 1 && g.maxSelect > 1) {
                      return (
                        <StepperRow
                          key={m.id}
                          label={m.name}
                          price={price}
                          value={q}
                          disabled={!m.available}
                          canAdd={!full && q < m.maxQuantity}
                          last={last}
                          onChange={(next) => setPick(g.id, m.id, next)}
                        />
                      );
                    }
                    return (
                      <OptionRow
                        key={m.id}
                        label={m.name}
                        price={price}
                        selected={q > 0}
                        disabled={!m.available || (g.maxSelect > 1 && full && q === 0)}
                        kind={g.maxSelect === 1 ? "radio" : "check"}
                        last={last}
                        onPress={() => setPick(g.id, m.id, g.maxSelect === 1 ? 1 : q > 0 ? 0 : 1)}
                      />
                    );
                  })}
                </Group>
              );
            })}

            <Text style={[styles.label, { color: t.text }]}>Aclaraciones</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Por ejemplo: sin cebolla"
              placeholderTextColor={t.muted}
              maxLength={200}
              multiline
              accessibilityLabel="Aclaraciones para el comercio"
              style={[styles.notes, { backgroundColor: t.surface, color: t.text }]}
            />
          </View>
        </ScrollView>

        {/* Pie fijo: cantidad + agregar */}
        <View
          style={[
            styles.footer,
            { backgroundColor: t.card, borderColor: t.border, paddingBottom: Math.max(insets.bottom, space.md) },
          ]}
        >
          {hint && <Text style={[styles.footerNote, { color: t.muted }]}>{hint}</Text>}
          {!hint && !branchOpen && <Text style={[styles.footerNote, { color: t.muted }]}>El comercio está cerrado ahora.</Text>}
          {otherMerchant && canAdd && (
            <Text style={[styles.footerNote, { color: t.muted }]}>
              Tenés un pedido en curso de {otherMerchant}. Si agregás esto, se reemplaza.
            </Text>
          )}
          <View style={styles.footerRow}>
            <View style={[styles.quantityPill, { backgroundColor: t.surface }]}>
              <Stepper value={quantity} min={1} max={20} onChange={setQuantity} label="Cantidad" />
            </View>
            <Pressable
              onPress={addToCart}
              disabled={!canAdd}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdd }}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: t.primary, opacity: !canAdd ? 0.4 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.addText, { color: t.primaryText }]} numberOfLines={1}>
                {otherMerchant ? "Vaciar y agregar" : "Agregar"}
              </Text>
              {total !== null && <Text style={[styles.addText, { color: t.primaryText }]}>{formatARSWhole(total)}</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Cerrar, flotante sobre la imagen */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar"
        onPress={onClose}
        hitSlop={8}
        style={[styles.close, { top: topGap, backgroundColor: t.card }]}
      >
        <Icon name="close" size={20} color={t.text} />
      </Pressable>
    </View>
  );
}

/** Qué le falta elegir al cliente, en lenguaje simple. */
function selectionHint(product: PublicProduct, result: ReturnType<typeof priceSelection>): string | null {
  if (result.ok) return null;
  const first = result.errors[0]!;
  const group = product.modifierGroups.find((g) => g.id === first.ref);
  switch (first.error) {
    case SelectionError.PRODUCT_UNAVAILABLE:
      return "Este producto no está disponible ahora.";
    case SelectionError.VARIANT_REQUIRED:
      return "Elegí una opción para continuar.";
    case SelectionError.GROUP_MIN_NOT_MET:
      return group ? `Elegí ${group.minSelect === 1 ? "una opción" : `${group.minSelect} opciones`} en «${group.name}».` : null;
    case SelectionError.GROUP_MAX_EXCEEDED:
      return group ? `En «${group.name}» podés elegir hasta ${group.maxSelect}.` : null;
    default:
      return "Revisá tu elección.";
  }
}

function groupRule(min: number, max: number): string {
  if (min === 0) return max === 1 ? "Opcional" : `Opcional · hasta ${max}`;
  if (min === max) return min === 1 ? "Obligatorio" : `Obligatorio · elegí ${min}`;
  return `Obligatorio · de ${min} a ${max}`;
}

/** Bloque de opciones. Los obligatorios llevan etiqueta roja que pasa a «Listo» al completarse. */
function Group({
  title,
  rule,
  required,
  done,
  children,
}: {
  title: string;
  rule: string;
  required: boolean;
  done: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  const tag = required ? (done ? { label: "Listo", bg: t.successBg, fg: t.success } : { label: "Obligatorio", bg: t.accentSoft, fg: t.accent }) : null;
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.groupTitle, { color: t.text }]}>{title}</Text>
          <Text style={[styles.groupRule, { color: t.muted }]}>{rule}</Text>
        </View>
        {tag && (
          <View style={[styles.groupTag, { backgroundColor: tag.bg }]}>
            {done && <Icon name="check" size={12} color={tag.fg} />}
            <Text style={[styles.groupTagText, { color: tag.fg }]}>{tag.label}</Text>
          </View>
        )}
      </View>
      <View style={[styles.groupCard, { borderColor: t.border }]}>{children}</View>
    </View>
  );
}

function OptionRow({
  label,
  price,
  selected,
  disabled,
  kind,
  last,
  onPress,
}: {
  label: string;
  price: string;
  selected: boolean;
  disabled: boolean;
  kind: "radio" | "check";
  last: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind === "radio" ? "radio" : "checkbox"}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${label} ${price}${disabled ? ", no disponible" : ""}`}
      style={({ pressed }) => [
        styles.option,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
        { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {kind === "radio" ? (
        <View style={[styles.radio, { borderColor: selected ? t.primary : t.border }]}>
          {selected && <View style={[styles.radioDot, { backgroundColor: t.primary }]} />}
        </View>
      ) : (
        <View style={[styles.check, { borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primary : "transparent" }]}>
          {selected && <Icon name="check" size={14} color={t.primaryText} />}
        </View>
      )}
      <Text style={[styles.optionLabel, { color: t.text, fontWeight: selected ? "600" : "400" }]}>{label}</Text>
      <Text style={[styles.optionPrice, { color: t.muted }]}>{disabled && !selected ? "Sin stock" : price}</Text>
    </Pressable>
  );
}

function StepperRow({
  label,
  price,
  value,
  disabled,
  canAdd,
  last,
  onChange,
}: {
  label: string;
  price: string;
  value: number;
  disabled: boolean;
  canAdd: boolean;
  last: boolean;
  onChange: (v: number) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.option,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border },
        { opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: t.text, fontWeight: value > 0 ? "600" : "400" }]}>{label}</Text>
        {price ? <Text style={[styles.optionPrice, { color: t.muted }]}>{price}</Text> : null}
      </View>
      <Stepper value={value} min={0} max={canAdd ? value + 1 : value} onChange={onChange} label={label} disabled={disabled} />
    </View>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  const btn = (icon: IconName, next: number, enabled: boolean, a11y: string, filled: boolean) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={!enabled || disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={8}
      style={[
        styles.stepBtn,
        filled
          ? { backgroundColor: t.primary, borderColor: t.primary }
          : { backgroundColor: t.card, borderColor: t.border },
        { opacity: enabled && !disabled ? 1 : 0.3 },
      ]}
    >
      <Icon name={icon} size={18} color={filled ? t.primaryText : t.text} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn("remove", value - 1, value > min, `Quitar uno de ${label}`, false)}
      <Text style={[styles.stepValue, { color: t.text }]} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {btn("add", value + 1, value < max, `Agregar uno de ${label}`, true)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: space.xl },

  hero: { height: 230, alignItems: "center", justifyContent: "center" },
  heroArt: { width: 130, height: 130, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", right: space.lg, width: 38, height: 38, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },

  sheet: { padding: space.lg, paddingTop: space.xl, gap: space.sm },
  title: { fontFamily: font.display, fontSize: 28, lineHeight: 31, fontWeight: "800", letterSpacing: -0.5 },
  basePrice: { fontFamily: font.display, fontSize: 18, fontWeight: "700" },
  description: { fontSize: 15, lineHeight: 21 },

  group: { marginTop: space.lg, gap: space.sm },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  groupTitle: { fontFamily: font.display, fontSize: 17, fontWeight: "700" },
  groupRule: { fontSize: 13 },
  groupTag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 4 },
  groupTagText: { fontSize: 12, fontWeight: "700" },
  groupCard: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: space.md },

  option: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, minHeight: 52 },
  optionLabel: { fontSize: 16, flex: 1 },
  optionPrice: { fontSize: 14 },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },

  label: { fontFamily: font.display, fontSize: 17, fontWeight: "700", marginTop: space.lg },
  notes: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 15, minHeight: 64, textAlignVertical: "top" },

  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepBtn: { width: 34, height: 34, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepValue: { fontSize: 16, fontWeight: "700", minWidth: 22, textAlign: "center" },

  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  footerNote: { fontSize: 13, textAlign: "center" },
  footerRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  quantityPill: { borderRadius: radius.pill, padding: 6 },
  addButton: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    height: 52,
  },
  addText: { fontFamily: font.display, fontSize: 16, fontWeight: "700" },
});
