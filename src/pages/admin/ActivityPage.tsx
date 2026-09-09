import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Download,
  LogIn,
  MapPin,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Alert, EmptyState, Skeleton } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { downloadCsv, type ExportRow } from '@/lib/exports';
import { fetchAllPages } from '@/lib/paging';
import { cn, formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import type { ActivityLog } from '@/types';

const PAGE_SIZE = 50;

/** How each recorded action is described and coloured. */
const ACTION_META: Record<
  string,
  { label: string; icon: typeof Activity; tone: 'brand' | 'emerald' | 'amber' | 'slate' | 'violet' }
> = {
  'admin.signed_in': { label: 'Admin signed in', icon: LogIn, tone: 'slate' },
  'bdm.signed_in': { label: 'BDM signed in', icon: LogIn, tone: 'slate' },
  'admin.created': { label: 'Super Admin created', icon: ShieldCheck, tone: 'violet' },
  'admin.disabled': { label: 'Super Admin disabled', icon: ShieldCheck, tone: 'amber' },
  'admin.enabled': { label: 'Super Admin enabled', icon: ShieldCheck, tone: 'emerald' },
  'admin.password_reset': { label: 'Admin password reset', icon: ShieldCheck, tone: 'amber' },
  'admin.password_changed': { label: 'Admin changed own password', icon: ShieldCheck, tone: 'slate' },
  'bdm.created': { label: 'BDM added', icon: Users, tone: 'emerald' },
  'bdm.updated': { label: 'BDM details changed', icon: Users, tone: 'slate' },
  'bdm.disabled': { label: 'BDM disabled', icon: Users, tone: 'amber' },
  'bdm.deleted': { label: 'BDM removed', icon: Users, tone: 'amber' },
  'bdm.pin_reset': { label: 'BDM PIN reset', icon: ShieldCheck, tone: 'amber' },
  'leads.imported': { label: 'Leads imported', icon: Upload, tone: 'brand' },
  'lead.assigned': { label: 'Lead assigned', icon: UserPlus, tone: 'emerald' },
  'lead.reassigned': { label: 'Lead reassigned', icon: UserPlus, tone: 'amber' },
  'lead.unassigned': { label: 'Lead pulled from BDM', icon: UserPlus, tone: 'amber' },
  'lead.deleted': { label: 'Lead deleted', icon: Trash2, tone: 'amber' },
  'lead.edited': { label: 'Lead edited', icon: Pencil, tone: 'slate' },
  'lead.location_confirmed': { label: 'Location confirmed', icon: MapPin, tone: 'emerald' },
  'lead.location_rejected': { label: 'Location rejected', icon: MapPin, tone: 'amber' },
};

const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  slate: 'bg-slate-100 text-slate-500',
  violet: 'bg-violet-50 text-violet-600',
};

interface LogRow extends ActivityLog {
  leads: { society_name: string } | null;
}

