import { useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../providers/ConnectionProvider';
import { useGamesStore } from '../stores/gamesStore';
import { getProgramId } from '../lib/anchor';
import { useAppStateReconnect } from '../hooks/useAppStateReconnect';
import { colors, fontSize, spacing, borderRadius } from '../lib/theme';
import { hapticLight } from '../lib/haptics';
import { HomeStats } from '../components/home/HomeStats';
import { GameCard } from '../components/game/GameCard';
import { NeonText } from '../components/ui/NeonText';
import { AgentGuide } from '../components/home/AgentGuide';

export default function HomeScreen() {
  const router = useRouter();
  const { connection } = useConnection();
  const { games, stats, isLoading, serverConnected, startPolling, stopPolling, fetchGames } = useGamesStore();
  const programId = getProgramId();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    startPolling(connection, programId);
    return () => stopPolling();
    // programId is now a stable cached reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  const onReconnect = useCallback(() => {
    fetchGames(connectionRef.current, programId);
  }, [programId, fetchGames]);

  useAppStateReconnect(onReconnect);

  // Show top 3 active games
  const activeGames = games
    .filter((g) => g.phase !== 'Waiting' && g.phase !== 'Finished')
    .slice(0, 3);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Hero */}
      <View style={styles.hero}>
        <NeonText color="cyan" size={28} bold>Claw Poker</NeonText>
        <Text style={styles.subtitle}>AI vs AI Texas Hold'em on Solana</Text>
      </View>

      {/* Agent Guide */}
      <AgentGuide />

      {/* Stats */}
      <HomeStats stats={stats} serverConnected={serverConnected} />

      {/* Active Games */}
      {activeGames.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Games</Text>
          {activeGames.map((game) => (
            <View key={game.gamePda.toBase58()} style={styles.cardWrapper}>
              <GameCard game={game} />
            </View>
          ))}
        </View>
      )}

      {/* Navigation */}
      <View style={styles.navButtons}>
        <Pressable style={styles.navBtn} onPress={() => { hapticLight(); router.push('/games'); }} accessibilityRole="button" accessibilityLabel="View all games">
          <Text style={styles.navBtnText}>All Games</Text>
        </Pressable>
        <Pressable style={styles.navBtnSecondary} onPress={() => { hapticLight(); router.push('/my-bets'); }} accessibilityRole="button" accessibilityLabel="View my bets">
          <Text style={styles.navBtnSecondaryText}>My Bets</Text>
        </Pressable>
      </View>

      {/* Settings */}
      <View style={styles.settingsRow}>
        <Pressable onPress={() => { hapticLight(); router.push('/settings'); }} accessibilityRole="button" accessibilityLabel="Open settings">
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  content: {
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: 4,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
  },
  section: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardWrapper: {
    marginBottom: spacing.sm,
  },
  navButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  navBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.cyan.DEFAULT,
    alignItems: 'center',
  },
  navBtnText: {
    color: colors.bg.primary,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  navBtnSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.purple,
    alignItems: 'center',
  },
  navBtnSecondaryText: {
    color: colors.purple.DEFAULT,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  settingsRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  settingsText: {
    color: colors.text.muted,
    fontSize: fontSize.md,
  },
});
