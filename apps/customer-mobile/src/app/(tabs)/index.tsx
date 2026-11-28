import type { CityMerchant } from "@pedilo/api-client";
import { addressTitle, formatARSWhole, isOrderFinal } from "@pedilo/domain";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomSheet } from "@/components/bottom-sheet";
import { categoryIcon, foodTypeEmoji, Icon, type IconName, rubroEmoji } from "@/components/icon";
import { Photo } from "@/components/photo";
import { Text, TextInput } from "@/components/text";
import { Button, ErrorState, Loading } from "@/components/ui";
import { useAccountOrders, useCityDishes, useCityMerchants, useCityOffers, useFoodTypes, useMerchantCategories } from "@/lib/api";
import { useDeliveryAddress } from "@/lib/addresses";
import { useCity } from "@/lib/city";
import { closedLabel, etaLabel, etaSortKey } from "@/lib/merchant-labels";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Orden y filtros de la lista de comercios (ADR 0028)
// ---------------------------------------------------------------------------

type SortId = "suggested" | "rating" | "fastest" | "cheapDelivery" | "cheapest";
/**
 * Formas de ordenar con datos que existen. «Más rápidos» aparece cuando algún comercio cargó su
 * tiempo de preparación (ADR 0029); «Mejor puntuados», cuando haya calificaciones. No se muestran
 * opciones que no hacen nada.
 */
const ALL_SORTS: { id: SortId; label: string }[] = [
  { id: "suggested", label: "Sugeridos" },
  { id: "rating", label: "Mejor puntuados" },
  { id: "fastest", label: "Más rápidos" },
  { id: "cheapDelivery", label: "Envío más barato" },
  { id: "cheapest", label: "Más económicos" },
];
const PRICE_LABEL: Record<1 | 2 | 3, string> = { 1: "$", 2: "$$", 3: "$$$" };
const PRICE_HINT: Record<1 | 2 | 3, string> = { 1: "Económico", 2: "Intermedio", 3: "Para darse un gusto" };

type Toggle = "deals" | "topRated" | "open" | "freeDelivery" | "pickup";
const TOGGLES: { id: Toggle; label: string; test: (m: CityMerchant) => boolean }[] = [
  { id: "deals", label: "Descuentos", test: (m) => m.offer !== null },
  { id: "topRated", label: "4,5 o más", test: (m) => (m.rating?.average ?? 0) >= 4.5 },
  { id: "open", label: "Abiertos", test: (m) => m.openNow },
  { id: "freeDelivery", label: "Envío gratis", test: (m) => m.acceptsDelivery && m.minDeliveryFeeMinor === 0 },
  { id: "pickup", label: "Retiro", test: (m) => m.acceptsPickup },
];

const COMPLETED = new Set(["DELIVERED", "PICKED_UP"]);

/**
 * Inicio: dirección y avisos, búsqueda, «¿Qué tenés ganas de pedir?», «Volver a pedir», «Platos para
 * probar» (lo que abre el apetito, con fotos) y una sola lista de comercios con orden y filtros.
 * Las secciones sin datos no se muestran.
 */
