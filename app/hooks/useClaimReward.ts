'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useAnchorProgram, getProgramId } from '@/lib/anchor';
import { useMyBetsStore } from '@/stores/myBetsStore';

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
      setError('ウォレットを接続してください');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const gameIdBuffer = Buffer.alloc(8);
      const view = new DataView(gameIdBuffer.buffer);
      view.setBigUint64(0, gameId, true);

      // Game PDA（IDLのPDA定義に基づき game_id から導出）
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), gameIdBuffer],
        programId
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txSig = await (program as any).methods
        .claimBettingReward(gameId)
        .accounts({
          bettingPool: bettingPoolPda,
          game: gamePda,
          betRecord: betRecordPda,
          bettor: publicKey,
        })
        .rpc();

      updateBetStatus(betRecordPda.toString(), 'claimed');
      return txSig;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { claimReward, isLoading, error };
}
