import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Paper, Alert } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';

void React;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Names the guarded subtree in the crash log. Every mounted boundary passes
   * one, so a log line says *which* part of the window failed.
   */
  label?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component that catches JavaScript errors in child components
 * and displays a fallback UI instead of crashing the entire application.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Record the crash before anything else. `window.onerror` in main.tsx does
    // not see errors a boundary catches, so without this a caught crash leaves
    // no trace at all in the log file. Same channel the window-level handlers
    // use; logging lives here rather than in an `onError` prop so a boundary
    // cannot be added without it.
    const where = this.props.label ? ` [${this.props.label}]` : '';
    window.editorAPI?.logRendererError?.({
      message: `React render crash${where}: ${error.message}`,
      stack: `${error.stack ?? ''}\n${errorInfo.componentStack ?? ''}`,
    });

    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            p: 3
          }}
        >
          <Paper sx={{ p: 4, maxWidth: 600, width: '100%' }}>
            <Alert severity="error" sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Something went wrong
              </Typography>
              <Typography variant="body2">
                An unexpected error occurred. You can try refreshing this section
                or reload the application.
              </Typography>
            </Alert>

            {this.state.error && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Error Details:
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    bgcolor: 'background.default',
                    p: 2,
                    borderRadius: 1,
                    overflow: 'auto',
                    maxHeight: 150
                  }}
                >
                  {this.state.error.message}
                </Typography>
              </Box>
            )}

            {this.state.errorInfo && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Component Stack:
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    bgcolor: 'background.default',
                    p: 2,
                    borderRadius: 1,
                    overflow: 'auto',
                    maxHeight: 200
                  }}
                >
                  {this.state.errorInfo.componentStack}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={this.handleReset}
              >
                Try Again
              </Button>
              <Button
                variant="outlined"
                onClick={() => window.location.reload()}
              >
                Reload Application
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Render-crash injector for the boundary tests.
 *
 * Boundary behaviour is only provable by actually throwing inside the guarded
 * subtree, so each boundary mounts one of these and the Playwright harness
 * arms it with `?crash=<id>`. Vite substitutes the literal `"production"` for
 * `process.env.NODE_ENV` in the renderer build, so the whole body folds away
 * in shipped bundles; the guard is also what keeps this inert in the packaged
 * app, where a query string cannot be supplied anyway.
 */
export const CrashProbe: React.FC<{ id: string }> = ({ id }) => {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  if (new URLSearchParams(window.location.search).get('crash') === id) {
    throw new Error(`CrashProbe: forced render crash in "${id}"`);
  }
  return null;
};

export default ErrorBoundary;
