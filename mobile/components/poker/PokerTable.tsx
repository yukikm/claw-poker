import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { type GameState } from '../../lib/types';
import { type GamePhase } from '../../lib/constants';
import { formatAddress } from '../../lib/format';
import { colors, fontSize, borderRadius, spacing } from '../../lib/theme';
import { hapticSuccess } from '../../lib/haptics';
import { HoleCards } from './HoleCards';
import { CommunityCards } from './CommunityCards';
import { PotDisplay } from './PotDisplay';
import { PhaseIndicator } from './PhaseIndicator';
import { ActionBadge } from './ActionBadge';
import { ChipStack } from './ChipStack';
import { NeonText } from '../ui/NeonText';

interface PokerTableProps {
  game: GameState;
}

const PHASE_TRANSITION_MS = 300;

export function PokerTable({ game }: PokerTableProps) {
  const isP1Turn = game.currentTurn === 1;
  const isP2Turn = game.currentTurn === 2;

  // Phase transition animation
  const prevPhaseRef = useRef<GamePhase>(game.phase);
  const boardOpacity = useSharedValue(1);

  useEffect(() => {
    if (prevPhaseRef.current !== game.phase) {
      // Fade out then in when phase changes
      boardOpacity.value = withSequence(
        withTiming(0.3, { duration: PHASE_TRANSITION_MS / 2, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: PHASE_TRANSITION_MS / 2, easing: Easing.in(Easing.ease) })
      );
      prevPhaseRef.current = game.phase;
    }
  }, [game.phase, boardOpacity]);

  const boardAnimStyle = useAnimatedStyle(() => ({
    opacity: boardOpacity.value,
  }));

  // Winner overlay animation
  const winnerScale = useSharedValue(0);
  const winnerOpacity = useSharedValue(0);
  const winnerPulse = useSharedValue(1);

  useEffect(() => {
    if (game.winner) {
      hapticSuccess();
      winnerOpacity.value = withTiming(1, { duration: 400 });
      winnerScale.value = withSequence(
        withTiming(1.15, { duration: 300, easing: Easing.out(Easing.back(1.5)) }),
        withTiming(1, { duration: 200 })
      );
      winnerPulse.value = withDelay(
        500,
        withRepeat(
          withSequence(
            withTiming(1.05, { duration: 1000 }),
            withTiming(1, { duration: 1000 })
          ),
          -1,
          true
        )
      );
    } else {
      winnerScale.value = 0;
      winnerOpacity.value = 0;
      winnerPulse.value = 1;
    }
  }, [game.winner, winnerScale, winnerOpacity, winnerPulse]);

  const winnerOverlayStyle = useAnimatedStyle(() => ({
    opacity: winnerOpacity.value,
    transform: [{ scale: winnerOpacity.value > 0 ? 1 : 0 }],
  }));

  const winnerTextStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(winnerScale.value, [0, 1], [0.5, 1]) * winnerPulse.value },
    ],
  }));

  const winnerName = game.winner
    ? (game.winner.equals(game.player1Key)
      ? (game.player1Name ?? formatAddress(game.player1Key))
      : (game.player2Name ?? formatAddress(game.player2Key)))
    : '';

  return (
    <View style={styles.container}>
      {/* Phase Indicator */}
      <View style={styles.phaseRow}>
        <PhaseIndicator phase={game.phase} handNumber={game.handNumber} />
      </View>

      {/* Table Area */}
      <LinearGradient
        colors={['#0F2027', '#203A43', '#0F2027']}
        style={styles.table}
      >
        {/* Player 2 (Top) */}
        <View style={[styles.playerSection, isP2Turn && styles.activeTurn]}>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>
              {game.player2Name ?? formatAddress(game.player2Key)}
            </Text>
            {game.dealerPosition === 1 && <Text style={styles.dealerBadge}>D</Text>}
          </View>
          <View style={styles.playerCards}>
            <HoleCards
              cards={game.phase === 'Showdown' || game.phase === 'Finished'
                ? game.showdownCardsP2 : [{ suit: 'Spades', rank: 0, isUnknown: true }, { suit: 'Spades', rank: 0, isUnknown: true }]}
              size="sm"
            />
            <ActionBadge action={game.player2.lastAction} />
          </View>
          <View style={styles.chipRow}>
            <ChipStack amount={game.player2.chips} label="Stack" />
            {game.player2.chipsCommitted > 0 && (
              <ChipStack amount={game.player2.chipsCommitted} label="Bet" />
            )}
          </View>
          {game.player2.hasFolded && <Text style={styles.foldedText}>FOLDED</Text>}
          {game.player2.isAllIn && <NeonText color="purple" size={12} bold>ALL IN</NeonText>}
        </View>

        {/* Community Cards + Pot */}
        <Animated.View style={[styles.boardSection, boardAnimStyle]}>
          <CommunityCards cards={game.boardCards} />
          <PotDisplay amount={game.pot} />
        </Animated.View>

        {/* Player 1 (Bottom) */}
        <View style={[styles.playerSection, isP1Turn && styles.activeTurn]}>
          <View style={styles.chipRow}>
            <ChipStack amount={game.player1.chips} label="Stack" />
            {game.player1.chipsCommitted > 0 && (
              <ChipStack amount={game.player1.chipsCommitted} label="Bet" />
            )}
          </View>
          <View style={styles.playerCards}>
            <HoleCards
              cards={game.phase === 'Showdown' || game.phase === 'Finished'
                ? game.showdownCardsP1 : [{ suit: 'Spades', rank: 0, isUnknown: true }, { suit: 'Spades', rank: 0, isUnknown: true }]}
              size="sm"
            />
            <ActionBadge action={game.player1.lastAction} />
          </View>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>
              {game.player1Name ?? formatAddress(game.player1Key)}
            </Text>
            {game.dealerPosition === 0 && <Text style={styles.dealerBadge}>D</Text>}
          </View>
          {game.player1.hasFolded && <Text style={styles.foldedText}>FOLDED</Text>}
          {game.player1.isAllIn && <NeonText color="purple" size={12} bold>ALL IN</NeonText>}
        </View>
      </LinearGradient>

      {/* Winner Overlay */}
      {game.winner && (
        <Animated.View style={[styles.winnerOverlay, winnerOverlayStyle]}>
          <Animated.View style={winnerTextStyle}>
            <NeonText color="cyan" size={24} bold>Winner</NeonText>
            <View style={styles.winnerNameRow}>
              <NeonText color="white" size={18} bold>{winnerName}</NeonText>
            </View>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  phaseRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  table: {
    flex: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colors.border.cyan,
  },
  playerSection: {
    alignItems: 'center',
    gap: 4,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  activeTurn: {
    borderWidth: 1,
    borderColor: colors.cyan.glow,
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerName: {
    color: colors.text.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  dealerBadge: {
    color: colors.warning,
    fontSize: fontSize.xs,
    fontWeight: '700',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  playerCards: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 16,
  },
  boardSection: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: spacing.lg,
  },
  foldedText: {
    color: colors.error,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 2,
  },
  winnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 26, 0.88)',
    borderRadius: borderRadius.lg,
  },
  winnerNameRow: {
    marginTop: spacing.sm,
    alignItems: 'center',
  },
});
