import { useState, useCallback } from 'react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getReadOnlyProgram, getProgramId } from '../lib/anchor';
import { useConnection } from '../providers/ConnectionProvider';
import { useMyBetsStore } from '../stores/myBetsStore';
import { useWallet } from '../providers/WalletProvider';

const ANCHOR_ERROR_MESSAGES: Record<number, string> = {
  6006: 'Reward already claimed.',
  6007: 'This game has not finished yet.',
  6008: 'Bet not found.',
  6009: 'No winner has been determined for this game.',
};

function sanitizeClaimError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  const hexMatch = message.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  const codeMatch = message.match(/Error Code: (\d+)/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  if (message.includes('insufficient funds') || message.includes('Insufficient funds')) {
    return 'Insufficient balance.';
  }

  if (message.includes('User rejected') || message.includes('declined')) {
    return 'Transaction cancelled.';
  }

  return 'Failed to claim reward. Please try again.';
}

function gameIdToBuffer(gameId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, gameId, true);
  return buf;
}

export function useClaimReward() {
  const { publicKey, signAndSendTransaction } = useWallet();
  const { updateBetStatus } = useMyBetsStore();
  const { connection } = useConnection();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programId = getProgramId();

  const claimReward = useCallback(async (
    gameId: bigint,
    bettingPoolPda: PublicKey,
    betRecordPda: PublicKey
  ): Promise<string | null> => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const program = getReadOnlyProgram(connection);

      const gameIdBuffer = gameIdToBuffer(gameId);

      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), gameIdBuffer],
        programId
      );

      const ix = await program.methods
        .claimBettingReward(new BN(gameId.toString()))
        .accountsPartial({
          bettingPool: bettingPoolPda,
          game: gamePda,
          betRecord: betRecordPda,
          bettor: publicKey,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

      const txSig = await signAndSendTransaction(tx);

      updateBetStatus(betRecordPda.toString(), 'claimed');
      return txSig;
    } catch (err) {
      console.error('[claimReward] error:', err);
      setError(sanitizeClaimError(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, signAndSendTransaction, updateBetStatus, programId, connection]);

  return { claimReward, isLoading, error, clearError: () => setError(null) };
}
