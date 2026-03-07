'use client';

import { useEffect } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useGamesStore } from '@/stores/gamesStore';
import { getProgramId } from '@/lib/anchor';
import { GameCard } from './GameCard';
import { type GamePhase } from '@/lib/constants';

interface GameListProps {
  filter?: 'bettable' | 'in_progress' | 'completed' | 'all';
  limit?: number;
}

const IN_PROGRESS_PHASES: GamePhase[] = ['Shuffling', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown'];

export function GameList({ filter = 'all', limit }: GameListProps) {
  const { connection } = useConnection();
  const { games, isLoading, error, serverConnected, startPolling, stopPolling } = useGamesStore();
  const programId = getProgramId();

  useEffect(() => {
    startPolling(connection, programId);
    return () => stopPolling();
    // startPolling/stopPolling are stable Zustand actions, excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, programId.toBase58()]);

  const filteredGames = games.filter((g) => {
    if (filter === 'bettable') return g.isBettable;
    if (filter === 'in_progress') return IN_PROGRESS_PHASES.includes(g.phase);
    if (filter === 'completed') return g.phase === 'Finished';
    return true;
  });

  // ソート: In Progress > Finished > Stale(Waiting+Hand#0) の順に表示
  const sortedGames = [...filteredGames].sort((a, b) => {
    const priority = (g: typeof a) => {
      if (IN_PROGRESS_PHASES.includes(g.phase)) return 0;
      if (g.phase === 'Finished') return 1;
      if (g.phase === 'Waiting' && g.handNumber === 0) return 3;
      return 2;
    };
    return priority(a) - priority(b);
  });

  const displayGames = limit ? sortedGames.slice(0, limit) : sortedGames;

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading games">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass rounded-2xl p-4 animate-pulse h-48" aria-hidden="true">
            <div className="h-3 bg-white/10 rounded mb-3 w-1/3" />
            <div className="h-4 bg-white/10 rounded mb-2" />
            <div className="h-4 bg-white/10 rounded w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-xl p-6 text-center text-red-400 text-sm" role="alert">
        Failed to load games: {error}
      </div>
    );
  }

  if (displayGames.length === 0) {
    return (
      <div className="glass rounded-xl p-8 text-center text-slate-500">
        {!serverConnected ? (
          <>
            <p className="text-lg text-yellow-300">Game server offline</p>
            <p className="text-sm mt-2">Unable to fetch live game data. Only on-chain games are shown.</p>
          </>
        ) : (
          <>
            <p className="text-lg">No games found</p>
            <p className="text-sm mt-2">AI agents are in matchmaking...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Game list">
      {displayGames.map((game) => (
        <div key={game.gameId.toString()} role="listitem">
          <GameCard game={game} />
        </div>
      ))}
    </div>
  );
}
