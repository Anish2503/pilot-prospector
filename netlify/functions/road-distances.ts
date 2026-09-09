/**
 * Driving distances along real roads.  POST /api/road-distances
 *
 * WHY THIS EXISTS
 * The BDM list used to show straight-line distance. Measured against real
 * routes in Bengaluru, a society 11.5 km away in a straight line is a 15.0 km
 * drive - and the gap is not a constant: across twelve real societies the ratio
 * ranged from 1.16x to 1.41x. So a multiplier cannot be used; the roads have to
 * be asked.
 *
 * PROVIDERS
 *   - OSRM (Open Source Routing Machine), default. Free, open source, no key,
 *     no account, no billing. Its `table` service answers one origin against
 *     many destinations in a SINGLE request, which is exactly what a BDM
 *     opening their list needs.
 *   - Google Routes API, used only if GOOGLE_MAPS_API_KEY is set. Accounts for
 *     live traffic; needs a billing account.
 *
 * The browser never talks to either service directly, so no key is ever exposed
 * and one request covers a whole list rather than one per society.
 */

import {
  assertMethod,
  errorResponse,
  getClaims,
  HttpError,
  json,
  optionalEnv,
  readJson,
  supabaseAdmin,
} from './_shared.ts';

const OSRM_TABLE_URL = 'https://router.project-osrm.org/table/v1/driving/';
const GOOGLE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

/**
 * Destinations per upstream request.
 * OSRM takes them in the URL path, so this keeps the URL comfortably short.
 */
const OSRM_CHUNK = 90;
const GOOGLE_CHUNK = 100;

/** A single BDM should never need more than this in one go. */
const MAX_DESTINATIONS = 400;

const TIMEOUT_MS = 15_000;

interface Point {
  id: string;
  latitude: number;
  longitude: number;
}

export interface RoadDistance {
  id: string;
  /** Metres along the road, or null when no route could be found. */
  distanceMeters: number | null;
  /** Seconds of driving, or null. */
  durationSeconds: number | null;
}

interface Body {
  origin?: { latitude: number; longitude: number };
  destinations?: Point[];
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001)
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// -----------------------------------------------------------------------------
// OSRM - the free default
// -----------------------------------------------------------------------------

async function viaOsrm(
  origin: { latitude: number; longitude: number },
  destinations: Point[],
): Promise<RoadDistance[]> {
  const results: RoadDistance[] = [];

  for (const batch of chunk(destinations, OSRM_CHUNK)) {
    // OSRM wants longitude first, and the origin is simply the first entry.
    const coordinates = [
      `${origin.longitude.toFixed(6)},${origin.latitude.toFixed(6)}`,
      ...batch.map((d) => `${d.longitude.toFixed(6)},${d.latitude.toFixed(6)}`),
    ].join(';');

    const url = `${OSRM_TABLE_URL}${coordinates}?sources=0&annotations=distance,duration`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const name = (error as Error)?.name;
      throw new HttpError(
        name === 'TimeoutError' ? 504 : 502,
        'The routing service did not respond in time.',
      );
    }

    if (response.status === 429) {
      throw new HttpError(429, 'The routing service is busy. Please try again in a moment.');
    }
    if (!response.ok) {
      throw new HttpError(502, 'The routing service could not be reached.');
    }

    const body = (await response.json()) as {
      code?: string;
      distances?: Array<Array<number | null>>;
      durations?: Array<Array<number | null>>;
    };

    if (body.code !== 'Ok') {
      throw new HttpError(502, 'The routing service could not work out these routes.');
    }

    // Row 0 is the origin; column 0 is the origin against itself, so skip it.
    const distanceRow = body.distances?.[0] ?? [];
    const durationRow = body.durations?.[0] ?? [];

    batch.forEach((destination, index) => {
      const metres = distanceRow[index + 1];
      const seconds = durationRow[index + 1];
      results.push({
        id: destination.id,
        distanceMeters: typeof metres === 'number' ? Math.round(metres) : null,
        durationSeconds: typeof seconds === 'number' ? Math.round(seconds) : null,
      });
    });
  }

  return results;
}

