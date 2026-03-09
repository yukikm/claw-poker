import { View, Text, StyleSheet } from 'react-native';
import { formatSol } from '../../lib/format';
import { colors, fontSize } from '../../lib/theme';

interface ChipStackProps {
  amount: number;
  label?: string;
}

export function ChipStack({ amount, label }: ChipStackProps) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Text style={styles.amount}>{formatSol(amount)} SOL</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
  },
  amount: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
