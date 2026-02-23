'use client';

import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyBetsStore } from '@/stores/myBetsStore';
import { ClaimButton } from '@/components/betting/ClaimButton';
import { formatSol, formatTimestamp } from '@/lib/format';
import Link from 'next/link';

const STATUS_CONFIG = {
  active: { label: '進行中', className: 'text-cyan-300 border-cyan-500/30' },
  won: { label: '勝利 (クレーム可)', className: 'text-green-300 border-green-500/30' },
  lost: { label: '敗北', className: 'text-red-400 border-red-500/30' },
  claimed: { label: 'クレーム済', className: 'text-slate-400 border-slate-500/30' },
};

export default function MyBetsPage() {
  const { publicKey } = useWallet();
  const { bets } = useMyBetsStore();

  const claimableBets = bets.filter((b) => b.status === 'won');
  const activeBets = bets.filter((b) => b.status === 'active');
  const historicalBets = bets.filter((b) => b.status === 'lost' || b.status === 'claimed');

  const totalWon = bets.filter((b) => b.payout).reduce((acc, b) => acc + (b.payout ?? 0), 0);
  const totalBet = bets.reduce((acc, b) => acc + b.amount, 0);
  const netPnl = totalWon - totalBet;

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="glass rounded-2xl p-12 text-center space-y-4">
          <p className="text-slate-400 text-lg">マイベットを見るにはウォレットを接続してください</p>
          <p className="text-slate-500 text-sm">ベット履歴はローカルに保存されます</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-white">マイベット</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-xl font-bold font-mono text-white">{bets.length}</p>
          <p className="text-xs text-slate-500 mt-1">総ベット数</p>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-xl font-bold font-mono text-slate-300">{formatSol(totalBet)}</p>
          <p className="text-xs text-slate-500 mt-1">総ベット額 (SOL)</p>
        </div>
        <div className="glass rounded-xl p-4 text-center">
          <p className={`text-xl font-bold font-mono ${netPnl >= 0 ? 'text-green-300' : 'text-red-400'}`}>
            {netPnl >= 0 ? '+' : ''}{formatSol(netPnl)}
          </p>
          <p className="text-xs text-slate-500 mt-1">損益 (SOL)</p>
        </div>
      </div>

      {/* Claimable bets */}
      {claimableBets.length > 0 && (
        <section aria-labelledby="claimable-heading">
          <h2 id="claimable-heading" className="text-lg font-semibold text-green-300 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
            クレーム可能 ({claimableBets.length}件)
          </h2>
          <div className="space-y-3">
            {claimableBets.map((bet) => (
              <div key={bet.betRecordPda} className="glass rounded-xl p-4 border border-green-500/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Link href={`/games/${bet.gameId}`} className="text-sm font-mono text-cyan-400 hover:text-white">
                      ゲーム #{bet.gameId}
                    </Link>
                    <p className="text-sm text-slate-400">
                      Player {bet.playerChoice} に {formatSol(bet.amount)} SOL
                    </p>
                    <p className="text-xs text-slate-500">{formatTimestamp(bet.timestamp)}</p>
                  </div>
                  <ClaimButton
                    gameId={BigInt(bet.gameId)}
                    bettingPoolPda={new PublicKey(bet.bettingPoolPda)}
                    betRecordPda={new PublicKey(bet.betRecordPda)}
                    estimatedPayout={bet.payout ?? bet.amount}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active bets */}
      {activeBets.length > 0 && (
        <section aria-labelledby="active-heading">
          <h2 id="active-heading" className="text-lg font-semibold text-cyan-300 mb-3">進行中のベット</h2>
          <div className="space-y-3">
            {activeBets.map((bet) => (
              <div key={bet.betRecordPda} className="glass rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Link href={`/games/${bet.gameId}`} className="text-sm font-mono text-cyan-400 hover:text-white">
                      ゲーム #{bet.gameId}
                    </Link>
                    <p className="text-sm text-slate-400">
                      Player {bet.playerChoice} に {formatSol(bet.amount)} SOL
                    </p>
                    <p className="text-xs text-slate-500">{formatTimestamp(bet.timestamp)}</p>
                  </div>
                  <span className="text-xs text-cyan-300 border border-cyan-500/30 rounded-full px-2 py-0.5">
                    進行中
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* History */}
      {historicalBets.length > 0 && (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-lg font-semibold text-slate-300 mb-3">ベット履歴</h2>
          <div className="space-y-2">
            {historicalBets.map((bet) => {
              const config = STATUS_CONFIG[bet.status];
              return (
                <div key={bet.betRecordPda} className="glass rounded-xl p-3 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Link href={`/games/${bet.gameId}`} className="text-sm font-mono text-slate-400 hover:text-white">
                      #{bet.gameId}
                    </Link>
                    <p className="text-xs text-slate-500">
                      P{bet.playerChoice} / {formatSol(bet.amount)} SOL / {formatTimestamp(bet.timestamp)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs border rounded-full px-2 py-0.5 ${config.className}`}>
                      {config.label}
                    </span>
                    {bet.payout && (
                      <p className="text-xs text-green-400 mt-1">+{formatSol(bet.payout)} SOL</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {bets.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center space-y-3">
          <p className="text-slate-400">まだベット履歴がありません</p>
          <Link href="/games" className="inline-block glass-cyan rounded-lg px-6 py-2 text-sm text-cyan-300 hover:text-white transition-colors">
            ゲームを見る
          </Link>
        </div>
      )}
    </div>
  );
}
