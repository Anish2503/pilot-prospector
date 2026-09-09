/**
 * Reads .xlsx / .xls / .csv files and works out what each column means.
 *
 * The file is read entirely inside the browser. Nothing is sent anywhere until
 * you have seen the preview and pressed Import, so a wrong file costs nothing.
 */

import * as XLSX from 'xlsx';
import {
  assessMapsUrl,
  isPlausibleCoordinate,
  type CoordinatePrecision,
  type MapsUrlStatus,
} from './googleMaps';

// -----------------------------------------------------------------------------
// The fields we can fill from a spreadsheet
// -----------------------------------------------------------------------------

export type LeadField =
  | 'society_name'
  | 'total_units'
  | 'address'
  | 'area'
  | 'city'
  | 'state'
  | 'pincode'
  | 'latitude'
  | 'longitude'
  | 'coordinates'
  | 'google_maps_url'
  | 'source';

export const FIELD_LABELS: Record<LeadField, string> = {
  society_name: 'Society name',
  total_units: 'Total units',
  address: 'Address',
  area: 'Area / Locality',
  city: 'City',
  state: 'State',
  pincode: 'Pincode',
  latitude: 'Latitude',
  longitude: 'Longitude',
  coordinates: 'Latitude & Longitude together',
  google_maps_url: 'Google Maps URL',
  source: 'Source',
};

export const REQUIRED_FIELDS: LeadField[] = ['society_name'];

/**
 * Header names we recognise. Matching ignores case, spaces and punctuation, so
 * "Society Name", "society_name" and "SOCIETY-NAME" all land in the same place.
 */
const FIELD_SYNONYMS: Record<LeadField, string[]> = {
  society_name: [
    'societyname', 'society', 'apartmentname', 'apartment', 'propertyname', 'property',
    'buildingname', 'building', 'projectname', 'project', 'communityname', 'community',
    'complexname', 'complex', 'name', 'societyapartmentname', 'nameofsociety',
    'nameofthesociety', 'societyapartment', 'leadname', 'clientname', 'towername',
  ],
  total_units: [
    'totalunits', 'units', 'numberofunits', 'noofunits', 'nounits', 'unitcount',
    'totalapartments', 'apartments', 'totalflats', 'flats', 'noofflats', 'nooflfats',
    'totalhomes', 'homes', 'doors', 'totaldoors', 'households', 'noofhouses', 'houses',
    'size', 'unitsize', 'totalunit', 'noofdoors',
  ],
  address: [
    'address', 'fulladdress', 'addressline', 'addressline1', 'streetaddress', 'street',
    'addr', 'completeaddress', 'societyaddress',
  ],
  area: [
    'area', 'locality', 'sublocality', 'neighbourhood', 'neighborhood', 'zone', 'region',
    'micromarket', 'localityarea', 'areaname', 'sector', 'ward',
  ],
  city: ['city', 'cityname', 'town', 'district', 'citytown', 'cty'],
  state: ['state', 'statename', 'province', 'region'],
  pincode: ['pincode', 'pin', 'postalcode', 'postcode', 'zip', 'zipcode', 'pincodezip'],
  latitude: ['latitude', 'lat', 'latitudes', 'ycoordinate', 'ycoord'],
  longitude: ['longitude', 'long', 'lng', 'lon', 'longitudes', 'xcoordinate', 'xcoord'],
  coordinates: [
    'coordinates', 'coordinate', 'latlong', 'latlng', 'latitudelongitude', 'geo',
    'geolocation', 'geocode', 'latlon', 'gps',
  ],
  google_maps_url: [
    'googlemapslink', 'googlemaplink', 'googlemapsurl', 'googlemapurl', 'googlemaps',
    'googlemap', 'mapslink', 'mapsurl', 'maplink', 'mapurl', 'locationlink',
    'locationurl', 'googlelocation', 'googlelocationlink', 'addresslink', 'gmaplink',
    'gmapslink', 'gmap', 'gmaps', 'maps', 'map', 'locationonmap', 'mapslocation',
    'googlepin', 'pinlocation', 'locationpin', 'googlemapslocation', 'mapsloc',
  ],
  source: ['source', 'leadsource', 'datasource', 'origin', 'channel'],
};

