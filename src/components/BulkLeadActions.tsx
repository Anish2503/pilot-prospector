/**
 * Bulk versions of the two destructive admin actions.
 *
 * HOW THE WORK IS SENT
 * A selection is sent to the database in chunks. Each chunk is ONE request that
 * the database loops over internally - so 400 leads is two requests, not four
 * hundred. Chunking also keeps each statement short enough to stay inside the
 * database's timeout, and gives us a real progress bar rather than a spinner.
 *
 * The database functions delegate to the single-lead functions, so a lead
 * deleted in bulk is archived exactly as one deleted on its own, and a lead
 * pulled in bulk closes its assignment exactly the same way. There is no second
 * code path that could drift.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, UserMinus } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { formatNumber } from '@/lib/utils';

/** Must not exceed bulk_action_max_batch() in migration 006. */
const BULK_CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What the database tells us about a selection, without sending the rows. */
export interface SelectionSummary {
  found: number;
  assigned: number;
  unassigned: number;
  with_visits: number;
  total_visits: number;
  sample_names: string[];
  bdms: string[];
}

function useSelectionSummary(leadIds: string[] | null): SelectionSummary | null {
  const [summary, setSummary] = useState<SelectionSummary | null>(null);

  useEffect(() => {
    if (!leadIds || leadIds.length === 0) {
      setSummary(null);
      return;
    }

    let cancelled = false;
    void supabase
      .rpc('lead_selection_summary', { p_lead_ids: leadIds })
      .then(({ data }) => {
        if (!cancelled && data) setSummary(data as SelectionSummary);
      });

    return () => {
      cancelled = true;
    };
  }, [leadIds]);

  return summary;
}

// -----------------------------------------------------------------------------

