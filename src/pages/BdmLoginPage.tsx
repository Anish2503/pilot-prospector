import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Alert, LoadingBlock } from '@/components/ui/Feedback';
import { PinInput } from '@/components/ui/PinInput';
import { fetchBdmOptions, useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import type { BdmOption } from '@/types';

/**
 * Two taps and four digits: pick your name, enter your PIN.
 * The PIN is what actually proves who you are - the name alone would let
 * anyone with the link read another BDM's societies and POC numbers.
 */
export default function BdmLoginPage() {
  const { loginBdm, loading } = useAuth();
  const navigate = useNavigate();

  const [bdms, setBdms] = useState<BdmOption[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [bdmId, setBdmId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBdmOptions()
      .then((result) => {
        if (cancelled) return;
        setBdms(result.bdms);
        // With only one BDM on the account, skip the dropdown entirely.
        if (result.bdms.length === 1) setBdmId(result.bdms[0]!.id);
      })
      .catch((cause) => {
        if (!cancelled) setListError(friendlyError(cause, 'Could not load the list of BDMs.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(pinValue: string) {
    if (!bdmId) {
      setError('Please select your name first.');
      return;
    }
    if (pinValue.length !== 4) {
      setError('Please enter your 4-digit PIN.');
      return;
    }

    setError(null);
    try {
      await loginBdm(bdmId, pinValue);
      navigate('/bdm', { replace: true });
    } catch (cause) {
      setError(friendlyError(cause, 'Could not sign you in. Please try again.'));
      setPin('');
    }
  }

  // ---------------------------------------------------------------- Loading
  if (!bdms && !listError) {
    return (
      <AuthShell title="BDM sign in">
        <LoadingBlock label="Loading your team..." />
      </AuthShell>
    );
  }

  // ------------------------------------------------------------ List failed
  if (listError) {
    return (
      <AuthShell title="BDM sign in">
        <Alert tone="error" title="Could not load the BDM list">
          {listError}
        </Alert>
        <Button
          variant="secondary"
          fullWidth
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </AuthShell>
    );
  }

  // ------------------------------------------------------------- No BDMs yet
  if (bdms && bdms.length === 0) {
    return (
      <AuthShell title="BDM sign in">
        <Alert tone="info" title="No BDMs have been added yet">
          Ask your admin to add you under BDM Management, then sign in here.
        </Alert>
      </AuthShell>
    );
  }

  const selectedName = bdms?.find((b) => b.id === bdmId)?.name;

  return (
    <AuthShell
      title="BDM sign in"
      subtitle="Select your name and enter your 4-digit PIN."
      footer={
        <Link to="/login/admin" className="font-medium text-brand-700 hover:text-brand-800">
          Are you an admin? Sign in here
        </Link>
      }
    >
      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <Select
          label="Your name"
          value={bdmId}
          onChange={(e) => {
            setBdmId(e.target.value);
            setPin('');
            setError(null);
          }}
          placeholder="Select your name"
          options={(bdms ?? []).map((b) => ({ value: b.id, label: b.name }))}
          disabled={loading}
          className="h-12 text-base"
        />

        {bdmId && (
          <div className="animate-fade-in-up">
            <p className="mb-3 flex items-center justify-center gap-2 text-sm text-slate-600">
              <UserRound className="size-4 text-slate-400" aria-hidden />
              Enter the PIN for <strong className="font-semibold">{selectedName}</strong>
            </p>

            <PinInput
              value={pin}
              onChange={(next) => {
                setPin(next);
                setError(null);
              }}
              onComplete={submit}
              disabled={loading}
              error={Boolean(error)}
              autoFocus
            />

            <Button
              size="lg"
              fullWidth
              className="mt-6"
              loading={loading}
              disabled={pin.length !== 4}
              onClick={() => submit(pin)}
            >
              Sign in
            </Button>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
        Forgotten your PIN? Ask your admin to reset it. You stay signed in on this phone for 30
        days.
      </p>
    </AuthShell>
  );
}
