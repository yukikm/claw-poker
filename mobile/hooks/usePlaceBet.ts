import { useState, useCallback } from 'react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getReadOnlyProgram, getProgramId } from '../lib/anchor';
import { useConnection } from '../providers/ConnectionProvider';
import { useMyBetsStore } from '../stores/myBetsStore';
import { useWallet } from '../providers/WalletProvider';
import { type MyBet } from '../lib/types';

const ANCHOR_ERROR_MESSAGES: Record<number, string> = {
  6003: 'Invalid action (bad player choice or amount).',
  6005: 'Betting is closed.',
  6011: 'Pot overflow.',
};

function sanitizeError(err: unknown): string {
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

  return 'Failed to place bet. Please try again.';
}

function gameIdToBuffer(gameId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, gameId, true);
  return buf;
}

interface PlaceBetParams {
  gameId: bigint;
  bettingPoolPda: PublicKey;
  playerChoice: 1 | 2;
  amount: number; // lamports
}

export function usePlaceBet() {
  const { publicKey, signAndSendTransaction } = useWallet();
  const { addBet } = useMyBetsStore();
  const { connection } = useConnection();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programId = getProgramId();

  const placeBet = useCallback(async ({ gameId, bettingPoolPda, playerChoice, amount }: PlaceBetParams): Promise<string | null> => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const program = getReadOnlyProgram(connection);

      const gameIdBuffer = gameIdToBuffer(gameId);

      const [betRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bet_record'), gameIdBuffer, publicKey.toBuffer()],
        programId
      );
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), gameIdBuffer],
        programId
      );

      // Build instruction (not rpc - we sign via MWA)
      const ix = await program.methods
        .placeSpectatorBet(new BN(gameId.toString()), playerChoice, new BN(amount))
        .accountsPartial({
          bettingPool: bettingPoolPda,
          betRecord: betRecordPda,
          bettor: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

      const txSig = await signAndSendTransaction(tx);

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
      console.error('[placeBet] error:', err);
      setError(sanitizeError(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, signAndSendTransaction, addBet, programId, connection]);

  return { placeBet, isLoading, error, clearError: () => setError(null) };
}
