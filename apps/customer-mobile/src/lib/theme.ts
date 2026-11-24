import { useColorScheme } from "react-native";

/** Paleta mínima con modo claro y oscuro. */
const light = {
  background: "#ffffff",
  surface: "#f5f5f4",
  border: "#e7e5e4",
  text: "#1c1917",
  muted: "#78716c",
  primary: "#1c1917",
  primaryText: "#ffffff",
  success: "#15803d",
  successBg: "#dcfce7",
  danger: "#b91c1c",
  dangerBg: "#fee2e2",
};

const dark: typeof light = {
  background: "#0c0a09",
  surface: "#1c1917",
  border: "#292524",
  text: "#fafaf9",
  muted: "#a8a29e",
  primary: "#fafaf9",
  primaryText: "#0c0a09",
  success: "#4ade80",
  successBg: "#14532d",
  danger: "#f87171",
  dangerBg: "#450a0a",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
