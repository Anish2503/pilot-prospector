import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  MapPin,
  MapPinOff,
  Pause,
  Play,
  RefreshCw,
  Search,
  ThumbsDown,
  TriangleAlert,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { cn, formatNumber, sleep } from '@/lib/utils';
import type { Lead } from '@/types';

/** Nominatim's policy is one request per second. We leave a little headroom. */
const PACE_MS = 1150;

interface Candidate {
  latitude: number;
  longitude: number;
  displayName: string;
  confidence: 'high' | 'medium' | 'low';
  query: string;
  matchedType: string;
}

interface NextResponse {
  done?: boolean;
  lead?: { id: string; society_name: string };
  candidate?: Candidate | null;
  saved?: boolean;
  reason?: string;
}

interface Stats {
  missing: number;
  geocoded: number;
  needsReview: number;
}

interface LogEntry {
  name: string;
  outcome: 'saved' | 'review' | 'failed';
  confidence?: string;
  displayName?: string;
}

export default function LocationsPage() {
  const toast = useToast();

  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const stopRequested = useRef(false);

  const [reviewLeads, setReviewLeads] = useState<Lead[] | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const result = await api.post<Stats>('/geocode', { action: 'pending' });
      setStats(result);
    } catch (cause) {
      setError(friendlyError(cause));
    }
  }, []);

  const loadReviewQueue = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('needs_review', true)
      .order('society_name')
      .limit(100);
    setReviewLeads((data ?? []) as Lead[]);
  }, []);

  useEffect(() => {
    void loadStats();
    void loadReviewQueue();
  }, [loadStats, loadReviewQueue]);

  // -------------------------------------------------------------- The loop

  async function run() {
    stopRequested.current = false;
    setRunning(true);
    setError(null);
    setLog([]);

    try {
      for (;;) {
        if (stopRequested.current) break;

        const result = await api.post<NextResponse>('/geocode', {
          action: 'next',
          highConfidenceOnly,
        });

        if (result.done) {
          toast.success('Every lead has been looked up.');
          break;
        }

        const name = result.lead?.society_name ?? 'A lead';
        setLog((current) =>
          [
            {
              name,
              outcome: !result.candidate ? 'failed' : result.saved ? 'saved' : 'review',
              confidence: result.candidate?.confidence,
              displayName: result.candidate?.displayName,
            } as LogEntry,
            ...current,
          ].slice(0, 60),
        );

        await sleep(PACE_MS);
      }
    } catch (cause) {
      setError(
        friendlyError(cause, 'The lookup stopped. Anything already found has been saved.'),
      );
    } finally {
      setRunning(false);
      await loadStats();
      await loadReviewQueue();
    }
  }

  // ---------------------------------------------------------------- Render

  const missing = stats?.missing ?? 0;
  const estimatedMinutes = Math.ceil((missing * PACE_MS) / 60000);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          Locations
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Find map coordinates for societies whose spreadsheet did not include them.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Missing a location"
          value={stats?.missing}
          sublabel="Cannot appear on the map"
          icon={MapPinOff}
          tone={missing > 0 ? 'amber' : 'slate'}
          loading={!stats}
        />
        <StatCard
          label="Found automatically"
          value={stats?.geocoded}
          sublabel="Estimated, not confirmed"
          icon={MapPin}
          tone="brand"
          loading={!stats}
        />
        <StatCard
          label="Waiting for review"
          value={stats?.needsReview}
          icon={TriangleAlert}
          tone={(stats?.needsReview ?? 0) > 0 ? 'red' : 'slate'}
          loading={!stats}
        />
      </div>

      {/* ------------------------------------------------------- The runner */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-700">Automatic lookup</h2>

        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This uses OpenStreetMap's free service, which allows one lookup per second. It is
          completely free and needs no account, but it is slow for large batches and it is less
          accurate on Indian society names than a paid service would be.
        </p>

        {missing > 0 && (
          <p className="mt-2 text-sm text-slate-500">
            {formatNumber(missing)} to look up — roughly{' '}
            <strong>
              {estimatedMinutes} minute{estimatedMinutes === 1 ? '' : 's'}
            </strong>
            . You can leave this page open and carry on; stop any time and progress is kept.
          </p>
        )}

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={highConfidenceOnly}
            onChange={(e) => setHighConfidenceOnly(e.target.checked)}
            disabled={running}
            className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-slate-700">
            Only save confident matches automatically
            <span className="block text-slate-500">
              Anything uncertain goes to the review list below instead of being saved. Slower to
              work through, but nothing questionable ever reaches your map.
            </span>
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {running ? (
            <Button
              variant="danger"
              icon={<Pause className="size-4" />}
              onClick={() => {
                stopRequested.current = true;
              }}
            >
              Stop
            </Button>
          ) : (
            <Button
              icon={<Play className="size-4" />}
              onClick={run}
              disabled={missing === 0}
            >
              {missing === 0 ? 'Nothing to look up' : `Find ${formatNumber(missing)} locations`}
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<RefreshCw className="size-4" />}
            onClick={() => {
              void loadStats();
              void loadReviewQueue();
            }}
            disabled={running}
          >
            Refresh
          </Button>
        </div>

        {/* --------------------------------------------------------- Live log */}
        {log.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
              {running && <Search className="size-4 animate-pulse" />}
              <span>
                {formatNumber(log.length)} looked up in this run
              </span>
            </div>
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {log.map((entry, index) => (
                <li key={index} className="flex items-start gap-2 px-1.5 py-1 text-sm">
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      entry.outcome === 'saved' && 'bg-emerald-500',
                      entry.outcome === 'review' && 'bg-amber-500',
                      entry.outcome === 'failed' && 'bg-red-400',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{entry.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {entry.outcome === 'failed'
                        ? 'No match found — needs entering by hand'
                        : entry.displayName}
                    </p>
                  </div>
                  {entry.confidence && (
                    <Badge
                      tone={
                        entry.confidence === 'high'
                          ? 'emerald'
                          : entry.confidence === 'medium'
                            ? 'amber'
                            : 'red'
                      }
                    >
                      {entry.confidence}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ Review queue */}
      <div className="card">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Needs your review {reviewLeads ? `(${reviewLeads.length})` : ''}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Nothing here is treated as confirmed until you say so.
          </p>
        </div>

        {reviewLeads === null ? (
          <LoadingBlock />
        ) : reviewLeads.length === 0 ? (
          <EmptyState
            icon={<Check className="size-6" />}
            title="Nothing to review"
            description="Every lead either has a confirmed location or has not been looked up yet."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {reviewLeads.map((lead) => (
              <ReviewRow
                key={lead.id}
                lead={lead}
                onResolved={() => {
                  void loadStats();
                  void loadReviewQueue();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function ReviewRow({ lead, onResolved }: { lead: Lead; onResolved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [latitude, setLatitude] = useState(lead.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(lead.longitude?.toString() ?? '');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [searched, setSearched] = useState(false);

  async function lookup() {
    setBusy(true);
    try {
      const result = await api.post<{ candidate: Candidate | null }>('/geocode', {
        action: 'lookup',
        leadId: lead.id,
      });
      setCandidate(result.candidate);
      setSearched(true);
      if (!result.candidate) toast.info('No match found. Please enter the location by hand.');
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function accept(lat: number, lng: number, displayName?: string) {
    setBusy(true);
    try {
      await api.post('/geocode', {
        action: 'accept',
        leadId: lead.id,
        latitude: lat,
        longitude: lng,
        displayName,
      });
      toast.success(`Location confirmed for ${lead.society_name}.`);
      onResolved();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await api.post('/geocode', { action: 'reject', leadId: lead.id });
      toast.info('Suggestion discarded.');
      onResolved();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  function saveManual() {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
      toast.error('Those coordinates are not valid.');
      return;
    }
    void accept(lat, lng, 'Entered by hand');
  }

  const suggestion = candidate ?? (lead.latitude !== null && lead.geocode_display_name
    ? {
        latitude: lead.latitude,
        longitude: lead.longitude!,
        displayName: lead.geocode_display_name,
        confidence: lead.location_confidence as 'high' | 'medium' | 'low',
        query: lead.geocode_query ?? '',
        matchedType: '',
      }
    : null);

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{lead.society_name}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {[lead.address, lead.area, lead.city].filter(Boolean).join(', ') ||
              'No address details at all'}
          </p>
          {lead.review_reason && (
            <p className="mt-1 text-sm text-amber-700">{lead.review_reason}</p>
          )}

          {lead.google_maps_url && (
            <a
              href={lead.google_maps_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline underline-offset-2"
            >
              Open the Google Maps link from the spreadsheet
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          {!suggestion && !searched && (
            <Button size="sm" variant="secondary" loading={busy} onClick={lookup} icon={<Search className="size-4" />}>
              Look up
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setManual((v) => !v)}>
            Enter by hand
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------- Suggestion */}
      {suggestion && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-slate-800">Suggested location</p>
                <Badge
                  tone={
                    suggestion.confidence === 'high'
                      ? 'emerald'
                      : suggestion.confidence === 'medium'
                        ? 'amber'
                        : 'red'
                  }
                >
                  {suggestion.confidence} confidence
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">{suggestion.displayName}</p>
              <a
                href={`https://www.openstreetmap.org/?mlat=${suggestion.latitude}&mlon=${suggestion.longitude}#map=17/${suggestion.latitude}/${suggestion.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-sm text-brand-700 underline underline-offset-2"
              >
                {suggestion.latitude.toFixed(5)}, {suggestion.longitude.toFixed(5)} — view on map
              </a>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="success"
                icon={<Check className="size-4" />}
                loading={busy}
                onClick={() => accept(suggestion.latitude, suggestion.longitude, suggestion.displayName)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ThumbsDown className="size-4" />}
                loading={busy}
                onClick={reject}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- Manual entry */}
      {manual && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
          <Input
            label="Latitude"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="12.93910"
            containerClassName="w-40"
          />
          <Input
            label="Longitude"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="77.74110"
            containerClassName="w-40"
          />
          <Button size="sm" onClick={saveManual} loading={busy}>
            Save
          </Button>
          <p className="w-full text-xs text-slate-500">
            Tip: find the society on Google Maps, right-click the exact spot, and click the
            numbers that appear to copy them.
          </p>
        </div>
      )}
    </li>
  );
}