/** Strips case, spaces and punctuation so header variants collapse together. */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

/**
 * Hyperlinks found in the sheet, as header -> (spreadsheet row number -> URL).
 *
 * WHY THIS EXISTS: a cell can display the words "Google Maps" while the real
 * link hides underneath. SheetJS keeps that in `cell.l.Target`, but
 * sheet_to_json only ever returns the visible text - so without this, the most
 * common way of storing a Maps link in Excel is invisible to the importer.
 */
export type HyperlinkIndex = Map<string, Map<number, string>>;

export interface ParsedSheet {
  /** Column headings exactly as they appear in the file. */
  headers: string[];
  /** Every data row, keyed by heading. */
  rows: Array<Record<string, unknown>>;
  /** Links hiding behind cell text. */
  hyperlinks: HyperlinkIndex;
  sheetNames: string[];
  activeSheet: string;
  filename: string;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_ROWS = 50_000;

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'Please choose an Excel file (.xlsx or .xls) or a CSV file.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB — try splitting it into smaller files.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/**
 * Walks the raw sheet looking for cells that carry a hyperlink, and records
 * them against the column heading and spreadsheet row they belong to.
 */
function collectHyperlinks(sheet: XLSX.WorkSheet): HyperlinkIndex {
  const index: HyperlinkIndex = new Map();
  const ref = sheet['!ref'];
  if (!ref) return index;

  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    return index;
  }

  // Row 0 holds the headings, matching what sheet_to_json assumes.
  const headerByColumn = new Map<number, string>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })] as XLSX.CellObject | undefined;
    const heading =
      cell?.v === undefined || cell?.v === null ? '' : String(cell.v).trim();
    if (heading) headerByColumn.set(c, heading);
  }

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const heading = headerByColumn.get(c);
      if (!heading) continue;

      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const target = cell?.l?.Target;
      if (!target) continue;

      if (!index.has(heading)) index.set(heading, new Map());
      // +1 because SheetJS rows are 0-based and spreadsheets are 1-based.
      index.get(heading)!.set(r + 1, String(target));
    }
  }

  return index;
}

export async function parseSpreadsheet(file: File, sheetName?: string): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();

  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    // We never evaluate formulas, only read their cached results. This removes
    // a whole class of spreadsheet-based attacks.
    cellFormula: false,
    cellHTML: false,
  });

  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) throw new Error('That file contains no sheets.');

  const active = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]!;
  const sheet = workbook.Sheets[active];
  if (!sheet) throw new Error(`Could not read the sheet "${active}".`);

  // defval keeps blank cells present so column positions never shift.
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    blankrows: false,
  });

  if (raw.length === 0) throw new Error('That sheet has no data rows.');
  if (raw.length > MAX_ROWS) {
    throw new Error(
      `That sheet has ${raw.length.toLocaleString('en-IN')} rows. The limit is ${MAX_ROWS.toLocaleString('en-IN')} per file.`,
    );
  }

  // Collect headers in first-seen order, ignoring SheetJS's blank-column names.
  const headers: string[] = [];
  for (const row of raw) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key) && !/^__EMPTY/.test(key)) headers.push(key);
    }
  }

  return {
    headers,
    rows: raw,
    hyperlinks: collectHyperlinks(sheet),
    sheetNames,
    activeSheet: active,
    filename: file.name,
  };
}

// -----------------------------------------------------------------------------
// Guessing which column is which
// -----------------------------------------------------------------------------

export type ColumnMapping = Partial<Record<LeadField, string>>;

/**
 * Matches each spreadsheet column to a field. An exact synonym match wins; a
 * partial one is accepted only if nothing better was found.
 */
