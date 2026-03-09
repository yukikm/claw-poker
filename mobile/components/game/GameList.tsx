import { FlatList, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { type GameSummary } from '../../lib/types';
import { type GamePhase } from '../../lib/constants';
import { colors, fontSize, spacing } from '../../lib/theme';
import { hapticMedium } from '../../lib/haptics';
import { GameCard } from './GameCard';

interface GameListProps {
  games: GameSummary[];
  isLoading: boolean;
  onRefresh: () => void;
  serverConnected: boolean;
}

const PHASE_PRIORITY: Record<GamePhase, number> = {
  PreFlop: 0, Flop: 0, Turn: 0, River: 0, Showdown: 0,
  Shuffling: 1,
  Finished: 2,
  Waiting: 3,
};

export function GameList({ games, isLoading, onRefresh, serverConnected }: GameListProps) {
  const sortedGames = [...games].sort((a, b) => {
    const aIsStale = a.phase === 'Waiting' && a.handNumber === 0;
    const bIsStale = b.phase === 'Waiting' && b.handNumber === 0;
    if (aIsStale !== bIsStale) return aIsStale ? 1 : -1;
    const aPriority = PHASE_PRIORITY[a.phase] ?? 3;
    const bPriority = PHASE_PRIORITY[b.phase] ?? 3;
    return aPriority - bPriority;
  });

  if (games.length === 0 && !isLoading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {serverConnected ? 'No games found.' : 'Server offline. No games available.'}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sortedGames}
      keyExtractor={(item) => item.gamePda.toBase58()}
      renderItem={({ item }) => <GameCard game={item} />}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={() => { hapticMedium(); onRefresh(); }}
          tintColor={colors.cyan.DEFAULT}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
  },
  separator: {
    height: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
});
