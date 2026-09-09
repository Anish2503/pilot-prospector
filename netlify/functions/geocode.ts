/**
 * Finding coordinates for societies that arrived without them.
 * POST /api/geocode
 *
 * Uses OpenStreetMap's Nominatim service, which is free and needs no API key.
 * Their usage policy allows at most ONE request per second, so this function
 * handles a single lead per call and the browser paces the loop.
 *
 * Actions:
 *   { action: 'pending' }                       -> how many leads still need a location
 *   { action: 'next' }                          -> look up the next one and save it
 *   { action: 'lookup', leadId }                -> look one up WITHOUT saving
 *   { action: 'accept', leadId, latitude, longitude, displayName, confidence }
 *   { action: 'reject', leadId }                -> mark as needing manual entry
 *
 * SWAPPING PROVIDERS: everything provider-specific lives in `searchNominatim`.
 * To move to Google's Geocoding API later, add a second function alongside it
 * and change PROVIDER. Nothing else in the app needs to know.
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

const PROVIDER = 'nominatim';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim asks that every caller identifies itself with a contact address. */
function userAgent(): string {
  const contact = optionalEnv('GEOCODER_CONTACT_EMAIL') ?? 'admin@example.com';
  return `PilotProspector/1.0 (${contact})`;
}

type Confidence = 'high' | 'medium' | 'low';

interface Candidate {
  latitude: number;
  longitude: number;
  displayName: string;
  confidence: Confidence;
  query: string;
  matchedType: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  importance?: number;
  addresstype?: string;
}

/**
 * Place types that mean "we found the actual building", as opposed to
 * "we found the neighbourhood it is in".
 */
const PRECISE_TYPES = new Set([
  'building', 'apartments', 'residential', 'house', 'yes', 'construction',
  'commercial', 'retail', 'neighbourhood', 'quarter',
]);

const VAGUE_TYPES = new Set([
  'city', 'town', 'state', 'county', 'district', 'administrative', 'postcode',
]);

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '3');
  url.searchParams.set('addressdetails', '0');
  // Restricting to India removes a great deal of noise from generic names.
  url.searchParams.set('countrycodes', 'in');

  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });

  if (response.status === 429) {
    throw new HttpError(429, 'The free location service is busy. Please wait a minute and continue.');
  }
  if (!response.ok) {
    throw new HttpError(502, 'The location service did not respond. Please try again shortly.');
  }

  return (await response.json()) as NominatimResult[];
}

