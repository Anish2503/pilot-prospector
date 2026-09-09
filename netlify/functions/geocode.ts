/**
 * Working out where a society actually is.  POST /api/geocode
 *
 * This is the single place that resolves a lead's location, and it applies one
 * priority order, always:
 *
 *   1. Coordinates already inside the lead's Google Maps URL
 *   2. Coordinates found by FOLLOWING a shortened Google Maps link
 *   3. A geocoding lookup, using the best text we have
 *   4. Nothing - the lead is flagged for a human to check
 *
 * WHY STEP 3 MATTERS MORE THAN IT SOUNDS
 * A spreadsheet exported for Google My Maps carries links of the form
 *   https://www.google.com/maps/search/?api=1&query=SOCIETY+NAME,+Bangalore
 * Those look like Maps links but contain NO coordinates, and following them
 * returns a search page rather than a place - measured, not assumed. What they
 * do carry is the exact text a person would type into Maps, so that text is
 * pulled out and used as the geocoding query. It is the strongest signal such a
 * file has.
 *
 * PROVIDERS
 *   - OpenStreetMap / Nominatim: free, no key, 1 request per second. Measured
 *     at roughly 4 in 10 on Indian society names.
 *   - Google Geocoding API: used only if GOOGLE_MAPS_API_KEY is set. Much
 *     better on Indian society names, needs a billing account.
 *
 * Actions:
 *   { action: 'pending' }                    -> what still needs locating
 *   { action: 'next' }                       -> resolve the next unlocated lead
 *   { action: 'resolve-lead', leadId }       -> resolve one specific lead
 *   { action: 'lookup', leadId }             -> preview WITHOUT saving
 *   { action: 'accept', leadId, latitude, longitude, displayName }
 *   { action: 'reject', leadId }
 */

import {
  assertMethod,
  errorResponse,
  HttpError,
  json,
  logActivity,
  optionalEnv,
  readJson,
  requireAdmin,
  supabaseAdmin,
} from './_shared.ts';
import {
  assessMapsUrl,
  extractCoordinatesFromUrl,
  isAllowedMapsHost,
  isPlausibleCoordinate,
} from '../../src/lib/googleMaps.ts';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

type Confidence = 'high' | 'medium' | 'low';

/** Matches the CHECK constraint on leads.location_source. */
type LocationSource = 'google_maps_url' | 'google_maps_redirect' | 'geocoded';

interface Located {
  latitude: number;
  longitude: number;
  source: LocationSource;
  confidence: Confidence;
  /** Human-readable description of what was matched. */
  displayName: string;
  /** The query or URL that produced it, for the audit trail. */
  query: string;
  resolvedUrl?: string | null;
  provider?: 'google' | 'openstreetmap' | 'maps_url';
}

interface LeadRow {
  id: string;
  society_name: string;
  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  google_maps_url: string | null;
}

const LEAD_FIELDS =
  'id, society_name, address, area, city, state, pincode, google_maps_url';

function userAgent(): string {
  const contact = optionalEnv('GEOCODER_CONTACT_EMAIL') ?? 'admin@example.com';
  return `PilotProspector/1.0 (${contact})`;
}

/** True when a Google key is configured, so the better provider is available. */
function googleKey(): string | null {
  return optionalEnv('GOOGLE_MAPS_API_KEY') ?? null;
}

// -----------------------------------------------------------------------------
// STEP 2 - follow a shortened link
// -----------------------------------------------------------------------------

/**
 * Follows a Maps link, validating the host at every hop so an open redirect
 * cannot be used to reach an internal address. Headers only - no page bodies.
 */
async function followMapsUrl(startUrl: string): Promise<{ url: string; coordinates: ReturnType<typeof extractCoordinatesFromUrl> } | null> {
  let current: string;
  try {
    current = new URL(startUrl).toString();
  } catch {
    return null;
  }

  for (let hop = 0; hop < 6; hop++) {
    let host: string;
    try {
      host = new URL(current).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (!isAllowedMapsHost(host)) return null;

    const found = extractCoordinatesFromUrl(current);
    if (found) return { url: current, coordinates: found };

    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
      });
    } catch {
      return null;
    }

    if (response.status === 429) {
      throw new HttpError(429, 'Google is asking us to slow down. Please wait a minute.');
    }

    const location = response.headers.get('location');
    if (location) {
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }

    const finalUrl = response.url || current;
    const coordinates = extractCoordinatesFromUrl(finalUrl);
    return coordinates ? { url: finalUrl, coordinates } : null;
  }

  return null;
}

// -----------------------------------------------------------------------------
// STEP 3 - geocoding
// -----------------------------------------------------------------------------

