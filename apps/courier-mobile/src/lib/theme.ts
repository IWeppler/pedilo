/**
 * Paleta de Pedilo, la misma de la app del cliente. Base blanca y tinta.
 * - `primary` es la tinta: botones principales, selección y texto fuerte.
 * - `accent` (rojo tomate) es solo para señales chicas: la marca, el contador del carrito,
 *   lo que pide atención (efectivo a cobrar, ofertas nuevas). Nunca para fondos grandes.
 * - Verde y rojo de estado solo para «abierto/listo» y errores.
 * Sin sombras: las superficies se separan por color (`surface`) o por una línea (`border`).
 */
const light = {
  background: "#ffffff",
  card: "#ffffff",
  surface: "#f3f2ef",
  border: "#e6e4e0",
  text: "#151515",
  muted: "#6e6a64",
  primary: "#151515",
  primaryText: "#ffffff",
  primarySoft: "#f3f2ef",
  accent: "#e5432b",
  accentText: "#ffffff",
  accentSoft: "#fdebe7",
  success: "#1f7a45",
  successBg: "#e3f3e8",
  danger: "#b42318",
  dangerBg: "#fdecea",
};

const dark: typeof light = {
  background: "#0f0f0f",
  card: "#181818",
  surface: "#222220",
  border: "#2e2d2a",
  text: "#f5f4f1",
  muted: "#a3a09a",
  primary: "#f5f4f1",
  primaryText: "#151515",
  primarySoft: "#222220",
  accent: "#ff5a40",
  accentText: "#ffffff",
  accentSoft: "#3a1a14",
  success: "#5cc98a",
  successBg: "#123322",
  danger: "#f2867c",
  dangerBg: "#3d1512",
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

/**
 * Familias tipográficas. En los estilos se escribe `fontFamily: font.display` (títulos, precios,
 * marca) y el peso con `fontWeight`; el `Text` de `@/components/text` elige el archivo de fuente.
 * Sin `fontFamily`, el texto usa la familia de lectura.
 */
export const font = { display: "display", text: "text" } as const;
