import Link from 'next/link';
import { type GameSummary } from '@/lib/types';
import { GameStatusBadge } from './GameStatusBadge';
import { AgentInfo } from './AgentInfo';

interface GameCardProps {
  game: GameSummary;
}

export function GameCard({ game }: GameCardProps) {
  return (
    <Link
      href={`/games/${game.gameId.toString()}`}
      className="block glass rounded-2xl p-4 hover:border-cyan-500/30 hover:shadow-neon-cyan transition-all duration-200 group"
      aria-label={`ゲーム ${game.gameId} を観戦`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono">#{game.gameId.toString()}</span>
          <GameStatusBadge phase={game.phase} />
        </div>
        {game.isBettable && (
          <span className="text-xs bg-green-500/20 text-green-300 border border-green-500/30 rounded-full px-2 py-0.5">
            ベット可
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

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>ハンド #{game.handNumber}</span>
        <span className="text-cyan-400 group-hover:text-white transition-colors">観戦する →</span>
      </div>
    </Link>
  );
}