/**
 * The text to look up, best first.
 *
 * A My Maps search link literally contains the phrase someone would type into
 * Google Maps, so it beats anything we could assemble ourselves.
 */
function buildQueries(lead: LeadRow): string[] {
  const queries: string[] = [];

  if (lead.google_maps_url) {
    try {
      const params = new URL(lead.google_maps_url).searchParams;
      const embedded = params.get('query') ?? params.get('q');
      if (embedded && !/^-?\d+\.\d+\s*,/.test(embedded)) queries.push(embedded);
    } catch {
      /* not a parseable URL - ignore */
    }
  }

  const place = [lead.area, lead.city, lead.state].filter(Boolean).join(', ');

  if (place) queries.push(`${lead.society_name}, ${place}, India`);
  if (lead.address && lead.city) {
    queries.push(`${lead.society_name}, ${lead.address}, ${lead.city}, India`);
  }
  if (lead.address) queries.push(`${lead.address}, India`);
  if (lead.city) queries.push(`${lead.society_name}, ${lead.city}, India`);

  // Remove duplicates, keeping the best-first order.
  const seen = new Set<string>();
  return queries.filter((q) => {
    const key = q.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Place types that mean "we found a neighbourhood", not a building. */
const VAGUE = new Set([
  'city', 'town', 'state', 'county', 'administrative', 'postcode', 'suburb',
  'political', 'locality', 'sublocality', 'administrative_area_level_1',
  'administrative_area_level_2', 'postal_code',
]);

/**
 * Google Places Text Search.
 *
 * This is tried before the Geocoding API because a society name like
 * "VEGA EASTWOODS" is a PLACE, not an address. The geocoder is built for
 * addresses and often returns nothing for a building name; Places is built to
 * answer exactly the question "what is this place called X near Bangalore".
 */
async function searchGooglePlaces(query: string, key: string): Promise<Located | null> {
  const response = await fetch(GOOGLE_PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      // Only the fields we need - this keeps it in the cheapest billing tier.
      'X-Goog-FieldMask': 'places.location,places.displayName,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: query, regionCode: 'IN', maxResultCount: 1 }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 429) {
    throw new HttpError(429, 'The Google Maps quota has been reached for now.');
  }
  if (response.status === 403) {
    throw new HttpError(
      500,
      'Google rejected the request. Check GOOGLE_MAPS_API_KEY and that the Places API (New) is enabled.',
    );
  }
  // A 400 usually means this particular query was unusable - not fatal.
  if (!response.ok) return null;

  const body = (await response.json()) as {
    places?: Array<{
      location?: { latitude: number; longitude: number };
      displayName?: { text?: string };
      formattedAddress?: string;
    }>;
  };

  const best = body.places?.[0];
  if (!best?.location) return null;

  const { latitude, longitude } = best.location;
  if (!isPlausibleCoordinate(latitude, longitude)) return null;

  return {
    latitude,
    longitude,
    source: 'geocoded',
    // Places returns the building itself, so this is as good as it gets
    // without someone standing outside it.
    confidence: 'high',
    displayName: best.formattedAddress ?? best.displayName?.text ?? query,
    query,
    provider: 'google',
  };
}

async function geocodeWithGoogle(query: string, key: string): Promise<Located | null> {
  const url = new URL(GOOGLE_GEOCODE_URL);
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'in');
  url.searchParams.set('key', key);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new HttpError(502, 'The location service did not respond.');

  const body = (await response.json()) as {
    status: string;
    results?: Array<{
      geometry: { location: { lat: number; lng: number }; location_type?: string };
      formatted_address?: string;
      types?: string[];
    }>;
    error_message?: string;
  };

  if (body.status === 'OVER_QUERY_LIMIT') {
    throw new HttpError(429, 'The Google Maps quota has been reached for now.');
  }
  if (body.status === 'REQUEST_DENIED') {
    throw new HttpError(
      500,
      'Google rejected the request. Check that GOOGLE_MAPS_API_KEY is valid and the Geocoding API is enabled.',
    );
  }
  if (body.status !== 'OK' || !body.results?.length) return null;

  const best = body.results[0]!;
  const { lat, lng } = best.geometry.location;
  if (!isPlausibleCoordinate(lat, lng)) return null;

  const type = (best.geometry.location_type ?? '').toUpperCase();
  const vague = (best.types ?? []).some((t) => VAGUE.has(t));

  const confidence: Confidence =
    type === 'ROOFTOP' ? 'high' : vague ? 'low' : type === 'APPROXIMATE' ? 'low' : 'medium';

  return {
    latitude: lat,
    longitude: lng,
    source: 'geocoded',
    confidence,
    displayName: best.formatted_address ?? query,
    query,
    provider: 'google',
  };
}

// -----------------------------------------------------------------------------
// FREE PROVIDER: Photon
//
// Photon searches the same OpenStreetMap data as Nominatim, but with fuzzy
// matching, which finds far more Indian society names. Measured on this
// project's own data: Nominatim found 1 in 12, Photon found 12 in 12.
//
// The catch is that fuzzy matching also returns confident-looking nonsense -
// it offered "Garuda Mall" for "GARUDA BLOSSOM" and a restaurant for
// "LAKE VIHAR 2". Storing those would send a BDM to the wrong building, which
// is worse than having no location at all.
//
// So every candidate must pass a name check: EVERY distinctive word of the
// society name has to appear in the match. Measured with that gate: 8 of 20
// accepted, and all six known-wrong matches correctly rejected.
// -----------------------------------------------------------------------------

const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Words that appear in half the societies in Bengaluru and prove nothing. */
const GENERIC_WORDS = new Set([
  'apartment', 'apartments', 'society', 'societies', 'residency', 'residence',
  'enclave', 'homes', 'home', 'towers', 'tower', 'the', 'owners', 'association',
  'welfare', 'layout', 'flats', 'block', 'phase', 'builders', 'projects',
  'project', 'estate', 'estates', 'villa', 'villas', 'heights', 'garden',
  'gardens', 'park', 'residents', 'apts', 'housing', 'and',
]);

function distinctiveWords(value: string): string[] {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word));
}

