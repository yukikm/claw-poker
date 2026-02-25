'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useAnchorProgram, getProgramId } from '@/lib/anchor';
import { useMyBetsStore } from '@/stores/myBetsStore';

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

  if (message.includes('User rejected')) {
    return 'Transaction cancelled.';
  }

  return 'Failed to claim reward. Please try again.';
}

export function useClaimReward() {
  const { publicKey } = useWallet();
  const program = useAnchorProgram();
  const { updateBetStatus } = useMyBetsStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programId = getProgramId();

  const claimReward = async (
    gameId: bigint,
    bettingPoolPda: PublicKey,
    betRecordPda: PublicKey
  ): Promise<string | null> => {
    if (!publicKey || !program) {
      setError('Please connect your wallet');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const gameIdBuffer = Buffer.alloc(8);
      const view = new DataView(gameIdBuffer.buffer);
      view.setBigUint64(0, gameId, true);

      // Game PDA derived from game_id per IDL PDA definition
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), gameIdBuffer],
        programId
      );

      const txSig = await program.methods
        .claimBettingReward(new BN(gameId.toString()))
        .accountsPartial({
          bettingPool: bettingPoolPda,
          game: gamePda,
          betRecord: betRecordPda,
          bettor: publicKey,
        })
        .rpc();

      updateBetStatus(betRecordPda.toString(), 'claimed');
      return txSig;
    } catch (err) {
      setError(sanitizeClaimError(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { claimReward, isLoading, error };
}
