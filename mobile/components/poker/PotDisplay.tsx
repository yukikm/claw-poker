import { View, Text, StyleSheet } from 'react-native';
import { formatSol } from '../../lib/format';
import { colors, fontSize, borderRadius } from '../../lib/theme';

interface PotDisplayProps {
  amount: number;
}

export function PotDisplay({ amount }: PotDisplayProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>POT</Text>
      <Text style={styles.amount}>{formatSol(amount)} SOL</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border.cyan,
  },
  label: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 2,
  },
  amount: {
    color: colors.cyan.light,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
});
