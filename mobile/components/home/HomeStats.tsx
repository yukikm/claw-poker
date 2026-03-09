import { View, Text, StyleSheet } from 'react-native';
import { type GamesStats } from '../../stores/gamesStore';
import { formatSol } from '../../lib/format';
import { colors, fontSize, borderRadius, spacing } from '../../lib/theme';
import { GlassCard } from '../ui/GlassCard';

interface HomeStatsProps {
  stats: GamesStats;
  serverConnected: boolean;
}

export function HomeStats({ stats, serverConnected }: HomeStatsProps) {
  return (
    <View style={styles.container}>
      {!serverConnected && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Server Offline</Text>
        </View>
      )}
      <View style={styles.grid}>
        <StatCard label="Total Games" value={stats.totalGames.toString()} />
        <StatCard label="Active" value={stats.activeGames.toString()} color={colors.success} />
        <StatCard label="Total Bets" value={`${formatSol(stats.totalBetsLamports)} SOL`} color={colors.cyan.DEFAULT} />
        <StatCard label="Bettors" value={stats.totalBettors.toString()} color={colors.purple.DEFAULT} />
      </View>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <GlassCard style={styles.statCard} padding={12}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : undefined]}>{value}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  offlineBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  offlineText: {
    color: colors.error,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    width: '48%',
    flexGrow: 1,
  },
  statLabel: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginBottom: 4,
  },
  statValue: {
    color: colors.text.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
});
