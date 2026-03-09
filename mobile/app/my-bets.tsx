import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useMyBetsStore } from '../stores/myBetsStore';
import { formatSol, formatTimestamp, formatAddress } from '../lib/format';
import { colors, fontSize, spacing, borderRadius } from '../lib/theme';
import { GlassCard } from '../components/ui/GlassCard';
import { ClaimButton } from '../components/betting/ClaimButton';

const STATUS_COLORS: Record<string, string> = {
  active: colors.cyan.DEFAULT,
  won: colors.success,
  lost: colors.error,
  claimed: colors.text.muted,
};

export default function MyBetsScreen() {
  const { bets } = useMyBetsStore();

  if (bets.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No bets yet. Watch a game and place your first bet!</Text>
      </View>
    );
  }

  const sortedBets = [...bets].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <FlatList
      data={sortedBets}
      keyExtractor={(item) => item.betRecordPda}
      style={styles.container}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <GlassCard padding={12}>
          <View style={styles.betHeader}>
            <Text style={styles.gameId}>Game: {formatAddress(item.gamePda)}</Text>
            <View style={[styles.statusBadge, { borderColor: STATUS_COLORS[item.status] }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
                {item.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.betDetails}>
            <Text style={styles.detailText}>Player {item.playerChoice}</Text>
            <Text style={styles.amountText}>{formatSol(item.amount)} SOL</Text>
          </View>
          <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
          {item.status === 'won' && (
            <View style={styles.claimSection}>
              <ClaimButton gameId={item.gameId} bettingPoolPda={item.bettingPoolPda} betRecordPda={item.betRecordPda} payout={item.payout} />
            </View>
          )}
        </GlassCard>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  list: {
    padding: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg.primary,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  betHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  gameId: {
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  betDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
  },
  amountText: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  timestamp: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    marginTop: 4,
  },
  claimSection: {
    marginTop: 8,
  },
  separator: {
    height: spacing.sm,
  },
});
