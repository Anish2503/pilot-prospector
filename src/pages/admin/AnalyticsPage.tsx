import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Home, Phone, Swords, Users } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import {
  ChartCard,
  HorizontalBars,
  ProgressBars,
  ProportionBar,
  TrendArea,
  type BarDatum,
  type ProgressDatum,
} from '@/components/charts';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatNumber, formatPercent, formatRelative, STATUS_LABELS } from '@/lib/utils';
import type {
  AdminDashboardStats,
  BdmPerformance,
  BreakdownRow,
  LeadStatus,
  VisitActivityRow,
} from '@/types';

const TREND_DAYS = 30;

export default function AnalyticsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [focusBdm, setFocusBdm] = useState('');

  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [performance, setPerformance] = useState<BdmPerformance[]>([]);
  const [areas, setAreas] = useState<BarDatum[]>([]);
  const [cities, setCities] = useState<BarDatum[]>([]);
  const [statuses, setStatuses] = useState<BarDatum[]>([]);
  const [competitors, setCompetitors] = useState<BarDatum[]>([]);
  const [trend, setTrend] = useState<VisitActivityRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const range = { p_from: from || null, p_to: to || null };

    // Every one of these is computed inside the database and returns a handful
    // of rows - never the ten thousand leads behind them.
    const [statsRes, perfRes, areaRes, cityRes, statusRes, compRes, trendRes] = await Promise.all([
      supabase.rpc('admin_dashboard_stats', range),
      supabase.rpc('bdm_performance', range),
      supabase.rpc('leads_breakdown', { p_field: 'area', p_limit: 10 }),
      supabase.rpc('leads_breakdown', { p_field: 'city', p_limit: 8 }),
      supabase.rpc('leads_breakdown', { p_field: 'status', p_limit: 8 }),
      supabase.rpc('leads_breakdown', { p_field: 'competitor_name', p_limit: 8 }),
      supabase.rpc('visit_activity', { p_days: TREND_DAYS }),
    ]);

    const failure = [statsRes, perfRes, areaRes, cityRes, statusRes, compRes, trendRes].find(
      (r) => r.error,
    );
    if (failure?.error) {
      setError(friendlyError(failure.error, 'Could not load analytics.'));
      setLoading(false);
      return;
    }

    const toBars = (rows: BreakdownRow[] | null): BarDatum[] =>
      (rows ?? []).map((row) => ({ label: row.label, value: Number(row.lead_count) }));

    setStats(statsRes.data as AdminDashboardStats);
    setPerformance((perfRes.data ?? []) as BdmPerformance[]);
    setAreas(toBars(areaRes.data as BreakdownRow[]));
    setCities(toBars(cityRes.data as BreakdownRow[]));
    setCompetitors(toBars(compRes.data as BreakdownRow[]));
    setTrend((trendRes.data ?? []) as VisitActivityRow[]);

    // Status labels come from our own dictionary, not raw database values.
    setStatuses(
      ((statusRes.data ?? []) as BreakdownRow[]).map((row) => ({
        label: STATUS_LABELS[row.label as LeadStatus] ?? row.label,
        value: Number(row.lead_count),
      })),
    );

    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePerformance = useMemo(
    () => performance.filter((row) => row.active || row.assigned_leads > 0),
    [performance],
  );

  const leadsByBdm: BarDatum[] = useMemo(
    () =>
      [...activePerformance]
        .sort((a, b) => b.assigned_leads - a.assigned_leads)
        .map((row) => ({ label: row.bdm_name, value: Number(row.assigned_leads) })),
    [activePerformance],
  );

  const progressByBdm: ProgressDatum[] = useMemo(
    () =>
      [...activePerformance]
        .filter((row) => row.assigned_leads > 0)
        .sort((a, b) => b.assigned_leads - a.assigned_leads)
        .map((row) => ({
          label: row.bdm_name,
          done: Number(row.visited_leads),
          todo: Number(row.pending_leads),
        })),
    [activePerformance],
  );

  const trendData = useMemo(
    () =>
      trend.map((row) => ({
        label: new Date(row.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        value: Number(row.visits),
      })),
    [trend],
  );

  const focused = useMemo(
    () => performance.find((row) => row.bdm_id === focusBdm) ?? null,
    [performance, focusBdm],
  );

  if (loading && !stats) return <LoadingBlock label="Working out the numbers…" />;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            How the pipeline and the team are doing.
          </p>
        </div>

        {/* Filters sit in one row above the charts. */}
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Leads added from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            containerClassName="w-40"
          />
          <Input
            label="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            containerClassName="w-40"
          />
          {(from || to) && (
            <Button
              variant="ghost"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* -------------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Societies" value={stats?.total_leads} icon={Building2} loading={loading} />
        <StatCard
          label="Total units"
          value={stats?.total_units}
          icon={Home}
          tone="violet"
          loading={loading}
        />
        <StatCard
          label="Active BDMs"
          value={stats?.active_bdms}
          sublabel={stats ? `${stats.total_bdms} in total` : undefined}
          icon={Users}
          tone="slate"
          loading={loading}
        />
        <StatCard
          label="POCs collected"
          value={stats?.leads_with_poc}
          icon={Phone}
          tone="emerald"
          loading={loading}
        />
        <StatCard
          label="Competitors found"
          value={stats?.leads_with_competitor}
          icon={Swords}
          tone="amber"
          loading={loading}
        />
      </div>

      {/* --------------------------------------------------------- Coverage */}
      <div className="grid gap-4 md:grid-cols-3">
        <ChartCard title="Assigned" subtitle="Societies with a BDM">
          <ProportionBar
            doneLabel="Assigned"
            todoLabel="Unassigned"
            done={stats?.assigned_leads ?? 0}
            total={stats?.total_leads ?? 0}
          />
        </ChartCard>

        <ChartCard title="Visited" subtitle="Societies with at least one update">
          <ProportionBar
            doneLabel="Visited"
            todoLabel="Pending"
            done={stats?.visited_leads ?? 0}
            total={stats?.total_leads ?? 0}
          />
        </ChartCard>

        <ChartCard title="On the map" subtitle="Societies with known coordinates">
          <ProportionBar
            doneLabel="Located"
            todoLabel="Missing"
            done={stats?.leads_with_location ?? 0}
            total={stats?.total_leads ?? 0}
          />
        </ChartCard>
      </div>

      {/* ----------------------------------------------------------- Trend */}
      <ChartCard
        title="Visits per day"
        subtitle={`Updates logged by BDMs over the last ${TREND_DAYS} days`}
        empty={trendData.length === 0}
      >
        <TrendArea data={trendData} unit="visits" />
      </ChartCard>

      {/* ------------------------------------------------------------- Team */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Leads by BDM"
          subtitle="How the workload is spread"
          empty={leadsByBdm.length === 0}
        >
          <HorizontalBars data={leadsByBdm} unit="leads" highlightLabel={focused?.bdm_name} />
        </ChartCard>

        <ChartCard
          title="Progress by BDM"
          subtitle="Visited against still to visit"
          empty={progressByBdm.length === 0}
        >
          <ProgressBars data={progressByBdm} />
        </ChartCard>

        <ChartCard title="Leads by area" subtitle="Top 10 areas" empty={areas.length === 0}>
          <HorizontalBars data={areas} unit="leads" />
        </ChartCard>

        <ChartCard title="Leads by city" empty={cities.length === 0}>
          <HorizontalBars data={cities} unit="leads" />
        </ChartCard>

        <ChartCard title="Leads by status" empty={statuses.length === 0}>
          <HorizontalBars data={statuses} unit="leads" />
        </ChartCard>

        <ChartCard
          title="Competitors found"
          subtitle="Recorded by BDMs during visits"
          empty={competitors.length === 0}
        >
          <HorizontalBars data={competitors} unit="leads" />
        </ChartCard>
      </div>

      {/* --------------------------------------------------- BDM drill-down */}
      <ChartCard
        title="Individual BDM"
        subtitle="Pick someone to see their numbers on their own"
        action={
          <Select
            value={focusBdm}
            onChange={(e) => setFocusBdm(e.target.value)}
            placeholder="Choose a BDM"
            options={performance.map((row) => ({ value: row.bdm_id, label: row.bdm_name }))}
            containerClassName="w-52"
            aria-label="Choose a BDM"
          />
        }
      >
        {!focused ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Choose a BDM above to see their individual figures.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniFigure label="Assigned" value={focused.assigned_leads} />
              <MiniFigure label="Visited" value={focused.visited_leads} />
              <MiniFigure label="Still to visit" value={focused.pending_leads} />
              <MiniFigure label="Total visits" value={focused.total_visits} />
              <MiniFigure label="Units covered" value={focused.total_units} />
              <MiniFigure label="POCs collected" value={focused.pocs_collected} />
              <MiniFigure label="Competitors found" value={focused.competitors_identified} />
              <MiniFigure label="Follow-ups open" value={focused.follow_up_leads} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Visit completion</p>
                <ProportionBar
                  doneLabel="Visited"
                  todoLabel="Pending"
                  done={Number(focused.visited_leads)}
                  total={Number(focused.assigned_leads)}
                />
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">POC collection</p>
                <ProportionBar
                  doneLabel="Collected"
                  todoLabel="Missing"
                  done={Number(focused.pocs_collected)}
                  total={Number(focused.assigned_leads)}
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Last activity: {formatRelative(focused.last_activity)}
            </p>
          </div>
        )}
      </ChartCard>

      {/* ------------------------------------------------------ Table view */}
      {/* The same figures in plain numbers - readable without relying on colour. */}
      <div className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">
          Every BDM, in numbers
        </h2>

        {performance.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No BDMs have been added yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">BDM</th>
                  <th className="px-3 py-2.5 text-right font-medium">Assigned</th>
                  <th className="px-3 py-2.5 text-right font-medium">Visited</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pending</th>
                  <th className="px-3 py-2.5 text-right font-medium">Visit&nbsp;%</th>
                  <th className="px-3 py-2.5 text-right font-medium">POCs</th>
                  <th className="px-3 py-2.5 text-right font-medium">POC&nbsp;%</th>
                  <th className="px-3 py-2.5 text-right font-medium">Competitors</th>
                  <th className="px-3 py-2.5 text-right font-medium">Units</th>
                  <th className="px-3 py-2.5 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {performance.map((row) => (
                  <tr key={row.bdm_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {row.bdm_name}
                      {!row.active && <span className="ml-2 text-xs text-slate-400">disabled</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.assigned_leads)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.visited_leads)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.pending_leads)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {formatPercent(Number(row.visited_leads), Number(row.assigned_leads))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.pocs_collected)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {formatPercent(Number(row.pocs_collected), Number(row.assigned_leads))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(row.competitors_identified)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(row.total_units)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                      {formatRelative(row.last_activity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
        {formatNumber(value)}
      </p>
    </div>
  );
}
