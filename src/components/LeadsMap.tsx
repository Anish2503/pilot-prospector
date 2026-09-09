import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { LeadStatus } from '@/types';
import { STATUS_LABELS } from '@/lib/utils';

/** The minimum a lead needs for the map to place it. */
export interface MappableLead {
  id: string;
  society_name: string;
  latitude: number;
  longitude: number;
  status: LeadStatus;
  total_units: number | null;
  area: string | null;
  city: string | null;
  bdmName?: string | null;
  location_source?: string;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  unassigned: '#94a3b8', // slate
  assigned: '#3b82f6', // blue
  visited: '#10b981', // emerald
  follow_up: '#f59e0b', // amber
  completed: '#8b5cf6', // violet
};

/** Roughly the middle of Bengaluru - only used when there is nothing to show. */
const DEFAULT_CENTER: L.LatLngExpression = [12.9716, 77.5946];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A coloured pin drawn with CSS, so no image files are needed. */
function pinIcon(status: LeadStatus, estimated: boolean): L.DivIcon {
  const color = STATUS_COLORS[status];
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:16px;height:16px;border-radius:9999px;
      background:${color};
      border:2.5px solid #fff;
      box-shadow:0 1px 4px rgba(15,23,42,.45);
      ${estimated ? 'outline:2px dashed ' + color + ';outline-offset:2px;' : ''}
    "></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

export function LeadsMap({
  leads,
  onSelect,
  className,
  currentPosition,
  fitKey,
}: {
  leads: MappableLead[];
  onSelect?: (leadId: string) => void;
  className?: string;
  /** Optional "you are here" marker for the BDM view. */
  currentPosition?: { latitude: number; longitude: number } | null;
  /** Change this to force the map to re-fit around the current markers. */
  fitKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const positionRef = useRef<L.CircleMarker | null>(null);
  const selectRef = useRef(onSelect);

  selectRef.current = onSelect;

  // ---- Create the map exactly once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 11,
      // Keeps a stray scroll from zooming the map while scrolling the page.
      scrollWheelZoom: false,
      zoomControl: true,
      preferCanvas: true,
    });

    // OpenStreetMap tiles: free, no API key, no billing account.
    // Attribution is required by their licence - please leave it in place.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // Only rebuild markers when the leads genuinely change.
  const signature = useMemo(
    () => leads.map((l) => `${l.id}:${l.status}`).join('|'),
    [leads],
  );

  // ---- Rebuild the markers whenever the leads change.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;

    cluster.clearLayers();

    const markers: L.Marker[] = leads.map((lead) => {
      const estimated = lead.location_source === 'geocoded';

      const marker = L.marker([lead.latitude, lead.longitude], {
        icon: pinIcon(lead.status, estimated),
        title: lead.society_name,
      });

      const details = [
        lead.total_units !== null
          ? `${lead.total_units.toLocaleString('en-IN')} units`
          : 'Units not confirmed',
        [lead.area, lead.city].filter(Boolean).join(', '),
        lead.bdmName ? `Assigned to ${escapeHtml(lead.bdmName)}` : 'Unassigned',
      ].filter(Boolean);

      marker.bindPopup(
        `<div style="font-family:inherit">
          <p style="margin:0;font-weight:600;font-size:14px;color:#0f172a">${escapeHtml(lead.society_name)}</p>
          <p style="margin:4px 0 0;font-size:13px;color:#475569;line-height:1.5">${details.map(escapeHtml).join('<br>')}</p>
          <p style="margin:6px 0 0;font-size:12px;color:${STATUS_COLORS[lead.status]};font-weight:600">
            ${STATUS_LABELS[lead.status]}${estimated ? ' &middot; location estimated' : ''}
          </p>
          ${selectRef.current ? `<button data-lead-id="${lead.id}" style="margin-top:8px;width:100%;padding:6px 10px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-size:13px;font-weight:500;cursor:pointer">Open lead</button>` : ''}
        </div>`,
      );

      return marker;
    });

    cluster.addLayers(markers);

    if (markers.length > 0) {
      const bounds = cluster.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // `signature` stands in for the contents of `leads`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, fitKey]);

  // ---- Wire up the "Open lead" button inside popups.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handler = (event: L.LeafletEvent) => {
      const popup = (event as L.PopupEvent).popup;
      const element = popup.getElement();
      const button = element?.querySelector<HTMLButtonElement>('button[data-lead-id]');
      if (!button) return;
      button.onclick = () => {
        const id = button.getAttribute('data-lead-id');
        if (id) selectRef.current?.(id);
      };
    };

    map.on('popupopen', handler);
    return () => {
      map.off('popupopen', handler);
    };
  }, []);

  // ---- The BDM's own position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (positionRef.current) {
      positionRef.current.remove();
      positionRef.current = null;
    }
    if (!currentPosition) return;

    positionRef.current = L.circleMarker(
      [currentPosition.latitude, currentPosition.longitude],
      {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#2563eb',
        fillOpacity: 1,
      },
    )
      .bindPopup('You are here')
      .addTo(map);
  }, [currentPosition]);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-full w-full rounded-xl" />
    </div>
  );
}

/** The colour key shown beside the map. */
export function MapLegend({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.keys(STATUS_COLORS) as LeadStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="size-3 rounded-full border-2 border-white shadow-sm"
              style={{ background: STATUS_COLORS[status] }}
            />
            {STATUS_LABELS[status]}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="size-3 rounded-full border border-dashed border-slate-500" />
          Location estimated
        </li>
      </ul>
    </div>
  );
}
