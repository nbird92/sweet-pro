import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** When set, render this instead of the full-screen fallback (e.g. to isolate
   *  one item in a list so a single bad row doesn't blank the surrounding UI). */
  fallback?: ReactNode | ((error: Error) => ReactNode);
}
interface State { error: Error | null }

/**
 * Top-level error boundary. Catches any render-time exception (e.g. a malformed
 * PO extraction in the "Review all" flow) and shows a recoverable message
 * instead of unmounting the whole app to a blank white page.
 *
 * NOTE: this project has no @types/react installed, so React.Component's
 * generic instance members (props/setState) don't project onto the subclass in
 * the type-checker. We access them through a runtime-correct typed view (`c`)
 * to keep `tsc --noEmit` clean without disabling type safety elsewhere.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const c = this as unknown as { state: State; props: Props; setState: (s: State) => void };
    if (c.state.error) {
      const fb = c.props.fallback;
      if (fb !== undefined) {
        return typeof fb === 'function' ? (fb as (e: Error) => ReactNode)(c.state.error) : fb;
      }
      return (
        <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-mono flex items-center justify-center p-6">
          <div className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full p-8 space-y-4">
            <h1 className="text-lg font-black uppercase tracking-tight text-red-700">Something went wrong</h1>
            <p className="text-sm opacity-70">
              The app hit an unexpected error and stopped rendering. Your data is safe — nothing was saved from this action.
            </p>
            <pre className="text-[11px] bg-[#F5F5F5] border border-[#141414]/20 p-3 overflow-x-auto whitespace-pre-wrap">
              {c.state.error.message || 'Unknown error'}
            </pre>
            <div className="flex gap-3">
              <button
                onClick={() => c.setState({ error: null })}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0]"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }
    return c.props.children;
  }
}