export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<string>();

  const score = (header: string, field: LeadField): number => {
    const normalized = normalizeHeader(header);
    if (!normalized) return 0;
    const synonyms = FIELD_SYNONYMS[field];

    if (synonyms.includes(normalized)) return 100;
    // "societynameenglish" contains "societyname"
    for (const synonym of synonyms) {
      if (synonym.length >= 4 && normalized.includes(synonym)) {
        return 60 + synonym.length;
      }
    }
    return 0;
  };

  // Specific fields first, so a column called "Name" does not steal
  // "Society Name" and a generic "location" does not beat a real "address".
  // google_maps_url comes early so a "Map Link" column is not swallowed by
  // something vaguer.
  const order: LeadField[] = [
    'society_name', 'google_maps_url', 'total_units', 'latitude', 'longitude',
    'coordinates', 'pincode', 'city', 'area', 'state', 'address', 'source',
  ];

  for (const field of order) {
    let best: { header: string; score: number } | null = null;

    for (const header of headers) {
      if (claimed.has(header)) continue;
      const value = score(header, field);
      if (value > 0 && (!best || value > best.score)) best = { header, score: value };
    }

    if (best) {
      mapping[field] = best.header;
      claimed.add(best.header);
    }
  }

  // A combined coordinates column is redundant if both parts were found.
  if (mapping.latitude && mapping.longitude) delete mapping.coordinates;

  return mapping;
}

/**
 * Looks for a column whose CONTENTS are Google Maps links, whatever it is
 * called. Catches a column headed "Link", "Location" or something unhelpful.
 */
export function detectMapsColumnByContent(parsed: ParsedSheet): string | null {
  const sample = parsed.rows.slice(0, 40);
  let best: { header: string; hits: number } | null = null;

  for (const header of parsed.headers) {
    let hits = 0;
    let seen = 0;

    for (let i = 0; i < sample.length; i++) {
      const hyperlink = parsed.hyperlinks.get(header)?.get(i + 2);
      const value = hyperlink ?? sample[i]![header];
      if (value === null || value === undefined || String(value).trim() === '') continue;

      seen++;
      const status = assessMapsUrl(value).status;
      if (
        status === 'has_coordinates' ||
        status === 'needs_resolving' ||
        status === 'no_coordinates'
      ) {
        hits++;
      }
    }

    // Most of the filled cells in that column have to be Maps links.
    if (seen >= 2 && hits / seen >= 0.6 && (!best || hits > best.hits)) {
      best = { header, hits };
    }
  }

  return best?.header ?? null;
}

// -----------------------------------------------------------------------------
// Cleaning individual values
// -----------------------------------------------------------------------------

function cleanText(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text || text === '-' || text === '--') return null;

  // Spreadsheets are full of these placeholders.
  if (/^(n\/?a|nil|none|null|undefined|not available|unknown|tbd|\?+)$/i.test(text)) return null;

  // Remove control characters that would corrupt a later CSV export.
  text = text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

  return text ? text.slice(0, maxLength) : null;
}

/** Handles "1,200", "420 units", "1200.0" and plain numbers. */
export function parseUnits(value: unknown): { value: number | null; issue?: string } {
  if (value === null || value === undefined || value === '') return { value: null };

  const text = String(value).trim();
  if (!text) return { value: null };

  const digits = text.replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  if (!digits) return { value: null, issue: `Could not read "${text}" as a number of units` };

  const parsed = Number(digits[0]);
  if (!Number.isFinite(parsed)) {
    return { value: null, issue: `Could not read "${text}" as a number of units` };
  }
  if (parsed < 0) return { value: null, issue: 'Unit count cannot be negative' };
  if (parsed > 100_000) {
    return { value: null, issue: `${Math.round(parsed)} units looks wrong — please check` };
  }

  return { value: Math.round(parsed) };
}

/** Accepts numbers, strings, and degree-symbol formats. */
function parseCoordinate(value: unknown, kind: 'lat' | 'lng'): number | null {
  if (value === null || value === undefined || value === '') return null;

  const text = String(value).trim().replace(/[°\s]/g, '');
  if (!text) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed === 0) return null;

  const limit = kind === 'lat' ? 90 : 180;
  if (Math.abs(parsed) > limit) return null;

  return parsed;
}

