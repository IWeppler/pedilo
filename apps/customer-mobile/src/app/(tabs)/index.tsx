import type { CityMerchant } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, TextInput } from "@/components/text";
import { Photo } from "@/components/photo";
import { categoryIcon, Icon, type IconName } from "@/components/icon";
import { Badge, Button, ErrorState, Loading } from "@/components/ui";
import { useCityMerchants, useMerchantCategories } from "@/lib/api";
import { useCity } from "@/lib/city";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

/** Filtros rápidos que se activan desde los destacados o el botón de filtro. */
type QuickFilter = "open" | "freeDelivery" | "pickup";

const FILTER_LABEL: Record<QuickFilter, string> = {
  open: "Abiertos ahora",
  freeDelivery: "Envío gratis",
  pickup: "Retiro en el local",
};

const matchesFilter: Record<QuickFilter, (m: CityMerchant) => boolean> = {
  open: (m) => m.openNow,
  freeDelivery: (m) => m.acceptsDelivery && m.minDeliveryFeeMinor === 0,
  pickup: (m) => m.acceptsPickup,
};

/**
 * Inicio: ciudad, búsqueda, destacados, rubros, comercios abiertos y listado completo.
 * Todo sale de datos reales de la ciudad (no hay promos ni fotos todavía).
 */