export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city, ready } = useCity();

  // Lo elegido en «¿Qué tenés ganas de pedir?»: un tipo de comida (ADR 0027) o un rubro. Uno a la vez.
  const [pick, setPick] = useState<{ kind: "food" | "rubro"; id: string } | null>(null);
  const foodTypeId = pick?.kind === "food" ? pick.id : null;
  const rubroId = pick?.kind === "rubro" ? pick.id : null;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("suggested");
  const [localType, setLocalType] = useState<string | null>(null);
  const [price, setPrice] = useState<1 | 2 | 3 | null>(null);
  const [toggles, setToggles] = useState<Set<Toggle>>(new Set());
  const [sheet, setSheet] = useState<"sort" | "localType" | "price" | null>(null);

  const categories = useMerchantCategories();
  const foodTypes = useFoodTypes();
  const merchants = useCityMerchants(city?.slug ?? null, foodTypeId, rubroId);
  const dishes = useCityDishes(city?.slug ?? null);
  const offers = useCityOffers(city?.slug ?? null);
  const accountOrders = useAccountOrders(true);
  const { selected: address } = useDeliveryAddress();

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const activeOrders = (accountOrders.data ?? []).filter((o) => !isOrderFinal(o.status)).length;
  // Último pedido entregado de cada comercio, para «Volver a pedir».
  const reorders = useMemo(() => {
    const seen = new Set<string>();
    return (accountOrders.data ?? []).filter((o) => COMPLETED.has(o.status) && !seen.has(o.merchantSlug) && seen.add(o.merchantSlug)).slice(0, 8);
  }, [accountOrders.data]);

  const searching = normalize(query).length > 0;
  const filtersActive = sort !== "suggested" || localType !== null || price !== null || toggles.size > 0;
  const results = useMemo(() => {
    const q = normalize(query);
    const list = (merchants.data ?? []).filter(
      (m) =>
        (!q || normalize(m.displayName).includes(q)) &&
        (!localType || m.categoryId === localType) &&
        (!price || m.priceLevel === price) &&
        TOGGLES.every((tg) => !toggles.has(tg.id) || tg.test(m)),
    );
    if (sort === "rating") {
      return [...list].sort((a, b) => (b.rating?.average ?? 0) - (a.rating?.average ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0));
    }
    if (sort === "fastest") {
      return [...list].sort((a, b) => Number(b.openNow) - Number(a.openNow) || etaSortKey(a) - etaSortKey(b));
    }
    if (sort === "cheapDelivery") {
      const fee = (m: CityMerchant) => (m.acceptsDelivery ? (m.minDeliveryFeeMinor ?? 0) : Number.MAX_SAFE_INTEGER);
      return [...list].sort((a, b) => Number(b.openNow) - Number(a.openNow) || fee(a) - fee(b));
    }
    if (sort === "cheapest") {
      return [...list].sort((a, b) => Number(b.openNow) - Number(a.openNow) || (a.priceLevel ?? 4) - (b.priceLevel ?? 4));
    }
    return list; // Sugeridos: abiertos primero (lo resuelve la API).
  }, [merchants.data, query, localType, price, toggles, sort]);

  if (!ready) return <Loading />;
  if (!city) return <Redirect href="/city" />;

  const openMerchant = (slug: string) => router.push({ pathname: "/merchant/[slug]", params: { slug } });
  const foodTypeName = foodTypeId ? foodTypes.data?.find((c) => c.id === foodTypeId)?.name : undefined;
  const rubroName = rubroId ? categoryById.get(rubroId)?.name : undefined;
  // «Gastronomía» ya está desglosada en los tipos de comida: no se repite en la fila.
  const rubros = (categories.data ?? []).filter((c) => c.slug !== "gastronomia");
  const choices = [
    ...(foodTypes.data ?? []).map((c) => ({ kind: "food" as const, id: c.id, label: c.name, emoji: foodTypeEmoji(c.slug) })),
    ...rubros.map((c) => ({ kind: "rubro" as const, id: c.id, label: c.name, emoji: rubroEmoji(c.slug) })),
  ];
  const togglePick = (kind: "food" | "rubro", id: string) => setPick((cur) => (cur?.kind === kind && cur.id === id ? null : { kind, id }));
  const toggle = (id: Toggle) =>
    setToggles((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearFilters = () => {
    setSort("suggested");
    setLocalType(null);
    setPrice(null);
    setToggles(new Set());
  };
  const browsing = !searching && pick === null;
  // Solo opciones que hacen algo: «Más rápidos» con tiempos cargados; las de calificación con alguna pública.
  const anyRated = (merchants.data ?? []).some((m) => m.rating !== null);
  const sorts = ALL_SORTS.filter(
    (s) => (s.id !== "fastest" || (merchants.data ?? []).some((m) => m.prepMinutes != null)) && (s.id !== "rating" || anyRated),
  );
  const toggles_ = TOGGLES.filter((tg) => tg.id !== "topRated" || anyRated);
  // Pedido terminado sin calificar (el más reciente), para el aviso del inicio.
  const toRate = (accountOrders.data ?? []).find((o) => o.ratableUntil !== null);
  const listTitle = searching ? "Resultados" : (foodTypeName ?? rubroName ?? "Comercios");

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={merchants.isRefetching}
            onRefresh={() => void Promise.all([merchants.refetch(), dishes.refetch(), accountOrders.refetch()])}
            tintColor={t.primary}
          />
        }
      >
        {/* Encabezado: dónde entregamos + avisos */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={address ? `Pedís desde ${addressTitle(address)}: ${address.line}. Cambiar` : `Ciudad: ${city.name}. Elegí desde dónde pedís`}
            onPress={() => router.push("/address")}
            hitSlop={8}
            style={styles.where}
          >
            <Text style={[styles.whereText, { color: t.text }]} numberOfLines={1}>
              {address ? `${addressTitle(address)} · ${address.line}` : city.name}
            </Text>
            <Icon name="chevronDown" size={18} color={t.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeOrders > 0 ? `Avisos: ${activeOrders} pedido${activeOrders === 1 ? "" : "s"} en curso` : "Avisos"}
            onPress={() => router.push("/notifications")}
            hitSlop={8}
            style={({ pressed }) => [styles.bell, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <Icon name="bell" size={22} color={t.text} />
            {activeOrders > 0 && <View style={[styles.bellDot, { backgroundColor: t.accent, borderColor: t.background }]} />}
          </Pressable>
        </View>

        {/* Búsqueda */}
        <View style={[styles.search, { backgroundColor: t.surface }]}>
          <Icon name="search" size={20} color={t.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar comercios"
            placeholderTextColor={t.muted}
            accessibilityLabel="Buscar comercios"
            style={[styles.searchInput, { color: t.text }]}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>

        {/* Tipos de comida y rubros, en una sola fila */}
        {choices.length > 0 && (
          <>
            <SectionHeader title="¿Qué tenés ganas de pedir?" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <FoodTypePill label="Todo" emoji="🍽️" selected={pick === null} onPress={() => setPick(null)} />
              {choices.map((c) => (
                <FoodTypePill
                  key={`${c.kind}-${c.id}`}
                  label={c.label}
                  emoji={c.emoji}
                  selected={pick?.kind === c.kind && pick.id === c.id}
                  onPress={() => togglePick(c.kind, c.id)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* Ofertas de los comercios (ADR 0030): arriba, para que se vean */}
        {browsing && (offers.data?.length ?? 0) > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.row, { marginTop: space.lg }]}
            decelerationRate="fast"
          >
            {offers.data!.map((o) => (
              <OfferCard
                key={o.offer.id}
                title={o.offer.title}
                label={o.offer.label}
                merchantName={o.merchant.name}
                minSubtotalMinor={o.offer.minSubtotalMinor}
                logoUrl={o.merchant.logoUrl}
                onPress={() => openMerchant(o.merchant.slug)}
              />
            ))}
          </ScrollView>
        )}

        {/* ¿Cómo estuvo? Un pedido terminado sin calificar (ADR 0031) */}
        {browsing && toRate && (
          <View style={[styles.rateNudge, { backgroundColor: t.surface }]}>
            <Text style={[styles.rateNudgeTitle, { color: t.text }]} numberOfLines={1}>
              ¿Cómo estuvo tu pedido de {toRate.merchantName}?
            </Text>
            <View style={styles.rateNudgeStars} accessibilityRole="radiogroup" accessibilityLabel="Calificar de 1 a 5 estrellas">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityLabel={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
                  onPress={() => router.push({ pathname: "/order/[id]", params: { id: toRate.id, rate: String(n) } })}
                  hitSlop={4}
                >
                  <Text style={[styles.rateNudgeStar, { color: t.border }]}>★</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Volver a pedir: solo si ya pidió */}
        {browsing && reorders.length > 0 && (
          <>
            <SectionHeader title="Volver a pedir" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {reorders.map((o) => (
                <ReorderCard key={o.id} merchantName={o.merchantName} items={o.itemsSummary} onPress={() => openMerchant(o.merchantSlug)} />
              ))}
            </ScrollView>
          </>
        )}

        {/* Platos para probar: lo que abre el apetito */}
        {browsing && (dishes.data?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Platos para probar" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} decelerationRate="fast">
              {dishes.data!.map((d) => (
                <DishCard
                  key={d.productId}
                  name={d.name}
                  imageUrl={d.imageUrl}
                  priceMinor={d.fromPriceMinor}
                  merchantName={d.merchant.name}
                  open={d.merchant.openNow}
                  onPress={() => router.push({ pathname: "/product/[slug]/[productId]", params: { slug: d.merchant.slug, productId: d.productId } })}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* Comercios: una sola lista, con orden y filtros en una fila deslizable */}
        <SectionHeader title={listTitle} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {filtersActive && <FilterChip label="Limpiar" icon="close" onPress={clearFilters} />}
          <FilterChip label={(sorts.find((s) => s.id === sort) ?? sorts[0]!).label} icon="filter" selected={sort !== "suggested"} dropdown onPress={() => setSheet("sort")} />
          <FilterChip
            label={localType ? (categoryById.get(localType)?.name ?? "Tipo de local") : "Tipo de local"}
            selected={localType !== null}
            dropdown
            onPress={() => setSheet("localType")}
          />
          <FilterChip label={price ? PRICE_LABEL[price] : "Precio"} selected={price !== null} dropdown onPress={() => setSheet("price")} />
          {toggles_.map((tg) => (
            <FilterChip key={tg.id} label={tg.label} selected={toggles.has(tg.id)} onPress={() => toggle(tg.id)} />
          ))}
        </ScrollView>

        {merchants.isPending ? (
          <View style={styles.state}>
            <Loading />
          </View>
        ) : merchants.isError ? (
          <View style={styles.state}>
            <ErrorState message="No pudimos cargar los comercios. Revisá tu conexión." onRetry={() => void merchants.refetch()} />
          </View>
        ) : (
          <View style={styles.list}>
            {results.length === 0 ? (
              <EmptyResults
                t={t}
                message={
                  searching
                    ? `No hay comercios que coincidan con «${query.trim()}».`
                    : filtersActive
                      ? "Ningún comercio cumple esos filtros ahora."
                      : foodTypeName
                        ? `Todavía nadie vende ${foodTypeName.toLowerCase()} en ${city.name}. Probá con otra opción.`
                        : rubroName
                          ? `Todavía no hay comercios de ${rubroName.toLowerCase()} en ${city.name}.`
                          : `Todavía no hay comercios en ${city.name}.`
                }
                onClear={
                  searching || filtersActive
                    ? () => {
                        setQuery("");
                        clearFilters();
                      }
                    : undefined
                }
              />
            ) : (
              results.map((m) => (
                <MerchantRow
                  key={m.id}
                  merchant={m}
                  categorySlug={categoryById.get(m.categoryId)?.slug}
                  categoryName={categoryById.get(m.categoryId)?.name}
                  onPress={() => openMerchant(m.slug)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>

      <OptionSheet
        visible={sheet === "sort"}
        title="Ordenar por"
        options={sorts.map((s) => ({ id: s.id, label: s.label }))}
        selected={sort}
        onSelect={(id) => setSort((id as SortId | null) ?? "suggested")}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === "localType"}
        title="Tipo de local"
        options={[{ id: null, label: "Todos" }, ...(categories.data ?? []).map((c) => ({ id: c.id, label: c.name }))]}
        selected={localType}
        onSelect={setLocalType}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === "price"}
        title="Rango de precio"
        options={[
          { id: null, label: "Todos" },
          ...([1, 2, 3] as const).map((p) => ({ id: String(p), label: PRICE_LABEL[p], hint: PRICE_HINT[p] })),
        ]}
        selected={price ? String(price) : null}
        onSelect={(id) => setPrice(id ? (Number(id) as 1 | 2 | 3) : null)}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Piezas de la pantalla
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.sectionTitle, { color: t.text }]} accessibilityRole="header">
      {title}
    </Text>
  );
}

/** Tipo de comida o rubro: emoji en un círculo y el nombre en una sola línea. */
function FoodTypePill({ label, emoji, selected, onPress }: { label: string; emoji: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.pillIcon, { backgroundColor: selected ? t.accentSoft : t.surface, borderColor: selected ? t.accent : "transparent" }]}>
        <Text style={styles.pillEmoji} aria-hidden>
          {emoji}
        </Text>
      </View>
      <Text style={[styles.pillText, { color: selected ? t.text : t.muted, fontWeight: selected ? "700" : "500" }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Oferta de un comercio en el banner del inicio: el descuento grande en tomate, qué es y dónde. Es
 * la única pieza de color fuerte de la pantalla.
 */
function OfferCard({
  title,
  label,
  merchantName,
  minSubtotalMinor,
  logoUrl,
  onPress,
}: {
  title: string;
  label: string;
  merchantName: string;
  minSubtotalMinor: number;
  logoUrl: string | null;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} en ${merchantName}: ${title}`}
      style={({ pressed }) => [styles.offer, { backgroundColor: t.accent, opacity: pressed ? 0.88 : 1 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.offerLabel, { color: t.accentText }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.offerTitle, { color: t.accentText }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.offerMeta, { color: t.accentText }]} numberOfLines={1}>
          {merchantName}
          {minSubtotalMinor > 0 ? ` · desde ${formatARSWhole(minSubtotalMinor)}` : ""}
        </Text>
      </View>
      {logoUrl && (
        <View style={styles.offerLogo}>
          <Photo url={logoUrl} style={StyleSheet.absoluteFill} />
        </View>
      )}
    </Pressable>
  );
}

/** «Volver a pedir»: el comercio y lo que pediste la última vez. Abre su menú. */
function ReorderCard({ merchantName, items, onPress }: { merchantName: string; items: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Volver a pedir en ${merchantName}: ${items}`}
      style={({ pressed }) => [styles.reorder, { backgroundColor: t.surface, opacity: pressed ? 0.75 : 1 }]}
    >
      <Text style={[styles.reorderName, { color: t.text }]} numberOfLines={1}>
        {merchantName}
      </Text>
      <Text style={[styles.reorderItems, { color: t.muted }]} numberOfLines={2}>
        {items}
      </Text>
      <Text style={[styles.reorderCta, { color: t.text }]}>Pedir de nuevo</Text>
    </Pressable>
  );
}

/**
 * Plato con foto grande: lo primero que se mira. Si el comercio está cerrado se ve igual (se puede
 * programar), con la marca «Cerrado» sobre la foto.
 */
function DishCard({
  name,
  imageUrl,
  priceMinor,
  merchantName,
  open,
  onPress,
}: {
  name: string;
  imageUrl: string;
  priceMinor: number;
  merchantName: string;
  open: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatARSWhole(priceMinor)}, en ${merchantName}${open ? "" : ", cerrado ahora"}`}
      style={({ pressed }) => [styles.dish, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={[styles.dishPhoto, { backgroundColor: t.surface }]}>
        <Photo url={imageUrl} style={StyleSheet.absoluteFill} />
        {!open && (
          <View style={[styles.dishTag, { backgroundColor: t.background }]}>
            <Text style={[styles.dishTagText, { color: t.text }]}>Cerrado</Text>
          </View>
        )}
      </View>
      <View style={styles.dishBody}>
        <View style={styles.dishTop}>
          <Text style={[styles.dishName, { color: t.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.dishPrice, { color: t.text }]}>{formatARSWhole(priceMinor)}</Text>
        </View>
        <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
          {merchantName}
        </Text>
      </View>
    </Pressable>
  );
}

/** Chip de la fila de orden y filtros: alterna, o abre opciones (con la flecha). */
function FilterChip({
  label,
  icon,
  selected,
  dropdown,
  onPress,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  dropdown?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const fg = selected ? t.primaryText : t.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      accessibilityLabel={dropdown ? `${label}. Cambiar` : label}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? t.primary : t.background, borderColor: selected ? t.primary : t.border, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {icon && <Icon name={icon} size={16} color={fg} />}
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
      {dropdown && <Icon name="chevronDown" size={16} color={fg} />}
    </Pressable>
  );
}

/** Hoja de opciones desde abajo (orden, tipo de local, precio). Elegir cierra. */
function OptionSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { id: string | null; label: string; hint?: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={[styles.sheetTitle, { color: t.text }]} accessibilityRole="header">
        {title}
      </Text>
      {options.map((o) => {
        const isSelected = o.id === selected;
        return (
          <Pressable
            key={o.id ?? "all"}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            onPress={() => {
              onSelect(o.id);
              onClose();
            }}
            style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionLabel, { color: t.text, fontWeight: isSelected ? "700" : "500" }]}>{o.label}</Text>
              {o.hint && <Text style={[styles.meta, { color: t.muted }]}>{o.hint}</Text>}
            </View>
            <View style={[styles.radio, { borderColor: isSelected ? t.primary : t.border }]}>
              {isSelected && <View style={[styles.radioDot, { backgroundColor: t.primary }]} />}
            </View>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

function deliveryText(m: CityMerchant): string | null {
  if (!m.acceptsDelivery) return null;
  return m.minDeliveryFeeMinor === 0 ? "Envío gratis" : `Envío ${formatARSWhole(m.minDeliveryFeeMinor ?? 0)}`;
}

/** Fila de la lista de comercios. */
function MerchantRow({
  merchant: m,
  categorySlug,
  categoryName,
  onPress,
}: {
  merchant: CityMerchant;
  categorySlug: string | undefined;
  categoryName: string | undefined;
  onPress: () => void;
}) {
  const t = useTheme();
  const delivery = deliveryText(m);
  const eta = etaLabel(m);
  const closed = m.openNow ? null : closedLabel(m);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[m.displayName, m.isNew ? "nuevo en Pedilo" : null, m.openNow ? eta ?? "abierto" : closed].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.merchant, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.merchantLogo, { backgroundColor: t.surface }]}>
        <Photo
          url={m.logoUrl}
          style={[StyleSheet.absoluteFill, { opacity: m.openNow ? 1 : 0.5 }]}
          fallback={<Icon name={categoryIcon(categorySlug)} size={26} color={m.openNow ? t.text : t.muted} />}
        />
      </View>
      <View style={styles.merchantBody}>
        <View style={styles.merchantTop}>
          <Text style={[styles.merchantName, { color: t.text }]} numberOfLines={1}>
            {m.displayName}
          </Text>
          {m.offer && (
            <View style={[styles.newTag, { backgroundColor: t.accent }]}>
              <Text style={[styles.newTagText, { color: t.accentText }]}>{m.offer.label}</Text>
            </View>
          )}
          {m.isNew && (
            <View style={[styles.newTag, { backgroundColor: t.accentSoft }]}>
              <Text style={[styles.newTagText, { color: t.accent }]}>Nuevo</Text>
            </View>
          )}
        </View>
        <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
          {m.rating && (
            <Text style={{ color: t.text, fontWeight: "700" }}>
              <Text style={{ color: t.accent }}>★</Text> {m.rating.average.toLocaleString("es-AR", { minimumFractionDigits: 1 })} ({m.rating.count}){"  "}
            </Text>
          )}
          {[categoryName, m.priceLevel ? PRICE_LABEL[m.priceLevel] : null].filter(Boolean).join("  ")}
        </Text>
        {closed ? (
          <Text style={[styles.closedText, { color: m.schedulingEnabled ? t.text : t.muted }]} numberOfLines={1}>
            {closed}
          </Text>
        ) : (
          <View style={styles.merchantInfo}>
            {eta && <InfoBit icon="clock" label={eta} t={t} strong />}
            {delivery && <InfoBit icon="delivery" label={delivery} t={t} />}
            {m.acceptsPickup && <InfoBit icon="pickup" label="Retiro" t={t} />}
          </View>
        )}
      </View>
    </Pressable>
  );
}

function InfoBit({ icon, label, t, strong }: { icon: IconName; label: string; t: Theme; strong?: boolean }) {
  return (
    <View style={styles.infoBit}>
      <Icon name={icon} size={14} color={strong ? t.text : t.muted} />
      <Text style={[styles.infoText, { color: strong ? t.text : t.muted, fontWeight: strong ? "700" : "400" }]}>{label}</Text>
    </View>
  );
}

function EmptyResults({ t, message, onClear }: { t: Theme; message: string; onClear?: () => void }) {
  return (
    <View style={styles.empty}>
      <Icon name="store" size={40} color={t.muted} />
      <Text style={{ color: t.muted, textAlign: "center" }}>{message}</Text>
      {onClear && <Button label="Ver todos" variant="outline" onPress={onClear} />}
    </View>
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
  content: { paddingBottom: space.xl * 2 },

  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md },
  where: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  whereText: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  bell: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", top: 9, right: 10, width: 10, height: 10, borderRadius: radius.pill, borderWidth: 2 },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    height: 50,
    marginHorizontal: space.lg,
  },
  searchInput: { flex: 1, fontSize: 16, height: "100%" },

  sectionTitle: {
    fontFamily: font.display,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.3,
    paddingHorizontal: space.lg,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  row: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: 4 },

  pill: { alignItems: "center", gap: 6, minWidth: 68 },
  pillIcon: { width: 60, height: 60, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  pillEmoji: { fontSize: 28, lineHeight: 34 },
  pillText: { fontSize: 13, lineHeight: 16, textAlign: "center" },

  offer: { width: 300, minHeight: 116, borderRadius: radius.lg, padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.md },
  offerLabel: { fontFamily: font.display, fontSize: 28, lineHeight: 30, fontWeight: "800", letterSpacing: -0.6 },
  offerTitle: { fontSize: 15, fontWeight: "700" },
  offerMeta: { fontSize: 13, opacity: 0.85 },
  offerLogo: { width: 56, height: 56, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#ffffff" },
  rateNudge: { marginHorizontal: space.lg, marginTop: space.lg, borderRadius: radius.md, padding: space.md, gap: 4 },
  rateNudgeTitle: { fontSize: 15, fontWeight: "700" },
  rateNudgeStars: { flexDirection: "row", gap: space.sm },
  rateNudgeStar: { fontSize: 32, lineHeight: 38 },
  reorder: { width: 220, borderRadius: radius.md, padding: space.md, gap: 4 },
  reorderName: { fontSize: 15, fontWeight: "700" },
  reorderItems: { fontSize: 14, lineHeight: 19, minHeight: 38 },
  reorderCta: { fontSize: 14, fontWeight: "700", textDecorationLine: "underline", marginTop: 2 },

  dish: { width: 260, gap: space.sm },
  dishPhoto: { height: 172, borderRadius: radius.lg, overflow: "hidden" },
  dishTag: { position: "absolute", top: space.sm, left: space.sm, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  dishTagText: { fontSize: 12, fontWeight: "700" },
  dishBody: { gap: 2, paddingHorizontal: 2 },
  dishTop: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  dishName: { flex: 1, fontSize: 16, fontWeight: "700" },
  dishPrice: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },

  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, height: 38 },
  chipText: { fontSize: 14, fontWeight: "600" },

  state: { paddingVertical: space.xl * 2 },
  list: { paddingHorizontal: space.lg },
  merchant: { flexDirection: "row", gap: space.md, paddingVertical: space.md },
  merchantLogo: { width: 64, height: 64, borderRadius: radius.md, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  merchantBody: { flex: 1, gap: 3 },
  merchantTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  merchantName: { flex: 1, fontSize: 16, fontWeight: "700" },
  merchantInfo: { flexDirection: "row", flexWrap: "wrap", gap: space.md, marginTop: 2 },
  meta: { fontSize: 13 },
  newTag: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  newTagText: { fontSize: 12, fontWeight: "700" },
  closedText: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  infoBit: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoText: { fontSize: 13 },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xl * 2 },

  sheetTitle: { fontFamily: font.display, fontSize: 20, fontWeight: "700", marginBottom: space.sm },
  option: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  optionLabel: { fontSize: 16 },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill },
});
