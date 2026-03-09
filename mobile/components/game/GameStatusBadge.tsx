import { View, Text, StyleSheet } from 'react-native';
import { type GamePhase } from '../../lib/constants';
import { colors, fontSize, borderRadius } from '../../lib/theme';

interface GameStatusBadgeProps {
  phase: GamePhase;
  handNumber: number;
}

const PHASE_CONFIG: Record<GamePhase, { color: string; label: string }> = {
  Waiting: { color: colors.warning, label: 'Waiting' },
  Shuffling: { color: colors.purple.DEFAULT, label: 'Shuffling' },
  PreFlop: { color: colors.cyan.DEFAULT, label: 'Pre-Flop' },
  Flop: { color: colors.cyan.light, label: 'Flop' },
  Turn: { color: colors.cyan.DEFAULT, label: 'Turn' },
  River: { color: colors.purple.light, label: 'River' },
  Showdown: { color: colors.warning, label: 'Showdown' },
  Finished: { color: colors.success, label: 'Finished' },
};

export function GameStatusBadge({ phase, handNumber }: GameStatusBadgeProps) {
  const config = PHASE_CONFIG[phase];

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: `${config.color}20`, borderColor: config.color }]}>
        <View style={[styles.dot, { backgroundColor: config.color }]} />
        <Text style={[styles.text, { color: config.color }]}>{config.label}</Text>
      </View>
      {handNumber > 0 && (
        <Text style={styles.hand}>#{handNumber}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  hand: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
  },
});