/** Allows a single character of spelling drift - "Sonesta" vs "Sonestaa". */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;

  let drift = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++drift > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return drift <= 1;
}

/**
 * Accepts a candidate only when every distinctive word of the society name is
 * present. One word in common is not enough - that is what let "Arvind
 * Arkavathi" match "Arvind Sporcia".
 */
function isTrustworthyMatch(societyName: string, candidateName: string): boolean {
  const wanted = distinctiveWords(societyName);
  const found = distinctiveWords(candidateName);

  if (wanted.length === 0 || found.length === 0) return false;

  const allPresent = wanted.every((word) => found.some((other) => nearlyEqual(word, other)));
  if (!allPresent) return false;

  // Two words agreeing is convincing. A single word has to be unusual enough
  // to stand on its own.
  return wanted.length >= 2 || wanted[0]!.length >= 10;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_value?: string; city?: string; state?: string };
}

async function searchPhoton(query: string, societyName: string): Promise<Located | null> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  // Bias towards Bengaluru so a same-named place elsewhere does not win.
  url.searchParams.set('lat', '12.97');
  url.searchParams.set('lon', '77.59');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (response.status === 429) {
    throw new HttpError(429, 'The free location service is busy. Please wait a minute.');
  }
  if (!response.ok) return null;

  const body = (await response.json()) as { features?: PhotonFeature[] };

  for (const feature of body.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates) continue;

    const [longitude, latitude] = coordinates;
    if (!isPlausibleCoordinate(latitude, longitude)) continue;

    const name = feature.properties?.name ?? '';
    if (!isTrustworthyMatch(societyName, name)) continue;

    return {
      latitude,
      longitude,
      source: 'geocoded',
      // Never 'high' - this is a fuzzy match against a community map, so it is
      // offered as a good guess for a human to confirm, not as established fact.
      confidence: 'medium',
      displayName: [name, feature.properties?.city, feature.properties?.state]
        .filter(Boolean)
        .join(', '),
      query,
      provider: 'openstreetmap',
    };
  }

  return null;
}

async function geocodeWithNominatim(query: string): Promise<Located | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'in');

  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 429) {
    throw new HttpError(429, 'The free location service is busy. Please wait a minute.');
  }
  if (!response.ok) throw new HttpError(502, 'The location service did not respond.');

  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    type?: string;
    addresstype?: string;
  }>;

  const best = results[0];
  if (!best) return null;

  const latitude = Number(best.lat);
  const longitude = Number(best.lon);
  if (!isPlausibleCoordinate(latitude, longitude)) return null;

  const type = (best.type ?? best.addresstype ?? '').toLowerCase();

  return {
    latitude,
    longitude,
    source: 'geocoded',
    confidence: VAGUE.has(type) ? 'low' : 'medium',
    displayName: best.display_name,
    query,
    provider: 'openstreetmap',
  };
}

// -----------------------------------------------------------------------------
// THE FULL CHAIN
// -----------------------------------------------------------------------------

/**
 * Applies every step in priority order to one lead.
 * Returns null only when nothing at all could be established.
 */
