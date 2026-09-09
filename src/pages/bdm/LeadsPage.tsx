import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Crosshair,
  MapPin,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Alert, EmptyState, LoadingBlock, StatusBadge } from '@/components/ui/Feedback';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { fetchAllPages } from '@/lib/paging';
import {
  cn,
  formatDistanceShort,
  formatDuration,
  formatNumber,
  formatRelative,
  haversineMeters,
} from '@/lib/utils';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useRoadDistances } from '@/hooks/useRoadDistances';
import type { BdmStats, Lead, LeadWithDistance } from '@/types';

type SortMode = 'nearest' | 'farthest' | 'recent' | 'name';

export default function BdmLeadsPage() {
  const { state, position, capturedAt, isStale, request } = useGeolocation();

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [stats, setStats] = useState<BdmStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('nearest');

  const load = useCallback(async () => {
    setError(null);

    const statsResult = await supabase.rpc('my_bdm_stats');
    if (statsResult.error) setError(friendlyError(statsResult.error, 'Could not load your summary.'));
    else setStats(statsResult.data as BdmStats);

    try {
      // No "where mine" is needed: the database only ever returns leads that
      // are assigned to whoever is signed in. Paged, so a BDM carrying more
      // than 1,000 societies still sees all of them.
      setLeads(
        await fetchAllPages<Lead>(
          (from, to) =>
            supabase
              .from('leads')
              .select('*')
              .order('society_name', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to) as never,
          5000,
        ),
      );
    } catch (cause) {
      setError(friendlyError(cause, 'Could not load your leads.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Ask for location once, on the first visit of the session.
  useEffect(() => {
    if (state.status === 'idle') request();
    // Intentionally runs only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we cannot know where they are, sorting by distance is meaningless.
  useEffect(() => {
    if ((state.status === 'denied' || state.status === 'unavailable') && sortMode === 'nearest') {
      setSortMode('name');
    }
  }, [state.status, sortMode]);

  // Road distances for the whole list, in one request rather than one per
  // society. Straight-line is kept only to order the list while those are
  // still being fetched - it is never shown as a driving distance.
  const road = useRoadDistances(position, leads ?? []);

  const withDistance: LeadWithDistance[] = useMemo(() => {
    if (!leads) return [];
    return leads.map((lead) => {
      const routed = road.distances.get(lead.id);
      return {
        ...lead,
        distanceMeters:
          position && lead.latitude !== null && lead.longitude !== null
            ? haversineMeters(position, { latitude: lead.latitude, longitude: lead.longitude })
            : null,
        roadMeters: routed?.distanceMeters ?? null,
        roadSeconds: routed?.durationSeconds ?? null,
      };
    });
  }, [leads, position, road.distances]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = term
      ? withDistance.filter(
          (lead) =>
            lead.society_name.toLowerCase().includes(term) ||
            (lead.area ?? '').toLowerCase().includes(term) ||
            (lead.city ?? '').toLowerCase().includes(term),
        )
      : withDistance;

    const sorted = [...filtered];
    switch (sortMode) {
      case 'nearest':
      case 'farthest': {
        // Ordering is by ROAD distance whenever it is known. Straight-line only
        // stands in while routing is still running, so the list is usefully
        // ordered from the first paint instead of sitting empty.
        const metric = (lead: LeadWithDistance) => lead.roadMeters ?? lead.distanceMeters;

        sorted.sort((a, b) => {
          const da = metric(a);
          const db = metric(b);
          // Societies with no location at all sink to the bottom - putting
          // them first would be misleading.
          if (da === null && db === null) return a.society_name.localeCompare(b.society_name);
          if (da === null) return 1;
          if (db === null) return -1;
          return sortMode === 'nearest' ? da - db : db - da;
        });
        break;
      }
      case 'recent':
        sorted.sort((a, b) => {
          const at = a.last_visit_at ? Date.parse(a.last_visit_at) : 0;
          const bt = b.last_visit_at ? Date.parse(b.last_visit_at) : 0;
          return bt - at;
        });
        break;
      case 'name':
        sorted.sort((a, b) => a.society_name.localeCompare(b.society_name));
        break;
    }
    return sorted;
  }, [withDistance, search, sortMode]);

  if (!leads && !error) return <LoadingBlock label="Loading your leads…" />;

  return (
    <div className="space-y-4">
      {error && (
        <Alert
          tone="error"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* ------------------------------------------------------------ Summary */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Assigned" value={stats?.assigned_leads} icon={Building2} />
        <MiniStat label="Visited" value={stats?.visited_leads} icon={ClipboardCheck} tone="emerald" />
        <MiniStat label="Pending" value={stats?.pending_leads} icon={Clock} tone="amber" />
      </div>

      {/* ----------------------------------------------------------- Location */}
      <LocationBanner
        status={state.status}
        message={state.status === 'unavailable' ? state.message : undefined}
        capturedAt={capturedAt}
        isStale={isStale}
        onRequest={() => request()}
      />

      {/* --------------------------------------------------- Search and sort */}
      {leads && leads.length > 0 && (
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your societies"
            leftIcon={<Search className="size-4" />}
            containerClassName="flex-1"
            aria-label="Search your leads"
            rightSlot={
              search ? (
                <button
                  onClick={() => setSearch('')}
                  className="rounded p-1 text-slate-400"
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </button>
              ) : undefined
            }
          />
          <Select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            options={[
              { value: 'nearest', label: 'Nearest first' },
              { value: 'farthest', label: 'Farthest first' },
              { value: 'recent', label: 'Recently updated' },
              { value: 'name', label: 'Society name' },
            ]}
            containerClassName="w-40 shrink-0"
            aria-label="Sort by"
          />
        </div>
      )}

      {/* -------------------------------------------------------------- List */}
      {leads && leads.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No leads have been assigned to you yet"
            description="Your admin will assign societies to you. They will appear here as soon as they do — just pull down to refresh."
            action={
              <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                Check again
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing matches that search" description="Try a different society or area name." />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((lead) => (
            <li key={lead.id}>
              <Link
                to={`/bdm/lead/${lead.id}`}
                className="card flex items-center gap-3 p-4 transition active:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{lead.society_name}</p>

                  <p className="mt-1 flex items-center gap-1.5 text-sm">
                    <LeadDistance lead={lead} roadStatus={road.status} />
                  </p>

                  {/*
                    Falls back to the address rather than announcing a missing
                    Area. A society can be perfectly well located by coordinates
                    with no Area text at all - saying "Area not recorded" there
                    reads as though the lead is broken when it is not.
                  */}
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {[
                      [lead.area, lead.city].filter(Boolean).join(', ') || lead.address,
                      lead.total_units !== null ? `${formatNumber(lead.total_units)} units` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={lead.status} />
                    {lead.last_visit_at && (
                      <span className="text-xs text-slate-400">
                        Updated {formatRelative(lead.last_visit_at)}
                      </span>
                    )}
                  </div>
                </div>

                <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {visible.length > 0 && (
        <p className="pb-2 text-center text-xs text-slate-400">
          {road.status === 'ready'
            ? 'Distances and times follow real roads, by car.'
            : road.status === 'loading'
              ? 'Working out driving distances…'
              : road.status === 'unavailable'
                ? 'Driving distances are unavailable, so straight-line distances are shown and clearly marked.'
                : 'Turn on location to see how far each society is.'}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function MiniStat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value?: number;
  icon: typeof Building2;
  tone?: 'brand' | 'emerald' | 'amber';
}) {
  const tones = {
    brand: 'text-brand-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="card p-3 text-center">
      <Icon className={cn('mx-auto size-4', tones[tone])} aria-hidden />
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {value === undefined ? '—' : formatNumber(value)}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------

function LocationBanner({
  status,
  message,
  capturedAt,
  isStale,
  onRequest,
}: {
  status: string;
  message?: string;
  capturedAt: number | null;
  isStale: boolean;
  onRequest: () => void;
}) {
  if (status === 'requesting') {
    return (
      <Alert tone="info">
        <span className="flex items-center gap-2">
          <Crosshair className="size-4 animate-pulse" />
          Finding your location…
        </span>
      </Alert>
    );
  }

  if (status === 'denied') {
    return (
      <Alert
        tone="warning"
        title="Location access is off"
        action={
          <Button size="sm" variant="secondary" onClick={onRequest}>
            Try again
          </Button>
        }
      >
        Your leads are sorted by name instead of by distance. To sort by how near they are, allow
        location for this site in your browser settings, then tap Try again.
      </Alert>
    );
  }

  if (status === 'unavailable') {
    return (
      <Alert
        tone="warning"
        title="Could not get your location"
        action={
          <Button size="sm" variant="secondary" onClick={onRequest}>
            Retry
          </Button>
        }
      >
        {message ?? 'Sorting by name instead.'}
      </Alert>
    );
  }

  if (status === 'granted') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <span className="flex min-w-0 items-center gap-2">
          <Crosshair className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            Sorted by distance from you
            {capturedAt && (
              <span className={cn('ml-1', isStale ? 'text-amber-700' : 'text-emerald-700/70')}>
                ({formatRelative(new Date(capturedAt).toISOString())})
              </span>
            )}
          </span>
        </span>
        <button
          onClick={onRequest}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium underline underline-offset-2"
        >
          <RefreshCw className="size-3.5" />
          Update
        </button>
      </div>
    );
  }

  return (
    <Alert
      tone="info"
      title="Sort your leads by distance"
      action={
        <Button size="sm" onClick={onRequest}>
          Allow
        </Button>
      }
    >
      We use your current location to put the nearest societies at the top of your list. It is
      only read when you open this page or tap Update — you are never tracked.
    </Alert>
  );
}

// -----------------------------------------------------------------------------

/**
 * The distance line on a society card.
 *
 * Road distance and straight-line distance are never allowed to look alike. A
 * driving figure is shown plainly ("7.1 km · 18 min"); a straight-line figure
 * is always labelled as such, so nobody plans a day around the wrong number.
 */
function LeadDistance({
  lead,
  roadStatus,
}: {
  lead: LeadWithDistance;
  roadStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
}) {
  // Nothing can be measured to a society we cannot place.
  if (lead.latitude === null) {
    return <span className="text-amber-600">No map location yet</span>;
  }

  if (lead.distanceMeters === null) {
    return <span className="text-slate-400">Turn on location to see distance</span>;
  }

  // The real thing.
  if (lead.roadMeters !== null) {
    const minutes = formatDuration(lead.roadSeconds);
    return (
      <>
        <MapPin className="size-3.5 shrink-0 text-brand-600" aria-hidden />
        <span className="font-medium text-brand-700">
          {formatDistanceShort(lead.roadMeters)} away
          {minutes ? <span className="font-normal text-slate-500"> · {minutes} drive</span> : null}
        </span>
      </>
    );
  }

  if (roadStatus === 'loading') {
    return <span className="text-slate-400">Measuring driving distance…</span>;
  }

  // Routing failed, or there is no road to this point. Say so plainly rather
  // than passing a straight line off as a drive.
  return (
    <>
      <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      <span className="text-slate-500">
        {formatDistanceShort(lead.distanceMeters)}
        <span className="text-amber-600"> straight-line</span>
      </span>
    </>
  );
}