// -----------------------------------------------------------------------------
// Google Routes - used only when a key is configured
// -----------------------------------------------------------------------------

async function viaGoogle(
  origin: { latitude: number; longitude: number },
  destinations: Point[],
  key: string,
): Promise<RoadDistance[]> {
  const results: RoadDistance[] = [];

  for (const batch of chunk(destinations, GOOGLE_CHUNK)) {
    const response = await fetch(GOOGLE_MATRIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'originIndex,destinationIndex,distanceMeters,duration,condition',
      },
      body: JSON.stringify({
        origins: [
          { waypoint: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } } },
        ],
        destinations: batch.map((d) => ({
          waypoint: { location: { latLng: { latitude: d.latitude, longitude: d.longitude } } },
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 429) {
      throw new HttpError(429, 'The Google routing quota has been reached for now.');
    }
    if (response.status === 403) {
      throw new HttpError(
        500,
        'Google rejected the request. Check GOOGLE_MAPS_API_KEY and that the Routes API is enabled.',
      );
    }
    if (!response.ok) {
      throw new HttpError(502, 'The routing service could not be reached.');
    }

    const rows = (await response.json()) as Array<{
      destinationIndex?: number;
      distanceMeters?: number;
      duration?: string;
      condition?: string;
    }>;

    const byIndex = new Map<number, { metres: number | null; seconds: number | null }>();
    for (const row of rows) {
      if (typeof row.destinationIndex !== 'number') continue;
      const routed = row.condition === 'ROUTE_EXISTS';
      byIndex.set(row.destinationIndex, {
        metres: routed && typeof row.distanceMeters === 'number' ? row.distanceMeters : null,
        // Google returns durations like "1234s".
        seconds: routed && row.duration ? Number.parseInt(row.duration, 10) || null : null,
      });
    }

    batch.forEach((destination, index) => {
      const found = byIndex.get(index);
      results.push({
        id: destination.id,
        distanceMeters: found?.metres ?? null,
        durationSeconds: found?.seconds ?? null,
      });
    });
  }

  return results;
}

// -----------------------------------------------------------------------------

/** Both BDMs and admins may ask for distances; nobody else may. */
async function requireSignedIn(request: Request) {
  const claims = getClaims(request);
  if (!claims) throw new HttpError(401, 'Please sign in.');

  const db = supabaseAdmin();

  if (claims.app_role === 'bdm') {
    const { data } = await db.from('bdms').select('active').eq('id', claims.uid).maybeSingle();
    if (!data?.active) throw new HttpError(403, 'This account has been disabled.');
    return claims;
  }

  if (claims.app_role === 'super_admin') {
    const { data } = await db.from('admins').select('active').eq('id', claims.uid).maybeSingle();
    if (!data?.active) throw new HttpError(403, 'This account has been disabled.');
    return claims;
  }

  throw new HttpError(401, 'Please sign in.');
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    await requireSignedIn(request);

    const body = await readJson<Body>(request);
    const origin = body.origin;

    if (!origin || !validCoordinate(origin.latitude, origin.longitude)) {
      throw new HttpError(400, 'A valid current location is required.');
    }

    // Anything without usable coordinates is dropped before we ask the router.
    const destinations = (body.destinations ?? [])
      .filter(
        (d): d is Point =>
          typeof d?.id === 'string' && validCoordinate(d?.latitude, d?.longitude),
      )
      .slice(0, MAX_DESTINATIONS);

    if (destinations.length === 0) {
      return json({ provider: 'none', results: [] });
    }

    const key = optionalEnv('GOOGLE_MAPS_API_KEY');
    const provider = key ? 'google' : 'osrm';

    const results = key
      ? await viaGoogle(origin, destinations, key)
      : await viaOsrm(origin, destinations);

    return json({ provider, results });
  } catch (error) {
    return errorResponse(error);
  }
}
