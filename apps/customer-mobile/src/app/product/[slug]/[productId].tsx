import type { PublicProduct } from "@pedilo/api-client";
import { formatARS, priceSelection, SelectionError } from "@pedilo/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Button, ErrorState, Loading } from "@/components/ui";
import { useMerchantMenu } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { space, useTheme } from "@/lib/theme";

/**
 * Detalle de producto: variante, opciones y cantidad. El precio y las validaciones salen de
 * `priceSelection` (@pedilo/domain), la misma regla que va a usar la API en el checkout.
 */
export default function ProductScreen() {
  const t = useTheme();
  const router = useRouter();
  const { slug, productId } = useLocalSearchParams<{ slug: string; productId: string }>();
  const menu = useMerchantMenu(slug);
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
  return (
    <ProductDetail
      product={product}
      merchant={{ merchantSlug: merchant.slug, merchantName: merchant.displayName, branchId: branch?.id ?? "" }}
      branchOpen={branch?.openNow ?? false}
      onClose={() => router.back()}
    />
  );
}

function ProductDetail({
  product,
  merchant,
  branchOpen,
  onClose,
}: {
  product: PublicProduct;
  merchant: { merchantSlug: string; merchantName: string; branchId: string };
  branchOpen: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
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

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={{ color: t.muted, fontSize: 16 }}>Cerrar</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.text }]}>{product.name}</Text>
        {product.description && <Text style={{ color: t.muted, fontSize: 15 }}>{product.description}</Text>}
        {!product.available && <Badge label="Sin stock por ahora" tone="danger" />}

        {product.variants.length > 0 && (
          <Group title="Elegí una opción" subtitle="Obligatorio">
            {product.variants.map((v) => (
              <OptionRow
                key={v.id}
                label={v.name}
                price={formatARS(v.priceMinor)}
                selected={variantId === v.id}
                disabled={!v.available}
                kind="radio"
                onPress={() => setVariantId(v.id)}
              />
            ))}
          </Group>
        )}

        {product.modifierGroups.map((g) => {
          const count = groupCount(g.id);
          const full = count >= g.maxSelect;
          return (
            <Group key={g.id} title={g.name} subtitle={groupRule(g.minSelect, g.maxSelect)}>
              {g.modifiers.map((m) => {
                const q = picks[m.id] ?? 0;
                const price = m.priceDeltaMinor > 0 ? `+ ${formatARS(m.priceDeltaMinor)}` : "";
                if (m.maxQuantity > 1 && g.maxSelect > 1) {
                  return (
                    <StepperRow
                      key={m.id}
                      label={m.name}
                      price={price}
                      value={q}
                      disabled={!m.available}
                      canAdd={!full && q < m.maxQuantity}
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
                    onPress={() => setPick(g.id, m.id, g.maxSelect === 1 ? 1 : q > 0 ? 0 : 1)}
                  />
                );
              })}
            </Group>
          );
        })}

        <Text style={{ color: t.text, fontSize: 16, fontWeight: "600", marginTop: space.md }}>Aclaraciones</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Por ejemplo: sin cebolla"
          placeholderTextColor={t.muted}
          maxLength={200}
          accessibilityLabel="Aclaraciones para el comercio"
          style={[styles.notes, { backgroundColor: t.surface, color: t.text }]}
        />

        <View style={styles.quantity}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>Cantidad</Text>
          <Stepper value={quantity} min={1} max={20} onChange={setQuantity} label="Cantidad" />
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.background }]}>
        {hint && <Text style={{ color: t.muted, textAlign: "center" }}>{hint}</Text>}
        {otherMerchant && canAdd && (
          <Text style={{ color: t.muted, fontSize: 13, textAlign: "center" }}>
            Tenés un pedido en curso de {otherMerchant}. Si agregás esto, se reemplaza.
          </Text>
        )}
        <Button
          label={
            total === null
              ? "Agregar al pedido"
              : otherMerchant
                ? `Vaciar y agregar · ${formatARS(total)}`
                : `Agregar al pedido · ${formatARS(total)}`
          }
          disabled={!canAdd}
          onPress={addToCart}
        />
        {!branchOpen && (
          <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>El comercio está cerrado ahora.</Text>
        )}
      </View>
    </SafeAreaView>
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

function Group({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.group}>
      <View style={[styles.groupHeader, { backgroundColor: t.surface }]}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

function OptionRow({
  label,
  price,
  selected,
  disabled,
  kind,
  onPress,
}: {
  label: string;
  price: string;
  selected: boolean;
  disabled: boolean;
  kind: "radio" | "check";
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
      style={[styles.option, { borderColor: t.border, opacity: disabled ? 0.4 : 1 }]}
    >
      <View
        style={[
          kind === "radio" ? styles.radio : styles.check,
          { borderColor: selected ? t.primary : t.muted, backgroundColor: selected ? t.primary : "transparent" },
        ]}
      />
      <Text style={{ color: t.text, fontSize: 16, flex: 1 }}>{label}</Text>
      <Text style={{ color: t.muted }}>{disabled && !selected ? "Sin stock" : price}</Text>
    </Pressable>
  );
}

function StepperRow({
  label,
  price,
  value,
  disabled,
  canAdd,
  onChange,
}: {
  label: string;
  price: string;
  value: number;
  disabled: boolean;
  canAdd: boolean;
  onChange: (v: number) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.option, { borderColor: t.border, opacity: disabled ? 0.4 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {price ? <Text style={{ color: t.muted }}>{price}</Text> : null}
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
  const btn = (text: string, next: number, enabled: boolean, a11y: string) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={!enabled || disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={8}
      style={[styles.stepBtn, { borderColor: t.border, opacity: enabled && !disabled ? 1 : 0.3 }]}
    >
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn("−", value - 1, value > min, `Quitar uno de ${label}`)}
      <Text style={{ color: t.text, fontSize: 16, minWidth: 20, textAlign: "center" }} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {btn("+", value + 1, value < max, `Agregar uno de ${label}`)}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  close: { alignSelf: "flex-end" },
  title: { fontSize: 24, fontWeight: "800" },
  group: { gap: 0, marginTop: space.sm },
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: space.md, borderRadius: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  check: { width: 20, height: 20, borderRadius: 4, borderWidth: 2 },
  notes: { borderRadius: 12, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 15 },
  quantity: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: space.sm },
  stepBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
});
