import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPinOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import { LeadsMap, MapLegend, type MappableLead } from '@/components/LeadsMap';
import { LeadDetailDialog } from '@/components/LeadDetailDialog';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { ALL_STATUSES, formatNumber, STATUS_LABELS } from '@/lib/utils';
import { fetchLeadsForMap, type MapLeadRow } from '@/hooks/useLeads';
import type { Bdm, Lead, LeadFilterOptions } from '@/types';

/** Above this, the map is still usable but we warn that it is a partial view. */
const MAP_LIMIT = 10_000;

type MapRow = MapLeadRow;

export default function MapPage() {
  const [rows, setRows] = useState<MapRow[] | null>(null);
  const [missingCount, setMissingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [bdms, setBdms] = useState<Bdm[]>([]);
  const [options, setOptions] = useState<LeadFilterOptions>({ cities: [], areas: [], competitors: [] });

  const [bdmFilter, setBdmFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');

  const [detailLead, setDetailLead] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    setError(null);

    // Only the handful of columns the map needs - and fetched in pages, because
    // one request can never return more than 1,000 rows.
    try {
      const [mapRows, missingResult] = await Promise.all([
        fetchLeadsForMap(MAP_LIMIT),
        supabase.from('leads').select('id', { count: 'exact', head: true }).is('latitude', null),
      ]);

      setRows(mapRows);
      setMissingCount(missingResult.count ?? 0);
    } catch (cause) {
      setError(friendlyError(cause, 'Could not load the map.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const [bdmResult, optionResult] = await Promise.all([
        supabase.from('bdms').select('*').order('name'),
        supabase.rpc('lead_filter_options'),
      ]);
      if (bdmResult.data) setBdms(bdmResult.data as Bdm[]);
      if (optionResult.data) setOptions(optionResult.data as LeadFilterOptions);
    })();
  }, [load]);

  const bdmNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const bdm of bdms) map.set(bdm.id, bdm.name);
    return map;
  }, [bdms]);

  // Filtering happens here rather than in the database, because the map is
  // already holding the points - re-querying would only add a network round trip.
  const visible: MappableLead[] = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((row) => {
        if (statusFilter && row.status !== statusFilter) return false;
        if (bdmFilter === 'unassigned' && row.current_bdm_id !== null) return false;
        if (bdmFilter && bdmFilter !== 'unassigned' && row.current_bdm_id !== bdmFilter) return false;
        if (cityFilter && row.city !== cityFilter) return false;
        if (areaFilter && row.area !== areaFilter) return false;
        return true;
      })
      .map((row) => ({
        id: row.id,
        society_name: row.society_name,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        total_units: row.total_units,
        area: row.area,
        city: row.city,
        location_source: row.location_source,
        bdmName: row.current_bdm_id ? (bdmNames.get(row.current_bdm_id) ?? null) : null,
      }));
  }, [rows, statusFilter, bdmFilter, cityFilter, areaFilter, bdmNames]);

  async function openLead(leadId: string) {
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (data) setDetailLead(data as Lead);
  }

  const filterKey = `${statusFilter}|${bdmFilter}|${cityFilter}|${areaFilter}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Map</h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows === null
              ? 'Loading…'
              : `${formatNumber(visible.length)} of ${formatNumber(rows.length)} societies shown`}
          </p>
        </div>
        <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {missingCount > 0 && (
        <Alert tone="warning" title={`${formatNumber(missingCount)} societies are not on this map`}>
          They have no coordinates yet. Go to <strong>Locations</strong> to find them
          automatically or enter them by hand.
        </Alert>
      )}

      {rows !== null && rows.length >= MAP_LIMIT && (
        <Alert tone="info">
          Showing the first {formatNumber(MAP_LIMIT)} societies. Use the filters to narrow down.
        </Alert>
      )}

      {/* ------------------------------------------------------------ Filters */}
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="BDM"
          value={bdmFilter}
          onChange={(e) => setBdmFilter(e.target.value)}
          placeholder="Anyone"
          options={[
            { value: 'unassigned', label: 'Nobody (unassigned)' },
            ...bdms.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          placeholder="Any status"
          options={ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <Select
          label="City"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          placeholder="Any city"
          options={options.cities.map((c) => ({ value: c, label: c }))}
        />
        <Select
          label="Area"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          placeholder="Any area"
          options={options.areas.map((a) => ({ value: a, label: a }))}
        />
      </div>

      {/* ---------------------------------------------------------------- Map */}
      <div className="card overflow-hidden p-3">
        {rows === null ? (
          <LoadingBlock label="Loading the map…" />
        ) : visible.length === 0 ? (
          <div className="flex h-[420px] flex-col items-center justify-center text-center">
            <MapPinOff className="mb-3 size-8 text-slate-300" />
            <p className="font-medium text-slate-700">Nothing to show on the map</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              {rows.length === 0
                ? 'No society has coordinates yet. Upload leads, then use the Locations page.'
                : 'No societies match these filters.'}
            </p>
          </div>
        ) : (
          <>
            <LeadsMap
              leads={visible}
              onSelect={openLead}
              fitKey={filterKey}
              className="h-[65vh] min-h-96 w-full"
            />
            <MapLegend className="mt-3 px-1" />
          </>
        )}
      </div>

      <LeadDetailDialog
        lead={detailLead}
        bdms={bdms}
        onClose={() => setDetailLead(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}
