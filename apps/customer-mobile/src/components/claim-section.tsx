import { ApiError, type Claim, unwrap } from "@pedilo/api-client";
import {
  CLAIM_REASON_LABELS,
  CLAIM_RESOLUTION_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_WINDOW_HOURS,
  type ClaimReason,
  formatARS,
} from "@pedilo/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { Text, TextInput } from "@/components/text";
import { Icon } from "@/components/icon";
import { Photo } from "@/components/photo";
import { Button, Chip } from "@/components/ui";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { font, radius, space, type Theme, useTheme } from "@/lib/theme";

const REASONS: ClaimReason[] = ["MISSING_ITEM", "WRONG_ITEM", "QUALITY", "DELAY", "NOT_DELIVERED", "WRONG_CHARGE"];
const CLAIMABLE = ["DELIVERED", "PICKED_UP", "DELIVERY_FAILED"];

const ACTOR_LABELS: Record<string, string> = { CUSTOMER: "Vos", MERCHANT: "Comercio", ADMIN: "Pedilo", SYSTEM: "Pedilo" };
const KIND_LABELS: Record<string, string> = {
  OPENED: "Abriste el reclamo",
  EVIDENCE: "Agregaste una foto",
  PROPOSAL: "Propuesta",
  ACCEPTED: "Aceptaste la propuesta",
  REJECTED: "No aceptaste la propuesta",
  ESCALATED: "Lo pasó a Pedilo",
  REFUNDED: "Devolución hecha",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
};
const timeFormat = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Reclamo del pedido (ADR 0019): abrirlo con motivo, descripción y fotos; ver la propuesta del
 * comercio y aceptarla o no; pedir que intervenga Pedilo. Usa el token de seguimiento.
 */
export function ClaimSection({ orderId, token, orderStatus }: { orderId: string; token: string; orderStatus: string }) {
  const t = useTheme();
  const headers = { "x-order-token": token };
  const claim = useQuery({
    queryKey: ["claim", orderId],
    queryFn: () => unwrap(api.GET("/v1/public/orders/{orderId}/claim", { params: { path: { orderId }, header: headers } })),
    enabled: CLAIMABLE.includes(orderStatus),
    refetchInterval: (q) => (q.state.data?.claim && !["RESOLVED", "CLOSED"].includes(q.state.data.claim.status) ? 20_000 : false),
  });
  if (!CLAIMABLE.includes(orderStatus) || claim.isPending) return null;
  const c = claim.data?.claim;
  return c ? <ClaimStatusCard orderId={orderId} token={token} claim={c} /> : <OpenClaim orderId={orderId} token={token} t={t} />;
}

