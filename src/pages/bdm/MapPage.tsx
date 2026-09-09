import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import { LeadsMap, MapLegend, type MappableLead } from '@/components/LeadsMap';
import { friendlyError } from '@/lib/errors';
import { formatNumber } from '@/lib/utils';
import { useGeolocation } from '@/hooks/useGeolocation';
import { fetchLeadsForMap, type MapLeadRow } from '@/hooks/useLeads';

export default function BdmMapPage() {
  const navigate = useNavigate();
  const { position, request, state } = useGeolocation();

  const [leads, setLeads] = useState<MapLeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // The database only ever returns this BDM's own assigned leads.
      setLeads(await fetchLeadsForMap(2000));
    } catch (cause) {
      setError(friendlyError(cause, 'Could not load the map.'));
      setLeads([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mappable: MappableLead[] = useMemo(
    () =>
      (leads ?? []).map((lead) => ({
        id: lead.id,
        society_name: lead.society_name,
        latitude: lead.latitude!,
        longitude: lead.longitude!,
        status: lead.status,
        total_units: lead.total_units,
        area: lead.area,
        city: lead.city,
        location_source: lead.location_source,
      })),
    [leads],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">My map</h1>
          <p className="text-sm text-slate-500">
            {leads === null ? 'Loading…' : `${formatNumber(mappable.length)} societies`}
          </p>
        </div>
        {state.status !== 'granted' && (
          <Button size="sm" variant="secondary" icon={<Crosshair className="size-4" />} onClick={() => request()}>
            Show me
          </Button>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="card overflow-hidden p-2">
        {leads === null ? (
          <LoadingBlock label="Loading the map…" />
        ) : mappable.length === 0 ? (
          <div className="flex h-96 flex-col items-center justify-center px-6 text-center">
            <MapPinOff className="mb-3 size-8 text-slate-300" />
            <p className="font-medium text-slate-700">Nothing to show yet</p>
            <p className="mt-1 text-sm text-slate-500">
              None of your societies has a location recorded, so none can be placed on the map.
            </p>
          </div>
        ) : (
          <>
            <LeadsMap
              leads={mappable}
              currentPosition={position}
              onSelect={(id) => navigate(`/bdm/lead/${id}`)}
              className="h-[62vh] min-h-80 w-full"
            />
            <MapLegend className="mt-2 px-1 pb-1" />
          </>
        )}
      </div>
    </div>
  );
}
