import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ClipboardCheck,
  Clock,
  Home,
  MapPinOff,
  Phone,
  Swords,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { Alert } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatPercent } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import type { AdminDashboardStats } from '@/types';

export default function DashboardPage() {
  const { session } = useAuth();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Counting happens in the database. The browser receives one small object,
    // never the ten thousand rows behind it.
    const { data, error: rpcError } = await supabase.rpc('admin_dashboard_stats');
    if (rpcError) setError(friendlyError(rpcError, 'Could not load the dashboard.'));
    else setStats(data as AdminDashboardStats);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasLeads = (stats?.total_leads ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Welcome back, {session?.name?.split(' ')[0] ?? 'there'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Here is where your pipeline stands today.</p>
      </div>

      {error && (
        <Alert
          tone="error"
          title="Could not load the dashboard"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* ----------------------------------------------------- Empty state */}
      {!loading && !error && !hasLeads && (
        <Alert tone="info" title="No leads have been uploaded yet">
          Once you upload your first spreadsheet, every number on this page fills in
          automatically.
        </Alert>
      )}

      {/* ---------------------------------------------------------- Pipeline */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total leads"
            value={stats?.total_leads}
            icon={Building2}
            tone="brand"
            loading={loading}
          />
          <StatCard
            label="Assigned"
            value={stats?.assigned_leads}
            sublabel={
              stats ? `${formatPercent(stats.assigned_leads, stats.total_leads)} of all leads` : undefined
            }
            icon={UserCheck}
            tone="emerald"
            loading={loading}
          />
          <StatCard
            label="Unassigned"
            value={stats?.unassigned_leads}
            icon={UserX}
            tone="amber"
            loading={loading}
          />
          <StatCard
            label="Total units"
            value={stats?.total_units}
            sublabel="Across all societies"
            icon={Home}
            tone="violet"
            loading={loading}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ Visits */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Field activity</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Visited"
            value={stats?.visited_leads}
            sublabel={
              stats ? `${formatPercent(stats.visited_leads, stats.total_leads)} covered` : undefined
            }
            icon={ClipboardCheck}
            tone="emerald"
            loading={loading}
          />
          <StatCard
            label="Pending visit"
            value={stats?.pending_leads}
            icon={Clock}
            tone="amber"
            loading={loading}
          />
          <StatCard
            label="Visits this week"
            value={stats?.visits_7d}
            sublabel={stats ? `${stats.visits_today} today` : undefined}
            icon={ClipboardCheck}
            tone="brand"
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
        </div>
      </section>

      {/* ----------------------------------------------------- Data quality */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Information gathered</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="POC collected"
            value={stats?.leads_with_poc}
            sublabel={
              stats ? `${formatPercent(stats.leads_with_poc, stats.total_leads)} of leads` : undefined
            }
            icon={Phone}
            tone="emerald"
            loading={loading}
          />
          <StatCard
            label="Competitor identified"
            value={stats?.leads_with_competitor}
            icon={Swords}
            tone="violet"
            loading={loading}
          />
          <StatCard
            label="Missing location"
            value={stats ? stats.total_leads - stats.leads_with_location : undefined}
            sublabel="Cannot be shown on the map"
            icon={MapPinOff}
            tone={stats && stats.total_leads - stats.leads_with_location > 0 ? 'amber' : 'slate'}
            loading={loading}
          />
          <StatCard
            label="Needs review"
            value={stats?.leads_need_review}
            sublabel="Flagged during import"
            icon={MapPinOff}
            tone={stats && stats.leads_need_review > 0 ? 'red' : 'slate'}
            loading={loading}
          />
        </div>
      </section>
    </div>
  );
}