function OpenClaim({ orderId, token, t }: { orderId: string; token: string; t: Theme }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClaimReason | null>(null);
  const [description, setDescription] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/v1/public/orders/{orderId}/claim", {
          params: { path: { orderId }, header: { "x-order-token": token } },
          body: { reason: reason!, description: description.trim(), sensitive },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(["claim", orderId], { claim: data }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "No pudimos enviar el reclamo. Revisá tu conexión."),
  });

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.openLink} hitSlop={8}>
        <Icon name="warning" size={16} color={t.muted} />
        <Text style={{ color: t.muted, fontWeight: "600" }}>¿Tuviste un problema con el pedido?</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <Text style={[styles.title, { color: t.text }]}>Contanos qué pasó</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        El comercio tiene 24 h para proponerte una solución. Podés reclamar hasta {CLAIM_WINDOW_HOURS} h después de recibir el pedido.
      </Text>
      <View style={styles.chips}>
        {REASONS.map((r) => (
          <Chip key={r} label={CLAIM_REASON_LABELS[r]} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Por ejemplo: faltó la gaseosa"
        placeholderTextColor={t.muted}
        accessibilityLabel="Descripción del problema"
        multiline
        style={[styles.input, { backgroundColor: t.surface, color: t.text, minHeight: 80 }]}
      />
      <View style={styles.row}>
        <Text style={{ color: t.text, flex: 1 }}>Es un problema de salud o seguridad (lo revisa Pedilo directamente)</Text>
        <Switch value={sensitive} onValueChange={setSensitive} accessibilityLabel="Problema de salud o seguridad" />
      </View>
      {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
      <Button
        label={submit.isPending ? "Enviando…" : "Enviar reclamo"}
        disabled={!reason || description.trim().length < 10 || submit.isPending}
        onPress={() => {
          setError(null);
          submit.mutate();
        }}
      />
      {description.trim().length > 0 && description.trim().length < 10 && (
        <Text style={{ color: t.muted, fontSize: 12 }}>Contanos un poco más (al menos 10 caracteres).</Text>
      )}
    </View>
  );
}

function ClaimStatusCard({ orderId, token, claim: c }: { orderId: string; token: string; claim: Claim }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const headers = { "x-order-token": token };
  const [message, setMessage] = useState("");
  const [escalating, setEscalating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (data: Claim) => queryClient.setQueryData(["claim", orderId], { claim: data });
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : "Sin conexión. Probá de nuevo.");

  const respond = useMutation({
    mutationFn: (accept: boolean) =>
      unwrap(api.POST("/v1/public/orders/{orderId}/claim/respond", { params: { path: { orderId }, header: headers }, body: { accept } })),
    onSuccess: update,
    onError,
  });
  const escalate = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/v1/public/orders/{orderId}/claim/escalate", { params: { path: { orderId }, header: headers }, body: { comment: message.trim() } })),
    onSuccess: (d) => {
      update(d);
      setMessage("");
      setEscalating(false);
    },
    onError,
  });
  const send = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/v1/public/orders/{orderId}/claim/messages", { params: { path: { orderId }, header: headers }, body: { body: message.trim() } })),
    onSuccess: (d) => {
      update(d);
      setMessage("");
    },
    onError,
  });
  const photo = useMutation({
    mutationFn: async () => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled || !picked.assets[0]) return null;
      const asset = picked.assets[0];
      const body = new FormData();
      // React Native acepta { uri, name, type } como archivo en FormData.
      body.append("file", { uri: asset.uri, name: asset.fileName ?? "foto.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(`${API_URL}/v1/public/orders/${orderId}/claim/evidence`, { method: "PUT", headers, body });
      const json = (await res.json()) as Claim & { error?: { message: string } };
      if (!res.ok) throw new ApiError(res.status, "UPLOAD", json.error?.message ?? "No pudimos subir la foto");
      return json;
    },
    onSuccess: (d) => d && update(d),
    onError,
  });

  const open = !["RESOLVED", "CLOSED"].includes(c.status);
  const proposalPending = c.status === "MERCHANT_REVIEW" && c.proposal;

  return (
    <View style={[styles.card, { backgroundColor: t.surface }]}>
      <View style={styles.row}>
        <Text style={[styles.title, { color: t.text, flex: 1 }]}>Reclamo: {CLAIM_REASON_LABELS[c.reason]}</Text>
      </View>
      <View style={[styles.status, { backgroundColor: open ? t.accentSoft : t.successBg }]}>
        <Text style={{ color: open ? t.accent : t.success, fontWeight: "700" }}>{CLAIM_STATUS_LABELS[c.status]}</Text>
      </View>

      {proposalPending && (
        <View style={[styles.proposal, { borderColor: t.primary }]}>
          <Text style={{ color: t.text, fontWeight: "800" }}>
            El comercio propone: {CLAIM_RESOLUTION_LABELS[c.proposal!.type]}
            {c.proposal!.amountMinor ? ` de ${formatARS(c.proposal!.amountMinor)}` : ""}
          </Text>
          {c.proposal!.note && <Text style={{ color: t.text }}>«{c.proposal!.note}»</Text>}
          <View style={styles.row}>
            <Button label="No acepto" variant="outline" onPress={() => respond.mutate(false)} disabled={respond.isPending} style={{ flex: 1 }} />
            <Button label="Acepto" onPress={() => respond.mutate(true)} disabled={respond.isPending} style={{ flex: 1 }} />
          </View>
        </View>
      )}
      {c.status === "AGREED_REFUND" && (
        <Text style={{ color: t.text }}>Acordaron una devolución de {formatARS(c.proposal?.amountMinor ?? 0)}. El comercio te avisa cuando la haga.</Text>
      )}
      {c.refundedMinor ? <Text style={{ color: t.success, fontWeight: "700" }}>El comercio registró la devolución de {formatARS(c.refundedMinor)}.</Text> : null}
      {c.resolutionNote && !open && <Text style={{ color: t.text }}>{c.resolutionNote}</Text>}

      {c.evidence.length > 0 && (
        <View style={styles.photos}>
          {c.evidence.map((url) => (
            <Photo key={url} url={url} style={styles.photo} />
          ))}
        </View>
      )}

      <View style={{ gap: 6 }}>
        {c.events.map((e, i) => (
          <Text key={i} style={{ color: t.muted, fontSize: 13 }}>
            {timeFormat.format(new Date(e.createdAt))} · {ACTOR_LABELS[e.actor]}: {e.kind === "MESSAGE" ? e.body : (KIND_LABELS[e.kind] ?? e.kind)}
            {e.kind !== "MESSAGE" && e.body ? ` — ${e.body}` : ""}
          </Text>
        ))}
      </View>

      {open && (
        <>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={escalating ? "Contale a Pedilo por qué no estás de acuerdo" : "Escribí un mensaje"}
            placeholderTextColor={t.muted}
            accessibilityLabel="Mensaje"
            multiline
            style={[styles.input, { backgroundColor: t.surface, color: t.text }]}
          />
          <View style={styles.row}>
            {c.evidence.length < 3 && (
              <Button label={photo.isPending ? "Subiendo…" : "Agregar foto"} variant="outline" onPress={() => photo.mutate()} disabled={photo.isPending} style={{ flex: 1 }} />
            )}
            {escalating ? (
              <Button label="Pedir ayuda a Pedilo" onPress={() => escalate.mutate()} disabled={message.trim().length < 5 || escalate.isPending} style={{ flex: 1 }} />
            ) : (
              <Button label="Enviar" onPress={() => send.mutate()} disabled={message.trim().length === 0 || send.isPending} style={{ flex: 1 }} />
            )}
          </View>
          {c.status === "DISPUTED" && !escalating && (
            <Pressable onPress={() => setEscalating(true)} accessibilityRole="button" hitSlop={8}>
              <Text style={{ color: t.text, fontWeight: "700", textAlign: "center", textDecorationLine: "underline" }}>No llegamos a un acuerdo: pedir que intervenga Pedilo</Text>
            </Pressable>
          )}
        </>
      )}
      {error && <Text style={{ color: t.danger, fontWeight: "600" }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  openLink: { flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingVertical: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  title: { fontFamily: font.display, fontSize: 17, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 15 },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  status: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
  proposal: { borderWidth: 1.5, borderRadius: radius.md, padding: space.md, gap: space.sm },
  photos: { flexDirection: "row", gap: space.sm },
  photo: { width: 72, height: 72, borderRadius: radius.md },
});
