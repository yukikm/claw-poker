'use client';

import { useEffect, useMemo } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useWatchGameStore } from '@/stores/watchGameStore';
import { getProgramId, useAnchorProgram, getReadOnlyProgram } from '@/lib/anchor';
import { getERConnection } from '@/lib/solana';

export function useGameSubscription(gamePda: PublicKey | null, bettingPoolPda: PublicKey | null) {
  const { connection } = useConnection();       // L1コネクション（BettingPool用）
  const erConnection = getERConnection();        // ERコネクション（Gameアカウント用）
  const walletProgram = useAnchorProgram();
  const { subscribeToGame, unsubscribeFromGame, game, bettingPool, isLoading } = useWatchGameStore();
  const programId = getProgramId();

  // ウォレット未接続時は読み取り専用プログラムにフォールバック
  const readOnlyProgram = useMemo(() => getReadOnlyProgram(connection), [connection]);
  const program = walletProgram ?? readOnlyProgram;

  useEffect(() => {
    if (!gamePda || !bettingPoolPda) return;

    subscribeToGame(connection, erConnection, gamePda, bettingPoolPda, programId, program);

    return () => {
      unsubscribeFromGame();
    };
  // Zustandストアのメソッドは参照安定のため依存配列から除外
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, erConnection, gamePda?.toString(), bettingPoolPda?.toString()]);

  return { game, bettingPool, isLoading };
}