export default function ActivityPage() {
  const toast = useToast();

  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let request = supabase
      .from('activity_logs')
      .select('*, leads(society_name)', { count: 'exact' });

    if (actorType) request = request.eq('actor_type', actorType);
    if (action) request = request.eq('action', action);

    const from = page * PAGE_SIZE;
    const { data, error: queryError, count } = await request
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (queryError) {
      setError(friendlyError(queryError, 'Could not load the activity log.'));
      setLogs([]);
    } else {
      setLogs((data ?? []) as unknown as LogRow[]);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page, actorType, action]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actionOptions = useMemo(
    () =>
      Object.entries(ACTION_META)
        .map(([value, meta]) => ({ value, label: meta.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  async function exportLog() {
    setExporting(true);
    try {
      // Paged, because one response can never carry more than 1,000 rows.
      const entries = await fetchAllPages<LogRow>((from, to) => {
        let request = supabase.from('activity_logs').select('*, leads(society_name)');
        if (actorType) request = request.eq('actor_type', actorType);
        if (action) request = request.eq('action', action);
        return request
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to) as never;
      }, 20_000);

      const rows: ExportRow[] = entries.map((log) => ({
        'When': formatDateTime(log.created_at),
        'Who': log.actor_name ?? '',
        'Role': log.actor_type,
        'What happened': ACTION_META[log.action]?.label ?? log.action,
        'Society': log.leads?.society_name ?? '',
        'Details': log.metadata ? JSON.stringify(log.metadata) : '',
      }));

      if (rows.length === 0) {
        toast.info('There is nothing to export.');
        return;
      }
      downloadCsv(rows, 'activity-log');
      toast.success(`${formatNumber(rows.length)} entries exported.`);
    } catch (cause) {
      toast.error(friendlyError(cause, 'Could not export the log.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Activity
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? 'Loading…' : `${formatNumber(total)} recorded actions`}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={exportLog}
          loading={exporting}
          disabled={total === 0}
        >
          Export
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Alert tone="info">
        This is a permanent record. Entries cannot be edited or deleted by anyone using the app.
      </Alert>

      <div className="flex flex-wrap gap-3">
        <Select
          value={actorType}
          onChange={(e) => {
            setActorType(e.target.value);
            setPage(0);
          }}
          placeholder="Everyone"
          options={[
            { value: 'admin', label: 'Admins' },
            { value: 'bdm', label: 'BDMs' },
            { value: 'system', label: 'System' },
          ]}
          containerClassName="w-44"
          aria-label="Filter by who"
        />
        <Select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
          placeholder="All actions"
          options={actionOptions}
          containerClassName="w-60"
          aria-label="Filter by action"
        />
        {(actorType || action) && (
          <Button
            variant="ghost"
            onClick={() => {
              setActorType('');
              setAction('');
              setPage(0);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<Activity className="size-6" />}
            title="Nothing recorded yet"
            description="Actions such as uploads, assignments and BDM updates will appear here."
          />
        ) : (
          <>
            <ul className={cn('divide-y divide-slate-100', loading && 'opacity-60')}>
              {logs.map((log) => {
                const meta = ACTION_META[log.action];
                const Icon = meta?.icon ?? Activity;
                return (
                  <li key={log.id} className="flex items-start gap-3 p-4">
                    <div
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        TONES[meta?.tone ?? 'slate'],
                      )}
                    >
                      <Icon className="size-[18px]" aria-hidden />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900">
                        <span className="font-medium">{log.actor_name ?? 'Someone'}</span>
                        <span className="text-slate-500">
                          {' '}
                          — {meta?.label ?? log.action}
                        </span>
                      </p>

                      {(log.leads?.society_name ??
                        (typeof log.metadata?.society_name === 'string'
                          ? log.metadata.society_name
                          : null)) && (
                        <p className="mt-0.5 truncate text-sm text-slate-600">
                          {log.leads?.society_name ?? String(log.metadata?.society_name)}
                        </p>
                      )}

                      <Details action={log.action} metadata={log.metadata} />
                    </div>

                    <time
                      className="shrink-0 text-xs whitespace-nowrap text-slate-400"
                      dateTime={log.created_at}
                      title={formatDateTime(log.created_at)}
                    >
                      {formatRelative(log.created_at)}
                    </time>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <p className="text-sm text-slate-600">
                Page {page + 1} of {totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  icon={<ChevronLeft className="size-4" />}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Turns the stored details into a readable sentence, per action type. */
function Details({
  action,
  metadata,
}: {
  action: string;
  metadata: Record<string, unknown> | null;
}) {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  const text = (key: string) =>
    typeof metadata[key] === 'string' ? (metadata[key] as string) : null;
  const num = (key: string) =>
    typeof metadata[key] === 'number' ? (metadata[key] as number) : null;

  let summary: string | null = null;

  if (action === 'leads.imported') {
    const parts = [
      num('imported') !== null ? `${formatNumber(num('imported')!)} added` : null,
      num('updated') ? `${formatNumber(num('updated')!)} updated` : null,
      num('duplicates') ? `${formatNumber(num('duplicates')!)} duplicates skipped` : null,
      num('failed') ? `${formatNumber(num('failed')!)} failed` : null,
    ].filter(Boolean);
    summary = `${text('filename') ?? 'File'} — ${parts.join(', ')}`;
  } else if (action === 'lead.reassigned') {
    summary = `${text('previous_bdm_name') ?? 'Someone'} → ${text('new_bdm_name') ?? 'someone'}`;
  } else if (action === 'lead.assigned') {
    summary = `Given to ${text('new_bdm_name') ?? 'a BDM'}`;
  } else if (action === 'lead.unassigned') {
    summary = `Pulled back from ${text('previous_bdm_name') ?? 'a BDM'}`;
  } else if (action === 'lead.deleted') {
    const parts = [
      text('previous_bdm_name') ? `was with ${text('previous_bdm_name')}` : null,
      num('visits_archived') ? `${formatNumber(num('visits_archived')!)} visits archived` : null,
      text('reason'),
    ].filter(Boolean);
    summary = parts.length ? parts.join(' · ') : 'Archived before deletion';
  } else if (action.startsWith('bdm.') || action.startsWith('admin.')) {
    summary = text('name') ?? text('username');
  }

  if (!summary) return null;
  return <p className="mt-0.5 text-xs text-slate-500">{summary}</p>;
}
