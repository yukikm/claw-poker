import { View, Text, StyleSheet } from 'react-native';
import { type GamePhase } from '../../lib/constants';
import { colors, fontSize, borderRadius } from '../../lib/theme';

interface PhaseIndicatorProps {
  phase: GamePhase;
  handNumber: number;
}

const PHASE_COLORS: Record<GamePhase, string> = {
  Waiting: colors.warning,
  Shuffling: colors.purple.DEFAULT,
  PreFlop: colors.cyan.DEFAULT,
  Flop: colors.cyan.light,
  Turn: colors.cyan.DEFAULT,
  River: colors.purple.light,
  Showdown: colors.warning,
  Finished: colors.success,
};

export function PhaseIndicator({ phase, handNumber }: PhaseIndicatorProps) {
  const phaseColor = PHASE_COLORS[phase];

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { backgroundColor: `${phaseColor}20`, borderColor: phaseColor }]}>
        <Text style={[styles.phaseText, { color: phaseColor }]}>{phase}</Text>
      </View>
      <Text style={styles.handText}>Hand #{handNumber}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  phaseText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  handText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
  },
});
