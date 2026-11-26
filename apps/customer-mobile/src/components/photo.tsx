import { Image, type ImageStyle } from "expo-image";
import type { ReactNode } from "react";
import type { StyleProp } from "react-native";

import { API_URL } from "@/lib/config";

/**
 * Fotos de comercios y productos (ADR 0017). En almacenamiento local la API devuelve rutas
 * relativas (`/media/...`): se resuelven contra la misma URL de la API que usa la app, así
 * funciona igual en el celular (IP de la red) que en el navegador (localhost).
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${API_URL}${url}` : url;
}

/** La foto, o `fallback` (el ícono del rubro) si no hay. Con caché en disco y fundido suave. */
export function Photo({
  url,
  style,
  fallback,
  accessibilityLabel,
}: {
  url: string | null | undefined;
  style: StyleProp<ImageStyle>;
  fallback?: ReactNode;
  accessibilityLabel?: string;
}) {
  const uri = resolveMediaUrl(url);
  if (!uri) return <>{fallback ?? null}</>;
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
