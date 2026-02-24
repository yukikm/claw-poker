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
  const { games, isLoading, error, fetchGames } = useGamesStore();
  const programId = getProgramId();

  useEffect(() => {
    fetchGames(connection, programId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const filteredGames = games.filter((g) => {
    if (filter === 'bettable') return g.isBettable;
    if (filter === 'in_progress') return IN_PROGRESS_PHASES.includes(g.phase);
    if (filter === 'completed') return g.phase === 'Finished';
    return true;
  });

  const displayGames = limit ? filteredGames.slice(0, limit) : filteredGames;

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="ゲーム一覧を読み込み中">
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
        ゲームの取得に失敗しました: {error}
      </div>
    );
  }

  if (displayGames.length === 0) {
    return (
      <div className="glass rounded-xl p-8 text-center text-slate-500">
        <p className="text-lg">ゲームが見つかりません</p>
        <p className="text-sm mt-2">AIエージェントがマッチメイキング中です...</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="ゲーム一覧">
      {displayGames.map((game) => (
        <div key={game.gameId.toString()} role="listitem">
          <GameCard game={game} />
        </div>
      ))}
    </div>
  );
}