function SelectionPreview({
  summary,
  total,
}: {
  summary: SelectionSummary | null;
  total: number;
}) {
  if (!summary) return <p className="text-sm text-slate-400">Checking the selection…</p>;

  const extra = summary.found - summary.sample_names.length;

  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-slate-500">Selected</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">{formatNumber(total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Assigned</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">
            {formatNumber(summary.assigned)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Unassigned</dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-900">
            {formatNumber(summary.unassigned)}
          </dd>
        </div>
      </dl>

      {summary.sample_names.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-t border-slate-200 pt-2 text-slate-600">
          {summary.sample_names.map((name) => (
            <li key={name} className="truncate">
              · {name}
            </li>
          ))}
          {extra > 0 && <li className="text-slate-400">+ {formatNumber(extra)} more</li>}
        </ul>
      )}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="mt-1.5 text-center text-xs text-slate-500">
        {formatNumber(done)} of {formatNumber(total)}
      </p>
    </div>
  );
}

function ResultTable({ rows, failed }: { rows: Array<[string, number]>; failed: number }) {
  return (
    <div>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-3 py-2">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>

      {failed > 0 && (
        <Alert tone="warning" className="mt-3">
          {formatNumber(failed)} could not be processed — most likely someone else changed or
          removed them while this was running. Refresh the list and try those again.
        </Alert>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// BULK PULL
// -----------------------------------------------------------------------------

interface PullTotals {
  selected: number;
  pulled: number;
  already: number;
  failed: number;
}

export function BulkPullDialog({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const summary = useSelectionSummary(leadIds);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullTotals | null>(null);

  useEffect(() => {
    if (leadIds) {
      setError(null);
      setResult(null);
      setProgress(0);
    }
  }, [leadIds]);

  async function run() {
    if (!leadIds) return;
    setBusy(true);
    setError(null);
    setProgress(0);

    const totals: PullTotals = { selected: leadIds.length, pulled: 0, already: 0, failed: 0 };

    try {
      for (const batch of chunk(leadIds, BULK_CHUNK)) {
        const { data, error: rpcError } = await supabase.rpc('bulk_pull_leads', {
          p_lead_ids: batch,
        });
        if (rpcError) throw rpcError;

        const r = data as { pulled: number; already_unassigned: number; failed: number };
        totals.pulled += r.pulled;
        totals.already += r.already_unassigned;
        totals.failed += r.failed;

        setProgress((done) => done + batch.length);
      }

      setResult(totals);
      toast.success(
        `${formatNumber(totals.pulled)} ${totals.pulled === 1 ? 'lead' : 'leads'} removed from their BDM.`,
      );
    } catch (cause) {
      setError(friendlyError(cause, 'The bulk pull could not be completed. Please try again.'));
      setResult(totals);
    } finally {
      setBusy(false);
    }
  }

  const count = leadIds?.length ?? 0;
  const noun = count === 1 ? 'lead' : 'leads';

  return (
    <Dialog
      open={Boolean(leadIds)}
      onClose={busy ? () => {} : onClose}
      title={result ? 'Bulk pull completed' : `Pull ${formatNumber(count)} ${noun} from their BDMs?`}
      footer={
        result ? (
          <Button fullWidth onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={run} loading={busy} icon={<UserMinus className="size-4" />}>
              {busy
                ? `Pulling ${formatNumber(count)} ${noun}…`
                : `Pull ${formatNumber(count)} ${noun}`}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm leading-relaxed text-slate-600">
        {error && <Alert tone="error">{error}</Alert>}

        {result ? (
          <ResultTable
            rows={[
              ['Selected', result.selected],
              ['Pulled from BDM', result.pulled],
              ['Already unassigned', result.already],
              ['Failed', result.failed],
            ]}
            failed={result.failed}
          />
        ) : busy ? (
          <>
            <p>Removing assignments…</p>
            <ProgressBar done={progress} total={count} />
          </>
        ) : (
          <>
            <p>
              You are about to remove{' '}
              <strong className="text-slate-900">{formatNumber(count)}</strong> {noun} from their
              current BDM assignments.
            </p>

            <SelectionPreview summary={summary} total={count} />

            {summary && summary.bdms.length > 0 && (
              <p className="text-slate-500">
                Affects: <strong className="text-slate-700">{summary.bdms.join(', ')}</strong>
              </p>
            )}

            {summary && summary.unassigned > 0 && (
              <Alert tone="info">
                {formatNumber(summary.unassigned)} of these{' '}
                {summary.unassigned === 1 ? 'is' : 'are'} already unassigned. They will simply be
                skipped, not counted as failures.
              </Alert>
            )}

            <Alert tone="info">
              The leads are <strong>not</strong> deleted. They become Unassigned and can be
              reassigned. Visit history, remarks, POC details and assignment history are all kept.
            </Alert>
          </>
        )}
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// BULK DELETE
// -----------------------------------------------------------------------------

interface DeleteTotals {
  selected: number;
  deleted: number;
  failed: number;
}

export function BulkDeleteDialog({
  leadIds,
  onClose,
  onDone,
}: {
  leadIds: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const summary = useSelectionSummary(leadIds);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DeleteTotals | null>(null);

  useEffect(() => {
    if (leadIds) {
      setError(null);
      setResult(null);
      setProgress(0);
      setReason('');
    }
  }, [leadIds]);

  async function run() {
    if (!leadIds) return;
    setBusy(true);
    setError(null);
    setProgress(0);

    const totals: DeleteTotals = { selected: leadIds.length, deleted: 0, failed: 0 };

    try {
      for (const batch of chunk(leadIds, BULK_CHUNK)) {
        const { data, error: rpcError } = await supabase.rpc('bulk_delete_leads', {
          p_lead_ids: batch,
          p_reason: reason.trim() || null,
        });
        if (rpcError) throw rpcError;

        const r = data as { deleted: number; failed: number };
        totals.deleted += r.deleted;
        totals.failed += r.failed;

        setProgress((done) => done + batch.length);
      }

      setResult(totals);
      toast.success(
        `${formatNumber(totals.deleted)} ${totals.deleted === 1 ? 'lead' : 'leads'} deleted.`,
      );
    } catch (cause) {
      setError(friendlyError(cause, 'The bulk delete could not be completed. Please try again.'));
      setResult(totals);
    } finally {
      setBusy(false);
    }
  }

  const count = leadIds?.length ?? 0;
  const noun = count === 1 ? 'Lead' : 'Leads';

  return (
    <Dialog
      open={Boolean(leadIds)}
      onClose={busy ? () => {} : onClose}
      title={result ? 'Bulk delete completed' : `Delete ${formatNumber(count)} ${noun}?`}
      footer={
        result ? (
          <Button fullWidth onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={run}
              loading={busy}
              icon={<Trash2 className="size-4" />}
            >
              {busy ? `Deleting ${formatNumber(count)}…` : `Delete ${formatNumber(count)} ${noun}`}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm leading-relaxed text-slate-600">
        {error && <Alert tone="error">{error}</Alert>}

        {result ? (
          <ResultTable
            rows={[
              ['Selected', result.selected],
              ['Deleted', result.deleted],
              ['Failed', result.failed],
            ]}
            failed={result.failed}
          />
        ) : busy ? (
          <>
            <p>Deleting leads…</p>
            <ProgressBar done={progress} total={count} />
            <p className="text-center text-xs text-slate-400">
              Please keep this window open until it finishes.
            </p>
          </>
        ) : (
          <>
            <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertTriangle className="size-5 shrink-0 text-red-600" aria-hidden />
              <div>
                <p className="text-slate-700">
                  This will permanently delete the selected {count === 1 ? 'lead' : 'leads'}.
                </p>
                <p className="mt-1 font-medium text-red-700">This action cannot be undone.</p>
              </div>
            </div>

            <SelectionPreview summary={summary} total={count} />

            {summary && summary.assigned > 0 && (
              <Alert tone="warning">
                {formatNumber(summary.assigned)} of these{' '}
                {summary.assigned === 1 ? 'is' : 'are'} currently assigned
                {summary.bdms.length > 0 ? ` to ${summary.bdms.join(', ')}` : ''}. They will
                disappear from those lead sheets straight away.
              </Alert>
            )}

            {summary && summary.total_visits > 0 && (
              <Alert tone="warning">
                Between them these leads have{' '}
                <strong>{formatNumber(summary.total_visits)}</strong> recorded{' '}
                {summary.total_visits === 1 ? 'visit' : 'visits'}. A full copy of each lead and its
                history is kept in the deletion archive for auditing, but they will no longer
                appear anywhere in the app.
              </Alert>
            )}

            <Input
              label="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate import from 9 September"
              hint="Stored with every deletion record in this batch."
              maxLength={200}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
