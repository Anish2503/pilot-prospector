import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  MoreVertical,
  Trash2,
  UserMinus,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Alert, Badge, EmptyState, Skeleton, StatusBadge } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { LeadDetailDialog } from '@/components/LeadDetailDialog';
import {
  DeleteLeadDialog,
  PullLeadDialog,
  type ActionableLead,
} from '@/components/LeadActions';
import { BulkDeleteDialog, BulkPullDialog } from '@/components/BulkLeadActions';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { ALL_STATUSES, cn, debounce, formatNumber, formatRelative, STATUS_LABELS } from '@/lib/utils';
import {
  EMPTY_FILTERS,
  EXPORT_LIMIT,
  fetchLeadIdsForSelection,
  fetchLeadsForExport,
  SELECT_ALL_LIMIT,
  useLeads,
  type LeadFilters,
  type SortField,
} from '@/hooks/useLeads';
import { downloadCsv, downloadExcel, type ExportRow } from '@/lib/exports';
import type { Bdm, LeadFilterOptions, LeadWithBdm } from '@/types';

const PAGE_SIZES = [25, 50, 100];

export default function LeadsPage() {
  const toast = useToast();

  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('society_name');
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pullTarget, setPullTarget] = useState<ActionableLead | null>(null);
  const [bulkPullIds, setBulkPullIds] = useState<string[] | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ActionableLead | null>(null);
  const [detailLead, setDetailLead] = useState<LeadWithBdm | null>(null);

  const [bdms, setBdms] = useState<Bdm[]>([]);
  const [options, setOptions] = useState<LeadFilterOptions>({
    cities: [],
    areas: [],
    competitors: [],
  });

  const query = useMemo(
    () => ({ filters, sortBy, ascending, page, pageSize }),
    [filters, sortBy, ascending, page, pageSize],
  );
  const { leads, total, loading, error, reload } = useLeads(query);

  // Filter dropdown contents come from the database, not from the page of rows
  // currently on screen - otherwise the options would change as you page.
  useEffect(() => {
    void (async () => {
      const [bdmResult, optionResult] = await Promise.all([
        supabase.from('bdms').select('*').order('name'),
        supabase.rpc('lead_filter_options'),
      ]);
      if (bdmResult.data) setBdms(bdmResult.data as Bdm[]);
      if (optionResult.data) setOptions(optionResult.data as LeadFilterOptions);
    })();
  }, []);

  // Typing should not fire a query on every keystroke.
  const applySearch = useMemo(
    () =>
      debounce((value: string) => {
        setFilters((current) => ({ ...current, search: value }));
        setPage(0);
      }, 350),
    [],
  );

  const updateFilter = useCallback(<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
    setSelected(new Set());
  }, []);

  function toggleSort(field: SortField) {
    if (sortBy === field) setAscending((v) => !v);
    else {
      setSortBy(field);
      setAscending(true);
    }
    setPage(0);
  }

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) => key !== 'search' && value !== '' && value !== false,
      ).length,
    [filters],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPageSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  // If leads disappear underneath us - deleted, reassigned, filters narrowed -
  // we can end up past the last page showing nothing. Step back rather than
  // leaving the user staring at an empty table with no obvious way out.
  useEffect(() => {
    if (!loading && leads.length === 0 && page > 0) setPage(0);
  }, [loading, leads.length, page]);

  /**
   * Selects every lead the current filters match, not just the visible page.
   * Only the id column is fetched, so this stays small even at ten thousand
   * leads - see fetchLeadIdsForSelection.
   */
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const ids = await fetchLeadIdsForSelection(filters);
      setSelected(new Set(ids));
      toast.info(`${formatNumber(ids.length)} leads selected.`);
    } catch (cause) {
      toast.error(friendlyError(cause, 'Could not select them all. Please try again.'));
    } finally {
      setSelectingAll(false);
    }
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) leads.forEach((l) => next.delete(l.id));
      else leads.forEach((l) => next.add(l.id));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? 'Loading…' : `${formatNumber(total)} societies`}
            {activeFilterCount > 0 && ' matching your filters'}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={() => setExportOpen(true)}
          disabled={total === 0}
        >
          Export
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* ------------------------------------------------------ Search + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            applySearch(e.target.value);
          }}
          placeholder="Search society, area, POC name or phone…"
          leftIcon={<Search className="size-4" />}
          containerClassName="min-w-56 flex-1 max-w-md"
          aria-label="Search leads"
          rightSlot={
            searchInput ? (
              <button
                onClick={() => {
                  setSearchInput('');
                  applySearch('');
                }}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : undefined
          }
        />

        <Button
          variant={activeFilterCount > 0 ? 'primary' : 'secondary'}
          icon={<Filter className="size-4" />}
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setFilters({ ...EMPTY_FILTERS, search: filters.search });
              setPage(0);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Assigned to"
            value={filters.bdmId}
            onChange={(e) => updateFilter('bdmId', e.target.value)}
            placeholder="Anyone"
            options={[
              { value: 'unassigned', label: 'Nobody (unassigned)' },
              ...bdms.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            placeholder="Any status"
            options={ALL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
          <Select
            label="City"
            value={filters.city}
            onChange={(e) => updateFilter('city', e.target.value)}
            placeholder="Any city"
            options={options.cities.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label="Area"
            value={filters.area}
            onChange={(e) => updateFilter('area', e.target.value)}
            placeholder="Any area"
            options={options.areas.map((a) => ({ value: a, label: a }))}
          />
          <Select
            label="Competitor"
            value={filters.competitor}
            onChange={(e) => updateFilter('competitor', e.target.value)}
            placeholder="Any"
            options={options.competitors.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label="POC collected"
            value={filters.poc}
            onChange={(e) => updateFilter('poc', e.target.value)}
            placeholder="Either"
            options={[
              { value: 'yes', label: 'Has a POC phone' },
              { value: 'no', label: 'No POC yet' },
            ]}
          />
          <Select
            label="Map location"
            value={filters.location}
            onChange={(e) => updateFilter('location', e.target.value)}
            placeholder="Either"
            options={[
              { value: 'present', label: 'Has coordinates' },
              { value: 'missing', label: 'Missing coordinates' },
            ]}
          />
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.needsReview}
                onChange={(e) => updateFilter('needsReview', e.target.checked)}
                className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Needs review only
            </label>
          </div>
        </div>
      )}

      {/* --------------------------------------------------- Bulk action bar */}
      {selected.size > 0 && (
        <div className="animate-fade-in-up sticky top-16 z-20 rounded-xl bg-slate-900 px-4 py-3 text-white shadow-lg lg:top-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {formatNumber(selected.size)} {selected.size === 1 ? 'lead' : 'leads'} selected
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-slate-300 hover:bg-white/10 hover:text-white"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                size="sm"
                icon={<UserPlus className="size-4" />}
                onClick={() => setAssignOpen(true)}
              >
                Assign to BDM
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<UserMinus className="size-4" />}
                onClick={() => setBulkPullIds([...selected])}
              >
                Pull Selected
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="size-4" />}
                onClick={() => setBulkDeleteIds([...selected])}
              >
                Delete Selected
              </Button>
            </div>
          </div>

          {/*
            Only offered once the whole visible page is ticked, and only when
            there is more beyond it. Selecting everything fetches ids alone -
            never the full rows - so it stays cheap at ten thousand leads.
          */}
          {allOnPageSelected && selected.size < total && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 text-sm text-slate-300">
              <span>
                All {formatNumber(leads.length)} on this page are selected.
              </span>
              <button
                onClick={selectAllMatching}
                disabled={selectingAll}
                className="font-medium text-white underline underline-offset-2 disabled:opacity-60"
              >
                {selectingAll
                  ? 'Selecting…'
                  : `Select all ${formatNumber(Math.min(total, SELECT_ALL_LIMIT))} matching your filters`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- Table */}
      <div className="card overflow-hidden">
        {loading && leads.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={
              total === 0 && activeFilterCount === 0 && !filters.search
                ? 'No leads have been uploaded yet'
                : 'No leads match your search'
            }
            description={
              total === 0 && activeFilterCount === 0 && !filters.search
                ? 'Upload a spreadsheet and every society in it appears here automatically.'
                : 'Try removing a filter or searching for something else.'
            }
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        aria-label="Select all on this page"
                      />
                    </th>
                    <SortableHeader field="society_name" {...{ sortBy, ascending, toggleSort }}>
                      Society
                    </SortableHeader>
                    <SortableHeader field="area" {...{ sortBy, ascending, toggleSort }}>
                      Area
                    </SortableHeader>
                    <SortableHeader field="total_units" {...{ sortBy, ascending, toggleSort }}>
                      Units
                    </SortableHeader>
                    <th className="px-3 py-3 font-medium">Assigned BDM</th>
                    <SortableHeader field="status" {...{ sortBy, ascending, toggleSort }}>
                      Status
                    </SortableHeader>
                    <th className="px-3 py-3 font-medium">Competitor</th>
                    <th className="px-3 py-3 font-medium">POC</th>
                    <SortableHeader field="last_visit_at" {...{ sortBy, ascending, toggleSort }}>
                      Last update
                    </SortableHeader>
                    <th className="w-12 px-3 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>

                <tbody className={cn('divide-y divide-slate-100', loading && 'opacity-60')}>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="cursor-pointer transition hover:bg-slate-50"
                      onClick={() => setDetailLead(lead)}
                    >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={(e) => {
                            const wanted = e.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              if (wanted) next.add(lead.id);
                              else next.delete(lead.id);
                              return next;
                            });
                          }}
                          className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          aria-label={`Select ${lead.society_name}`}
                        />
                      </td>

                      <td className="max-w-64 px-3 py-3">
                        <p className="truncate font-medium text-slate-900">{lead.society_name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {lead.city ?? 'City not recorded'}
                        </p>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                        {lead.area ?? '—'}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-600">
                        {lead.total_units === null ? (
                          <span className="text-amber-600">Needs check</span>
                        ) : (
                          formatNumber(lead.total_units)
                        )}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        {lead.current_bdm ? (
                          <span className="text-slate-700">{lead.current_bdm.name}</span>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>

                      <td className="px-3 py-3">
                        <StatusBadge status={lead.status} />
                      </td>

                      <td className="max-w-40 truncate px-3 py-3 text-slate-600">
                        {lead.competitor_name ?? '—'}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        {lead.poc_name || lead.poc_phone ? (
                          <Badge tone="emerald">Collected</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap text-slate-500">
                        {lead.last_visit_at ? formatRelative(lead.last_visit_at) : 'Never'}
                      </td>

                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          lead={lead}
                          onView={() => setDetailLead(lead)}
                          onPull={() =>
                            setPullTarget({
                              id: lead.id,
                              society_name: lead.society_name,
                              visit_count: lead.visit_count,
                              bdmName: lead.current_bdm?.name ?? null,
                            })
                          }
                          onDelete={() =>
                            setDeleteTarget({
                              id: lead.id,
                              society_name: lead.society_name,
                              visit_count: lead.visit_count,
                              bdmName: lead.current_bdm?.name ?? null,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* --------------------------------------------------- Pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  aria-label="Rows per page"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <span className="hidden sm:inline">
                  {formatNumber(page * pageSize + 1)}–
                  {formatNumber(Math.min((page + 1) * pageSize, total))} of {formatNumber(total)}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  icon={<ChevronLeft className="size-4" />}
                >
                  Previous
                </Button>
                <span className="px-2 text-sm text-slate-600">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ----------------------------------------------------------- Dialogs */}
      <AssignDialog
        open={assignOpen}
        leadIds={[...selected]}
        bdms={bdms.filter((b) => b.active)}
        onClose={() => setAssignOpen(false)}
        onDone={(summary) => {
          setAssignOpen(false);
          setSelected(new Set());
          toast.success(summary);
          void reload();
        }}
      />

      <ExportDialog
        open={exportOpen}
        filters={filters}
        total={total}
        onClose={() => setExportOpen(false)}
      />

      <BulkPullDialog
        leadIds={bulkPullIds}
        onClose={() => setBulkPullIds(null)}
        onDone={() => {
          setBulkPullIds(null);
          setSelected(new Set());
          void reload();
        }}
      />

      <BulkDeleteDialog
        leadIds={bulkDeleteIds}
        onClose={() => setBulkDeleteIds(null)}
        onDone={() => {
          setBulkDeleteIds(null);
          setSelected(new Set());
          void reload();
        }}
      />

      <PullLeadDialog
        lead={pullTarget}
        onClose={() => setPullTarget(null)}
        onDone={() => {
          setPullTarget(null);
          setSelected(new Set());
          void reload();
        }}
      />

      <DeleteLeadDialog
        lead={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDone={() => {
          setDeleteTarget(null);
          // Drop it from the selection too, so a follow-up bulk assign cannot
          // reference a lead that no longer exists.
          setSelected((current) => {
            const next = new Set(current);
            next.delete(deleteTarget!.id);
            return next;
          });
          void reload();
        }}
      />

      <LeadDetailDialog
        lead={detailLead}
        bdms={bdms}
        onClose={() => setDetailLead(null)}
        onChanged={() => void reload()}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------

function SortableHeader({
  field,
  sortBy,
  ascending,
  toggleSort,
  children,
}: {
  field: SortField;
  sortBy: SortField;
  ascending: boolean;
  toggleSort: (field: SortField) => void;
  children: React.ReactNode;
}) {
  const active = sortBy === field;
  return (
    <th className="px-3 py-3 font-medium">
      <button
        onClick={() => toggleSort(field)}
        className={cn(
          'inline-flex items-center gap-1 uppercase transition hover:text-slate-900',
          active && 'text-slate-900',
        )}
      >
        {children}
        {active &&
          (ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
}

// -----------------------------------------------------------------------------

function AssignDialog({
  open,
  leadIds,
  bdms,
  onClose,
  onDone,
}: {
  open: boolean;
  leadIds: string[];
  bdms: Bdm[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [bdmId, setBdmId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBdmId('');
      setNote('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!bdmId) {
      setError('Please choose a BDM.');
      return;
    }
    setSaving(true);
    setError(null);

    // One database call handles the whole batch, closing any existing
    // assignments and opening new ones as a single safe operation.
    const { data, error: rpcError } = await supabase.rpc('bulk_assign_leads', {
      p_lead_ids: leadIds,
      p_bdm_id: bdmId,
      p_note: note.trim() || null,
    });

    setSaving(false);

    if (rpcError) {
      setError(friendlyError(rpcError, 'Could not assign those leads.'));
      return;
    }

    const result = data as { assigned: number; reassigned: number; skipped: number };
    const parts: string[] = [];
    if (result.assigned) parts.push(`${result.assigned} assigned`);
    if (result.reassigned) parts.push(`${result.reassigned} reassigned`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    onDone(parts.join(', ') || 'Nothing changed');
  }

  const name = bdms.find((b) => b.id === bdmId)?.name;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Assign ${formatNumber(leadIds.length)} lead${leadIds.length === 1 ? '' : 's'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!bdmId}>
            Assign{name ? ` to ${name}` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Select
          label="Assign to"
          value={bdmId}
          onChange={(e) => setBdmId(e.target.value)}
          placeholder="Choose a BDM"
          options={bdms.map((b) => ({ value: b.id, label: b.name }))}
          autoFocus
        />

        <Input
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Priority for this quarter"
        />

        <Alert tone="info">
          Any lead already assigned to someone else will be <strong>reassigned</strong>. The
          previous owner and the change are kept in the lead's history.
        </Alert>
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

/**
 * Exports exactly the rows the current filters describe.
 *
 * POC name and phone are business-sensitive, so including them is a deliberate
 * choice each time rather than the default.
 */
function ExportDialog({
  open,
  filters,
  total,
  onClose,
}: {
  open: boolean;
  filters: LeadFilters;
  total: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [includePoc, setIncludePoc] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const leads = await fetchLeadsForExport(filters);

      const rows: ExportRow[] = leads.map((lead) => {
        const row: ExportRow = {
          'Society Name': lead.society_name,
          'Total Units': lead.total_units,
          'Units Source': lead.units_source,
          Address: lead.address,
          Area: lead.area,
          City: lead.city,
          State: lead.state,
          Pincode: lead.pincode,
          Latitude: lead.latitude,
          Longitude: lead.longitude,
          'Location Source': lead.location_source,
          Status: STATUS_LABELS[lead.status],
          'Assigned BDM': lead.current_bdm?.name ?? '',
          'Assigned On': lead.assigned_at ? lead.assigned_at.slice(0, 10) : '',
          Competitor: lead.competitor_name,
          'Current Vendor': lead.current_vendor,
          Visits: lead.visit_count,
          'Last Visit': lead.last_visit_at ? lead.last_visit_at.slice(0, 10) : '',
          'Latest Remark': lead.last_remark,
          'Follow Up Date': lead.follow_up_date,
          'Needs Review': lead.needs_review ? 'Yes' : 'No',
          'Source File': lead.source_file,
          'Added On': lead.created_at.slice(0, 10),
        };

        if (includePoc) {
          row['POC Name'] = lead.poc_name;
          row['POC Designation'] = lead.poc_designation;
          row['POC Phone'] = lead.poc_phone;
        }
        return row;
      });

      if (rows.length === 0) {
        toast.info('There is nothing to export with these filters.');
        return;
      }

      const name = includePoc ? 'leads-with-poc' : 'leads';
      if (format === 'csv') downloadCsv(rows, name);
      else downloadExcel(rows, name, 'Leads');

      toast.success(`${formatNumber(rows.length)} leads exported.`);
      onClose();
    } catch (cause) {
      toast.error(friendlyError(cause, 'Could not build the export.'));
    } finally {
      setBusy(false);
    }
  }

  const capped = total > EXPORT_LIMIT;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export leads"
      description={`${formatNumber(Math.min(total, EXPORT_LIMIT))} rows matching your current filters`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} loading={busy} icon={<Download className="size-4" />}>
            Download
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {capped && (
          <Alert tone="warning">
            Only the first {formatNumber(EXPORT_LIMIT)} rows will be included. Narrow the filters
            to export the rest.
          </Alert>
        )}

        <Select
          label="Format"
          value={format}
          onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv')}
          options={[
            { value: 'xlsx', label: 'Excel (.xlsx)' },
            { value: 'csv', label: 'CSV (.csv)' },
          ]}
        />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={includePoc}
            onChange={(e) => setIncludePoc(e.target.checked)}
            className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Include contact details</span>
            <span className="block text-slate-500">
              Adds POC name, designation and phone number. This is personal data — only include
              it if the file is going somewhere safe.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

/**
 * The per-row action menu.
 *
 * Which actions appear depends on whether the lead currently has an owner:
 *
 *   assigned    ->  View · Reassign · Pull from BDM · Delete
 *   unassigned  ->  View · Assign            · Delete
 *
 * Reassign and Assign both open the detail panel, where the BDM is chosen.
 */
function RowActions({
  lead,
  onView,
  onPull,
  onDelete,
}: {
  lead: LeadWithBdm;
  onView: () => void;
  onPull: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const assigned = Boolean(lead.current_bdm);

  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="-mr-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        aria-label={`Actions for ${lead.society_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-5" />
      </button>

      {open && (
        <>
          {/* Catches the next click anywhere, so the menu closes. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            <RowMenuItem icon={<Building2 className="size-4" />} onClick={close(onView)}>
              View details
            </RowMenuItem>

            <RowMenuItem icon={<UserPlus className="size-4" />} onClick={close(onView)}>
              {assigned ? 'Reassign' : 'Assign to BDM'}
            </RowMenuItem>

            {assigned && (
              <RowMenuItem icon={<UserMinus className="size-4" />} onClick={close(onPull)}>
                Pull from BDM
              </RowMenuItem>
            )}

            <div className="my-1 border-t border-slate-100" />

            <RowMenuItem icon={<Trash2 className="size-4" />} danger onClick={close(onDelete)}>
              Delete lead
            </RowMenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function RowMenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
