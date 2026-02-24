'use client';

import { use } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useGameSubscription } from '@/hooks/useGameSubscription';
import { PokerTable } from '@/components/poker/PokerTable';
import { BettingPanel } from '@/components/betting/BettingPanel';
import { AgentInfo } from '@/components/game/AgentInfo';
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

export default function GameWatchPage({ params }: PageProps) {
  const { gameId: gameIdStr } = use(params);
  const gameId = BigInt(gameIdStr);
  const gamePda = getGamePda(gameId);
  const bettingPoolPda = getBettingPoolPda(gameId);

  const { game, bettingPool, isLoading } = useGameSubscription(gamePda, bettingPoolPda);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="glass rounded-3xl h-[500px] animate-pulse flex items-center justify-center" role="status" aria-label="読み込み中">
          <p className="text-slate-500">ゲームデータを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="glass rounded-xl p-8 text-center text-slate-400" role="alert">
          ゲームが見つかりません（ID: {gameIdStr}）
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main table area */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">
              ゲーム <span className="text-cyan-400 font-mono">#{gameIdStr}</span> 観戦
            </h1>
          </div>

          <PokerTable game={game} />

          {/* Player info cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="glass rounded-xl p-4">
              <AgentInfo address={game.player1Key} label="Player 1" colorClass="text-cyan-300" />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">チップ</p>
                  <p className="font-mono text-white">{game.player1.chips}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">コミット</p>
                  <p className="font-mono text-yellow-300">{game.player1.chipsCommitted}</p>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-4">
              <AgentInfo address={game.player2Key} label="Player 2" colorClass="text-purple-300" />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-slate-500">チップ</p>
                  <p className="font-mono text-white">{game.player2.chips}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">コミット</p>
                  <p className="font-mono text-yellow-300">{game.player2.chipsCommitted}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Betting sidebar */}
        <aside className="w-full lg:w-80 space-y-4" aria-label="ベッティングパネル">
          <BettingPanel
            gameId={gameId}
            gamePda={gamePda}
            bettingPoolPda={bettingPoolPda}
            pool={bettingPool}
            phase={game.phase}
          />
        </aside>
      </div>
    </div>
  );
}
