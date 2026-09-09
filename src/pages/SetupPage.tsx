import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, KeyRound, ShieldCheck, User } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

/**
 * Creates the very first Super Admin. Runs once, then locks itself.
 */
export default function SetupPage() {
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [done, setDone] = useState(false);

  const [setupSecret, setSetupSecret] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>('/setup')
      .then((result) => setNeedsSetup(result.needsSetup))
      .catch((cause) => setError(friendlyError(cause)))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Please choose a password of at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      await api.postAnonymous('/setup', {
        setupSecret: setupSecret.trim(),
        name: name.trim(),
        username: username.trim().toLowerCase(),
        password,
      });
      setDone(true);
    } catch (cause) {
      setError(friendlyError(cause, 'Could not create the account.'));
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <AuthShell title="Setup">
        <LoadingBlock label="Checking..." />
      </AuthShell>
    );
  }

  // ------------------------------------------------------------------- Done
  if (done) {
    return (
      <AuthShell title="You are all set" backTo={null}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-7" />
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            Your Super Admin account <strong>{username}</strong> has been created.
          </p>
          <Alert tone="warning" className="mt-5 text-left">
            For safety, remove <code className="font-mono text-xs">SETUP_SECRET</code> from your
            Netlify environment variables now. You will not need it again.
          </Alert>
          <Button
            size="lg"
            fullWidth
            className="mt-5"
            onClick={() => navigate('/login/admin', { replace: true })}
          >
            Go to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  // ------------------------------------------------------- Already set up
  if (!needsSetup) {
    return (
      <AuthShell title="Setup already complete">
        <Alert tone="info" title="An admin account already exists">
          Sign in, then create further Super Admins from Admin Management inside the app.
        </Alert>
        <Link to="/login/admin">
          <Button size="lg" fullWidth className="mt-5">
            Go to admin sign in
          </Button>
        </Link>
      </AuthShell>
    );
  }

  // ------------------------------------------------------------------ Form
  return (
    <AuthShell
      title="Create the first Super Admin"
      subtitle="This runs only once. Afterwards, admins are created from inside the app."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="Setup code"
          value={setupSecret}
          onChange={(e) => setSetupSecret(e.target.value)}
          placeholder="The SETUP_SECRET you added in Netlify"
          hint="This is the value you set as SETUP_SECRET in your environment variables."
          leftIcon={<ShieldCheck className="size-4" />}
          autoComplete="off"
          disabled={saving}
          required
        />

        <hr className="border-slate-200" />

        <Input
          label="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Priya Sharma"
          leftIcon={<User className="size-4" />}
          autoComplete="name"
          disabled={saving}
          required
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
          autoComplete="username"
          disabled={saving}
          required
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters. Use something you do not use elsewhere."
          leftIcon={<KeyRound className="size-4" />}
          autoComplete="new-password"
          disabled={saving}
          required
        />

        <Input
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          leftIcon={<KeyRound className="size-4" />}
          autoComplete="new-password"
          disabled={saving}
          required
        />

        <Button type="submit" size="lg" fullWidth loading={saving}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
