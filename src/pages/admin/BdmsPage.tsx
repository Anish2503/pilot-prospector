import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRoundX,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Alert, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { cn, formatNumber, formatPhone, formatRelative, initials } from '@/lib/utils';
import type { Bdm, BdmPerformance } from '@/types';

const WEAK_PINS = new Set([
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '1234','4321','1212','2580','0123','9876',
]);

/** A random 4-digit PIN that is not one of the obvious ones. */
function generatePin(): string {
  for (;;) {
    const pin = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
    if (!WEAK_PINS.has(pin)) return pin;
  }
}

export default function BdmsPage() {
  const toast = useToast();

  const [bdms, setBdms] = useState<Bdm[] | null>(null);
  const [performance, setPerformance] = useState<Record<string, BdmPerformance>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Bdm | null>(null);
  const [pinTarget, setPinTarget] = useState<Bdm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bdm | null>(null);
  const [disableTarget, setDisableTarget] = useState<Bdm | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [bdmResult, perfResult] = await Promise.all([
      supabase.from('bdms').select('*').order('name'),
      supabase.rpc('bdm_performance'),
    ]);

    if (bdmResult.error) {
      setError(friendlyError(bdmResult.error, 'Could not load the BDM list.'));
      return;
    }
    setBdms(bdmResult.data as Bdm[]);

    if (!perfResult.error && perfResult.data) {
      const map: Record<string, BdmPerformance> = {};
      for (const row of perfResult.data as BdmPerformance[]) map[row.bdm_id] = row;
      setPerformance(map);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!bdms) return [];
    const term = search.trim().toLowerCase();
    return bdms.filter((bdm) => {
      if (!showInactive && !bdm.active) return false;
      if (!term) return true;
      return (
        bdm.name.toLowerCase().includes(term) ||
        (bdm.phone ?? '').toLowerCase().includes(term) ||
        (bdm.employee_code ?? '').toLowerCase().includes(term)
      );
    });
  }, [bdms, search, showInactive, ]);

  // --------------------------------------------------------------- Actions

  async function toggleActive(bdm: Bdm, active: boolean) {
    setBusy(true);
    try {
      await api.post('/manage-bdms', { action: 'update', id: bdm.id, active });
      toast.success(
        active ? `${bdm.name} can sign in again.` : `${bdm.name} has been disabled.`,
      );
      setDisableTarget(null);
      await load();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(bdm: Bdm) {
    setBusy(true);
    try {
      await api.post('/manage-bdms', { action: 'delete', id: bdm.id });
      toast.success(`${bdm.name} has been removed.`);
      setDeleteTarget(null);
      await load();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  // ----------------------------------------------------------------- Render

  if (!bdms && !error) return <LoadingBlock label="Loading BDMs..." />;

  const activeCount = bdms?.filter((b) => b.active).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">BDMs</h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeCount} active{bdms && bdms.length !== activeCount ? ` · ${bdms.length - activeCount} disabled` : ''}
          </p>
        </div>
        <Button
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Add BDM
        </Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {bdms && bdms.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone or code"
            leftIcon={<Search className="size-4" />}
            containerClassName="max-w-xs"
            aria-label="Search BDMs"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Show disabled
          </label>
        </div>
      )}

      {bdms && bdms.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Users className="size-6" />}
            title="No BDMs yet"
            description="Add your Business Development Managers here. Each one gets a 4-digit PIN they use to sign in."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>
                Add your first BDM
              </Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState title="No BDMs match your search" description="Try a different name or code." />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((bdm) => (
            <BdmCard
              key={bdm.id}
              bdm={bdm}
              stats={performance[bdm.id]}
              onEdit={() => {
                setEditing(bdm);
                setFormOpen(true);
              }}
              onResetPin={() => setPinTarget(bdm)}
              onToggleActive={() =>
                bdm.active ? setDisableTarget(bdm) : void toggleActive(bdm, true)
              }
              onDelete={() => setDeleteTarget(bdm)}
            />
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------- Dialogs */}
      <BdmFormDialog
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <ResetPinDialog bdm={pinTarget} onClose={() => setPinTarget(null)} />

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onCancel={() => setDisableTarget(null)}
        onConfirm={() => disableTarget && void toggleActive(disableTarget, false)}
        title={`Disable ${disableTarget?.name ?? ''}?`}
        message={
          <>
            They will be signed out immediately and will not appear in the login list.
            <br />
            <br />
            Their assigned leads and past visit history are <strong>kept</strong>. You can enable
            them again at any time.
          </>
        }
        confirmLabel="Disable"
        loading={busy}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void remove(deleteTarget)}
        title={`Permanently delete ${deleteTarget?.name ?? ''}?`}
        message={
          <>
            This cannot be undone. It is only possible for a BDM who has never been assigned a
            lead.
            <br />
            <br />
            If they have any history, disable them instead.
          </>
        }
        confirmLabel="Delete permanently"
        loading={busy}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------

function BdmCard({
  bdm,
  stats,
  onEdit,
  onResetPin,
  onToggleActive,
  onDelete,
}: {
  bdm: Bdm;
  stats?: BdmPerformance;
  onEdit: () => void;
  onResetPin: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <li className={cn('card relative p-4', !bdm.active && 'bg-slate-50')}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            bdm.active ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500',
          )}
        >
          {initials(bdm.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('truncate font-semibold', bdm.active ? 'text-slate-900' : 'text-slate-500')}>
              {bdm.name}
            </p>
            {!bdm.active && <Badge tone="slate">Disabled</Badge>}
          </div>

          <p className="mt-0.5 truncate text-sm text-slate-500">
            {bdm.phone ? formatPhone(bdm.phone) : 'No phone number'}
            {bdm.employee_code ? ` · ${bdm.employee_code}` : ''}
          </p>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="-mr-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label={`Actions for ${bdm.name}`}
          >
            <MoreVertical className="size-5" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <MenuItem icon={<Pencil className="size-4" />} onClick={() => { setMenuOpen(false); onEdit(); }}>
                  Edit details
                </MenuItem>
                <MenuItem icon={<KeyRound className="size-4" />} onClick={() => { setMenuOpen(false); onResetPin(); }}>
                  Reset PIN
                </MenuItem>
                <MenuItem
                  icon={bdm.active ? <UserRoundX className="size-4" /> : <CheckCircle2 className="size-4" />}
                  onClick={() => { setMenuOpen(false); onToggleActive(); }}
                >
                  {bdm.active ? 'Disable sign-in' : 'Enable sign-in'}
                </MenuItem>
                {(stats?.assigned_leads ?? 0) === 0 && (stats?.total_visits ?? 0) === 0 && (
                  <MenuItem
                    icon={<Trash2 className="size-4" />}
                    danger
                    onClick={() => { setMenuOpen(false); onDelete(); }}
                  >
                    Delete
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
        <Metric label="Assigned" value={stats?.assigned_leads} />
        <Metric label="Visited" value={stats?.visited_leads} />
        <Metric label="POCs" value={stats?.pocs_collected} />
      </dl>

      <p className="mt-2 text-center text-xs text-slate-400">
        Last activity: {formatRelative(stats?.last_activity)}
      </p>
    </li>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">
        {formatNumber(value ?? 0)}
      </dd>
    </div>
  );
}

function MenuItem({
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

// -----------------------------------------------------------------------------

function BdmFormDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Bdm | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createdPin, setCreatedPin] = useState<{ name: string; pin: string } | null>(null);

  // Reset the form each time the dialog is opened.
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setPhone(editing?.phone ?? '');
    setCode(editing?.employee_code ?? '');
    setPin(editing ? '' : generatePin());
    setError(null);
    setCreatedPin(null);
  }, [open, editing]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (editing) {
        await api.post('/manage-bdms', {
          action: 'update',
          id: editing.id,
          name,
          phone,
          employeeCode: code,
        });
        toast.success(`${name} updated.`);
        onSaved();
      } else {
        await api.post('/manage-bdms', {
          action: 'create',
          name,
          phone,
          employeeCode: code,
          pin,
        });
        // Show the PIN once so it can be passed on - it is hashed after this
        // and can never be read back, only reset.
        setCreatedPin({ name: name.trim(), pin });
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  }

  // The one-time PIN handover screen.
  if (createdPin) {
    return (
      <Dialog
        open={open}
        onClose={onSaved}
        title="BDM added"
        footer={
          <Button fullWidth onClick={onSaved}>
            Done
          </Button>
        }
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-6" />
          </div>
          <p className="text-sm text-slate-600">
            <strong>{createdPin.name}</strong> can now sign in.
          </p>

          <div className="mt-4 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 p-5">
            <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">Their PIN</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-brand-800">
              {createdPin.pin}
            </p>
          </div>

          <Alert tone="warning" className="mt-4 text-left">
            Write this down and pass it to them now. For security it is stored scrambled and
            cannot be shown again — though you can always reset it.
          </Alert>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Add a BDM'}
      description={editing ? undefined : 'They will sign in by picking their name and typing this PIN.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {editing ? 'Save changes' : 'Add BDM'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rahul Verma"
          hint="This is what they will pick from the sign-in list, so make it recognisable."
          autoFocus
          required
          disabled={saving}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            inputMode="tel"
            disabled={saving}
          />
          <Input
            label="Employee code (optional)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MG-1042"
            disabled={saving}
          />
        </div>

        {!editing && (
          <div>
            <label className="label-base">4-digit PIN</label>
            <div className="flex gap-2">
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                maxLength={4}
                className="font-mono text-center text-xl tracking-[0.4em]"
                disabled={saving}
                required
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPin(generatePin())}
                disabled={saving}
              >
                New PIN
              </Button>
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              Avoid obvious ones like 1234 or 0000 — the system will reject those.
            </p>
          </div>
        )}
      </form>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

function ResetPinDialog({ bdm, onClose }: { bdm: Bdm | null; onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (bdm) {
      setPin(generatePin());
      setError(null);
      setDone(false);
    }
  }, [bdm]);

  async function submit() {
    if (!bdm) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/manage-bdms', { action: 'reset-pin', id: bdm.id, pin });
      setDone(true);
      toast.success(`PIN reset for ${bdm.name}.`);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={Boolean(bdm)}
      onClose={onClose}
      title={done ? 'PIN reset' : `Reset PIN for ${bdm?.name ?? ''}`}
      size="sm"
      footer={
        done ? (
          <Button fullWidth onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving} disabled={pin.length !== 4}>
              Reset PIN
            </Button>
          </>
        )
      }
    >
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      {done ? (
        <div className="text-center">
          <div className="rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 p-5">
            <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">New PIN</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.3em] text-brand-800">{pin}</p>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Pass this to {bdm?.name} now. Any device they are signed in on stays signed in.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            Their old PIN stops working straight away. Any lockout from failed attempts is
            cleared.
          </p>
          <div className="flex gap-2">
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              className="font-mono text-center text-xl tracking-[0.4em]"
              disabled={saving}
              aria-label="New PIN"
            />
            <Button type="button" variant="secondary" onClick={() => setPin(generatePin())} disabled={saving}>
              New PIN
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
