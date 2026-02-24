'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6" role="alert">
          <div className="glass rounded-2xl p-8 space-y-4">
            <h2 className="text-xl font-bold text-red-400">
              予期しないエラーが発生しました
            </h2>
            <p className="text-sm text-slate-400">
              ページの表示中にエラーが発生しました。再試行するか、ページをリロードしてください。
            </p>
            {this.state.errorMessage && (
              <p className="text-xs text-slate-500 font-mono break-all">
                {this.state.errorMessage}
              </p>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="glass-cyan rounded-lg px-6 py-2 text-sm font-semibold text-cyan-300 hover:text-white hover:shadow-neon-cyan transition-all duration-200 cursor-pointer"
              >
                再試行
              </button>
              <button
                onClick={() => window.location.reload()}
                className="glass rounded-lg px-6 py-2 text-sm text-slate-300 hover:text-white transition-all duration-200 cursor-pointer"
              >
                ページをリロード
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
