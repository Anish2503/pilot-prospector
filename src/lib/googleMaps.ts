/**
 * Reading coordinates out of Google Maps links.
 *
 * A spreadsheet of societies almost always carries a Maps link per row, and it
 * is the strongest location signal available - far better than geocoding a
 * society name. This file turns those links into latitude/longitude.
 *
 * Nothing here touches the network. Links that need a redirect followed are
 * identified as such and handed to netlify/functions/resolve-maps-url.ts, which
 * is the only place allowed to fetch them.
 */

// -----------------------------------------------------------------------------
// WHAT COUNTS AS A GOOGLE MAPS LINK
//
// Also the SSRF whitelist. The server refuses to fetch anything whose host is
// not on this list - at every redirect hop, not just the first.
// -----------------------------------------------------------------------------

/** Hosts that can carry a full Maps URL. */
const MAPS_HOSTS = [
  'google.com',
  'www.google.com',
  'maps.google.com',
  'www.maps.google.com',
];

/** Hosts that only ever produce a redirect to one of the above. */
const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'www.goo.gl', 'g.co', 'maps.app.google.com'];

/** google.co.in, google.co.uk, google.de and so on. */
const COUNTRY_HOST = /^(www\.|maps\.)?google\.([a-z]{2,3})(\.[a-z]{2})?$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isMapsHost(host: string): boolean {
  if (MAPS_HOSTS.includes(host)) return true;
  return COUNTRY_HOST.test(host);
}

function isShortHost(host: string): boolean {
  return SHORT_HOSTS.includes(host);
}

/** True for any host we are willing to fetch, at any redirect hop. */
export function isAllowedMapsHost(host: string): boolean {
  return isMapsHost(host) || isShortHost(host);
}

/** True if this looks like a Google Maps link of any shape. */
export function isGoogleMapsUrl(value: string): boolean {
  const host = hostOf(value);
  if (!host) return false;

  if (isShortHost(host)) return true;

  // A bare google.com link is only a Maps link if the path says so.
  if (isMapsHost(host)) {
    try {
      const { pathname, searchParams } = new URL(value);
      return (
        pathname.startsWith('/maps') ||
        pathname.startsWith('/local') ||
        searchParams.has('ll') ||
        (pathname === '/' && searchParams.has('q'))
      );
    } catch {
      return false;
    }
  }

  return false;
}

/** True if the link must be followed before it can yield coordinates. */
export function isShortMapsUrl(value: string): boolean {
  const host = hostOf(value);
  return host !== null && isShortHost(host);
}

// -----------------------------------------------------------------------------
// PULLING COORDINATES OUT OF A URL
// -----------------------------------------------------------------------------

/**
 * How exactly the numbers pin down the society.
 *
 *  place    - the marker itself (!3d!4d, or an explicit q=lat,lng). Best.
 *  viewport - where the map was centred (@lat,lng). Usually right on top of
 *             the place, but it is the camera, not the pin.
 */
export type CoordinatePrecision = 'place' | 'viewport';

export interface ExtractedCoordinates {
  latitude: number;
  longitude: number;
  precision: CoordinatePrecision;
  /** Which pattern matched - useful when diagnosing an odd row. */
  pattern: string;
}

const LAT = -90;
const LAT_MAX = 90;
const LNG = -180;
const LNG_MAX = 180;

/** Rejects out-of-range values and the null island, which is never a society. */
export function isPlausibleCoordinate(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < LAT || latitude > LAT_MAX) return false;
  if (longitude < LNG || longitude > LNG_MAX) return false;
  // 0,0 is in the Atlantic. It means "the URL had no real coordinates".
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) return false;
  return true;
}

/** Roughly the bounding box of India, used only to flag surprises. */
export function looksLikeIndia(latitude: number, longitude: number): boolean {
  return latitude >= 6 && latitude <= 37.5 && longitude >= 68 && longitude <= 97.5;
}

/**
 * Decodes a URL that may have been escaped once or twice by Excel or by
 * whoever pasted it. Safe to call on an already-clean URL.
 */
function decodeTwice(value: string): string {
  let out = value;
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9a-f]{2}/i.test(out)) break;
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * The patterns, in order of how well they identify the actual place.
 *
 * !3d!4d wins because Google puts the marker's true position there. The @
 * pattern is the map camera, which is usually - but not always - the same spot.
 */
