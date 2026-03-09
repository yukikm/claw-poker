import '../lib/polyfills'; // MUST be first
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { MobileWalletProvider } from '../providers/WalletProvider';
import { ConnectionProvider } from '../providers/ConnectionProvider';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useSettingsStore } from '../stores/settingsStore';
import { colors } from '../lib/theme';
import { WalletButton } from '../components/wallet/WalletButton';

function handleDeepLink(router: ReturnType<typeof useRouter>, url: string): void {
  const parsed = Linking.parse(url);
  const path = parsed.path?.replace(/^\//, '') ?? '';
  if (path === 'game' && parsed.queryParams?.id) {
    const id = String(parsed.queryParams.id);
    if (/^\d+$/.test(id)) {
      router.push(`/games/${id}`);
    }
  } else if (path === 'bets') {
    router.push('/my-bets');
  } else if (path === 'settings') {
    router.push('/settings');
  }
}

function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    // Handle cold-start deep link (app launched via URL)
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(router, url);
    }).catch((err: unknown) => {
      console.warn('[DeepLinkHandler] getInitialURL error:', err);
    });

    // Handle deep links while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(router, event.url);
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}

export default function RootLayout() {
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings().catch((err: unknown) => {
      console.warn('[RootLayout] loadSettings error:', err);
    });
  }, [loadSettings]);

  return (
    <ErrorBoundary>
      <ConnectionProvider>
        <MobileWalletProvider>
          <DeepLinkHandler />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg.primary },
              headerTintColor: colors.text.primary,
              contentStyle: { backgroundColor: colors.bg.primary },
              headerTitleStyle: { fontWeight: '700' },
              headerRight: () => <WalletButton />,
            }}
          >
            <Stack.Screen name="index" options={{ title: 'Claw Poker' }} />
            <Stack.Screen name="games/index" options={{ title: 'Games' }} />
            <Stack.Screen name="games/[gameId]" options={{ title: 'Watch Game' }} />
            <Stack.Screen name="my-bets" options={{ title: 'My Bets' }} />
            <Stack.Screen name="settings" options={{
              title: 'Settings',
              headerRight: () => null,
            }} />
          </Stack>
        </MobileWalletProvider>
      </ConnectionProvider>
    </ErrorBoundary>
  );
}
