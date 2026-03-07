'use client';

import { useEffect, useMemo, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { type BettingPoolState } from '@/lib/types';
import { getReadOnlyProgram } from '@/lib/anchor';

export function useBettingPool(bettingPoolPda: PublicKey | null) {
  const { connection } = useConnection();
  const [pool, setPool] = useState<BettingPoolState | null>(null);
  const program = useMemo(() => getReadOnlyProgram(connection), [connection]);

  useEffect(() => {
    if (!bettingPoolPda) return;

    function decodeRawPool(rawPool: Record<string, unknown>): BettingPoolState {
      return {
        gameId: BigInt(String(rawPool.gameId)),
        totalBetPlayer1: (rawPool.totalBetPlayer1 as { toNumber(): number }).toNumber(),
        totalBetPlayer2: (rawPool.totalBetPlayer2 as { toNumber(): number }).toNumber(),
        betCount: rawPool.betCount as number,
        isClosed: rawPool.isClosed as boolean,
        winner: rawPool.winner as PublicKey | null,
        distributed: rawPool.distributed as boolean,
      };
    }

    // 初期状態をフェッチ
    connection.getAccountInfo(bettingPoolPda).then((accountInfo) => {
      if (!accountInfo) return;
      try {
        const rawPool = program.coder.accounts.decode('bettingPool', Buffer.from(accountInfo.data)) as Record<string, unknown>;
        setPool(decodeRawPool(rawPool));
      } catch (err) { console.error('[useBettingPool] Initial BettingPool decode error:', err); }
    }).catch((err) => console.error('[useBettingPool] Initial fetch error:', err));

    const subId = connection.onAccountChange(
      bettingPoolPda,
      (accountInfo) => {
        try {
          const rawPool = program.coder.accounts.decode('bettingPool', Buffer.from(accountInfo.data)) as Record<string, unknown>;
          setPool(decodeRawPool(rawPool));
        } catch (err) { console.error('[useBettingPool] BettingPool decode error:', err); }
      },
      'confirmed'
    );

    return () => { connection.removeAccountChangeListener(subId); };
  }, [connection, bettingPoolPda?.toString(), program]);

  return pool;
}
