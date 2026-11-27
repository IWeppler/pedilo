import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { type ComponentProps, createContext, useContext } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextProps,
  type TextStyle,
  StyleSheet,
} from "react-native";

/**
 * Tipografías de la app: Bricolage Grotesque para títulos, precios y marca; Hanken Grotesk
 * para leer. React Native no elige el archivo de una fuente propia por `fontWeight` (en Android
 * cada peso es otra familia), así que estos `Text` y `TextInput` traducen
 * `fontFamily` (`font.display` o `font.text`) + `fontWeight` al archivo que corresponde.
 */
export const fontAssets = {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
};

const FAMILIES = {
  display: { 400: "BricolageGrotesque_600SemiBold", 500: "BricolageGrotesque_600SemiBold", 600: "BricolageGrotesque_600SemiBold", 700: "BricolageGrotesque_700Bold", 800: "BricolageGrotesque_800ExtraBold" },
  text: { 400: "HankenGrotesk_400Regular", 500: "HankenGrotesk_500Medium", 600: "HankenGrotesk_600SemiBold", 700: "HankenGrotesk_700Bold", 800: "HankenGrotesk_700Bold" },
} as const;

function weightOf(w: TextStyle["fontWeight"]): 400 | 500 | 600 | 700 | 800 {
  const n = w === "bold" ? 700 : w === "normal" || w === undefined ? 400 : Number(w);
  if (n >= 800) return 800;
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

/** Estilo que reemplaza `fontFamily`/`fontWeight` por el archivo de fuente exacto. */
function resolveFont(style: TextProps["style"], nested: boolean): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  // Un texto anidado sin tipografía propia (solo color, por ejemplo) hereda la del padre.
  if (nested && flat.fontFamily === undefined && flat.fontWeight === undefined) return {};
  const family = flat.fontFamily === "display" ? FAMILIES.display : flat.fontFamily && flat.fontFamily !== "text" ? null : FAMILIES.text;
  if (!family) return {};
  return { fontFamily: family[weightOf(flat.fontWeight)], fontWeight: "normal" };
}

/** Marca que un `Text` está dentro de otro, para que el de adentro herede la fuente. */
const InsideText = createContext(false);

export function Text(props: ComponentProps<typeof RNText>) {
  const nested = useContext(InsideText);
  return (
    <InsideText.Provider value>
      <RNText {...props} style={[props.style, resolveFont(props.style, nested)]} />
    </InsideText.Provider>
  );
}

export function TextInput(props: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...props} style={[props.style, resolveFont(props.style, false)]} />;
}
