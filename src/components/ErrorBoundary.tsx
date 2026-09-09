import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches any unexpected crash so the user sees a helpful screen with a way
 * out, instead of a blank white page. Requirement 37.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app crash]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card w-full max-w-lg p-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <TriangleAlert className="size-7" />
          </div>

          <h1 className="text-lg font-semibold text-slate-900">
            Something went wrong
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The page ran into an unexpected problem. Reloading usually fixes it.
          </p>

          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-500">
            {error.message}
          </pre>

          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            <RefreshCw className="size-4" />
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
