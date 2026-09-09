/**
 * The two destructive admin actions on a lead, and the confirmations that guard
 * them. Shared by the leads table and the lead detail panel so both behave
 * identically.
 *
 * THEY ARE NOT THE SAME THING:
 *
 *   PULL   - the lead stays. Its current BDM is removed, it becomes Unassigned,
 *            and it can be given to someone else. Every visit, remark and POC
 *            the previous BDM recorded is kept, and the assignment itself is
 *            kept as history rather than deleted.
 *
 *   DELETE - the lead goes. Permanent. The database archives a full copy of it
 *            and everything attached to it first (see migration 005), so the
 *            record of what was removed survives even though the lead does not.
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

/** The little a dialog needs to know about the lead it is acting on. */
export interface ActionableLead {
  id: string;
  society_name: string;
  visit_count?: number;
  /** Name of the BDM who currently holds it, if any. */
  bdmName?: string | null;
}

// -----------------------------------------------------------------------------
// PULL - take the lead back from its BDM. The lead itself is untouched.
// -----------------------------------------------------------------------------

export function PullLeadDialog({
  lead,
  onClose,
  onDone,
}: {
  lead: ActionableLead | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lead) setError(null);
  }, [lead]);

  async function confirm() {
    if (!lead) return;
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('unassign_lead', {
      p_lead_id: lead.id,
    });
    setBusy(false);

    if (rpcError) {
      setError(friendlyError(rpcError, 'Unable to remove this lead from the BDM. Please try again.'));
      return;
    }

    const result = data as { changed: boolean; previous_bdm_name?: string } | null;

    if (result?.changed === false) {
      toast.info('That lead was already unassigned.');
    } else {
      toast.success(
        `${lead.society_name} removed from ${result?.previous_bdm_name ?? 'their BDM'}. It is now available to reassign.`,
      );
    }

    onDone();
  }

  return (
    <Dialog
      open={Boolean(lead)}
      onClose={busy ? () => {} : onClose}
      title="Remove lead from BDM?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={busy} icon={<UserMinus className="size-4" />}>
            Remove from BDM
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">
        {error && <Alert tone="error">{error}</Alert>}

        <p>
          <strong className="text-slate-900">{lead?.society_name}</strong>
          {lead?.bdmName ? (
            <>
              {' '}is currently assigned to <strong className="text-slate-900">{lead.bdmName}</strong>.
            </>
          ) : (
            ' is currently assigned.'
          )}
        </p>

        <p>Removing it will make this lead available for reassignment.</p>

        <Alert tone="info">
          The lead itself is <strong>not</strong> deleted. Its visit history, remarks and POC
          details all stay, and the assignment is kept in the lead's history rather than erased.
        </Alert>
      </div>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// DELETE - permanent. Archived by the database first.
// -----------------------------------------------------------------------------

export function DeleteLeadDialog({
  lead,
  onClose,
  onDone,
}: {
  lead: ActionableLead | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (lead) {
      setError(null);
      setReason('');
    }
  }, [lead]);

  async function confirm() {
    if (!lead) return;
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('delete_lead', {
      p_lead_id: lead.id,
      p_reason: reason.trim() || null,
    });
    setBusy(false);

    if (rpcError) {
      setError(friendlyError(rpcError, 'Unable to delete this lead. Please try again.'));
      return;
    }

    const result = data as { society_name?: string } | null;
    toast.success(`${result?.society_name ?? lead.society_name} deleted successfully.`);
    onDone();
  }

  const visits = lead?.visit_count ?? 0;

  return (
    <Dialog
      open={Boolean(lead)}
      onClose={busy ? () => {} : onClose}
      title="Delete lead?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy} icon={<Trash2 className="size-4" />}>
            Delete lead
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="size-5 shrink-0 text-red-600" aria-hidden />
          <div>
            <p className="text-slate-700">You are about to permanently delete:</p>
            <p className="mt-1 font-semibold text-slate-900">{lead?.society_name}</p>
            <p className="mt-1.5 font-medium text-red-700">This action cannot be undone.</p>
          </div>
        </div>

        {lead?.bdmName && (
          <Alert tone="warning">
            This lead is currently assigned to <strong>{lead.bdmName}</strong>. It will disappear
            from their list straight away.
          </Alert>
        )}

        {visits > 0 && (
          <Alert tone="warning">
            It has <strong>{formatNumber(visits)}</strong> recorded{' '}
            {visits === 1 ? 'visit' : 'visits'}. A full copy of the lead and all of its visit
            history is kept in the deletion archive for auditing, but it will no longer appear
            anywhere in the app or in your reports.
          </Alert>
        )}

        <Input
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Duplicate of another entry"
          hint="Stored with the deletion record so anyone reviewing it later knows why."
          disabled={busy}
          maxLength={200}
        />
      </div>
    </Dialog>
  );
}
