'use client';

import { use } from 'react';
import Link from 'next/link';
import { PublicKey } from '@solana/web3.js';
import { useGameSubscription } from '@/hooks/useGameSubscription';
import { BettingPanel } from '@/components/betting/BettingPanel';
import { AgentInfo } from '@/components/game/AgentInfo';
import { GameStatusBadge } from '@/components/game/GameStatusBadge';
import { getProgramId } from '@/lib/anchor';

interface PageProps {
  params: Promise<{ gameId: string }>;
}

function getGamePda(gameId: bigint): PublicKey {
  const gameIdBuffer = Buffer.alloc(8);
  const view = new DataView(gameIdBuffer.buffer);
  view.setBigUint64(0, gameId, true);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('game'), gameIdBuffer],
    getProgramId()
  );
  return pda;
}

function getBettingPoolPda(gameId: bigint): PublicKey {
  const gameIdBuffer = Buffer.alloc(8);
  const view = new DataView(gameIdBuffer.buffer);
  view.setBigUint64(0, gameId, true);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('betting_pool'), gameIdBuffer],
    getProgramId()
  );
  return pda;
}

export default function BetPage({ params }: PageProps) {
  const { gameId: gameIdStr } = use(params);
  const gameId = BigInt(gameIdStr);
  const gamePda = getGamePda(gameId);
  const bettingPoolPda = getBettingPoolPda(gameId);

  const { game, bettingPool, isLoading } = useGameSubscription(gamePda, bettingPoolPda);

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/games/${gameIdStr}`}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="ゲーム観戦に戻る"
        >
          ← 観戦に戻る
        </Link>
      </div>

      <div className="glass rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">ゲーム #{gameIdStr}</h1>
          {game && <GameStatusBadge phase={game.phase} />}
        </div>

        {game && (
          <div className="space-y-3">
            <AgentInfo address={game.player1Key} label="Player 1" colorClass="text-cyan-300" />
            <div className="text-center text-xs text-slate-500">VS</div>
            <AgentInfo address={game.player2Key} label="Player 2" colorClass="text-purple-300" />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="glass rounded-xl p-8 text-center text-slate-500 animate-pulse" role="status" aria-label="読み込み中">読み込み中...</div>
      ) : game ? (
        <BettingPanel
          gameId={gameId}
          gamePda={gamePda}
          bettingPoolPda={bettingPoolPda}
          pool={bettingPool}
          phase={game.phase}
        />
      ) : (
        <div className="glass rounded-xl p-8 text-center text-red-400" role="alert">
          ゲームが見つかりません
        </div>
      )}
    </div>
  );
}
