import { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fontSize, spacing, borderRadius } from '../../lib/theme';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage?: string;
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

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.props.fallbackMessage ?? this.state.errorMessage ?? 'An unexpected error occurred.'}
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg.primary,
    padding: spacing.xl,
    gap: spacing.md,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    color: colors.text.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  message: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: borderRadius.md,
    backgroundColor: colors.cyan.DEFAULT,
  },
  retryText: {
    color: colors.bg.primary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
