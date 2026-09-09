import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, KeyRound, Plus, ShieldCheck, UserRoundX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Alert, Badge, LoadingBlock } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, initials } from '@/lib/utils';
import type { Admin } from '@/types';

export default function AdminsPage() {
  const { session } = useAuth();
  const toast = useToast();

  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<Admin | null>(null);
  const [disableTarget, setDisableTarget] = useState<Admin | null>(null);
  const [changeOwnOpen, setChangeOwnOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: queryError } = await supabase
      .from('admins')
      .select('*')
      .order('name');

    if (queryError) setError(friendlyError(queryError, 'Could not load admin accounts.'));
    else setAdmins(data as Admin[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(admin: Admin, active: boolean) {
    setBusy(true);
    try {
      await api.post('/manage-admins', { action: 'set-active', id: admin.id, active });
      toast.success(active ? `${admin.name} can sign in again.` : `${admin.name} has been disabled.`);
      setDisableTarget(null);
      await load();
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!admins && !error) return <LoadingBlock label="Loading admins…" />;

  const activeCount = admins?.filter((a) => a.active).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Admin management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {activeCount} active Super Admin{activeCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setChangeOwnOpen(true)}>
            Change my password
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>
            Add Super Admin
          </Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Alert tone="info">
        Every Super Admin has exactly the same powers — there are no levels. Anyone here can add
        another, disable one, upload leads, and see all activity.
      </Alert>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {admins?.map((admin) => {
          const isMe = admin.id === session?.id;
          return (
            <li key={admin.id} className={cn('card p-4', !admin.active && 'bg-slate-50')}>
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    admin.active ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500',
                  )}
                >
                  {initials(admin.name)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p
                      className={cn(
                        'truncate font-semibold',
                        admin.active ? 'text-slate-900' : 'text-slate-500',
                      )}
                    >
                      {admin.name}
                    </p>
                    {isMe && <Badge tone="brand">You</Badge>}
                    {!admin.active && <Badge tone="slate">Disabled</Badge>}
                  </div>

                  <p className="mt-0.5 truncate font-mono text-sm text-slate-500">
                    {admin.username}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Added {formatDate(admin.created_at)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<KeyRound className="size-4" />}
                  onClick={() => setPasswordTarget(admin)}
                >
                  Reset password
                </Button>

                {!isMe &&
                  (admin.active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<UserRoundX className="size-4" />}
                      onClick={() => setDisableTarget(admin)}
                    >
                      Disable
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<CheckCircle2 className="size-4" />}
                      onClick={() => void setActive(admin, true)}
                    >
                      Enable
                    </Button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>

      {/* ---------------------------------------------------------- Dialogs */}
      <AddAdminDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          void load();
        }}
      />

      <ResetPasswordDialog admin={passwordTarget} onClose={() => setPasswordTarget(null)} />

      <ChangeOwnPasswordDialog open={changeOwnOpen} onClose={() => setChangeOwnOpen(false)} />

      <ConfirmDialog
        open={Boolean(disableTarget)}
        onCancel={() => setDisableTarget(null)}
        onConfirm={() => disableTarget && void setActive(disableTarget, false)}
        title={`Disable ${disableTarget?.name ?? ''}?`}
        message={
          <>
            They will be signed out straight away and will not be able to sign back in.
            <br />
            <br />
            Everything they did stays in the activity log. You can enable them again at any time.
          </>
        }
        confirmLabel="Disable"
        loading={busy}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------

function AddAdminDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setUsername('');
      setPassword('');
      setError(null);
      setCreated(null);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post('/manage-admins', {
        action: 'create',
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
      setCreated({ username: username.trim().toLowerCase(), password });
      toast.success('Super Admin created.');
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <Dialog
        open={open}
        onClose={onSaved}
        title="Super Admin created"
        footer={
          <Button fullWidth onClick={onSaved}>
            Done
          </Button>
        }
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <ShieldCheck className="size-6" />
          </div>
          <p className="text-sm text-slate-600">Pass these details on securely.</p>

          <dl className="mt-4 space-y-2 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 p-4 text-left">
            <div>
              <dt className="text-xs font-medium tracking-wide text-brand-700 uppercase">Username</dt>
              <dd className="font-mono text-lg font-semibold text-brand-900">{created.username}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-brand-700 uppercase">Password</dt>
              <dd className="font-mono text-lg font-semibold break-all text-brand-900">
                {created.password}
              </dd>
            </div>
          </dl>

          <Alert tone="warning" className="mt-4 text-left">
            The password is stored scrambled and cannot be shown again. If it is lost, any Super
            Admin can reset it.
          </Alert>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a Super Admin"
      description="They will have exactly the same powers as you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create account
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
          placeholder="Priya Sharma"
          autoFocus
          required
          disabled={saving}
        />
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="priya.sharma"
          hint="Lowercase letters, numbers, dot, dash or underscore. No email needed."
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={saving}
        />
        <Input
          label="Temporary password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters. They should change it after signing in."
          required
          disabled={saving}
        />
      </form>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

function ResetPasswordDialog({ admin, onClose }: { admin: Admin | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (admin) {
      setPassword('');
      setError(null);
      setDone(false);
    }
  }, [admin]);

  async function submit() {
    if (!admin) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/manage-admins', { action: 'reset-password', id: admin.id, password });
      setDone(true);
      toast.success(`Password reset for ${admin.name}.`);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={Boolean(admin)}
      onClose={onClose}
      title={done ? 'Password reset' : `Reset password for ${admin?.name ?? ''}`}
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
            <Button onClick={submit} loading={saving} disabled={password.length < 8}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {done ? (
        <div className="text-center">
          <div className="rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 p-4">
            <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">
              New password
            </p>
            <p className="mt-1 font-mono text-lg font-semibold break-all text-brand-900">
              {password}
            </p>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Pass this to {admin?.name} securely. Their old password no longer works.
          </p>
        </div>
      ) : (
        <Input
          label="New password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters."
          autoFocus
          disabled={saving}
        />
      )}
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

function ChangeOwnPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    setError(null);
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/manage-admins', {
        action: 'change-my-password',
        currentPassword: current,
        newPassword: next,
      });
      toast.success('Your password has been changed.');
      onClose();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change my password"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!current || next.length < 8}>
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input
          label="Current password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          autoFocus
          disabled={saving}
        />
        <Input
          label="New password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="At least 8 characters."
          autoComplete="new-password"
          disabled={saving}
        />
        <Input
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          disabled={saving}
        />
      </div>
    </Dialog>
  );
}
