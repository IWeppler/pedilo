import type { PublicProduct } from "@pedilo/api-client";
import { formatARSWhole, offerUnitPrice } from "@pedilo/domain";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { Photo } from "@/components/photo";
import { Text } from "@/components/text";
import { font, radius, useTheme } from "@/lib/theme";

export type Offer = Parameters<typeof offerUnitPrice>[0];

/** Precio base del producto («desde» si tiene variantes) y el menor precio con oferta, si alguna aplica sin condiciones. */
export function productPrices(p: PublicProduct, offers: Offer[]) {
  const base = p.variants.length > 0 ? p.fromPriceMinor : p.priceMinor;
  const offerPrices = offers.map((o) => offerUnitPrice(o, p.id, base)).filter((v): v is number => v !== null);
  return {
    base,
    offer: offerPrices.length > 0 ? Math.min(...offerPrices) : null,
    prefix: p.variants.length > 0 ? "desde " : "",
  };
}

/**
 * Producto en tarjeta con foto grande, para filas horizontales (sugerencias del carrito, descuentos
 * del menú). Tocar la tarjeta abre la ficha; el «+» llama a `onAdd`, que devuelve si lo agregó
 * directo: en ese caso el botón muestra un tilde un momento.
 */
export function ProductTile({
  product: p,
  offers,
  icon,
  size = 128,
  onOpen,
  onAdd,
}: {
  product: PublicProduct;
  offers: Offer[];
  icon: IconName;
  size?: number;
  onOpen: () => void;
  onAdd: () => boolean;
}) {
  const t = useTheme();
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const id = setTimeout(() => setAdded(false), 1200);
    return () => clearTimeout(id);
  }, [added]);

  const { base, offer, prefix } = productPrices(p, offers);
  const price = `${prefix}${formatARSWhole(offer ?? base)}`;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${p.name}, ${price}`} style={[styles.tile, { width: size }]}>
      <View style={[styles.photo, { width: size, height: size, backgroundColor: t.surface }]}>
        <Photo url={p.imageUrl} style={StyleSheet.absoluteFill} fallback={<Icon name={icon} size={30} color={t.muted} />} />
        {offer !== null && (
          <Text style={[styles.offerTag, { backgroundColor: t.accent, color: t.accentText }]}>
            −{Math.round((1 - offer / base) * 100)}%
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => {
          if (onAdd()) setAdded(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={added ? `${p.name} agregado` : `Agregar ${p.name}`}
        hitSlop={8}
        style={[styles.add, { top: size - 38, backgroundColor: added ? t.success : t.primary, borderColor: t.background }]}
      >
        <Icon name={added ? "check" : "add"} size={18} color={t.primaryText} />
      </Pressable>
      <Text numberOfLines={2} style={[styles.name, { color: t.text }]}>
        {p.name}
      </Text>
      <View style={styles.prices}>
        <Text style={[styles.price, { color: offer !== null ? t.accent : t.text }]}>{price}</Text>
        {offer !== null && <Text style={[styles.was, { color: t.muted }]}>{formatARSWhole(base)}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { gap: 4 },
  photo: { borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  offerTag: {
    position: "absolute",
    top: 8,
    left: 8,
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "800",
  },
  add: {
    position: "absolute",
    right: 6,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  prices: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  price: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },
  was: { fontSize: 13, textDecorationLine: "line-through" },
});
