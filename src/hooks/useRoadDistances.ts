import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Coordinates } from '@/types';

/**
 * Driving distances along real roads, for a list of societies.
 *
 * A straight line badly understates a drive - measured across twelve real
 * Bengaluru societies, the road was 1.16x to 1.41x the straight line, so no
 * single multiplier would do. This asks a routing service instead.
 *
 * ONE REQUEST, NOT ONE PER SOCIETY. The whole list goes to the server together
 * and comes back together, so a BDM with two hundred leads makes a couple of
 * requests rather than two hundred.
 *
 * CACHING. Results are kept against the origin rounded to roughly 110 metres.
 * Re-rendering, searching or re-sorting reuses them; only genuinely moving
 * triggers fresh routing. The BDM is never tracked continuously - this runs
 * when their location is read, which is on opening the list or tapping Update.
 */

export interface RoadDistance {
  distanceMeters: number | null;
  durationSeconds: number | null;
}

export type RoadStatus =
  | 'idle' // no location yet, or nothing to measure
  | 'loading'
  | 'ready'
  | 'unavailable'; // the routing service could not be reached

interface Mappable {
  id: string;
  latitude: number | null;
  longitude: number | null;
}

/** ~110 m of movement before we consider the origin to have changed. */
function originKeyOf(position: Coordinates | null): string | null {
  if (!position) return null;
  return `${position.latitude.toFixed(3)},${position.longitude.toFixed(3)}`;
}

export function useRoadDistances(position: Coordinates | null, leads: Mappable[]) {
  const [distances, setDistances] = useState<Map<string, RoadDistance>>(new Map());
  const [status, setStatus] = useState<RoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  /** Everything already routed, keyed by origin then by lead. */
  const cache = useRef<Map<string, Map<string, RoadDistance>>>(new Map());
  const inFlight = useRef<string | null>(null);

  const originKey = originKeyOf(position);

  // Only the societies that actually have coordinates can be routed.
  const routable = useMemo(
    () => leads.filter((l) => l.latitude !== null && l.longitude !== null),
    [leads],
  );

  // A stable description of "which societies", so re-renders do not refetch.
  const leadsKey = useMemo(
    () =>
      routable
        .map((l) => l.id)
        .sort()
        .join(','),
    [routable],
  );

  const run = useCallback(
    async (force: boolean) => {
      if (!position || !originKey || routable.length === 0) {
        setStatus('idle');
        return;
      }

      const requestKey = `${originKey}|${leadsKey}`;
      if (!force && inFlight.current === requestKey) return;

      const cached = cache.current.get(originKey);
      const missing = force
        ? routable
        : routable.filter((l) => !cached?.has(l.id));

      if (missing.length === 0 && cached) {
        setDistances(new Map(cached));
        setStatus('ready');
        return;
      }

      inFlight.current = requestKey;
      setStatus('loading');
      setError(null);

      try {
        const response = await api.post<{
          provider: string;
          results: Array<{ id: string; distanceMeters: number | null; durationSeconds: number | null }>;
        }>('/road-distances', {
          origin: { latitude: position.latitude, longitude: position.longitude },
          destinations: missing.map((l) => ({
            id: l.id,
            latitude: l.latitude,
            longitude: l.longitude,
          })),
        });

        const merged = new Map(cached ?? []);
        for (const row of response.results) {
          merged.set(row.id, {
            distanceMeters: row.distanceMeters,
            durationSeconds: row.durationSeconds,
          });
        }

        cache.current.set(originKey, merged);
        setDistances(new Map(merged));
        setStatus('ready');
      } catch (cause) {
        // Deliberately does NOT fall back to straight-line here. The caller
        // decides what to show, and must label it as an approximation - never
        // pass a straight line off as a driving distance.
        setError(
          (cause as { message?: string })?.message ??
            'Road distances are unavailable right now.',
        );
        setStatus('unavailable');
      } finally {
        if (inFlight.current === requestKey) inFlight.current = null;
      }
    },
    [position, originKey, leadsKey, routable],
  );

  useEffect(() => {
    void run(false);
    // `run` already depends on everything that should trigger a refetch.
  }, [run]);

  /** Re-routes from scratch, e.g. after the BDM refreshes their location. */
  const refresh = useCallback(() => {
    if (originKey) cache.current.delete(originKey);
    void run(true);
  }, [originKey, run]);

  return { distances, status, error, refresh };
}
