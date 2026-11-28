import type { paths, PublicProduct } from "@pedilo/api-client";
import { formatARSWhole } from "@pedilo/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  TextInput as RNTextInput,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Text, TextInput } from "@/components/text";
import { CartBar } from "@/components/cart-bar";
import { Photo } from "@/components/photo";
import { ProductTile, productPrices } from "@/components/product-tile";
import { categoryIcon, Icon, type IconName } from "@/components/icon";
import { Badge, Centered, ErrorState, Loading } from "@/components/ui";
import { useMerchantCategories, useMerchantMenu } from "@/lib/api";
import { etaLabel } from "@/lib/merchant-labels";
import { useQuickAdd } from "@/lib/quick-add";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

type PublicOffer = paths["/v1/public/merchants/{slug}"]["get"]["responses"][200]["content"]["application/json"]["offers"][number];

interface MenuSectionData {
  key: string;
  title: string;
  data: PublicProduct[];
}

const BAR_HEIGHT = 52;
const TABS_HEIGHT = 48;

/**
 * Menú de un comercio: portada, datos de la sucursal y productos por sección, con búsqueda.
 * Al pasar la portada aparece una barra fija con el nombre y las secciones para saltar entre ellas.
 */
export default function MerchantScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const menu = useMerchantMenu(slug);
  const categories = useMerchantCategories();
  const [query, setQuery] = useState("");
  const [headerHeight, setHeaderHeight] = useState(0);
  const [compact, setCompact] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<SectionList<PublicProduct, MenuSectionData>>(null);
  const searchRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  // Mientras se salta a una sección tocando su pestaña, no se pisa la pestaña activa al scrollear.
  const jumpingTo = useRef<string | null>(null);

  const sections = useMemo<MenuSectionData[]>(() => {
    const q = normalize(query);
    return (menu.data?.sections ?? [])
      .map((s) => ({
        key: s.id ?? "otros",
        title: s.name,
        data: s.products.filter((p) => !q || normalize(`${p.name} ${p.description ?? ""}`).includes(q)),
      }))
      .filter((s) => s.data.length > 0);
  }, [menu.data, query]);

  // Lo más pedido (lo calcula la API): en su orden, solo lo que sigue en el menú y disponible.
  const popular = useMemo(() => {
    const byId = new Map((menu.data?.sections ?? []).flatMap((s) => s.products).map((p) => [p.id, p]));
    return (menu.data?.popularProductIds ?? []).map((id) => byId.get(id)).filter((p): p is PublicProduct => Boolean(p?.available));
  }, [menu.data]);

  // Con descuento: los productos con precio de oferta fijo (porcentaje sin mínimo), el mayor ahorro
  // primero. Sin repetir los que ya están en «Lo más pedido».
  const discounted = useMemo(() => {
    const offers = menu.data?.offers ?? [];
    if (offers.length === 0) return [];
    const seen = new Set<string>(popular.length >= 2 ? popular.map((p) => p.id) : []);
    return (menu.data?.sections ?? [])
      .flatMap((s) => s.products)
      .filter((p) => p.available && !seen.has(p.id) && seen.add(p.id))
      .map((p) => ({ p, prices: productPrices(p, offers) }))
      .filter((x) => x.prices.offer !== null)
      .sort((a, b) => b.prices.base - b.prices.offer! - (a.prices.base - a.prices.offer!))
      .slice(0, 10)
      .map((x) => x.p);
  }, [menu.data, popular]);

  const firstBranch = menu.data?.merchant.branches[0];
  const quickAdd = useQuickAdd({
    merchantSlug: menu.data?.merchant.slug ?? "",
    merchantName: menu.data?.merchant.displayName ?? "",
    branchId: firstBranch?.id ?? "",
    open: firstBranch?.openNow ?? false,
  });

  // Estable: SectionList no admite cambiar onViewableItemsChanged después de montarse.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { section?: unknown }[] }) => {
    const first = viewableItems.find((v) => v.section);
    const key = (first?.section as MenuSectionData | undefined)?.key ?? null;
    if (jumpingTo.current) {
      if (key === jumpingTo.current) jumpingTo.current = null;
      return;
    }
    if (key) setActiveKey(key);
  }, []);

  if (menu.isPending) return <Loading />;
  if (menu.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
        <ErrorState message="No pudimos cargar este comercio." onRetry={() => menu.refetch()} />
      </SafeAreaView>
    );
  }

  const { merchant, offers, rating } = menu.data;
  const category = categories.data?.find((c) => c.id === merchant.categoryId);
  const icon = categoryIcon(category?.slug);
  // MVP: se muestra la primera sucursal activa (la mayoría de los comercios del piloto tiene una).
  const branch = merchant.branches[0];
  const fees = branch?.zones.map((z) => z.feeMinor) ?? [];
  const minOrders = branch?.zones.map((z) => z.minOrderMinor).filter((v) => v > 0) ?? [];
  const minFee = fees.length > 0 ? Math.min(...fees) : null;
  const currentKey = activeKey ?? sections[0]?.key ?? null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const next = headerHeight > 0 && y > headerHeight - BAR_HEIGHT - insets.top;
    if (next !== compact) setCompact(next);
  };

  const jumpTo = (key: string) => {
    const sectionIndex = sections.findIndex((s) => s.key === key);
    if (sectionIndex < 0) return;
    jumpingTo.current = key;
    setActiveKey(key);
    listRef.current?.scrollToLocation({
      sectionIndex,
      itemIndex: 0,
      viewOffset: insets.top + BAR_HEIGHT + TABS_HEIGHT,
      animated: true,
    });
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const openProduct = (p: PublicProduct) => router.push({ pathname: "/product/[slug]/[productId]", params: { slug, productId: p.id } });
  // El «+»: agrega directo si se puede; si no (pide elegir opciones, está cerrado, hay otro pedido), abre la ficha.
  const addOrOpen = (p: PublicProduct) => {
    if (quickAdd(p)) return true;
    openProduct(p);
    return false;
  };

  // Desde la barra compacta: vuelve arriba y abre el teclado en el buscador.
  const openSearch = () => {
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true });
    setTimeout(() => searchRef.current?.focus(), 350);
  };

  return (
    <View style={[styles.screen, { backgroundColor: t.background }]}>
      {/* Íconos claros sobre la portada oscura; normales con la barra compacta. */}
      <StatusBar style={compact ? "dark" : "light"} />
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={32}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        // Los menús del piloto son chicos: renderizar todo hace que saltar a una sección sea exacto.
        initialNumToRender={500}
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={
          <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
            {/* Portada: la foto del comercio o, si no tiene, el ícono del rubro sobre la tinta de marca */}
            <View style={[styles.cover, { backgroundColor: t.primary, paddingTop: insets.top }]}>
              <Photo
                url={merchant.coverUrl}
                style={StyleSheet.absoluteFill}
                fallback={
                  <View style={styles.coverArt}>
                    <Icon name={icon} size={64} color={t.accent} />
                  </View>
                }
              />
            </View>

            {/* Datos del comercio */}
            <View style={styles.info}>
              {merchant.logoUrl && (
                <View style={[styles.logo, { backgroundColor: t.surface, borderColor: t.background }]}>
                  <Photo url={merchant.logoUrl} style={StyleSheet.absoluteFill} accessibilityLabel={`Logo de ${merchant.displayName}`} />
                </View>
              )}
              <Text style={[styles.title, { color: t.text }]}>{merchant.displayName}</Text>
              <View style={styles.badges}>
                {branch && (
                  <Badge
                    label={branch.openNow ? "Abierto ahora" : branch.closedToday ? `Cerrado hoy · ${branch.closedToday.reason}` : "Cerrado ahora"}
                    tone={branch.openNow ? "success" : branch.closedToday ? "danger" : "neutral"}
                  />
                )}
                {category && <Text style={[styles.meta, { color: t.muted }]}>{category.name}</Text>}
              </View>
              {branch && (
                <>
                  <View style={styles.address}>
                    <Icon name="location" size={16} color={t.muted} />
                    <Text style={[styles.meta, { color: t.muted, flex: 1 }]}>
                      {branch.addressLine}
                      {branch.addressNotes ? ` · ${branch.addressNotes}` : ""}
                    </Text>
                  </View>
                  <View style={[styles.facts, { borderTopColor: t.border }]}>
                    {rating && (
                      <Fact
                        icon="star"
                        label={`${rating.count} calificaciones`}
                        value={`${rating.average.toLocaleString("es-AR", { minimumFractionDigits: 1 })} de 5`}
                        t={t}
                      />
                    )}
                    {merchant.prepMinutes != null && (
                      <Fact
                        icon="clock"
                        label="Tiempo"
                        value={etaLabel({ prepMinutes: merchant.prepMinutes, acceptsDelivery: branch.acceptsDelivery && minFee !== null }) ?? ""}
                        t={t}
                      />
                    )}
                    {branch.acceptsPickup && <Fact icon="pickup" label="Retiro" value="Sin costo" t={t} />}
                    {branch.acceptsDelivery && minFee !== null && (
                      <Fact icon="delivery" label="Envío" value={minFee === 0 ? "Gratis" : `desde ${formatARSWhole(minFee)}`} t={t} />
                    )}
                    {minOrders.length > 0 && <Fact icon="cart" label="Mínimo" value={formatARSWhole(Math.min(...minOrders))} t={t} />}
                  </View>
                </>
              )}
            </View>

            {/* Ofertas vigentes (ADR 0030) */}
            {offers.length > 0 && (
              <View style={styles.offers}>
                {offers.map((o) => (
                  <View key={o.id} style={[styles.offerBox, { backgroundColor: t.accentSoft }]}>
                    <Text style={[styles.offerBoxLabel, { color: t.accent }]}>{o.label}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>{o.title}</Text>
                      <Text style={[styles.meta, { color: t.muted }]}>
                        {[
                          o.productIds ? "En productos marcados" : "En todo el menú",
                          o.minSubtotalMinor > 0 ? `desde ${formatARSWhole(o.minSubtotalMinor)}` : null,
                          o.maxDiscountMinor ? `hasta ${formatARSWhole(o.maxDiscountMinor)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Lo más pedido */}
            {popular.length >= 2 && (
              <>
                <Text style={[styles.rowTitle, { color: t.text }]}>Lo más pedido</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
                  {popular.map((p) => (
                    <ProductTile
                      key={p.id}
                      product={p}
                      offers={offers}
                      icon={icon}
                      size={148}
                      onOpen={() => openProduct(p)}
                      onAdd={() => addOrOpen(p)}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            {/* Con descuento */}
            {discounted.length >= 2 && (
              <>
                <Text style={[styles.rowTitle, { color: t.text }]}>Con descuento</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
                  {discounted.map((p) => (
                    <ProductTile
                      key={p.id}
                      product={p}
                      offers={offers}
                      icon={icon}
                      size={148}
                      onOpen={() => openProduct(p)}
                      onAdd={() => addOrOpen(p)}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            {/* Búsqueda */}
            <View style={[styles.search, { backgroundColor: t.surface }]}>
              <Icon name="search" size={20} color={t.muted} />
              <TextInput
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar en el menú"
                placeholderTextColor={t.muted}
                accessibilityLabel="Buscar en el menú"
                style={[styles.searchInput, { color: t.text }]}
                clearButtonMode="while-editing"
              />
            </View>

            {sections.length > 1 && (
              <SectionTabs sections={sections} activeKey={currentKey} onPress={jumpTo} style={{ marginTop: space.md }} />
            )}
          </View>
        }
        ListEmptyComponent={
          <Centered>
            <Icon name="store" size={40} color={t.muted} />
            <Text style={{ color: t.muted, textAlign: "center" }}>
              {query ? `Nada coincide con «${query.trim()}».` : "Este comercio todavía no cargó su menú."}
            </Text>
          </Centered>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.text }]}>{section.title}</Text>
            <Text style={[styles.meta, { color: t.muted }]}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ProductCard product={item} offers={offers} icon={icon} onPress={() => openProduct(item)} onAdd={() => addOrOpen(item)} />
        )}
      />

      {/* Botón volver flotante sobre la portada */}
      {!compact && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={back}
          hitSlop={8}
          style={[styles.floatingBack, { top: insets.top + space.sm, backgroundColor: t.card }]}
        >
          <Icon name="back" size={22} color={t.text} />
        </Pressable>
      )}

      {/* Barra compacta al pasar la portada */}
      {compact && (
        <View style={[styles.compact, { paddingTop: insets.top, backgroundColor: t.background, borderBottomColor: t.border }]}>
          <View style={styles.compactBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={back} hitSlop={12} style={styles.compactBack}>
              <Icon name="back" size={22} color={t.text} />
            </Pressable>
            <Text style={[styles.compactTitle, { color: t.text }]} numberOfLines={1}>
              {merchant.displayName}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Buscar en el menú" onPress={openSearch} hitSlop={12} style={styles.compactBack}>
              <Icon name="search" size={22} color={t.text} />
            </Pressable>
          </View>
          {sections.length > 1 && <SectionTabs sections={sections} activeKey={currentKey} onPress={jumpTo} />}
        </View>
      )}

      <CartBar onlyFor={slug} />
    </View>
  );
}

function SectionTabs({
  sections,
  activeKey,
  onPress,
  style,
}: {
  sections: MenuSectionData[];
  activeKey: string | null;
  onPress: (key: string) => void;
  style?: object;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ height: TABS_HEIGHT, flexGrow: 0 }, style]}
      contentContainerStyle={styles.tabs}
    >
      {sections.map((s) => {
        const active = s.key === activeKey;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onPress(s.key)}
            style={[styles.tab, { backgroundColor: active ? t.primary : t.surface }]}
          >
            <Text style={[styles.tabText, { color: active ? t.primaryText : t.text }]}>{s.title}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Fact({ icon, label, value, t }: { icon: IconName; label: string; value: string; t: Theme }) {
  return (
    <View style={styles.fact}>
      <View style={[styles.factIcon, { backgroundColor: t.surface }]}>
        <Icon name={icon} size={16} color={t.text} />
      </View>
      <View>
        <Text style={[styles.factLabel, { color: t.muted }]}>{label}</Text>
        <Text style={[styles.factValue, { color: t.text }]}>{value}</Text>
      </View>
    </View>
  );
}

/** Tarjeta de producto. Sin fotos todavía: miniatura con el ícono del rubro. */
function ProductCard({
  product: p,
  offers,
  icon,
  onPress,
  onAdd,
}: {
  product: PublicProduct;
  offers: PublicOffer[];
  icon: IconName;
  onPress: () => void;
  onAdd: () => boolean;
}) {
  const t = useTheme();
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const id = setTimeout(() => setAdded(false), 1200);
    return () => clearTimeout(id);
  }, [added]);
  // Precio con oferta, si no depende del resto del pedido (porcentaje sin mínimo).
  const { base, offer: offerPrice, prefix } = productPrices(p, offers);
  const price = `${prefix}${formatARSWhole(base)}`;
  // Alcanzado por una oferta con condiciones: solo la etiqueta.
  const conditional = offerPrice === null ? offers.find((o) => !o.productIds || o.productIds.includes(p.id)) : undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${price}${p.available ? "" : ", sin stock"}`}
      style={({ pressed }) => [
        styles.product,
        { borderBottomColor: t.border, opacity: pressed ? 0.6 : p.available ? 1 : 0.55 },
      ]}
    >
      <View style={styles.productBody}>
        <Text style={[styles.productName, { color: t.text }]} numberOfLines={2}>
          {p.name}
        </Text>
        {p.description && (
          <Text style={[styles.meta, { color: t.muted }]} numberOfLines={2}>
            {p.description}
          </Text>
        )}
        <View style={styles.productFooter}>
          {offerPrice !== null ? (
            <>
              <Text style={[styles.price, { color: t.accent }]}>{`${prefix}${formatARSWhole(offerPrice)}`}</Text>
              <Text style={[styles.meta, { color: t.muted, textDecorationLine: "line-through" }]}>{formatARSWhole(base)}</Text>
            </>
          ) : (
            <Text style={[styles.price, { color: t.text }]}>{price}</Text>
          )}
          {conditional && (
            <Text style={[styles.meta, { color: t.accent, fontWeight: "700" }]}>
              {conditional.label}
              {conditional.minSubtotalMinor > 0 ? ` desde ${formatARSWhole(conditional.minSubtotalMinor)}` : ""}
            </Text>
          )}
          {!p.available && <Badge label="Sin stock" tone="danger" />}
        </View>
      </View>
      <View style={[styles.thumb, { backgroundColor: t.surface }]}>
        <Photo
          url={p.imageUrl}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.md, opacity: p.available ? 1 : 0.5 }]}
          fallback={<Icon name={icon} size={34} color={t.muted} />}
        />
        {p.available && (
          <Pressable
            onPress={() => {
              if (onAdd()) setAdded(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={added ? `${p.name} agregado` : `Agregar ${p.name}`}
            hitSlop={8}
            style={[styles.addButton, { backgroundColor: added ? t.success : t.primary, borderColor: t.card }]}
          >
            <Icon name={added ? "check" : "add"} size={18} color={t.primaryText} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: space.xl * 2, flexGrow: 1 },

  cover: { height: 190, alignItems: "center", justifyContent: "center" },
  coverArt: {
    width: 120,
    height: 120,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  floatingBack: { position: "absolute", left: space.lg, width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },

  info: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  // El logo se apoya sobre el borde de la portada; el borde del color del fondo lo recorta.
  logo: { width: 72, height: 72, borderRadius: radius.md, borderWidth: 3, overflow: "hidden", marginTop: -36 - space.lg, marginBottom: space.xs },
  title: { fontFamily: font.display, fontSize: 30, lineHeight: 33, fontWeight: "800", letterSpacing: -0.6 },
  badges: { flexDirection: "row", alignItems: "center", gap: space.sm },
  address: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  meta: { fontSize: 13 },
  offers: { gap: space.sm, marginTop: space.md },
  offerBox: { flexDirection: "row", alignItems: "center", gap: space.md, borderRadius: radius.md, padding: space.md },
  offerBoxLabel: { fontFamily: font.display, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md, marginTop: space.xs },
  fact: { flexDirection: "row", alignItems: "center", gap: space.sm },
  factIcon: { width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  factLabel: { fontSize: 11 },
  factValue: { fontFamily: font.display, fontSize: 15, fontWeight: "700" },

  rowTitle: { fontFamily: font.display, fontSize: 21, fontWeight: "700", letterSpacing: -0.3, paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md },
  tiles: { paddingHorizontal: space.lg, gap: space.md },
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.lg, marginTop: space.lg, borderRadius: radius.md, paddingHorizontal: space.lg, height: 48 },
  searchInput: { flex: 1, fontSize: 16, height: "100%" },

  tabs: { gap: space.sm, paddingHorizontal: space.lg, alignItems: "center" },
  tab: { borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 8 },
  tabText: { fontSize: 14, fontWeight: "600" },

  compact: { position: "absolute", top: 0, left: 0, right: 0, paddingBottom: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  compactBar: { height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  compactBack: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  compactTitle: { fontFamily: font.display, fontSize: 18, fontWeight: "700", flex: 1 },

  sectionHeader: { flexDirection: "row", alignItems: "baseline", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xs },
  sectionTitle: { fontFamily: font.display, fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },

  product: { flexDirection: "row", gap: space.md, marginHorizontal: space.lg, paddingVertical: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  productBody: { flex: 1, gap: 4 },
  productName: { fontSize: 16, fontWeight: "600" },
  productFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm, marginTop: "auto", paddingTop: space.xs },
  price: { fontFamily: font.display, fontSize: 16, fontWeight: "700" },
  thumb: { width: 104, height: 104, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  addButton: {
    position: "absolute",
    right: -6,
    bottom: -6,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
