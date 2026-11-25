import type { BranchSlots } from "@pedilo/api-client";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { radius, space, useTheme } from "@/lib/theme";

/**
 * Elegir una franja de 30 min para un pedido programado (ADR 0011): primero el día, después la
 * hora. Las franjas sin cupo se muestran deshabilitadas. Horas en la zona horaria de la sucursal.
 */
export function SlotPicker({
  data,
  value,
  onChange,
}: {
  data: BranchSlots;
  value: string | null;
  onChange: (startsAt: string) => void;
}) {
  const t = useTheme();
  const days = useMemo(() => groupByDay(data), [data]);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const selectedDay = days.find((d) => d.key === dayKey) ?? days.find((d) => d.slots.some((s) => s.startsAt === value)) ?? days[0];

  if (days.length === 0) {
    return <Text style={[styles.empty, { color: t.muted }]}>No hay horarios disponibles para programar en los próximos días.</Text>;
  }

  return (
    <View style={{ gap: space.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((d) => {
          const selected = d.key === selectedDay?.key;
          return (
            <Pressable
              key={d.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setDayKey(d.key)}
              style={[styles.day, { backgroundColor: selected ? t.primary : t.surface }]}
            >
              <Text style={[styles.dayTitle, { color: selected ? t.primaryText : t.text }]}>{d.title}</Text>
              <Text style={[styles.daySub, { color: selected ? t.primaryText : t.muted }]}>{d.subtitle}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.times}>
        {selectedDay?.slots.map((s) => {
          const selected = s.startsAt === value;
          return (
            <Pressable
              key={s.startsAt}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !s.available }}
              accessibilityLabel={s.available ? s.label : `${s.label}, sin lugar`}
              disabled={!s.available}
              onPress={() => onChange(s.startsAt)}
              style={[
                styles.time,
                {
                  backgroundColor: selected ? t.primarySoft : t.card,
                  borderColor: selected ? t.primary : t.border,
                  opacity: s.available ? 1 : 0.4,
                },
              ]}
            >
              <Text style={[styles.timeText, { color: selected ? t.primary : t.text, textDecorationLine: s.available ? "none" : "line-through" }]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface Day {
  key: string;
  title: string;
  subtitle: string;
  slots: { startsAt: string; available: boolean; label: string }[];
}

function groupByDay({ timezone, slots }: BranchSlots): Day[] {
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const weekday = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, weekday: "short" });
  const dayMonth = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("es-AR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const today = dayKey.format(new Date());
  const tomorrow = dayKey.format(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const days = new Map<string, Day>();
  for (const s of slots) {
    const at = new Date(s.startsAt);
    const key = dayKey.format(at);
    let day = days.get(key);
    if (!day) {
      const title = key === today ? "Hoy" : key === tomorrow ? "Mañana" : capitalize(weekday.format(at).replace(".", ""));
      day = { key, title, subtitle: dayMonth.format(at).replace(".", ""), slots: [] };
      days.set(key, day);
    }
    day.slots.push({ startsAt: s.startsAt, available: s.available, label: time.format(at) });
  }
  return [...days.values()];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Hoy 20:30", "Mañana 12:00", "Vie 28 nov 21:00" para mostrar la franja elegida. */
export function describeSlot(iso: string, timezone: string): string {
  const day = groupByDay({ timezone, slots: [{ startsAt: iso, available: true }] })[0]!;
  const sameYearDay = day.title === "Hoy" || day.title === "Mañana" ? day.title : `${day.title} ${day.subtitle}`;
  return `${sameYearDay} ${day.slots[0]!.label}`;
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
  day: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, alignItems: "center", minWidth: 72 },
  dayTitle: { fontSize: 15, fontWeight: "800" },
  daySub: { fontSize: 12 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  time: { borderRadius: radius.pill, borderWidth: 1.5, paddingHorizontal: space.md, paddingVertical: space.sm },
  timeText: { fontSize: 15, fontWeight: "700" },
  empty: { fontSize: 14 },
});
