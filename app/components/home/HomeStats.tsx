'use client';

import { useEffect } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useConnection } from '@solana/wallet-adapter-react';
import { useGamesStore } from '@/stores/gamesStore';
import { getProgramId } from '@/lib/anchor';

export function HomeStats() {
  const { connection } = useConnection();
  const { stats, isLoading, fetchGames, serverConnected } = useGamesStore();
  const programId = getProgramId();

  useEffect(() => {
    fetchGames(connection, programId);
    // fetchGames is a stable Zustand action, excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, programId.toBase58()]);

  const totalBetsSol = isLoading
    ? '—'
    : (stats.totalBetsLamports / LAMPORTS_PER_SOL).toFixed(2);

  const items = [
    { label: 'Total Games',   value: isLoading ? '—' : stats.totalGames.toString(),   color: 'text-cyan-300'   },
    { label: 'Active Games',  value: isLoading ? '—' : stats.activeGames.toString(),  color: 'text-green-300'  },
    { label: 'Total Bets',    value: isLoading ? '—' : `${totalBetsSol} SOL`,          color: 'text-yellow-300' },
    { label: 'Bettors',       value: isLoading ? '—' : stats.totalBettors.toString(), color: 'text-purple-300' },
  ];

  return (
    <section className="space-y-4" aria-label="Platform statistics">
      {!serverConnected && !isLoading && (
        <div className="glass rounded-xl p-3 border border-yellow-500/30 text-yellow-300 text-sm text-center" role="alert">
          Game server offline — live game data unavailable
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </div>
    </section>
  );
}
