'use client';

import { type GameState } from '@/lib/types';
import { formatAddress } from '@/lib/format';
import { HoleCards } from './HoleCards';
import { CommunityCards } from './CommunityCards';
import { ChipStack } from './ChipStack';
import { PotDisplay } from './PotDisplay';
import { PhaseIndicator } from './PhaseIndicator';
import { ActionBadge } from './ActionBadge';

interface PokerTableProps {
  game: GameState;
}

function AgentPanel({
  agent,
  position,
  isCurrentTurn,
  isDealer,
  showdownCards,
}: {
  agent: GameState['player1'];
  position: 'left' | 'right';
  isCurrentTurn: boolean;
  isDealer: boolean;
  showdownCards?: GameState['showdownCardsP1'];
}) {
  return (
    <div
      className={`
        glass rounded-2xl p-4 flex flex-col items-center gap-3 w-[160px] md:w-[200px]
        transition-all duration-300
        ${isCurrentTurn ? 'ring-2 ring-cyan-400/50 shadow-neon-cyan' : ''}
        ${agent.hasFolded ? 'opacity-40' : ''}
      `}
      aria-label={`プレイヤー: ${formatAddress(agent.address)}`}
    >
      {/* Agent avatar */}
      <div className="relative">
        <div className={`
          w-12 h-12 md:w-16 md:h-16 rounded-full border-2 flex items-center justify-center
          ${isCurrentTurn ? 'border-cyan-400 bg-cyan-400/10' : 'border-purple-500/40 bg-purple-500/10'}
        `}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-purple-300" fill="currentColor">
            <path d="M12 2a5 5 0 110 10A5 5 0 0112 2zm0 12c5.33 0 8 2.67 8 4v2H4v-2c0-1.33 2.67-4 8-4z" />
          </svg>
        </div>
        {isDealer && (
          <div
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-yellow-400 border border-yellow-300 flex items-center justify-center text-[10px] font-bold text-black"
            aria-label="ディーラー"
          >
            D
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="text-xs text-slate-500 font-mono">{formatAddress(agent.address)}</p>
        <div className="mt-1">
          <span className="text-xs text-slate-500">AI Agent</span>
        </div>
      </div>

      <ChipStack chips={agent.chips} label="チップ" />

      {agent.chipsCommitted > 0 && (
        <div className="text-xs text-slate-400">
          ベット: <span className="text-yellow-300 font-mono">{agent.chipsCommitted}</span>
        </div>
      )}

      <ActionBadge action={agent.lastAction} isCurrentTurn={isCurrentTurn} />

      <HoleCards cards={showdownCards} position={position} />

      {agent.hasFolded && (
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest" role="status">FOLDED</span>
      )}

      {agent.isAllIn && !agent.hasFolded && (
        <span className="text-xs font-bold text-red-400 uppercase tracking-widest" role="status">ALL IN</span>
      )}
    </div>
  );
}

export function PokerTable({ game }: PokerTableProps) {
  const isPlayer1Turn = game.currentTurn === 1;
  const isPlayer2Turn = game.currentTurn === 2;
  const isDealer1 = game.dealerPosition === 1;

  return (
    <div
      className="relative w-full rounded-3xl overflow-hidden p-4 md:p-8"
      style={{
        background: 'radial-gradient(ellipse at center, #1a5f4d 0%, #0d3d30 40%, #0a1628 100%)',
        minHeight: '500px',
      }}
      role="region"
      aria-label="ポーカーテーブル"
    >
      {/* Table border */}
      <div
        className="absolute inset-2 rounded-3xl pointer-events-none"
        style={{ border: '3px solid rgba(255,255,255,0.08)' }}
        aria-hidden="true"
      />

      {/* Phase indicator */}
      <div className="flex justify-center mb-6">
        <PhaseIndicator phase={game.phase} handNumber={game.handNumber} />
      </div>

      {/* Main table content */}
      <div className="flex items-center justify-between gap-4 md:gap-8">
        {/* Player 1 */}
        <AgentPanel
          agent={game.player1}
          position="left"
          isCurrentTurn={isPlayer1Turn}
          isDealer={isDealer1}
          showdownCards={game.showdownCardsP1}
        />

        {/* Center */}
        <div className="flex-1 flex flex-col items-center gap-6">
          {/* Community cards */}
          <CommunityCards cards={game.boardCards} phase={game.phase} />

          {/* Pot */}
          <PotDisplay pot={game.pot} />
        </div>

        {/* Player 2 */}
        <AgentPanel
          agent={game.player2}
          position="right"
          isCurrentTurn={isPlayer2Turn}
          isDealer={!isDealer1}
          showdownCards={game.showdownCardsP2}
        />
      </div>

      {/* Winner overlay */}
      {game.phase === 'Finished' && game.winner && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-3xl backdrop-blur-sm"
          role="alert"
          aria-label={`勝者: ${formatAddress(game.winner)}`}
        >
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3" aria-hidden="true">&#x1F3C6;</p>
            <p className="text-xl font-bold text-yellow-300">勝者</p>
            <p className="text-sm font-mono text-slate-300 mt-1">{formatAddress(game.winner)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
