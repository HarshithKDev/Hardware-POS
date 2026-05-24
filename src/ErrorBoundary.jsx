import { Component } from 'react';

/**
 * React Error Boundary that catches render-time exceptions
 * in any descendant component and shows a friendly fallback UI
 * instead of a white screen crash.
 *
 * Usage: <ErrorBoundary><App /></ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="w-full min-h-screen flex flex-col items-center justify-center p-8"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          role="alert"
          aria-live="assertive"
        >
          <div
            className="max-w-md w-full p-8 border"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-medium)',
            }}
          >
            <h1 className="text-xl font-light mb-4">Something went wrong</h1>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              An unexpected error occurred. Your data is safe — please reload the page to continue.
            </p>
            {this.state.error && (
              <pre
                className="text-xs p-3 mb-6 overflow-auto max-h-32 border"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  borderColor: 'var(--border-light)',
                  color: 'var(--color-error)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              className="w-full h-10 text-white text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1"
              style={{ backgroundColor: 'var(--color-accent)', focusRingColor: 'var(--color-accent)' }}
              onMouseEnter={(e) => (e.target.style.backgroundColor = 'var(--color-accent-hover)')}
              onMouseLeave={(e) => (e.target.style.backgroundColor = 'var(--color-accent)')}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
