/**
 * Spreadsheet import.  POST /api/import-leads
 *
 * The browser parses the file and shows you a preview. Only when you press
 * Import does it send the cleaned rows here, in batches, to be written.
 *
 * Actions:
 *   { action: 'start',  filename, totalRows, columnMapping }  -> { jobId }
 *   { action: 'batch',  jobId, rows, duplicateMode }          -> per-batch counts
 *   { action: 'finish', jobId }                               -> final totals
 *   { action: 'cancel', jobId }
 */

import {
  assertMethod,
  errorResponse,
  HttpError,
  json,
  logActivity,
  readJson,
  requireAdmin,
  supabaseAdmin,
} from './_shared.ts';

/** Big enough to be fast, small enough to stay well inside request limits. */
export const MAX_BATCH_ROWS = 500;

type DuplicateMode = 'skip' | 'update';

interface IncomingRow {
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
  google_maps_url: string | null;
  resolved_maps_url: string | null;
  /** Where the browser worked out the coordinates from. Re-validated below. */
  location_source: string | null;
}

/** Mirrors the CHECK constraint on leads.location_source. */
const LOCATION_SOURCES = new Set([
  'uploaded',
  'google_maps_url',
  'google_maps_redirect',
  'geocoded',
  'manual',
  'unknown',
]);

/**
 * The browser tells us where a row's coordinates came from, but a browser can
 * be tampered with - so the value is checked against the same list the database
 * enforces, and anything unexpected falls back to 'uploaded'.
 */
function locationSource(value: unknown, hasLocation: boolean): string {
  if (!hasLocation) return 'unknown';
  const text = typeof value === 'string' ? value : '';
  return LOCATION_SOURCES.has(text) && text !== 'unknown' ? text : 'uploaded';
}

interface Body {
  action?: 'start' | 'batch' | 'finish' | 'cancel';
  jobId?: string;
  filename?: string;
  totalRows?: number;
  columnMapping?: Record<string, string>;
  rows?: IncomingRow[];
  duplicateMode?: DuplicateMode;
}

/** Must match normalize_society_name() in the database exactly. */
function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function clean(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0 || Math.abs(parsed) > limit) return null;
  return parsed;
}

function unitCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) return null;
  return Math.round(parsed);
}

