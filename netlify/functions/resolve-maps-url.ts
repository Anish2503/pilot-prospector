/**
 * Following shortened Google Maps links.  POST /api/resolve-maps-url
 *
 * A maps.app.goo.gl link carries no coordinates - it is only a redirect. This
 * function follows it and reads the coordinates out of wherever it lands.
 *
 * SECURITY - this endpoint takes URLs from a spreadsheet and fetches them, so
 * it is exactly the shape of a server-side request forgery hole. Three things
 * prevent that:
 *
 *   1. Only hosts on the Google Maps whitelist are fetched. Anything else is
 *      rejected before a request is made.
 *   2. Redirects are followed MANUALLY, and every hop is checked against the
 *      same whitelist. An open redirect on Google's side cannot be used to
 *      point us at an internal address.
 *   3. Only admins may call it at all, with a short timeout and a small cap on
 *      how many URLs one request may carry.
 *
 * We never read the page body - only the Location header and the final URL. No
 * scraping of any kind.
 */

import {
  assertMethod,
  errorResponse,
  HttpError,
  json,
  readJson,
  requireAdmin,
} from './_shared.ts';
import {
  extractCoordinatesFromUrl,
  isAllowedMapsHost,
  type ExtractedCoordinates,
} from '../../src/lib/googleMaps.ts';

/** URLs per request. The browser sends them in batches of this size. */
const MAX_URLS = 30;

/** Simultaneous fetches. Enough to be quick, gentle enough not to be rude. */
const CONCURRENCY = 6;

/** A Maps short link normally lands in one or two hops. */
const MAX_HOPS = 6;

const TIMEOUT_MS = 8000;

export type ResolveOutcome =
  | 'resolved'
  | 'resolved_no_coordinates'
  | 'not_allowed'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'failed';

export interface ResolveResult {
  url: string;
  outcome: ResolveOutcome;
  resolvedUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: ExtractedCoordinates['precision'] | null;
  /** Safe to show an admin. Never a raw technical error. */
  message?: string;
}

function failure(url: string, outcome: ResolveOutcome, message: string): ResolveResult {
  return {
    url,
    outcome,
    resolvedUrl: null,
    latitude: null,
    longitude: null,
    precision: null,
    message,
  };
}

/**
 * Follows one short link, checking every hop.
 * Reads headers only - the response body is never downloaded.
 */
async function resolveOne(rawUrl: string): Promise<ResolveResult> {
  let current: string;
  try {
    current = new URL(rawUrl.trim()).toString();
  } catch {
    return failure(rawUrl, 'not_allowed', 'That does not look like a web address.');
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let host: string;
    try {
      host = new URL(current).hostname.toLowerCase();
    } catch {
      return failure(rawUrl, 'failed', 'The link could not be followed.');
    }

    // Re-checked on EVERY hop, not just the first.
    if (!isAllowedMapsHost(host)) {
      return failure(rawUrl, 'not_allowed', 'That link does not point to Google Maps.');
    }

    // Coordinates may appear part-way through the chain.
    const found = extractCoordinatesFromUrl(current);
    if (found) {
      return {
        url: rawUrl,
        outcome: 'resolved',
        resolvedUrl: current,
        latitude: found.latitude,
        longitude: found.longitude,
        precision: found.precision,
      };
    }

    let response: Response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Google hands a mobile client the coordinate-bearing URL more readily.
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
          'Accept-Language': 'en-IN,en;q=0.9',
        },
      });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return failure(rawUrl, 'timeout', 'Google Maps did not respond in time.');
      }
      return failure(rawUrl, 'failed', 'The link could not be reached.');
    }

    if (response.status === 429) {
      return failure(rawUrl, 'rate_limited', 'Google is asking us to slow down.');
    }
    if (response.status === 404 || response.status === 410) {
      return failure(rawUrl, 'not_found', 'That Google Maps link no longer exists.');
    }

    const location = response.headers.get('location');

    if (location) {
      // A relative Location header resolves against the current URL.
      try {
        current = new URL(location, current).toString();
      } catch {
        return failure(rawUrl, 'failed', 'The link could not be followed.');
      }
      continue;
    }

    // No redirect left. `response.url` is where we ended up.
    const finalUrl = response.url || current;
    const coordinates = extractCoordinatesFromUrl(finalUrl);

    if (coordinates) {
      return {
        url: rawUrl,
        outcome: 'resolved',
        resolvedUrl: finalUrl,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        precision: coordinates.precision,
      };
    }

    return {
      url: rawUrl,
      outcome: 'resolved_no_coordinates',
      resolvedUrl: finalUrl,
      latitude: null,
      longitude: null,
      precision: null,
      message: 'The link opened, but carried no coordinates.',
    };
  }

  return failure(rawUrl, 'failed', 'That link redirected too many times.');
}

/** Runs the jobs a few at a time rather than all at once. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(worker))));
  }
  return results;
}

interface Body {
  urls?: string[];
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    await requireAdmin(request);

    const body = await readJson<Body>(request);
    const urls = Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string') : [];

    if (urls.length === 0) return json({ results: [] });
    if (urls.length > MAX_URLS) {
      throw new HttpError(400, `At most ${MAX_URLS} links can be resolved in one request.`);
    }

    // The same link often appears on several rows; resolve it once.
    const unique = [...new Set(urls.map((u) => u.trim()))];
    const resolved = await inBatches(unique, CONCURRENCY, resolveOne);

    const byUrl = new Map(resolved.map((r) => [r.url.trim(), r]));
    const results = urls.map(
      (u) => byUrl.get(u.trim()) ?? failure(u, 'failed', 'The link could not be followed.'),
    );

    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
