import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';

export default function NotFoundPage() {
  const { session } = useAuth();
  const home = session ? (session.role === 'super_admin' ? '/admin' : '/bdm') : '/';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Compass className="size-7" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
          The page you were looking for does not exist, or you no longer have access to it.
        </p>
        <Link to={home}>
          <Button className="mt-6">Go back</Button>
        </Link>
      </div>
    </main>
  );
}