async function resolveLocation(lead: LeadRow): Promise<Located | null> {
  // --- 1. Coordinates already in the URL.
  if (lead.google_maps_url) {
    const assessment = assessMapsUrl(lead.google_maps_url);

    if (assessment.coordinates) {
      return {
        latitude: assessment.coordinates.latitude,
        longitude: assessment.coordinates.longitude,
        source: 'google_maps_url',
        confidence: assessment.coordinates.precision === 'place' ? 'high' : 'medium',
        displayName: 'Taken from the Google Maps link',
        query: lead.google_maps_url,
        provider: 'maps_url',
      };
    }

    // --- 2. Follow it, if following could possibly help.
    if (assessment.status === 'needs_resolving' || assessment.status === 'no_coordinates') {
      const followed = await followMapsUrl(assessment.url ?? lead.google_maps_url);
      if (followed?.coordinates) {
        return {
          latitude: followed.coordinates.latitude,
          longitude: followed.coordinates.longitude,
          source: 'google_maps_redirect',
          confidence: followed.coordinates.precision === 'place' ? 'high' : 'medium',
          displayName: 'Found by following the Google Maps link',
          query: lead.google_maps_url,
          resolvedUrl: followed.url,
          provider: 'maps_url',
        };
      }
    }
  }

  // --- 3. Geocode.
  const key = googleKey();
  for (const query of buildQueries(lead)) {
    if (key) {
      // Places first (it understands building names), then the geocoder.
      const viaPlaces = await searchGooglePlaces(query, key);
      if (viaPlaces) return viaPlaces;

      const viaGeocoder = await geocodeWithGoogle(query, key);
      if (viaGeocoder) return viaGeocoder;
    } else {
      // Photon finds far more Indian society names than Nominatim, but only
      // its name-verified matches are accepted.
      const viaPhoton = await searchPhoton(query, lead.society_name);
      if (viaPhoton) return viaPhoton;

      const viaNominatim = await geocodeWithNominatim(query);
      if (viaNominatim) return viaNominatim;
    }
  }

  return null;
}

/** Writes a successful result to the lead. */
async function saveLocation(leadId: string, found: Located, highConfidenceOnly: boolean) {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  // A coordinate we are not confident about is saved but stays flagged, so it
  // never masquerades as a confirmed location.
  const keepFlagged = found.confidence !== 'high';

  if (highConfidenceOnly && found.confidence !== 'high') {
    await db
      .from('leads')
      .update({
        geocoded_at: now,
        geocode_query: found.query,
        geocode_display_name: found.displayName,
        needs_review: true,
        review_reason: `A ${found.confidence}-confidence match was found - please confirm it`,
      })
      .eq('id', leadId);
    return false;
  }

  await db
    .from('leads')
    .update({
      latitude: found.latitude,
      longitude: found.longitude,
      location_source: found.source,
      location_confidence: found.confidence,
      geocoded_at: now,
      geocode_query: found.query,
      geocode_display_name: found.displayName,
      resolved_maps_url: found.resolvedUrl ?? null,
      needs_review: keepFlagged,
      review_reason: keepFlagged
        ? `Location is a ${found.confidence}-confidence estimate - please confirm`
        : null,
    })
    .eq('id', leadId);

  return true;
}

// -----------------------------------------------------------------------------

interface Body {
  action?: 'pending' | 'next' | 'resolve-lead' | 'lookup' | 'accept' | 'reject';
  leadId?: string;
  latitude?: number;
  longitude?: number;
  displayName?: string;
  highConfidenceOnly?: boolean;
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    const admin = await requireAdmin(request);
    const body = await readJson<Body>(request);
    const db = supabaseAdmin();

    // ------------------------------------------------------------ PENDING
    if (body.action === 'pending') {
      const [missing, withLink, geocoded, review, fromMaps] = await Promise.all([
        db.from('leads').select('id', { count: 'exact', head: true }).is('latitude', null),
        db
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .is('latitude', null)
          .not('google_maps_url', 'is', null),
        db
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('location_source', 'geocoded'),
        db.from('leads').select('id', { count: 'exact', head: true }).eq('needs_review', true),
        db
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .in('location_source', ['google_maps_url', 'google_maps_redirect']),
      ]);

      return json({
        missing: missing.count ?? 0,
        missingWithMapsLink: withLink.count ?? 0,
        geocoded: geocoded.count ?? 0,
        fromMapsLink: fromMaps.count ?? 0,
        needsReview: review.count ?? 0,
        provider: googleKey() ? 'google' : 'openstreetmap',
        // Google needs no pause between calls; OpenStreetMap allows one a second.
        paceMs: googleKey() ? 120 : 600,
      });
    }

