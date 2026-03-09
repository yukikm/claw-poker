import { View, Pressable, Text, StyleSheet, Alert } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { colors, fontSize, borderRadius } from '../../lib/theme';
import { formatSol } from '../../lib/format';
import { hapticMedium, hapticSuccess, hapticError } from '../../lib/haptics';
import { useWallet } from '../../providers/WalletProvider';
import { useClaimReward } from '../../hooks/useClaimReward';

interface ClaimButtonProps {
  gameId: string;
  bettingPoolPda: string;
  betRecordPda: string;
  payout: number | null;
}

export function ClaimButton({ gameId, bettingPoolPda, betRecordPda, payout }: ClaimButtonProps) {
  const { connected } = useWallet();
  const { claimReward, isLoading, error } = useClaimReward();

  const handleClaim = async () => {
    if (!connected) {
      Alert.alert('Wallet Required', 'Connect wallet to claim.');
      return;
    }

    let gameIdBigInt: bigint;
    let poolPubkey: PublicKey;
    let betPubkey: PublicKey;
    try {
      gameIdBigInt = BigInt(gameId);
      poolPubkey = new PublicKey(bettingPoolPda);
      betPubkey = new PublicKey(betRecordPda);
    } catch (err) {
      console.error('[ClaimButton] Invalid bet data:', err);
      Alert.alert('Error', 'Invalid bet data. Please try again.');
      return;
    }

    hapticMedium();
    const txSig = await claimReward(gameIdBigInt, poolPubkey, betPubkey);

    if (txSig) {
      hapticSuccess();
      Alert.alert('Reward Claimed', `Transaction: ${txSig.slice(0, 8)}...`);
    } else {
      hapticError();
    }
  };

  return (
    <View>
      <Pressable
        style={[styles.button, isLoading && styles.disabled]}
        onPress={handleClaim}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel={payout ? `Claim ${formatSol(payout)} SOL reward` : 'Claim reward'}
        accessibilityState={{ disabled: isLoading }}
      >
        <Text style={styles.text}>
          {isLoading
            ? 'Claiming...'
            : payout
              ? `Claim ${formatSol(payout)} SOL`
              : 'Claim Reward'}
        </Text>
      </Pressable>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.success,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.xs,
    marginTop: 4,
  },
});
