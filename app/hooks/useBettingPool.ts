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

    const subId = connection.onAccountChange(
      bettingPoolPda,
      (accountInfo) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawPool = program.coder.accounts.decode('BettingPool', Buffer.from(accountInfo.data)) as any;
          setPool({
            gameId: BigInt(rawPool.gameId.toString()),
            totalBetPlayer1: (rawPool.totalBetPlayer1 as { toNumber(): number }).toNumber(),
            totalBetPlayer2: (rawPool.totalBetPlayer2 as { toNumber(): number }).toNumber(),
            betCount: rawPool.betCount as number,
            isClosed: rawPool.isClosed as boolean,
            winner: rawPool.winner as PublicKey | null,
            distributed: rawPool.distributed as boolean,
          });
        } catch { /* デコードエラーは無視 */ }
      },
      'confirmed'
    );

    return () => { connection.removeAccountChangeListener(subId); };
  }, [connection, bettingPoolPda?.toString(), program]);

  return pool;
}
