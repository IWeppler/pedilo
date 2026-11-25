import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

/**
 * Íconos de la app: SF Symbols en iOS y Material Symbols en Android/web (vía `expo-symbols`).
 * Se nombran por intención para no repetir el par iOS/Android en cada pantalla.
 */
const ICONS = {
  home: { ios: "house.fill", android: "home" },
  orders: { ios: "list.bullet.rectangle.portrait", android: "receipt_long" },
  cart: { ios: "bag.fill", android: "shopping_bag" },
  search: { ios: "magnifyingglass", android: "search" },
  location: { ios: "mappin.and.ellipse", android: "location_on" },
  chevronDown: { ios: "chevron.down", android: "expand_more" },
  chevronRight: { ios: "chevron.right", android: "chevron_right" },
  filter: { ios: "slider.horizontal.3", android: "tune" },
  store: { ios: "storefront.fill", android: "storefront" },
  food: { ios: "fork.knife", android: "lunch_dining" },
  kiosk: { ios: "cup.and.saucer.fill", android: "local_convenience_store" },
  grocery: { ios: "cart.fill", android: "local_grocery_store" },
  electronics: { ios: "headphones", android: "devices" },
  handmade: { ios: "birthday.cake.fill", android: "cake" },
  delivery: { ios: "bicycle", android: "delivery_dining" },
  pickup: { ios: "bag", android: "takeout_dining" },
  clock: { ios: "clock", android: "schedule" },
  grid: { ios: "square.grid.2x2.fill", android: "category" },
  back: { ios: "chevron.left", android: "arrow_back" },
  add: { ios: "plus", android: "add" },
  remove: { ios: "minus", android: "remove" },
  close: { ios: "xmark", android: "close" },
  check: { ios: "checkmark", android: "check" },
  trash: { ios: "trash", android: "delete" },
  cash: { ios: "banknote", android: "payments" },
  bank: { ios: "building.columns", android: "account_balance" },
  calendar: { ios: "calendar", android: "calendar_month" },
  bolt: { ios: "bolt.fill", android: "bolt" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning" },
  note: { ios: "square.and.pencil", android: "edit_note" },
  info: { ios: "info.circle", android: "info" },
} as const satisfies Record<string, ComponentProps<typeof SymbolView>["name"]>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  const symbol = ICONS[name];
  return (
    <SymbolView
      name={{ ios: symbol.ios, android: symbol.android, web: symbol.android }}
      size={size}
      tintColor={color}
      style={style}
    />
  );
}

/** Ícono de cada rubro según su slug (los define el seed). Rubros nuevos caen en «comercio». */
export function categoryIcon(slug: string | undefined): IconName {
  switch (slug) {
    case "gastronomia":
      return "food";
    case "kioscos":
      return "kiosk";
    case "supermercados":
      return "grocery";
    case "electronica":
      return "electronics";
    case "emprendedores":
      return "handmade";
    default:
      return "store";
  }
}
