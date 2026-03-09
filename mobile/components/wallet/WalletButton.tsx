import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useWallet } from '../../providers/WalletProvider';
import { useConnection } from '../../providers/ConnectionProvider';
import { formatAddress, formatSol } from '../../lib/format';
import { colors, fontSize, borderRadius } from '../../lib/theme';
import { hapticLight } from '../../lib/haptics';

export function WalletButton() {
  const { publicKey, connected, connecting, connect, disconnect } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalance(null);
      return;
    }
    const fetchBalance = async () => {
      try {
        const bal = await connection.getBalance(publicKey);
        setBalance(bal);
      } catch {
        setBalance(null);
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 10_000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection]);

  if (!connected) {
    return (
      <Pressable
        style={styles.connectButton}
        onPress={() => { hapticLight(); connect(); }}
        disabled={connecting}
        accessibilityRole="button"
        accessibilityLabel={connecting ? 'Connecting wallet' : 'Connect wallet'}
        accessibilityState={{ disabled: connecting }}
      >
        <Text style={styles.connectText}>
          {connecting ? 'Connecting...' : 'Connect Wallet'}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.connectedContainer} onPress={() => { hapticLight(); disconnect(); }} accessibilityRole="button" accessibilityLabel="Disconnect wallet">
      <Text style={styles.address}>{formatAddress(publicKey!.toString())}</Text>
      {balance !== null && (
        <Text style={styles.balance}>{formatSol(balance)} SOL</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  connectButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.cyan.DEFAULT,
  },
  connectText: {
    color: colors.bg.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  connectedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.cyan,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
  },
  address: {
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  balance: {
    color: colors.cyan.DEFAULT,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