/** Splits "12.9716, 77.5946" into its two halves. */
function parseCoordinatePair(value: unknown): { lat: number | null; lng: number | null } {
  if (value === null || value === undefined) return { lat: null, lng: null };

  const parts = String(value).split(/[,;|]/);
  if (parts.length < 2) return { lat: null, lng: null };

  return {
    lat: parseCoordinate(parts[0], 'lat'),
    lng: parseCoordinate(parts[1], 'lng'),
  };
}

// -----------------------------------------------------------------------------
// Where a row's coordinates came from
// -----------------------------------------------------------------------------

/**
 * Matches the values allowed by leads.location_source in the database.
 * The order here IS the priority order used when resolving a row.
 */
export type LocationOrigin =
  | 'uploaded' // 1. latitude/longitude columns in the sheet
  | 'google_maps_url' // 2. coordinates read straight out of the link
  | 'google_maps_redirect' // 3. coordinates after following a short link
  | 'geocoded' // 4. looked up from the address
  | 'unknown'; // 5. nothing reliable - needs review

export const ORIGIN_LABELS: Record<LocationOrigin, string> = {
  uploaded: 'From spreadsheet coordinates',
  google_maps_url: 'From Google Maps link',
  google_maps_redirect: 'From Google Maps link (followed)',
  geocoded: 'Looked up from address',
  unknown: 'Needs review',
};

/** Result of following one short link. */
export interface ResolvedLink {
  latitude: number | null;
  longitude: number | null;
  resolvedUrl: string | null;
  precision: CoordinatePrecision | null;
  message?: string;
}

/** Results keyed by the original URL. */
export type ResolvedLinks = Map<string, ResolvedLink>;

// -----------------------------------------------------------------------------
// Turning a spreadsheet row into a lead
// -----------------------------------------------------------------------------

export interface PreparedRow {
  /** 1-based row number as shown in Excel, so errors can be found easily. */
  rowNumber: number;
  society_name: string;
  total_units: number | null;
  address: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string | null;

  /** The Maps link exactly as it appeared (hyperlink preferred over text). */
  google_maps_url: string | null;
  /** Where the link ended up, when we had to follow it. */
  resolved_maps_url: string | null;
  maps_url_status: MapsUrlStatus;

  location_origin: LocationOrigin;
  location_confidence: 'high' | 'medium' | 'low' | 'unverified';
  /** True when this row still needs a short link followed. */
  needs_link_resolution: boolean;

  /** Reasons this row cannot be imported at all. */
  errors: string[];
  /** Things worth knowing, but which do not block the import. */
  warnings: string[];
  /** True when this exact society appears earlier in the same file. */
  duplicateOfRow?: number;
}

export interface LocationCounts {
  fromUploadedCoordinates: number;
  fromMapsUrl: number;
  fromMapsRedirect: number;
  needsResolving: number;
  invalidUrl: number;
  noLocation: number;
  located: number;
}

export interface PreparedFile {
  rows: PreparedRow[];
  validRows: PreparedRow[];
  errorRows: PreparedRow[];
  duplicateRows: PreparedRow[];
  counts: {
    total: number;
    valid: number;
    errors: number;
    duplicatesInFile: number;
    missingLocation: number;
    missingUnits: number;
    missingName: number;
    withWarnings: number;
  };
  location: LocationCounts;
  /** Distinct short links still to be followed. */
  unresolvedUrls: string[];
}

