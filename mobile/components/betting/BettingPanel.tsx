import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { type GameState, type BettingPoolState } from '../../lib/types';
import { formatSol, formatAddress, formatOdds } from '../../lib/format';
import { LAMPORTS_PER_SOL, MIN_BET_LAMPORTS, MAX_BET_LAMPORTS } from '../../lib/constants';
import { colors, fontSize, borderRadius, spacing } from '../../lib/theme';
import { hapticSelection, hapticMedium, hapticSuccess, hapticError } from '../../lib/haptics';
import { GlassCard } from '../ui/GlassCard';
import { OddsDisplay } from './OddsDisplay';
import { useWallet } from '../../providers/WalletProvider';
import { usePlaceBet } from '../../hooks/usePlaceBet';

interface BettingPanelProps {
  game: GameState;
  bettingPool: BettingPoolState | null;
}

const BET_PRESETS = [0.1, 0.5, 1.0, 5.0];

export function BettingPanel({ game, bettingPool }: BettingPanelProps) {
  const { connected, publicKey } = useWallet();
  const { placeBet, isLoading: isSubmitting, error: betError, clearError } = usePlaceBet();
  const [selectedPlayer, setSelectedPlayer] = useState<1 | 2>(1);
  const [betAmount, setBetAmount] = useState('0.1');
  const [showConfirm, setShowConfirm] = useState(false);
  const [lastTxSig, setLastTxSig] = useState<string | null>(null);

  const isBettable =
    game.phase !== 'Waiting' &&
    game.phase !== 'Finished' &&
    game.phase !== 'Showdown' &&
    !(bettingPool?.isClosed ?? false);

  const amountLamports = Math.floor(parseFloat(betAmount || '0') * LAMPORTS_PER_SOL);
  const isValidAmount = amountLamports >= MIN_BET_LAMPORTS && amountLamports <= MAX_BET_LAMPORTS;

  // Estimated payout
  const { odds1, odds2 } = formatOdds(
    bettingPool?.totalBetPlayer1 ?? 0,
    bettingPool?.totalBetPlayer2 ?? 0
  );
  const selectedOdds = selectedPlayer === 1 ? odds1 : odds2;
  const estimatedPayout = selectedOdds !== '---'
    ? (parseFloat(betAmount || '0') * parseFloat(selectedOdds)).toFixed(3)
    : '---';

  const handlePlaceBet = async () => {
    if (!connected || !publicKey) {
      Alert.alert('Wallet Required', 'Please connect your wallet first.');
      return;
    }
    if (!isValidAmount) {
      Alert.alert('Invalid Amount', `Bet must be between ${formatSol(MIN_BET_LAMPORTS)} and ${formatSol(MAX_BET_LAMPORTS)} SOL.`);
      return;
    }

    if (!showConfirm) {
      hapticMedium();
      setShowConfirm(true);
      clearError();
      return;
    }

    const txSig = await placeBet({
      gameId: game.gameId,
      bettingPoolPda: game.bettingPoolPda,
      playerChoice: selectedPlayer,
      amount: amountLamports,
    });

    if (txSig) {
      hapticSuccess();
      setLastTxSig(txSig);
      setShowConfirm(false);
      Alert.alert('Bet Placed', `Transaction: ${txSig.slice(0, 8)}...`);
    } else {
      hapticError();
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
    clearError();
  };

  return (
    <GlassCard variant="purple" padding={16}>
      <Text style={styles.title}>Place Your Bet</Text>

      {bettingPool && (
        <OddsDisplay
          totalBetPlayer1={bettingPool.totalBetPlayer1}
          totalBetPlayer2={bettingPool.totalBetPlayer2}
          player1Name={game.player1Name ?? formatAddress(game.player1Key)}
          player2Name={game.player2Name ?? formatAddress(game.player2Key)}
        />
      )}

      {/* Player Selection */}
      <View style={styles.playerSelection}>
        <Pressable
          style={[styles.playerBtn, selectedPlayer === 1 && styles.playerBtnActive]}
          onPress={() => { hapticSelection(); setSelectedPlayer(1); setShowConfirm(false); clearError(); }}
          accessibilityRole="button"
          accessibilityLabel={`Select Player 1: ${game.player1Name ?? formatAddress(game.player1Key)}`}
          accessibilityState={{ selected: selectedPlayer === 1 }}
        >
          <Text style={[styles.playerBtnText, selectedPlayer === 1 && styles.playerBtnTextActive]}>
            P1: {game.player1Name ?? formatAddress(game.player1Key)}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.playerBtn, selectedPlayer === 2 && styles.playerBtnActive]}
          onPress={() => { hapticSelection(); setSelectedPlayer(2); setShowConfirm(false); clearError(); }}
          accessibilityRole="button"
          accessibilityLabel={`Select Player 2: ${game.player2Name ?? formatAddress(game.player2Key)}`}
          accessibilityState={{ selected: selectedPlayer === 2 }}
        >
          <Text style={[styles.playerBtnText, selectedPlayer === 2 && styles.playerBtnTextActive]}>
            P2: {game.player2Name ?? formatAddress(game.player2Key)}
          </Text>
        </Pressable>
      </View>

      {/* Amount Input */}
      <View style={styles.amountRow}>
        <TextInput
          style={styles.input}
          value={betAmount}
          onChangeText={(v) => { setBetAmount(v); setShowConfirm(false); clearError(); }}
          keyboardType="decimal-pad"
          placeholder="0.1"
          placeholderTextColor={colors.text.muted}
          editable={!isSubmitting}
          accessibilityLabel="Bet amount in SOL"
          accessibilityHint="Enter the amount you want to bet"
        />
        <Text style={styles.solLabel}>SOL</Text>
      </View>

      {/* Presets */}
      <View style={styles.presets}>
        {BET_PRESETS.map((preset) => (
          <Pressable
            key={preset}
            style={[styles.presetBtn, betAmount === preset.toString() && styles.presetBtnActive]}
            onPress={() => { hapticSelection(); setBetAmount(preset.toString()); setShowConfirm(false); clearError(); }}
            disabled={isSubmitting}
          >
            <Text style={[styles.presetText, betAmount === preset.toString() && styles.presetTextActive]}>
              {preset}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Estimated Payout */}
      {isValidAmount && (
        <View style={styles.payoutRow}>
          <Text style={styles.payoutLabel}>Est. Payout:</Text>
          <Text style={styles.payoutValue}>{estimatedPayout} SOL</Text>
        </View>
      )}

      {/* Error */}
      {betError && (
        <Text style={styles.errorText}>{betError}</Text>
      )}

      {/* Submit / Confirm */}
      {showConfirm ? (
        <View style={styles.confirmRow}>
          <Pressable style={styles.cancelBtn} onPress={handleCancel} disabled={isSubmitting} accessibilityRole="button" accessibilityLabel="Cancel bet">
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.confirmBtn, isSubmitting && styles.submitBtnDisabled]}
            onPress={handlePlaceBet}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={`Confirm bet of ${betAmount} SOL on Player ${selectedPlayer}`}
          >
            <Text style={styles.submitText}>
              {isSubmitting ? 'Sending...' : 'Confirm'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.submitBtn, (!isBettable || !isValidAmount) && styles.submitBtnDisabled]}
          onPress={handlePlaceBet}
          disabled={!isBettable || !isValidAmount || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel={!isBettable ? 'Betting is closed' : !isValidAmount ? 'Invalid bet amount' : `Place bet of ${betAmount} SOL`}
          accessibilityState={{ disabled: !isBettable || !isValidAmount || isSubmitting }}
        >
          <Text style={styles.submitText}>
            {!isBettable ? 'Betting Closed' : !isValidAmount ? 'Invalid Amount' : 'Place Bet'}
          </Text>
        </Pressable>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text.primary,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: 12,
  },
  playerSelection: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  playerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
  },
  playerBtnActive: {
    borderColor: colors.purple.DEFAULT,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  playerBtnText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  playerBtnTextActive: {
    color: colors.purple.light,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text.primary,
    fontSize: fontSize.lg,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  solLabel: {
    color: colors.text.secondary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  presets: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
  },
  presetBtnActive: {
    borderColor: colors.purple.DEFAULT,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  presetText: {
    color: colors.text.secondary,
    fontSize: fontSize.sm,
  },
  presetTextActive: {
    color: colors.purple.light,
  },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  payoutLabel: {
    color: colors.text.muted,
    fontSize: fontSize.sm,
  },
  payoutValue: {
    color: colors.success,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
    marginTop: 8,
  },
  submitBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.purple.DEFAULT,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: colors.text.muted,
    opacity: 0.5,
  },
  submitText: {
    color: colors.text.primary,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.text.secondary,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.purple.DEFAULT,
    alignItems: 'center',
  },
});
