import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

// App-wide error boundary: catches render-time errors anywhere below it and shows a
// friendly recovery fallback instead of a blank screen. "Try again" clears the error so
// the subtree re-renders.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // NON-PRODUCTION: log to the console only (no external reporting, no real user data).
    console.error("[ErrorBoundary] caught", error, info.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            This page hit an unexpected error. Your synthetic demo data is safe — nothing was lost.
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-4 rounded-ogc border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
