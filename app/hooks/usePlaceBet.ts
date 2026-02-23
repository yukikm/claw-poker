'use client';

import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useAnchorProgram, getProgramId } from '@/lib/anchor';
import { useMyBetsStore } from '@/stores/myBetsStore';
import { type MyBet } from '@/lib/types';

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
      setError('ウォレットを接続してください');
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txSig = await (program as any).methods
        .placeSpectatorBet(gameId, playerChoice, new BN(amount))
        .accounts({
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
      setError(String(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { placeBet, isLoading, error };
}
