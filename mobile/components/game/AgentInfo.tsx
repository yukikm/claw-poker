import { View, Text, StyleSheet } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { formatAddress } from '../../lib/format';
import { colors, fontSize } from '../../lib/theme';

interface AgentInfoProps {
  address: PublicKey;
  name: string | null;
  isWinner?: boolean;
  label?: string;
}

export function AgentInfo({ address, name, isWinner, label }: AgentInfoProps) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Text style={[styles.name, isWinner && styles.winner]}>
        {name ?? formatAddress(address)}
      </Text>
      {isWinner && <Text style={styles.winnerBadge}>Winner</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: colors.text.muted,
    fontSize: fontSize.xs,
  },
  name: {
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  winner: {
    color: colors.cyan.DEFAULT,
  },
  winnerBadge: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.xs,
    fontWeight: '700',
    backgroundColor: 'rgba(6, 182, 212, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
