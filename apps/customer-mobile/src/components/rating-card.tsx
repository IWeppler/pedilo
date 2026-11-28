import { ApiError, unwrap } from "@pedilo/api-client";
import { MAX_RATING_COMMENT } from "@pedilo/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text, TextInput } from "@/components/text";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { font, radius, space, useTheme } from "@/lib/theme";

const LABELS = ["", "Muy mal", "Mal", "Bien", "Muy bien", "Excelente"] as const;

/**
 * Calificar el comercio de un pedido terminado (ADR 0031): estrellas y un comentario opcional que
 * lee el comercio. Se manda una sola vez.
 */
export function RatingCard({
  orderId,
  merchantName,
  initialStars,
  rated,
}: {
  orderId: string;
  merchantName: string;
  /** Estrellas preelegidas (desde el aviso del inicio). */
  initialStars?: number | undefined;
  /** Ya calificado: muestra cuántas estrellas dio. */
  rated: number | null;
}) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(initialStars ?? 0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/v1/customer/orders/{orderId}/rating", { params: { path: { orderId } }, body: { stars, comment: comment.trim() || null } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["customer", "orders"] }),
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "CONFLICT"
          ? err.message
          : "No pudimos enviar tu calificación. Revisá tu conexión y probá de nuevo.",
      ),
  });

  const done = rated ?? (send.isSuccess ? stars : null);
  if (done !== null) {
    return (
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        <Text style={[styles.title, { color: t.text }]}>Gracias por calificar</Text>
        <Text style={{ color: t.muted }} accessibilityLabel={`Le diste ${done} de 5 estrellas a ${merchantName}`}>
          <Text style={{ color: t.accent }}>{"★".repeat(done)}</Text>
          <Text style={{ color: t.border }}>{"★".repeat(5 - done)}</Text>
          {"  "}a {merchantName}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">
        ¿Cómo estuvo tu pedido?
      </Text>
      <Text style={{ color: t.muted }}>Tu calificación ayuda a otros a elegir {merchantName}.</Text>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Calificación de 1 a 5 estrellas">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: stars === n }}
            accessibilityLabel={`${n} ${n === 1 ? "estrella" : "estrellas"}: ${LABELS[n]}`}
            onPress={() => setStars(n)}
            hitSlop={4}
          >
            <Text style={[styles.star, { color: n <= stars ? t.accent : t.border }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.starLabel, { color: stars ? t.text : t.muted }]}>{stars ? LABELS[stars] : "Tocá las estrellas"}</Text>
      {stars > 0 && (
        <>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Contale al comercio qué te gustó o qué mejorar (opcional)"
            placeholderTextColor={t.muted}
            accessibilityLabel="Comentario para el comercio"
            multiline
            maxLength={MAX_RATING_COMMENT}
            style={[styles.input, { backgroundColor: t.background, color: t.text }]}
          />
          <Text style={{ color: t.muted, fontSize: 12 }}>El comentario lo lee el comercio; no se publica.</Text>
          {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
          <Button
            label={send.isPending ? "Enviando…" : "Enviar calificación"}
            onPress={() => {
              setError(null);
              send.mutate();
            }}
            disabled={send.isPending}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, padding: space.lg, gap: space.sm },
  title: { fontFamily: font.display, fontSize: 19, fontWeight: "700" },
  stars: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  star: { fontSize: 38, lineHeight: 44 },
  starLabel: { fontSize: 14, fontWeight: "600" },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, fontSize: 15, minHeight: 80, textAlignVertical: "top" },
});
