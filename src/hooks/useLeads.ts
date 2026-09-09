import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { fetchAllPages, SERVER_PAGE_SIZE } from '@/lib/paging';
import type { LeadStatus, LeadWithBdm } from '@/types';

export interface LeadFilters {
  search: string;
  status: string;
  bdmId: string; // '' = any, 'unassigned' = no BDM, otherwise a BDM id
  city: string;
  area: string;
  competitor: string;
  poc: string; // '' | 'yes' | 'no'
  location: string; // '' | 'missing' | 'present'
  needsReview: boolean;
  fromDate: string;
  toDate: string;
}

export const EMPTY_FILTERS: LeadFilters = {
  search: '',
  status: '',
  bdmId: '',
  city: '',
  area: '',
  competitor: '',
  poc: '',
  location: '',
  needsReview: false,
  fromDate: '',
  toDate: '',
};

export type SortField =
  | 'society_name'
  | 'total_units'
  | 'city'
  | 'area'
  | 'status'
  | 'last_visit_at'
  | 'updated_at'
  | 'created_at';

export interface LeadQuery {
  filters: LeadFilters;
  sortBy: SortField;
  ascending: boolean;
  page: number;
  pageSize: number;
}

export const LEAD_SELECT = '*, current_bdm:bdms(id, name)';

/**
 * Search runs against `search_text` - a column the database builds and keeps up
 * to date itself, joining society name, area, city, address, POC name, POC
 * phone and competitor. That turns seven unindexed "contains" checks into one
 * indexed lookup. See supabase/migrations/004_search_performance.sql.
 *
 * POC name and phone are searchable because finding a contact by their number
 * is a real need; the database still only returns rows that person may see.
 */
const SEARCH_COLUMN = 'search_text';

/**
 * The columns searched individually if `search_text` is not there yet - i.e.
 * migration 004 has not been run. Slower, but it means search keeps working
 * rather than breaking with a confusing error.
 */
const FALLBACK_SEARCH_COLUMNS = [
  'society_name',
  'area',
  'city',
  'address',
  'poc_name',
  'poc_phone',
  'competitor_name',
];

/** Postgres' code for "no such column". */
const UNDEFINED_COLUMN = '42703';

/**
 * Remembered for the rest of the session once we learn the answer, so the
 * fallback costs one failed request in total, not one per search.
 */
let searchColumnExists: boolean | null = null;

/** Anything with a special meaning in PostgREST's filter syntax. */
const UNSAFE_SEARCH_CHARS = /[,()%\\]/g;

/**
 * Translates the filter panel into database conditions.
 *
 * Shared by the paged table and the export, so the file you download always
 * contains exactly the rows you were looking at - no more, no less.
 */
function applyFilters<T>(request: T, filters: LeadFilters): T {
  // The Supabase query builder returns a new object from every method, so this
  // is a chain of reassignments rather than mutation.
  let q = request as never;

  const term = filters.search.trim();
  if (term) {
    const safe = term.replace(UNSAFE_SEARCH_CHARS, ' ').trim();
    if (safe) {
      if (searchColumnExists === false) {
        q = (q as never as { or: (f: string) => never }).or(
          FALLBACK_SEARCH_COLUMNS.map((column) => `${column}.ilike.%${safe}%`).join(','),
        );
      } else {
        q = (q as never as { ilike: (c: string, p: string) => never }).ilike(
          SEARCH_COLUMN,
          `%${safe.toLowerCase()}%`,
        );
      }
    }
  }

  type Builder = {
    eq: (c: string, v: unknown) => never;
    is: (c: string, v: unknown) => never;
    not: (c: string, o: string, v: unknown) => never;
    gte: (c: string, v: unknown) => never;
    lte: (c: string, v: unknown) => never;
  };
  const b = () => q as never as Builder;

  if (filters.status) q = b().eq('status', filters.status);

  if (filters.bdmId === 'unassigned') q = b().is('current_bdm_id', null);
  else if (filters.bdmId) q = b().eq('current_bdm_id', filters.bdmId);

  if (filters.city) q = b().eq('city', filters.city);
  if (filters.area) q = b().eq('area', filters.area);
  if (filters.competitor) q = b().eq('competitor_name', filters.competitor);

  if (filters.poc === 'yes') q = b().not('poc_phone', 'is', null);
  else if (filters.poc === 'no') q = b().is('poc_phone', null);

  if (filters.location === 'missing') q = b().is('latitude', null);
  else if (filters.location === 'present') q = b().not('latitude', 'is', null);

  if (filters.needsReview) q = b().eq('needs_review', true);

  if (filters.fromDate) q = b().gte('created_at', filters.fromDate);
  if (filters.toDate) q = b().lte('created_at', `${filters.toDate}T23:59:59`);

  return q as T;
}

