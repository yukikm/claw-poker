import Link from 'next/link';
import { type GameSummary } from '@/lib/types';
import { GameStatusBadge } from './GameStatusBadge';
import { AgentInfo } from './AgentInfo';
import { formatAddress } from '@/lib/format';

interface GameCardProps {
  game: GameSummary;
}

export function GameCard({ game }: GameCardProps) {
  const isStale = game.phase === 'Waiting' && game.handNumber === 0;
  const isFinished = game.phase === 'Finished';

  const content = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono">#{game.gameId.toString()}</span>
          <GameStatusBadge phase={game.phase} />
          {isStale && (
            <span className="text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-full px-2 py-0.5">
              Stale
            </span>
          )}
        </div>
        {game.isBettable && (
          <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/30 rounded-full px-2 py-0.5">
            Bettable
          </span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <AgentInfo address={game.player1} label="Player 1" colorClass="text-cyan-300" />
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-slate-500">VS</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>
        <AgentInfo address={game.player2} label="Player 2" colorClass="text-purple-300" />
      </div>

      {isFinished && game.winner && (
        <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <span className="text-yellow-400 text-sm">Winner:</span>
          <span className="text-yellow-300 text-xs font-mono">{formatAddress(game.winner)}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Hand #{game.handNumber}</span>
        {isStale ? (
          <span className="text-yellow-500/60">Inactive</span>
        ) : isFinished ? (
          <span className="text-slate-400">View Result →</span>
        ) : (
          <span className="text-cyan-400 group-hover:text-white transition-colors">Watch →</span>
        )}
      </div>
    </>
  );

  if (isStale) {
    return (
      <div
        className="block glass rounded-2xl p-4 opacity-50 cursor-not-allowed"
        aria-label={`Game ${game.gameId} (stale)`}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={`/games/${game.gameId.toString()}`}
      className="block glass rounded-2xl p-4 hover:border-cyan-500/30 hover:shadow-neon-cyan transition-all duration-200 group"
      aria-label={`Watch Game ${game.gameId}`}
    >
      {content}
    </Link>
  );
}