interface LeadForGeocoding {
  id: string;
  society_name: string;
  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

/**
 * Tries progressively less specific searches. The more we had to give up to
 * get a hit, the lower the confidence we report.
 */
function buildQueries(lead: LeadForGeocoding): Array<{ query: string; ceiling: Confidence }> {
  const { society_name, address, area, city, state, pincode } = lead;
  const place = [area, city, state].filter(Boolean).join(', ');
  const attempts: Array<{ query: string; ceiling: Confidence }> = [];

  if (place) {
    attempts.push({ query: `${society_name}, ${place}, India`, ceiling: 'high' });
  }
  if (address && city) {
    attempts.push({ query: `${society_name}, ${address}, ${city}, India`, ceiling: 'high' });
  }
  if (city) {
    attempts.push({ query: `${society_name}, ${city}, India`, ceiling: 'medium' });
  }
  if (address && city) {
    // No society name: this finds the street, not the building.
    attempts.push({ query: `${address}, ${city}, India`, ceiling: 'low' });
  }
  if (pincode && area) {
    attempts.push({ query: `${area}, ${pincode}, India`, ceiling: 'low' });
  }

  // Remove duplicates while keeping the best-first order.
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const key = a.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rank(result: NominatimResult, ceiling: Confidence): Confidence {
  const type = (result.type ?? result.addresstype ?? '').toLowerCase();

  // A result that is just "Bengaluru" is useless for finding a society.
  if (VAGUE_TYPES.has(type)) return 'low';
  if (PRECISE_TYPES.has(type)) return ceiling;

  // Anything else is a step below whatever the query could have earned.
  if (ceiling === 'high') return 'medium';
  return 'low';
}

async function findLocation(lead: LeadForGeocoding): Promise<Candidate | null> {
  for (const { query, ceiling } of buildQueries(lead)) {
    const results = await searchNominatim(query);
    const best = results[0];
    if (!best) continue;

    const latitude = Number(best.lat);
    const longitude = Number(best.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    return {
      latitude,
      longitude,
      displayName: best.display_name,
      confidence: rank(best, ceiling),
      query,
      matchedType: best.type ?? best.addresstype ?? 'unknown',
    };
  }
  return null;
}

interface Body {
  action?: 'pending' | 'next' | 'lookup' | 'accept' | 'reject';
  leadId?: string;
  latitude?: number;
  longitude?: number;
  displayName?: string;
  confidence?: Confidence;
  /** When true, only high-confidence matches are saved automatically. */
  highConfidenceOnly?: boolean;
}

const LEAD_FIELDS = 'id, society_name, address, area, city, state, pincode';

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    const admin = await requireAdmin(request);
    const body = await readJson<Body>(request);
    const db = supabaseAdmin();

    // ------------------------------------------------------------ PENDING
    if (body.action === 'pending') {
      const [missing, geocoded, review] = await Promise.all([
        db.from('leads').select('id', { count: 'exact', head: true }).is('latitude', null),
        db
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('location_source', 'geocoded'),
        db.from('leads').select('id', { count: 'exact', head: true }).eq('needs_review', true),
      ]);

      return json({
        missing: missing.count ?? 0,
        geocoded: geocoded.count ?? 0,
        needsReview: review.count ?? 0,
        provider: PROVIDER,
      });
    }

    // ------------------------------------------------------------- LOOKUP
    // Looks a specific lead up and returns the result WITHOUT saving it.
    if (body.action === 'lookup') {
      if (!body.leadId) throw new HttpError(400, 'Which lead should be looked up?');

      const { data: lead } = await db
        .from('leads')
        .select(LEAD_FIELDS)
        .eq('id', body.leadId)
        .maybeSingle();

      if (!lead) throw new HttpError(404, 'That lead no longer exists.');

      const candidate = await findLocation(lead as LeadForGeocoding);
      return json({ lead: { id: lead.id, society_name: lead.society_name }, candidate });
    }

    // --------------------------------------------------------------- NEXT
    // Finds the next lead without a location, looks it up, and saves the
    // result if it is trustworthy enough.
    if (body.action === 'next') {
      const { data: lead } = await db
        .from('leads')
        .select(LEAD_FIELDS)
        .is('latitude', null)
        // Never retry one we already tried and failed on in this pass.
        .is('geocoded_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!lead) return json({ done: true });

      const typed = lead as LeadForGeocoding;
      let candidate: Candidate | null = null;
      let failure: string | null = null;

      try {
        candidate = await findLocation(typed);
      } catch (error) {
        // A rate limit or outage should pause the loop, not poison the lead.
        if (error instanceof HttpError && (error.status === 429 || error.status === 502)) {
          throw error;
        }
        failure = 'The location service could not be reached.';
      }

      const now = new Date().toISOString();

      if (!candidate) {
        // Record the attempt so the loop moves on, and flag it for a human.
        await db
          .from('leads')
          .update({
            geocoded_at: now,
            geocode_query: buildQueries(typed)[0]?.query ?? typed.society_name,
            needs_review: true,
            review_reason:
              failure ?? 'No location could be found automatically - please enter it by hand',
          })
          .eq('id', typed.id);

        return json({
          done: false,
          lead: { id: typed.id, society_name: typed.society_name },
          candidate: null,
          saved: false,
          reason: failure ?? 'not_found',
        });
      }

      const autoSave = body.highConfidenceOnly ? candidate.confidence === 'high' : true;

      if (autoSave) {
        await db
          .from('leads')
          .update({
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            location_source: 'geocoded',
            location_confidence: candidate.confidence,
            geocoded_at: now,
            geocode_query: candidate.query,
            geocode_display_name: candidate.displayName,
            // A high-confidence hit clears the flag. Anything less stays in
            // the review queue, because an estimate is not a fact.
            needs_review: candidate.confidence !== 'high',
            review_reason:
              candidate.confidence === 'high'
                ? null
                : `Location was estimated (${candidate.confidence} confidence) - please confirm`,
          })
          .eq('id', typed.id);
      } else {
        await db
          .from('leads')
          .update({
            geocoded_at: now,
            geocode_query: candidate.query,
            geocode_display_name: candidate.displayName,
            needs_review: true,
            review_reason: `A ${candidate.confidence}-confidence match was found - please confirm it`,
          })
          .eq('id', typed.id);
      }

      return json({
        done: false,
        lead: { id: typed.id, society_name: typed.society_name },
        candidate,
        saved: autoSave,
      });
    }

    // ------------------------------------------------------------- ACCEPT
    if (body.action === 'accept') {
      const { leadId, latitude, longitude } = body;
      if (!leadId || typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new HttpError(400, 'A lead and a pair of coordinates are required.');
      }
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
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