function normalizeForComparison(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function prepareRows(
  parsed: ParsedSheet,
  mapping: ColumnMapping,
  resolvedLinks?: ResolvedLinks,
): PreparedFile {
  const rows: PreparedRow[] = [];
  const seen = new Map<string, number>();
  const unresolved = new Set<string>();

  const location: LocationCounts = {
    fromUploadedCoordinates: 0,
    fromMapsUrl: 0,
    fromMapsRedirect: 0,
    needsResolving: 0,
    invalidUrl: 0,
    noLocation: 0,
    located: 0,
  };

  parsed.rows.forEach((raw, index) => {
    // +2: one for the header row, one because spreadsheets count from 1.
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const get = (field: LeadField): unknown => (mapping[field] ? raw[mapping[field]!] : null);

    // ------------------------------------------------------------- Name
    const society_name = cleanText(get('society_name'), 250);
    if (!society_name) errors.push('Society name is missing');
    else if (society_name.length < 2) errors.push('Society name is too short');

    // ------------------------------------------------------------ Units
    const units = parseUnits(get('total_units'));
    if (units.issue) warnings.push(units.issue);

    // --------------------------------------------------------- Address
    const address = cleanText(get('address'));
    const area = cleanText(get('area'), 120);
    const city = cleanText(get('city'), 120);
    const state = cleanText(get('state'), 120);

    const pincodeRaw = cleanText(get('pincode'), 20);
    const pincode = pincodeRaw?.replace(/\D/g, '') || null;
    if (pincodeRaw && pincode && pincode.length !== 6) {
      warnings.push(`Pincode "${pincodeRaw}" is not 6 digits`);
    }

    // ================================================================
    // LOCATION - strictly in priority order.
    // A better source is never replaced by a worse one.
    // ================================================================

    // --- Priority 1: coordinates given in the sheet.
    let latitude = parseCoordinate(get('latitude'), 'lat');
    let longitude = parseCoordinate(get('longitude'), 'lng');

    if ((latitude === null || longitude === null) && mapping.coordinates) {
      const pair = parseCoordinatePair(get('coordinates'));
      latitude = latitude ?? pair.lat;
      longitude = longitude ?? pair.lng;
    }

    // A half-pair is meaningless, and worse than none at all.
    if ((latitude === null) !== (longitude === null)) {
      warnings.push('Only one of latitude/longitude was readable, so both were ignored');
      latitude = null;
      longitude = null;
    }

    let origin: LocationOrigin = 'unknown';
    let confidence: PreparedRow['location_confidence'] = 'unverified';

    if (latitude !== null && longitude !== null) {
      if (isPlausibleCoordinate(latitude, longitude)) {
        origin = 'uploaded';
        confidence = 'high';
      } else {
        warnings.push('The coordinates in the sheet are not valid and were ignored');
        latitude = null;
        longitude = null;
      }
    }

    // --- The Google Maps cell. Prefer the hyperlink hiding behind the text.
    const mapsHeader = mapping.google_maps_url;
    const hyperlink = mapsHeader ? parsed.hyperlinks.get(mapsHeader)?.get(rowNumber) : undefined;
    const mapsCell = hyperlink ?? (mapsHeader ? raw[mapsHeader] : null);

    const assessment = assessMapsUrl(mapsCell);
    let google_maps_url = assessment.url;
    let resolved_maps_url: string | null = null;
    let needsResolution = false;

    if (mapsHeader) {
      if (assessment.status === 'not_a_url' && String(mapsCell ?? '').trim()) {
        warnings.push('The Google Maps cell does not contain a web address');
        location.invalidUrl++;
        google_maps_url = null;
      } else if (assessment.status === 'not_google_maps') {
        warnings.push('That link is not a Google Maps link');
        location.invalidUrl++;
      }
    }

    // --- Priority 2: coordinates inside the link itself.
    if (origin === 'unknown' && assessment.coordinates) {
      latitude = assessment.coordinates.latitude;
      longitude = assessment.coordinates.longitude;
      origin = 'google_maps_url';
      // The marker position is exact; the map centre is very close but is the
      // camera rather than the pin.
      confidence = assessment.coordinates.precision === 'place' ? 'high' : 'medium';
    }

    // --- Priority 3: follow a short link.
    if (
      origin === 'unknown' &&
      google_maps_url &&
      (assessment.status === 'needs_resolving' || assessment.status === 'no_coordinates')
    ) {
      const resolved = resolvedLinks?.get(google_maps_url);

      if (resolved && resolved.latitude !== null && resolved.longitude !== null) {
        latitude = resolved.latitude;
        longitude = resolved.longitude;
        resolved_maps_url = resolved.resolvedUrl;
        origin = 'google_maps_redirect';
        confidence = resolved.precision === 'place' ? 'high' : 'medium';
      } else if (resolved) {
        // We tried, and it gave us nothing usable.
        resolved_maps_url = resolved.resolvedUrl;
        warnings.push(resolved.message ?? 'That Google Maps link carried no coordinates');
      } else {
        needsResolution = true;
        unresolved.add(google_maps_url);
      }
    }

    // --- Tally.
    if (needsResolution) location.needsResolving++;
    else if (origin === 'uploaded') location.fromUploadedCoordinates++;
    else if (origin === 'google_maps_url') location.fromMapsUrl++;
    else if (origin === 'google_maps_redirect') location.fromMapsRedirect++;
    else location.noLocation++;

    if (origin !== 'unknown') location.located++;

    if (origin === 'unknown' && !needsResolution && !address && !area && !city) {
      warnings.push('No location details at all — this lead cannot be placed on the map');
    }

    const row: PreparedRow = {
      rowNumber,
      society_name: society_name ?? '',
      total_units: units.value,
      address,
      area,
      city,
      state,
      pincode,
      latitude,
      longitude,
      source: cleanText(get('source'), 120),
      google_maps_url,
      resolved_maps_url,
      maps_url_status: assessment.status,
      location_origin: origin,
      location_confidence: confidence,
      needs_link_resolution: needsResolution,
      errors,
      warnings,
    };

    // --------------------------------------------- Duplicates inside the file
    if (society_name) {
      const key = `${normalizeForComparison(society_name)}|${normalizeForComparison(city ?? '')}`;
      const firstSeenAt = seen.get(key);
      if (firstSeenAt !== undefined) row.duplicateOfRow = firstSeenAt;
      else seen.set(key, rowNumber);
    }

    rows.push(row);
  });

  const errorRows = rows.filter((r) => r.errors.length > 0);
  const duplicateRows = rows.filter((r) => r.errors.length === 0 && r.duplicateOfRow !== undefined);
  const validRows = rows.filter((r) => r.errors.length === 0 && r.duplicateOfRow === undefined);

  return {
    rows,
    validRows,
    errorRows,
    duplicateRows,
    counts: {
      total: rows.length,
      valid: validRows.length,
      errors: errorRows.length,
      duplicatesInFile: duplicateRows.length,
      missingLocation: validRows.filter((r) => r.latitude === null).length,
      missingUnits: validRows.filter((r) => r.total_units === null).length,
      missingName: rows.filter((r) => r.errors.includes('Society name is missing')).length,
      withWarnings: validRows.filter((r) => r.warnings.length > 0).length,
    },
    location,
    unresolvedUrls: [...unresolved],
  };
}

// -----------------------------------------------------------------------------
// Error report download
// -----------------------------------------------------------------------------

/**
 * Builds a CSV of every rejected row so the problems can be fixed in Excel and
 * re-uploaded. Values are escaped so a cell beginning with "=" cannot run as a
 * formula when the file is opened.
 */
export function buildIssueCsv(rows: PreparedRow[]): string {
  const header = ['Row in your file', 'Society name', 'City', 'Google Maps URL', 'Problem'];

  const escape = (value: string): string => {
    let text = value ?? '';
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [header.map(escape).join(',')];

  for (const row of rows) {
    const problems = [
      ...row.errors,
      ...row.warnings,
      row.duplicateOfRow ? `Duplicate of row ${row.duplicateOfRow}` : '',
    ]
      .filter(Boolean)
      .join('; ');

    lines.push(
      [
        String(row.rowNumber),
        row.society_name || '(blank)',
        row.city ?? '',
        row.google_maps_url ?? '',
        problems,
      ]
        .map(escape)
        .join(','),
    );
  }

  return lines.join('\r\n');
}
