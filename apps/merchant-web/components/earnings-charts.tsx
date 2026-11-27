"use client";

import { formatARS } from "@pedilo/domain";
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";

/**
 * Gráficos del reporte de ganancias, en SVG propio (sin librería):
 * - Barras: ganancia neta de cada día (puede ser negativa si hubo devoluciones o ajustes).
 * - Línea: ganancia neta acumulada desde el primer día del período.
 * Son dos gráficos con su propio eje (nunca doble eje). Un solo color de serie; el título nombra
 * lo que se mide, así que no hace falta leyenda. Tooltip al pasar el mouse o con el teclado; los
 * mismos valores están en la tabla de la página.
 */

export interface ChartDay {
  date: string;
  netMinor: number;
  cumulativeNetMinor: number;
  orders: number;
}

const SERIES = "#257de0";
const GRID = "var(--border)";
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 64 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Escala «linda»: de 0 (o el mínimo negativo) a un máximo redondeado, con 4 marcas. */
function niceScale(values: number[]) {
  const max = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const span = max - minV || 100_00; // sin datos: $100 de rango para que el eje no colapse
  const rough = span / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const lo = Math.floor(minV / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const shortMoney = (minor: number) => {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor / 100);
  const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `${sign}$${fmt(abs / 1_000_000)} M`;
  if (abs >= 1_000) return `${sign}$${fmt(abs / 1_000)} mil`;
  return `${sign}$${abs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
};

/** La primera y la última fecha del eje se alinean al borde para no cortarse. */
const xAnchor = (i: number, n: number) => (n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle");

const dayLabel = (date: string, withWeekday = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(withWeekday && { weekday: "short" }),
  });

function Tooltip({ x, width, day, value, label }: { x: number; width: number; day: ChartDay; value: number; label: string }) {
  const left = Math.min(Math.max(x - 80, 0), Math.max(width - 160, 0));
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 w-40 rounded-lg border bg-background px-3 py-2 text-xs"
      style={{ left }}
    >
      <p className="text-sm font-semibold tabular-nums">{formatARS(value)}</p>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 text-muted-foreground">
        {dayLabel(day.date, true)} · {day.orders === 1 ? "1 pedido" : `${day.orders} pedidos`}
      </p>
    </div>
  );
}

function Axis({ ticks, y, plotWidth }: { ticks: number[]; y: (v: number) => number; plotWidth: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={PAD.left + plotWidth} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
            {shortMoney(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Marcas del eje X: unas 6 fechas repartidas, siempre la primera y la última. */
function xTickIndexes(n: number) {
  if (n <= 7) return [...Array(n).keys()];
  const every = Math.ceil(n / 6);
  const idx = [...Array(n).keys()].filter((i) => i % every === 0);
  if (idx.at(-1) !== n - 1) idx.push(n - 1);
  if (idx.length > 1 && n - 1 - idx.at(-2)! < every / 2) idx.splice(-2, 1);
  return idx;
}

export function DailyNetChart({ days }: { days: ChartDay[] }) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = Math.max(width - PAD.left - PAD.right, 0);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const { lo, hi, ticks } = niceScale(days.map((d) => d.netMinor));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotHeight;
  const band = days.length ? plotWidth / days.length : 0;
  const barW = Math.min(24, Math.max(band - 2, 1));
  const zero = y(0);

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="Ganancia neta por día">
          <Axis ticks={ticks} y={y} plotWidth={plotWidth} />
          {days.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const top = Math.min(y(d.netMinor), zero);
            const h = Math.abs(y(d.netMinor) - zero);
            const r = Math.min(4, h, barW / 2);
            const up = d.netMinor >= 0;
            // Esquinas de 4px solo en la punta del dato; cuadrada contra la línea de base.
            const path =
              h === 0
                ? ""
                : up
                  ? `M${cx - barW / 2},${zero} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${zero} Z`
                  : `M${cx - barW / 2},${zero} V${zero + h - r} Q${cx - barW / 2},${zero + h} ${cx - barW / 2 + r},${zero + h} H${cx + barW / 2 - r} Q${cx + barW / 2},${zero + h} ${cx + barW / 2},${zero + h - r} V${zero} Z`;
            return (
              <g key={d.date}>
                {path && <path d={path} fill={SERIES} opacity={active === null || active === i ? 1 : 0.45} />}
                {/* Zona de toque más grande que la barra */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${dayLabel(d.date, true)}: ${formatARS(d.netMinor)}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none focus-visible:stroke-ring"
                />
              </g>
            );
          })}
          <line x1={PAD.left} x2={PAD.left + plotWidth} y1={zero} y2={zero} stroke="var(--muted-foreground)" strokeWidth={1} />
          {xTickIndexes(days.length).map((i) => (
            <text
              key={days[i]!.date}
              x={PAD.left + band * i + band / 2}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {dayLabel(days[i]!.date)}
            </text>
          ))}
        </svg>
      )}
      {active !== null && days[active] && (
        <Tooltip
          x={PAD.left + band * active + band / 2}
          width={width}
          day={days[active]}
          value={days[active].netMinor}
          label="Ganancia neta del día"
        />
      )}
    </div>
  );
}

export function CumulativeNetChart({ days }: { days: ChartDay[] }) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = Math.max(width - PAD.left - PAD.right, 0);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const { lo, hi, ticks } = niceScale(days.map((d) => d.cumulativeNetMinor));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotHeight;
  const x = (i: number) => PAD.left + (days.length > 1 ? (i / (days.length - 1)) * plotWidth : plotWidth / 2);
  const line = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.cumulativeNetMinor)}`).join(" ");
  const area = days.length ? `${line} L${x(days.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z` : "";

  // El crosshair busca el día más cercano al puntero.
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = days.length > 1 ? Math.round((px / plotWidth) * (days.length - 1)) : 0;
    setActive(Math.min(Math.max(i, 0), days.length - 1));
  };
  const last = days.length - 1;

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Ganancia neta acumulada"
          onPointerMove={onMove}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => Math.min((a ?? -1) + 1, last));
            if (e.key === "ArrowLeft") setActive((a) => Math.max((a ?? last + 1) - 1, 0));
          }}
          onBlur={() => setActive(null)}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Axis ticks={ticks} y={y} plotWidth={plotWidth} />
          <path d={area} fill={SERIES} opacity={0.08} />
          <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last >= 0 && active === null && (
            <circle cx={x(last)} cy={y(days[last]!.cumulativeNetMinor)} r={4} fill={SERIES} stroke="var(--background)" strokeWidth={2} />
          )}
          {active !== null && days[active] && (
            <>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} stroke="var(--muted-foreground)" strokeWidth={1} />
              <circle cx={x(active)} cy={y(days[active].cumulativeNetMinor)} r={5} fill={SERIES} stroke="var(--background)" strokeWidth={2} />
            </>
          )}
          {xTickIndexes(days.length).map((i) => (
            <text key={days[i]!.date} x={x(i)} y={HEIGHT - 8} textAnchor={xAnchor(i, days.length)} className="fill-muted-foreground text-[11px]">
              {dayLabel(days[i]!.date)}
            </text>
          ))}
        </svg>
      )}
      {active !== null && days[active] && (
        <Tooltip x={x(active)} width={width} day={days[active]} value={days[active].cumulativeNetMinor} label="Acumulado hasta ese día" />
      )}
    </div>
  );
}