/**
 * Fetches one page of leads.
 *
 * Every filter, sort and search is applied by the database, and only the
 * requested page is sent back. This is what keeps the app fast with 10,000+
 * leads: the browser never holds more than a screenful at a time.
 */
export function useLeads(query: LeadQuery) {
  const [leads, setLeads] = useState<LeadWithBdm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  /**
   * Counting matching rows is the expensive half of this query - at 10,000
   * leads an exact count cost roughly 800ms on its own. But the answer only
   * changes when the FILTERS change, not when you turn the page.
   *
   * So we count exactly once per set of filters and reuse it while paging.
   * Accurate page numbers, paid for once.
   */
  const countCache = useRef<{ key: string; total: number } | null>(null);

  const fetchPage = useCallback(async (force: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const { filters, sortBy, ascending, page, pageSize } = query;

    const countKey = JSON.stringify(filters);
    const needCount = force || countCache.current?.key !== countKey;
    const from = page * pageSize;

    // Rebuilt on each attempt, because a Supabase query can only be sent once.
    const run = () =>
      applyFilters(
        supabase
          .from('leads')
          .select(LEAD_SELECT, needCount ? { count: 'exact' } : undefined),
        filters,
      )
        .order(sortBy, { ascending, nullsFirst: false })
        // A stable tie-breaker, so rows never shuffle between pages.
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

    let { data, error: queryError, count } = await run();

    // If migration 004 has not been run yet, `search_text` does not exist.
    // Remember that and retry the old way, so search still works.
    if (queryError?.code === UNDEFINED_COLUMN && searchColumnExists === null) {
      searchColumnExists = false;
      ({ data, error: queryError, count } = await run());
    } else if (!queryError && searchColumnExists === null && filters.search.trim()) {
      searchColumnExists = true;
    }

    // A slower earlier request must never overwrite a newer result.
    if (id !== requestId.current) return;

    if (queryError) {
      setError(friendlyError(queryError, 'Could not load leads.'));
      setLeads([]);
      setTotal(0);
      countCache.current = null;
      setLoading(false);
      return;
    }

    if (needCount && count !== null && count !== undefined) {
      countCache.current = { key: countKey, total: count };
    }

    setLeads((data ?? []) as unknown as LeadWithBdm[]);
    setTotal(countCache.current?.total ?? (data?.length ?? 0));
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void fetchPage(false);
  }, [fetchPage]);

  /** Re-reads the current page AND recounts - use after adding or changing leads. */
  const reload = useCallback(() => fetchPage(true), [fetchPage]);

  return { leads, total, loading, error, reload };
}

/**
 * Fetches every lead matching the current filters, for export.
 *
 * Capped, so a mis-click cannot try to pull a million rows into the browser.
 */
export const EXPORT_LIMIT = 20 * SERVER_PAGE_SIZE;

export function fetchLeadsForExport(filters: LeadFilters): Promise<LeadWithBdm[]> {
  return fetchAllPages<LeadWithBdm>(
    (from, to) =>
      applyFilters(supabase.from('leads').select(LEAD_SELECT), filters)
        .order('society_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as never,
    EXPORT_LIMIT,
  );
}

/** Only the columns the map needs, for every lead that has coordinates. */
export interface MapLeadRow {
  id: string;
  society_name: string;
  latitude: number;
  longitude: number;
  status: LeadStatus;
  total_units: number | null;
  area: string | null;
  city: string | null;
  location_source: string;
  current_bdm_id: string | null;
}

const MAP_SELECT =
  'id, society_name, latitude, longitude, status, total_units, area, city, location_source, current_bdm_id';

/**
 * Fetches every mappable lead, in pages.
 *
 * A load test at 10,000 leads showed a single request silently returning only
 * the first 1,000 - so two thirds of the pins were missing with no error. This
 * keeps asking until the server runs out of rows.
 */
export function fetchLeadsForMap(maxLeads = 10_000): Promise<MapLeadRow[]> {
  return fetchAllPages<MapLeadRow>(
    (from, to) =>
      supabase
        .from('leads')
        .select(MAP_SELECT)
        .not('latitude', 'is', null)
        .order('id', { ascending: true })
        .range(from, to) as never,
    maxLeads,
  );
}

/**
 * Every lead id matching the current filters - nothing else.
 *
 * This is what "Select all N matching" uses. Only the id column is requested,
 * so 10,000 leads cost about 360KB rather than the many megabytes the full rows
 * would take. The filters are the same ones the table is showing, so the
 * selection can never include something the admin cannot see.
 */
export const SELECT_ALL_LIMIT = 10_000;

export async function fetchLeadIdsForSelection(filters: LeadFilters): Promise<string[]> {
  const rows = await fetchAllPages<{ id: string }>(
    (from, to) =>
      applyFilters(supabase.from('leads').select('id'), filters)
        .order('society_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as never,
    SELECT_ALL_LIMIT,
  );

  return rows.map((row) => row.id);
}