const PATTERNS: Array<{
  name: string;
  precision: CoordinatePrecision;
  regex: RegExp;
}> = [
  // .../data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d12.9715987!4d77.5945627
  { name: '!3d!4d', precision: 'place', regex: /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/ },
  // ?q=12.9715987,77.5945627   /   ?query=...   /   ?destination=...
  {
    name: 'q/query/destination',
    precision: 'place',
    regex: /[?&](?:q|query|destination|daddr)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i,
  },
  // ?ll=12.97,77.59  /  ?center=12.97,77.59  /  ?sll=...
  {
    name: 'll/center',
    precision: 'place',
    regex: /[?&](?:ll|sll|center|cbll)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i,
  },
  // /maps/place/Some+Name/@12.9715987,77.5945627,17z
  { name: '@lat,lng', precision: 'viewport', regex: /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/ },
  // /maps/12.97,77.59  - occasionally seen in older exports
  { name: 'path pair', precision: 'viewport', regex: /\/maps\/(-?\d+\.\d+),(-?\d+\.\d+)/ },
];

/**
 * Reads coordinates straight out of a Maps URL. No network.
 * Returns null when the URL carries none - which is normal for a short link.
 */
export function extractCoordinatesFromUrl(rawUrl: string): ExtractedCoordinates | null {
  if (!rawUrl) return null;

  const url = decodeTwice(String(rawUrl).trim());
  if (!url) return null;

  for (const { name, precision, regex } of PATTERNS) {
    const match = url.match(regex);
    if (!match) continue;

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);

    if (!isPlausibleCoordinate(latitude, longitude)) continue;

    return { latitude, longitude, precision, pattern: name };
  }

  return null;
}

// -----------------------------------------------------------------------------
// CLASSIFYING A CELL
// -----------------------------------------------------------------------------

export type MapsUrlStatus =
  | 'empty'
  | 'not_a_url'
  | 'not_google_maps'
  | 'has_coordinates'
  | 'needs_resolving'
  | 'no_coordinates';

export interface MapsUrlAssessment {
  status: MapsUrlStatus;
  /** The cleaned URL, when the cell held one. */
  url: string | null;
  coordinates: ExtractedCoordinates | null;
}

/**
 * Works out what a single Google Maps cell gives us, without any network calls.
 *
 * `needs_resolving` means the link is a real Google short link whose redirect
 * has to be followed - that happens later, on the server.
 */
export function assessMapsUrl(value: unknown): MapsUrlAssessment {
  const none: MapsUrlAssessment = { status: 'empty', url: null, coordinates: null };

  if (value === null || value === undefined) return none;

  const text = String(value).trim();
  if (!text) return none;

  // A HYPERLINK() formula left behind as text. Pull the first quoted argument
  // out rather than stripping from both ends - a URL is full of commas and
  // quotes of its own, and trimming around them silently truncated the
  // coordinates.
  const formula = text.match(/^=?\s*HYPERLINK\(\s*"([^"]+)"/i);
  if (formula) return assessMapsUrl(formula[1]);

  // Otherwise just drop any quotes wrapping the whole value.
  const cleaned = text.replace(/^["']+|["']+$/g, '').trim();

  if (!/^https?:\/\//i.test(cleaned)) {
    // A bare "maps.app.goo.gl/xyz" with no scheme is still usable.
    if (/^(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|google\.[a-z.]+\/maps)/i.test(cleaned)) {
      return assessMapsUrl('https://' + cleaned);
    }
    return { status: 'not_a_url', url: null, coordinates: null };
  }

  if (!isGoogleMapsUrl(cleaned)) {
    return { status: 'not_google_maps', url: cleaned, coordinates: null };
  }

  const coordinates = extractCoordinatesFromUrl(cleaned);
  if (coordinates) {
    return { status: 'has_coordinates', url: cleaned, coordinates };
  }

  if (isShortMapsUrl(cleaned)) {
    return { status: 'needs_resolving', url: cleaned, coordinates: null };
  }

  // A full Maps URL with no coordinates in it - e.g. /maps/place/Some+Name
  // with no @ segment. Following it usually fills them in.
  return { status: 'no_coordinates', url: cleaned, coordinates: null };
}
