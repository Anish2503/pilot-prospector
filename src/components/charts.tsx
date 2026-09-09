/**
 * Chart building blocks.
 *
 * COLOURS: the three below were checked with a colour-blindness validator
 * against a white card surface. All pass the lightness, chroma, colour-blind
 * separation and 3:1 contrast checks. Do not swap them for arbitrary hex codes
 * without re-checking - roughly 1 in 12 men cannot distinguish red from green.
 */

import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber } from '@/lib/utils';

export const SERIES = {
  /** Single-series bars and trends. */
  primary: '#2a78d6',
  /** Work finished. */
  done: '#0f9e6e',
  /** Work outstanding. */
  todo: '#eb6834',
} as const;

const AXIS = '#64748b';
const GRID = '#e2e8f0';
const SURFACE = '#ffffff';

// -----------------------------------------------------------------------------

export function ChartCard({
  title,
  subtitle,
  children,
  action,
  empty,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  empty?: boolean;
}) {
  return (
    <section className="card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-slate-400">Nothing to show yet.</p>
      ) : (
        children
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------

interface TooltipRow {
  name: string;
  value: number;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; fill?: string }>;
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  const rows: TooltipRow[] = payload
    .filter((entry) => entry.value !== undefined)
    .map((entry) => ({
      name: entry.name ?? '',
      value: Number(entry.value),
      color: entry.color ?? entry.fill ?? SERIES.primary,
    }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      {label && <p className="mb-1 text-xs font-medium text-slate-900">{label}</p>}
      {rows.map((row) => (
        <p key={row.name} className="flex items-center gap-2 text-xs text-slate-600">
          <span className="size-2 rounded-full" style={{ background: row.color }} />
          {row.name && <span>{row.name}:</span>}
          <span className="font-semibold tabular-nums text-slate-900">
            {formatNumber(row.value)}
            {unit ? ` ${unit}` : ''}
          </span>
        </p>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Horizontal bars, one colour. Length carries the meaning; colour carries
 * nothing, so there is no legend and nothing to misread.
 */
export function HorizontalBars({
  data,
  unit,
  height,
  highlightLabel,
}: {
  data: BarDatum[];
  unit?: string;
  height?: number;
  /** Draws one bar in a stronger tone, e.g. the BDM being examined. */
  highlightLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Nothing to show yet.</p>;
  }

  const chartHeight = height ?? Math.max(140, data.length * 34 + 20);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={132}
          tick={{ fontSize: 12, fill: '#334155' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<ChartTooltip unit={unit} />}
          cursor={{ fill: 'rgba(148,163,184,.12)' }}
        />
        <Bar dataKey="value" name={unit ?? 'Leads'} radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((entry) => (
            <Cell
              key={entry.label}
              fill={
                highlightLabel && entry.label === highlightLabel ? SERIES.done : SERIES.primary
              }
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            style={{ fontSize: 11, fill: AXIS, fontWeight: 600 }}
            formatter={(value) => formatNumber(Number(value))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// -----------------------------------------------------------------------------

export interface ProgressDatum {
  label: string;
  done: number;
  todo: number;
}

/**
 * Two stacked segments per row - work done against work left. A legend is
 * always shown, and each segment carries a 2px white gap so the boundary is
 * visible without relying on the colour difference alone.
 */
export function ProgressBars({ data, height }: { data: ProgressDatum[]; height?: number }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Nothing to show yet.</p>;
  }

  const chartHeight = height ?? Math.max(160, data.length * 38 + 40);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={132}
          tick={{ fontSize: 12, fill: '#334155' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,.12)' }} />
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: '#475569' }}
        />
        <Bar
          dataKey="done"
          name="Visited"
          stackId="progress"
          fill={SERIES.done}
          barSize={14}
          stroke={SURFACE}
          strokeWidth={2}
        />
        <Bar
          dataKey="todo"
          name="Still to visit"
          stackId="progress"
          fill={SERIES.todo}
          barSize={14}
          radius={[0, 4, 4, 0]}
          stroke={SURFACE}
          strokeWidth={2}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// -----------------------------------------------------------------------------

export interface TrendDatum {
  label: string;
  value: number;
}

/** One line over time. A single series needs no legend - the title names it. */
export function TrendArea({ data, unit }: { data: TrendDatum[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.primary} stopOpacity={0.22} />
            <stop offset="100%" stopColor={SERIES.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={38}
        />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="value"
          name={unit ?? 'Visits'}
          stroke={SERIES.primary}
          strokeWidth={2}
          fill="url(#trendFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// -----------------------------------------------------------------------------

/**
 * A single proportion, drawn as one bar rather than a pie. Two numbers do not
 * need a circle, and a bar is far easier to read accurately.
 */
export function ProportionBar({
  doneLabel,
  todoLabel,
  done,
  total,
}: {
  doneLabel: string;
  todoLabel: string;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{percent}%</p>
        <p className="text-xs text-slate-500">
          {formatNumber(done)} of {formatNumber(total)}
        </p>
      </div>

      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, background: SERIES.done }}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: SERIES.done }} />
          {doneLabel} {formatNumber(done)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-slate-300" />
          {todoLabel} {formatNumber(Math.max(0, total - done))}
        </span>
      </div>
    </div>
  );
}