export default async function handler(request: Request): Promise<Response> {
  try {
    assertMethod(request, 'POST');
    const admin = await requireAdmin(request);
    const body = await readJson<Body>(request);
    const db = supabaseAdmin();

    // ============================================================== START
    if (body.action === 'start') {
      const filename = clean(body.filename, 260) ?? 'upload';
      const totalRows = Number(body.totalRows) || 0;

      const { data, error } = await db
        .from('import_jobs')
        .insert({
          filename,
          uploaded_by: admin.uid,
          status: 'importing',
          total_rows: totalRows,
          column_mapping: body.columnMapping ?? null,
        })
        .select('id')
        .single();

      if (error || !data) throw new HttpError(500, 'Could not start the import.');
      return json({ jobId: data.id });
    }

    // ============================================================== BATCH
    if (body.action === 'batch') {
      const jobId = body.jobId;
      const rows = body.rows ?? [];
      const duplicateMode: DuplicateMode = body.duplicateMode === 'update' ? 'update' : 'skip';

      if (!jobId) throw new HttpError(400, 'The import session was lost. Please start again.');
      if (rows.length === 0) return json({ inserted: 0, updated: 0, skipped: 0, failed: 0, issues: [] });
      if (rows.length > MAX_BATCH_ROWS) {
        throw new HttpError(400, `Batches are limited to ${MAX_BATCH_ROWS} rows.`);
      }

      const { data: job } = await db
        .from('import_jobs')
        .select('id, filename, status')
        .eq('id', jobId)
        .maybeSingle();

      if (!job) throw new HttpError(404, 'That import session no longer exists.');
      if (job.status === 'cancelled') throw new HttpError(409, 'This import was cancelled.');

      const issues: Array<{ row: number; message: string }> = [];

      // ---- Clean and validate every row again, server-side.
      // The browser already checked, but a browser can be tampered with.
      const candidates: Array<{ row: IncomingRow; name: string; key: string }> = [];

      for (const row of rows) {
        const name = clean(row.society_name, 250);
        if (!name || name.length < 2) {
          issues.push({ row: row.rowNumber, message: 'Society name is missing' });
          continue;
        }
        const city = clean(row.city, 120);
        candidates.push({
          row,
          name,
          key: `${normalizeName(name)}|${normalizeName(city ?? '')}`,
        });
      }

      if (candidates.length === 0) {
        return json({ inserted: 0, updated: 0, skipped: 0, failed: issues.length, issues });
      }

      // ---- One query finds every possible clash in this batch.
      const normalizedNames = [...new Set(candidates.map((c) => normalizeName(c.name)))];
      const { data: existing } = await db
        .from('leads')
        .select('id, society_name, normalized_name, city, total_units, latitude, longitude')
        .in('normalized_name', normalizedNames);

      const existingByKey = new Map<string, { id: string; total_units: number | null; latitude: number | null }>();
      for (const lead of existing ?? []) {
        const key = `${lead.normalized_name}|${normalizeName(lead.city ?? '')}`;
        if (!existingByKey.has(key)) {
          existingByKey.set(key, {
            id: lead.id,
            total_units: lead.total_units,
            latitude: lead.latitude,
          });
        }
      }

      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];
      let skipped = 0;

      for (const { row, name, key } of candidates) {
        const latitude = coordinate(row.latitude, 90);
        const longitude = coordinate(row.longitude, 180);
        const hasLocation = latitude !== null && longitude !== null;
        const units = unitCount(row.total_units);

        const shared = {
          society_name: name,
          total_units: units,
          units_source: units !== null ? 'uploaded' : 'unknown',
          units_confidence: units !== null ? 'medium' : 'unverified',
          address: clean(row.address),
          area: clean(row.area, 120),
          city: clean(row.city, 120),
          state: clean(row.state, 120),
          pincode: clean(row.pincode, 10),
          latitude: hasLocation ? latitude : null,
          longitude: hasLocation ? longitude : null,
          location_source: locationSource(row.location_source, hasLocation),
          location_confidence: hasLocation ? 'high' : 'unverified',
          google_maps_url: clean(row.google_maps_url, 2000),
          resolved_maps_url: clean(row.resolved_maps_url, 2000),
        };

        const match = existingByKey.get(key);

        if (match) {
          if (duplicateMode === 'skip') {
            skipped++;
            continue;
          }
          // Update mode: only fill gaps. Never overwrite something a BDM
          // confirmed on site with a number from a spreadsheet.
          const patch: Record<string, unknown> = {
            address: shared.address,
            area: shared.area,
            city: shared.city,
            state: shared.state,
            pincode: shared.pincode,
          };
          if (match.total_units === null && units !== null) {
            patch.total_units = units;
            patch.units_source = 'uploaded';
            patch.units_confidence = 'medium';
          }
          if (match.latitude === null && hasLocation) {
            patch.latitude = latitude;
            patch.longitude = longitude;
            patch.location_source = locationSource(row.location_source, true);
            patch.location_confidence = 'high';
          }
          if (shared.google_maps_url) {
            patch.google_maps_url = shared.google_maps_url;
            patch.resolved_maps_url = shared.resolved_maps_url;
          }
          toUpdate.push({ id: match.id, patch });
          continue;
        }

        toInsert.push({
          ...shared,
          source: clean(row.source, 120),
          source_file: job.filename,
          source_row: row.rowNumber,
          import_job_id: jobId,
          status: 'unassigned',
          // Flagged so it appears in the review queue and the geocoder picks it up.
          needs_review: !hasLocation,
          review_reason: hasLocation ? null : 'Location missing - needs geocoding or manual entry',
        });

        // Guard against the same society appearing twice within one batch.
        existingByKey.set(key, { id: 'pending', total_units: units, latitude });
      }

      // ---- Write.
      let inserted = 0;
      if (toInsert.length > 0) {
        const { data, error } = await db.from('leads').insert(toInsert).select('id');
        if (error) {
          // Fall back to one-at-a-time so a single bad row cannot lose the batch.
          for (const record of toInsert) {
            const { error: rowError } = await db.from('leads').insert(record);
            if (rowError) {
              issues.push({
                row: Number(record.source_row) || 0,
                message: rowError.message.slice(0, 160),
              });
            } else inserted++;
          }
        } else {
          inserted = data?.length ?? toInsert.length;
        }
      }

      let updated = 0;
      for (const { id, patch } of toUpdate) {
        const { error } = await db.from('leads').update(patch).eq('id', id);
        if (error) issues.push({ row: 0, message: `Could not update an existing lead` });
        else updated++;
      }

      // ---- Keep the running totals on the job row.
      const { data: current } = await db
        .from('import_jobs')
        .select('successful_rows, updated_rows, duplicate_rows, failed_rows, error_summary')
        .eq('id', jobId)
        .single();

      const previousIssues = Array.isArray(current?.error_summary) ? current.error_summary : [];

      await db
        .from('import_jobs')
        .update({
          successful_rows: (current?.successful_rows ?? 0) + inserted,
          updated_rows: (current?.updated_rows ?? 0) + updated,
          duplicate_rows: (current?.duplicate_rows ?? 0) + skipped,
          failed_rows: (current?.failed_rows ?? 0) + issues.length,
          // Keep the first 200 problems - enough to diagnose, not enough to bloat.
          error_summary: [...previousIssues, ...issues].slice(0, 200),
        })
        .eq('id', jobId);

      return json({ inserted, updated, skipped, failed: issues.length, issues });
    }

    // ============================================================= FINISH
    if (body.action === 'finish') {
      if (!body.jobId) throw new HttpError(400, 'The import session was lost.');

      const { data: job, error } = await db
        .from('import_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', body.jobId)
        .select('*')
        .single();

      if (error || !job) throw new HttpError(500, 'Could not finish the import.');

      await logActivity({
        actorType: 'admin',
        actorId: admin.uid,
        actorName: admin.name,
        action: 'leads.imported',
        metadata: {
          filename: job.filename,
          imported: job.successful_rows,
          updated: job.updated_rows,
          duplicates: job.duplicate_rows,
          failed: job.failed_rows,
        },
      });

      return json({ job });
    }

    // ============================================================= CANCEL
    if (body.action === 'cancel') {
      if (!body.jobId) throw new HttpError(400, 'The import session was lost.');
      await db
        .from('import_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', body.jobId);
      return json({ ok: true });
    }

    throw new HttpError(400, 'The request was not valid.');
  } catch (error) {
    return errorResponse(error);
  }
}