    // ------------------------------------------------------------- LOOKUP
    // Resolves without saving, so an admin can see what would happen.
    if (body.action === 'lookup') {
      if (!body.leadId) throw new HttpError(400, 'Which lead should be looked up?');

      const { data: lead } = await db
        .from('leads')
        .select(LEAD_FIELDS)
        .eq('id', body.leadId)
        .maybeSingle();

      if (!lead) throw new HttpError(404, 'That lead no longer exists.');

      const found = await resolveLocation(lead as LeadRow);
      return json({
        lead: { id: lead.id, society_name: lead.society_name },
        candidate: found,
      });
    }

    // ------------------------------------ NEXT / RESOLVE ONE SPECIFIC LEAD
    if (body.action === 'next' || body.action === 'resolve-lead') {
      let lead: LeadRow | null = null;

      if (body.action === 'resolve-lead') {
        if (!body.leadId) throw new HttpError(400, 'Which lead?');
        const { data } = await db
          .from('leads')
          .select(LEAD_FIELDS)
          .eq('id', body.leadId)
          .maybeSingle();
        lead = (data as LeadRow) ?? null;
        if (!lead) throw new HttpError(404, 'That lead no longer exists.');
      } else {
        // Leads that carry a Maps link are tried first - they are the most
        // likely to succeed, so the numbers move quickly for the admin.
        const { data: withLink } = await db
          .from('leads')
          .select(LEAD_FIELDS)
          .is('latitude', null)
          .is('geocoded_at', null)
          .not('google_maps_url', 'is', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        lead = (withLink as LeadRow) ?? null;

        if (!lead) {
          const { data: fallback } = await db
            .from('leads')
            .select(LEAD_FIELDS)
            .is('latitude', null)
            .is('geocoded_at', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          lead = (fallback as LeadRow) ?? null;
        }

        if (!lead) return json({ done: true });
      }

      const now = new Date().toISOString();
      let found: Located | null = null;
      let failure: string | null = null;

      try {
        found = await resolveLocation(lead);
      } catch (error) {
        // Rate limits and outages must pause the run, not poison the lead.
        if (error instanceof HttpError && (error.status === 429 || error.status === 502)) throw error;
        failure = 'The location service could not be reached.';
      }

      if (!found) {
        await db
          .from('leads')
          .update({
            geocoded_at: now,
            geocode_query: buildQueries(lead)[0] ?? lead.society_name,
            needs_review: true,
            review_reason:
              failure ?? 'No location could be found automatically - please enter it by hand',
          })
          .eq('id', lead.id);

        return json({
          done: false,
          lead: { id: lead.id, society_name: lead.society_name },
          candidate: null,
          saved: false,
          reason: failure ?? 'not_found',
        });
      }

      const saved = await saveLocation(lead.id, found, Boolean(body.highConfidenceOnly));

      return json({
        done: false,
        lead: { id: lead.id, society_name: lead.society_name },
        candidate: found,
        saved,
      });
    }

    // ------------------------------------------------------------- ACCEPT
    if (body.action === 'accept') {
      const { leadId, latitude, longitude } = body;
      if (!leadId || typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new HttpError(400, 'A lead and a pair of coordinates are required.');
      }
      if (!isPlausibleCoordinate(latitude, longitude)) {
        throw new HttpError(400, 'Those coordinates are not valid.');
      }

      const { error } = await db
        .from('leads')
        .update({
          latitude,
          longitude,
          // An admin pressing Accept is a human decision, so it counts as
          // confirmed rather than estimated.
          location_source: 'manual',
          location_confidence: 'high',
          geocoded_at: new Date().toISOString(),
          geocode_display_name: body.displayName ?? null,
          needs_review: false,
          review_reason: null,
        })
        .eq('id', leadId);

      if (error) throw new HttpError(500, 'Could not save that location.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'lead.location_confirmed',
        leadId,
        metadata: { latitude, longitude, displayName: body.displayName },
      });

      return json({ ok: true });
    }

    // ------------------------------------------------------------- REJECT
    if (body.action === 'reject') {
      if (!body.leadId) throw new HttpError(400, 'Which lead?');

      await db
        .from('leads')
        .update({
          latitude: null,
          longitude: null,
          location_source: 'unknown',
          location_confidence: 'unverified',
          needs_review: true,
          review_reason: 'Suggested location was rejected - needs to be entered by hand',
        })
        .eq('id', body.leadId);

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'lead.location_rejected',
        leadId: body.leadId,
      });

      return json({ ok: true });
    }

    throw new HttpError(400, 'The request was not valid.');
  } catch (error) {
    return errorResponse(error);
  }
}
