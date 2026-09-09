import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, User } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Feedback';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/errors';

export default function AdminLoginPage() {
  const { loginAdmin, loading } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  // If no admin account exists yet, point the very first user at setup rather
  // than letting them guess at a login that cannot possibly work.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ needsSetup: boolean }>('/setup')
      .then((result) => {
        if (!cancelled) setNeedsSetup(result.needsSetup);
      })
      .catch(() => {
        /* Not being able to check is not worth bothering the user about. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter both your username and password.');
      return;
    }

    try {
      await loginAdmin(username, password);
      navigate('/admin', { replace: true });
    } catch (cause) {
      setError(friendlyError(cause, 'Could not sign you in. Please try again.'));
      setPassword('');
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Use the username and password given to you by your team."
      footer={
        <Link to="/login/bdm" className="font-medium text-brand-700 hover:text-brand-800">
          Are you a BDM? Sign in here
        </Link>
      }
    >
      {needsSetup && (
        <Alert tone="info" title="No admin account exists yet" className="mb-5">
          <Link to="/setup" className="font-medium underline underline-offset-2">
            Create the first Super Admin account
          </Link>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your.username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          leftIcon={<User className="size-4" />}
          disabled={loading}
          required
        />

        <Input
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          autoComplete="current-password"
          leftIcon={<KeyRound className="size-4" />}
          disabled={loading}
          required
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />

        <Button type="submit" size="lg" fullWidth loading={loading}>
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-center text-xs leading-relaxed text-slate-400">
        Forgotten your password? Ask another Super Admin to reset it for you from Admin
        Management.
      </p>
    </AuthShell>
  );
}
