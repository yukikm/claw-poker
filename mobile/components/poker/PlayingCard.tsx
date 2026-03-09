import { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { type CardDisplay } from '../../lib/types';
import { CARD_RANKS } from '../../lib/constants';
import { colors, borderRadius } from '../../lib/theme';

interface PlayingCardProps {
  card: CardDisplay;
  size?: 'sm' | 'md' | 'lg';
  /** Stagger delay in ms for cascade entrance */
  delay?: number;
  /** Enable flip animation when card transitions from unknown to known */
  animate?: boolean;
}

const SUIT_SYMBOLS: Record<string, string> = {
  Spades: '\u2660',
  Hearts: '\u2665',
  Diamonds: '\u2666',
  Clubs: '\u2663',
};

const SUIT_COLORS: Record<string, string> = {
  Spades: '#FFFFFF',
  Hearts: '#EF4444',
  Diamonds: '#EF4444',
  Clubs: '#FFFFFF',
};

const SIZES = {
  sm: { width: 36, height: 52, fontSize: 12, suitSize: 14 },
  md: { width: 48, height: 68, fontSize: 16, suitSize: 18 },
  lg: { width: 60, height: 84, fontSize: 20, suitSize: 22 },
};

const FLIP_DURATION = 400;
const ENTRANCE_DURATION = 300;

export function PlayingCard({ card, size = 'md', delay = 0, animate = true }: PlayingCardProps) {
  const dims = SIZES[size];

  // Entrance animation (scale + fade in)
  const entrance = useSharedValue(animate ? 0 : 1);
  // Flip animation (0 = face down, 1 = face up)
  const flip = useSharedValue(card.isUnknown ? 0 : 1);

  useEffect(() => {
    if (animate) {
      entrance.value = withDelay(
        delay,
        withTiming(1, { duration: ENTRANCE_DURATION, easing: Easing.out(Easing.back(1.2)) })
      );
    }
  }, [animate, delay, entrance]);

  useEffect(() => {
    const target = card.isUnknown ? 0 : 1;
    if (flip.value !== target) {
      flip.value = withTiming(target, { duration: FLIP_DURATION, easing: Easing.inOut(Easing.ease) });
    }
  }, [card.isUnknown, flip]);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: interpolate(entrance.value, [0, 1], [0.7, 1]) }],
  }));

  // Front face (visible when flip > 0.5)
  const frontStyle = useAnimatedStyle(() => ({
    opacity: flip.value > 0.5 ? 1 : 0,
    transform: [
      { perspective: 600 },
      { rotateY: `${interpolate(flip.value, [0.5, 1], [-90, 0])}deg` },
    ],
  }));

  // Back face (visible when flip <= 0.5)
  const backStyle = useAnimatedStyle(() => ({
    opacity: flip.value <= 0.5 ? 1 : 0,
    transform: [
      { perspective: 600 },
      { rotateY: `${interpolate(flip.value, [0, 0.5], [0, 90])}deg` },
    ],
  }));

  const rankStr = CARD_RANKS[card.rank] ?? '?';
  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? '';
  const suitColor = SUIT_COLORS[card.suit] ?? '#FFFFFF';

  return (
    <Animated.View style={[{ width: dims.width, height: dims.height, marginHorizontal: 2 }, entranceStyle]}>
      {/* Back face */}
      <Animated.View
        style={[styles.card, styles.faceDown, { width: dims.width, height: dims.height, position: 'absolute' }, backStyle]}
        accessibilityLabel="Hidden card"
      >
        <Text style={[styles.backText, { fontSize: dims.suitSize }]}>?</Text>
      </Animated.View>

      {/* Front face */}
      <Animated.View
        style={[styles.card, styles.faceUp, { width: dims.width, height: dims.height, position: 'absolute' }, frontStyle]}
        accessibilityLabel={card.isUnknown ? 'Hidden card' : `${rankStr} of ${card.suit}`}
      >
        <Text style={[styles.rank, { color: suitColor, fontSize: dims.fontSize }]}>{rankStr}</Text>
        <Text style={[styles.suit, { color: suitColor, fontSize: dims.suitSize }]}>{suitSymbol}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceUp: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  faceDown: {
    backgroundColor: '#1E3A5F',
    borderWidth: 1,
    borderColor: colors.cyan.dark,
  },
  backText: {
    color: colors.cyan.DEFAULT,
    fontWeight: '700',
  },
  rank: {
    fontWeight: '700',
    position: 'absolute',
    top: 4,
    left: 6,
  },
  suit: {
    position: 'absolute',
    bottom: 4,
    right: 6,
  },
});
