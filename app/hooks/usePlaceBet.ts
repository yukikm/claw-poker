'use client';

import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useAnchorProgram, getProgramId } from '@/lib/anchor';
import { useMyBetsStore } from '@/stores/myBetsStore';
import { type MyBet } from '@/lib/types';

const ANCHOR_ERROR_MESSAGES: Record<number, string> = {
  6000: 'Game has not started.',
  6001: 'Betting is closed.',
  6002: 'Insufficient balance.',
  6003: 'Already placed a bet.',
  6004: 'Invalid player selection.',
  6005: 'Invalid bet amount.',
};

function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  // Anchor custom error code (e.g. "custom program error: 0x1770")
  const hexMatch = message.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  // "Error Code: <number>" format
  const codeMatch = message.match(/Error Code: (\d+)/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  // SystemProgram insufficient funds error
  if (message.includes('insufficient funds') || message.includes('Insufficient funds')) {
    return 'Insufficient balance.';
  }

  // User rejected transaction
  if (message.includes('User rejected')) {
    return 'Transaction cancelled.';
  }

  return 'Failed to place bet. Please try again.';
}

interface PlaceBetParams {
  gameId: bigint;
  gamePda: PublicKey;
  bettingPoolPda: PublicKey;
  playerChoice: 1 | 2;
  amount: number; // lamports
}

export function usePlaceBet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useAnchorProgram();
  const { addBet } = useMyBetsStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programId = getProgramId();

  const placeBet = async ({ gameId, gamePda, bettingPoolPda, playerChoice, amount }: PlaceBetParams): Promise<string | null> => {
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

      const [betRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bet_record'), gameIdBuffer, publicKey.toBuffer()],
        programId
      );

      const txSig = await program.methods
        .placeSpectatorBet(new BN(gameId.toString()), playerChoice, new BN(amount))
        .accountsPartial({
          bettingPool: bettingPoolPda,
          game: gamePda,
          betRecord: betRecordPda,
          bettor: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const newBet: MyBet = {
        gameId: gameId.toString(),
        gamePda: gamePda.toString(),
        bettingPoolPda: bettingPoolPda.toString(),
        betRecordPda: betRecordPda.toString(),
        playerChoice,
        amount,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'active',
        payout: null,
        txSignature: txSig,
      };

      addBet(newBet);
      return txSig;
    } catch (err) {
      setError(sanitizeError(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { placeBet, isLoading, error };
}