export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { city, ready } = useCity();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<QuickFilter | null>(null);
  const categories = useMerchantCategories();
  const merchants = useCityMerchants(city?.slug ?? null, categoryId);

  const categoryById = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const all = useMemo(() => merchants.data ?? [], [merchants.data]);
  const searching = normalize(query).length > 0;
  const results = useMemo(() => {
    const q = normalize(query);
    return all.filter((m) => (!q || normalize(m.displayName).includes(q)) && (!filter || matchesFilter[filter](m)));
  }, [all, query, filter]);
  const openNow = useMemo(() => all.filter((m) => m.openNow), [all]);

  if (!ready) return <Loading />;
  if (!city) return <Redirect href="/city" />;

  const openMerchant = (m: CityMerchant) => router.push({ pathname: "/merchant/[slug]", params: { slug: m.slug } });
  const categoryName = categoryId ? categoryById.get(categoryId)?.name : undefined;

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={merchants.isRefetching} onRefresh={() => void merchants.refetch()} tintColor={t.primary} />
        }
      >
        {/* Encabezado: marca + ciudad */}
        <View style={styles.header}>
          <View style={[styles.logo, { backgroundColor: t.accent }]}>
            <Text style={[styles.logoText, { color: t.accentText }]}>P</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ciudad: ${city.name}. Cambiar`}
            onPress={() => router.push("/city")}
            hitSlop={8}
            style={{ flex: 1 }}
          >
            <Text style={[styles.headerLabel, { color: t.muted }]}>Pedir en</Text>
            <View style={styles.cityRow}>
              <Icon name="location" size={18} color={t.accent} />
              <Text style={[styles.cityName, { color: t.text }]} numberOfLines={1}>
                {city.name}
              </Text>
              <Icon name="chevronDown" size={18} color={t.text} />
            </View>
          </Pressable>
        </View>

        {/* Búsqueda + filtro «abiertos» */}
        <View style={styles.searchRow}>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mostrar solo comercios abiertos"
            accessibilityState={{ selected: filter === "open" }}
            onPress={() => setFilter((f) => (f === "open" ? null : "open"))}
            style={({ pressed }) => [
              styles.filterButton,
              {
                backgroundColor: filter === "open" ? t.primary : t.surface,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Icon name="filter" size={22} color={filter === "open" ? t.primaryText : t.text} />
          </Pressable>
        </View>

        {!searching && all.length > 0 && (
          <Highlights merchants={all} cityName={city.name} onPick={(f) => setFilter(f)} />
        )}

        {/* Rubros */}
        <SectionHeader title="Rubros" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          <CategoryPill label="Todos" icon="grid" selected={categoryId === null} onPress={() => setCategoryId(null)} />
          {(categories.data ?? []).map((c) => (
            <CategoryPill
              key={c.id}
              label={c.name}
              icon={categoryIcon(c.slug)}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </ScrollView>

        {merchants.isPending ? (
          <View style={styles.state}>
            <Loading />
          </View>
        ) : merchants.isError ? (
          <View style={styles.state}>
            <ErrorState message="No pudimos cargar los comercios. Revisá tu conexión." onRetry={() => merchants.refetch()} />
          </View>
        ) : (
          <>
            {!searching && !filter && openNow.length > 0 && (
              <>
                <SectionHeader title="Abiertos ahora" action={openNow.length > 3 ? "Ver todos" : undefined} onAction={() => setFilter("open")} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carouselRow}>
                  {openNow.map((m) => (
                    <FeaturedCard key={m.id} merchant={m} categorySlug={categoryById.get(m.categoryId)?.slug} categoryName={categoryById.get(m.categoryId)?.name} onPress={() => openMerchant(m)} />
                  ))}
                </ScrollView>
              </>
            )}

            <SectionHeader title={searching ? "Resultados" : categoryName ?? "Todos los comercios"} />
            {filter && (
              <View style={styles.activeFilterRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar filtro ${FILTER_LABEL[filter]}`}
                  onPress={() => setFilter(null)}
                  style={[styles.activeFilter, { backgroundColor: t.primary }]}
                >
                  <Text style={[styles.activeFilterText, { color: t.primaryText }]}>{FILTER_LABEL[filter]}  ✕</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.list}>
              {results.length === 0 ? (
                <EmptyResults
                  t={t}
                  message={
                    searching
                      ? `No hay comercios que coincidan con «${query.trim()}».`
                      : filter
                        ? `No hay comercios con «${FILTER_LABEL[filter].toLowerCase()}» ahora.`
                        : categoryName
                          ? `Todavía no hay comercios de ${categoryName} en ${city.name}.`
                          : `Todavía no hay comercios en ${city.name}.`
                  }
                  onClear={
                    filter || searching
                      ? () => {
                          setFilter(null);
                          setQuery("");
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
                    onPress={() => openMerchant(m)}
                  />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Destacados: carrusel armado con datos reales de la ciudad
// ---------------------------------------------------------------------------

interface Highlight {
  key: string;
  tag: string;
  title: string;
  subtitle: string;
  cta: string;
  icon: IconName;
  filter: QuickFilter;
}

function Highlights({ merchants, cityName, onPick }: { merchants: CityMerchant[]; cityName: string; onPick: (f: QuickFilter) => void }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const slideWidth = Math.min(width, 520) - space.lg * 2;
  const [index, setIndex] = useState(0);

  const slides = useMemo(() => {
    const open = merchants.filter(matchesFilter.open).length;
    const free = merchants.filter(matchesFilter.freeDelivery).length;
    const pickup = merchants.filter(matchesFilter.pickup).length;
    const list: Highlight[] = [];
    if (open > 0) {
      list.push({
        key: "open",
        tag: cityName,
        title: open === 1 ? "1 comercio abierto ahora" : `${open} comercios abiertos ahora`,
        subtitle: "Pedí y seguí tu pedido en vivo.",
        cta: "Ver abiertos",
        icon: "clock",
        filter: "open",
      });
    }
    if (free > 0) {
      list.push({
        key: "free",
        tag: "Envío",
        title: "Envío gratis",
        subtitle: free === 1 ? "1 comercio no cobra el envío." : `${free} comercios no cobran el envío.`,
        cta: "Ver comercios",
        icon: "delivery",
        filter: "freeDelivery",
      });
    }
    if (pickup > 0) {
      list.push({
        key: "pickup",
        tag: "Sin esperar",
        title: "Retirá en el local",
        subtitle: "Pedí antes y pasá a buscarlo.",
        cta: "Ver comercios",
        icon: "pickup",
        filter: "pickup",
      });
    }
    return list;
  }, [merchants, cityName]);

  if (slides.length === 0) return null;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / (slideWidth + space.md));
    if (i !== index) setIndex(i);
  };

  return (
    <View style={styles.highlights}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={slideWidth + space.md}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
      >
        {slides.map((s) => (
          <View key={s.key} style={[styles.slide, { width: slideWidth, backgroundColor: t.primary }]}>
            <View style={styles.slideBody}>
              <View style={[styles.slideTag, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
                <Text style={styles.slideTagText} numberOfLines={1}>
                  {s.tag}
                </Text>
              </View>
              <Text style={styles.slideTitle} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={styles.slideSubtitle} numberOfLines={2}>
                {s.subtitle}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s.title}: ${s.cta}`}
                onPress={() => onPick(s.filter)}
                style={({ pressed }) => [styles.slideCta, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.slideCtaText}>{s.cta}</Text>
              </Pressable>
            </View>
            <View style={styles.slideArt}>
              <Icon name={s.icon} size={56} color={t.accent} />
            </View>
          </View>
        ))}
      </ScrollView>
      {slides.length > 1 && (
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View key={s.key} style={[styles.dot, { backgroundColor: i === index ? t.primary : t.border, width: i === index ? 18 : 6 }]} />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Piezas de la pantalla
// ---------------------------------------------------------------------------

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: t.text }]}>{title}</Text>
      {action && onAction && (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, { color: t.text }]}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function CategoryPill({ label, icon, selected, onPress }: { label: string; icon: IconName; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.pillIcon, { backgroundColor: selected ? t.primary : t.surface }]}>
        <Icon name={icon} size={24} color={selected ? t.primaryText : t.text} />
      </View>
      <Text style={[styles.pillText, { color: selected ? t.text : t.muted, fontWeight: selected ? "700" : "500" }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function deliveryText(m: CityMerchant): string | null {
  if (!m.acceptsDelivery) return null;
  return m.minDeliveryFeeMinor === 0 ? "Envío gratis" : `Envío desde ${formatARS(m.minDeliveryFeeMinor ?? 0)}`;
}

/** Tarjeta grande del carrusel «Abiertos ahora». Sin fotos todavía: portada con el ícono del rubro. */
function FeaturedCard({
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.displayName}, abierto`}
      style={({ pressed }) => [styles.featured, { opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={[styles.featuredCover, { backgroundColor: t.surface }]}>
        <Photo
          url={m.coverUrl ?? m.logoUrl}
          style={StyleSheet.absoluteFill}
          fallback={<Icon name={categoryIcon(categorySlug)} size={44} color={t.muted} />}
        />
        {m.acceptsDelivery && m.minDeliveryFeeMinor === 0 && (
          <View style={[styles.coverTag, { backgroundColor: t.success }]}>
            <Text style={styles.coverTagText}>Envío gratis</Text>
          </View>
        )}
      </View>
      <View style={styles.featuredBody}>
        <Text style={[styles.featuredTitle, { color: t.text }]} numberOfLines={1}>
          {m.displayName}
        </Text>
        <Text style={[styles.meta, { color: t.muted }]} numberOfLines={1}>
          {[categoryName, delivery ?? (m.acceptsPickup ? "Solo retiro" : null)].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

/** Fila del listado completo. */
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.displayName}, ${m.openNow ? "abierto" : "cerrado"}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: t.surface, overflow: "hidden" }]}>
        <Photo
          url={m.logoUrl}
          style={[StyleSheet.absoluteFill, { opacity: m.openNow ? 1 : 0.5 }]}
          fallback={<Icon name={categoryIcon(categorySlug)} size={26} color={m.openNow ? t.text : t.muted} />}
        />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, { color: t.text }]} numberOfLines={1}>
            {m.displayName}
          </Text>
          <Badge label={m.openNow ? "Abierto" : "Cerrado"} tone={m.openNow ? "success" : "neutral"} />
        </View>
        {categoryName && <Text style={[styles.meta, { color: t.muted }]}>{categoryName}</Text>}
        <View style={styles.rowInfo}>
          {m.acceptsPickup && <InfoBit icon="pickup" label="Retiro" t={t} />}
          {delivery && <InfoBit icon="delivery" label={delivery} t={t} />}
        </View>
      </View>
    </Pressable>
  );
}

function InfoBit({ icon, label, t }: { icon: IconName; label: string; t: Theme }) {
  return (
    <View style={styles.infoBit}>
      <Icon name={icon} size={14} color={t.muted} />
      <Text style={[styles.infoText, { color: t.muted }]}>{label}</Text>
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

  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg },
  logo: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  logoText: { fontFamily: font.display, fontSize: 24, fontWeight: "800", marginTop: -2 },
  headerLabel: { fontSize: 13 },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  cityName: { fontFamily: font.display, fontSize: 18, fontWeight: "700", flexShrink: 1 },

  searchRow: { flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, alignItems: "center" },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.lg, height: 50 },
  searchInput: { flex: 1, fontSize: 16, height: "100%" },
  filterButton: { width: 50, height: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },

  highlights: { marginTop: space.xl, gap: space.md },
  slide: { flexDirection: "row", borderRadius: radius.lg, padding: space.lg, paddingVertical: space.xl, minHeight: 168, overflow: "hidden" },
  slideBody: { flex: 1, gap: 6, alignItems: "flex-start" },
  slideTag: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  slideTagText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  slideTitle: { color: "#ffffff", fontFamily: font.display, fontSize: 26, lineHeight: 29, fontWeight: "800", letterSpacing: -0.5 },
  slideSubtitle: { color: "rgba(255,255,255,0.72)", fontSize: 14, lineHeight: 19 },
  slideCta: { marginTop: space.sm, backgroundColor: "#ffffff", borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 10 },
  slideCtaText: { color: "#151515", fontWeight: "700", fontSize: 14 },
  slideArt: {
    width: 104,
    height: 104,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginRight: -space.sm,
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { height: 6, borderRadius: radius.pill },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md },
  sectionTitle: { fontFamily: font.display, fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  sectionAction: { fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },

  categories: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 4 },
  pill: { alignItems: "center", gap: 6, width: 76 },
  pillIcon: { width: 60, height: 60, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 12, lineHeight: 15, textAlign: "center" },

  carouselRow: { gap: space.md, paddingHorizontal: space.lg, paddingVertical: 4 },
  featured: { width: 228 },
  featuredCover: { height: 140, borderRadius: radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  coverTag: { position: "absolute", top: space.sm, left: space.sm, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  coverTagText: { color: "#ffffff", fontSize: 11, fontWeight: "700" },
  featuredBody: { paddingTop: space.sm, gap: 2 },
  featuredTitle: { fontFamily: font.display, fontSize: 17, fontWeight: "700" },
  meta: { fontSize: 13 },

  activeFilterRow: { flexDirection: "row", paddingHorizontal: space.lg, marginBottom: space.md },
  activeFilter: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  activeFilterText: { fontSize: 13, fontWeight: "700" },

  list: { paddingHorizontal: space.lg, gap: space.lg },
  row: { flexDirection: "row", gap: space.md, alignItems: "center" },
  rowIcon: { width: 68, height: 68, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  rowTitle: { fontFamily: font.display, fontSize: 17, fontWeight: "700", flexShrink: 1 },
  rowInfo: { flexDirection: "row", flexWrap: "wrap", gap: space.md, marginTop: 2 },
  infoBit: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoText: { fontSize: 12 },

  state: { minHeight: 200 },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xl },
});
