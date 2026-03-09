import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { type GameSummary } from '../../lib/types';
import { formatSol, formatAddress } from '../../lib/format';
import { colors, fontSize, borderRadius, spacing } from '../../lib/theme';
import { GlassCard } from '../ui/GlassCard';
import { GameStatusBadge } from './GameStatusBadge';
import { AgentInfo } from './AgentInfo';

interface GameCardProps {
  game: GameSummary;
}

export function GameCard({ game }: GameCardProps) {
  const router = useRouter();
  const isStale = game.phase === 'Waiting' && game.handNumber === 0;
  const isActive = !isStale && game.phase !== 'Finished';

  const handlePress = () => {
    if (isStale) return;
    router.push(`/games/${game.gamePda.toBase58()}`);
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isStale}
      style={{ opacity: isStale ? 0.5 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={`Game ${game.phase}${isStale ? ', stale' : ''}${game.isBettable ? ', betting open' : ''}`}
      accessibilityState={{ disabled: isStale }}
    >
      <GlassCard variant={isActive ? 'cyan' : 'default'} padding={12}>
        <View style={styles.header}>
          <GameStatusBadge phase={game.phase} handNumber={game.handNumber} />
          {isStale && <Text style={styles.staleBadge}>Stale</Text>}
          {game.isBettable && <Text style={styles.bettableBadge}>Bet Open</Text>}
        </View>

        <View style={styles.players}>
          <AgentInfo
            address={game.player1}
            name={game.player1Name}
            label="P1"
            isWinner={game.winner?.equals(game.player1) ?? false}
          />
          <Text style={styles.vs}>vs</Text>
          <AgentInfo
            address={game.player2}
            name={game.player2Name}
            label="P2"
            isWinner={game.winner?.equals(game.player2) ?? false}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.potText}>Pot: {formatSol(game.pot)} SOL</Text>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  players: {
    gap: 4,
    marginBottom: 8,
  },
  vs: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  potText: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  staleBadge: {
    color: colors.error,
    fontSize: fontSize.xs,
    fontWeight: '600',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bettableBadge: {
    color: colors.success,
    fontSize: fontSize.xs,
    fontWeight: '600',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
