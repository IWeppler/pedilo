/**
 * Paleta de Pedilo con modo claro y oscuro.
 * `primary` es el naranja de marca: botones principales, selección, acentos.
 */
const light = {
  background: "#fafaf9",
  card: "#ffffff",
  surface: "#f2f1ef",
  border: "#e7e5e4",
  text: "#1c1917",
  muted: "#78716c",
  primary: "#f2681d",
  primaryText: "#ffffff",
  primarySoft: "#fff0e6",
  success: "#15803d",
  successBg: "#dcfce7",
  danger: "#b91c1c",
  dangerBg: "#fee2e2",
  shadow: "#1c1917",
};

const dark: typeof light = {
  background: "#0c0a09",
  card: "#1c1917",
  surface: "#292524",
  border: "#292524",
  text: "#fafaf9",
  muted: "#a8a29e",
  primary: "#ff7a33",
  primaryText: "#ffffff",
  primarySoft: "#3b1d0c",
  success: "#4ade80",
  successBg: "#14532d",
  danger: "#f87171",
  dangerBg: "#450a0a",
  shadow: "#000000",
};

export type Theme = typeof light;

/**
 * La app se ve siempre en claro, sin importar el tema del teléfono (`userInterfaceStyle: "light"`
 * en app.json). La paleta oscura queda lista por si más adelante se ofrece como opción.
 */
export const colorScheme: "light" | "dark" = "light";

export function useTheme(): Theme {
  return colorScheme === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

/** Sombra suave para tarjetas (iOS usa shadow*, Android elevation). */
export function cardShadow(t: Theme) {
  return {
    shadowColor: t.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } as const;
}
