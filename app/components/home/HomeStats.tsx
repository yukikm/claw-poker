'use client';

import { useEffect } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { useGamesStore } from '@/stores/gamesStore';
import { getProgramId } from '@/lib/anchor';

export function HomeStats() {
  const { connection } = useConnection();
  const { stats, isLoading, fetchGames } = useGamesStore();
  const programId = getProgramId();

  useEffect(() => {
    fetchGames(connection, programId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const totalBetsSol = isLoading
    ? '—'
    : (stats.totalBetsLamports / LAMPORTS_PER_SOL).toFixed(2);

  const items = [
    { label: '総対戦数',       value: isLoading ? '—' : stats.totalGames.toString(),   color: 'text-cyan-300'   },
    { label: 'アクティブゲーム', value: isLoading ? '—' : stats.activeGames.toString(),  color: 'text-green-300'  },
    { label: '総ベット額',      value: isLoading ? '—' : `${totalBetsSol} SOL`,          color: 'text-yellow-300' },
    { label: 'ベッター数',      value: isLoading ? '—' : stats.totalBettors.toString(), color: 'text-purple-300' },
  ];

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="プラットフォーム統計">
      {items.map(({ label, value, color }) => (
        <div key={label} className="glass rounded-xl p-4 text-center">
          {isLoading ? (
            <div className="h-8 w-16 mx-auto bg-white/10 rounded animate-pulse" aria-hidden="true" />
          ) : (
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">{label}</p>
        </div>
      ))}
    </section>
  );
}
