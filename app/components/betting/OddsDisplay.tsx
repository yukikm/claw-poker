'use client';

import { motion } from 'framer-motion';
import { type BettingPoolState } from '@/lib/types';
import { formatOdds, formatSol } from '@/lib/format';

interface OddsDisplayProps {
  pool: BettingPoolState | null;
}

export function OddsDisplay({ pool }: OddsDisplayProps) {
  if (!pool) {
    return (
      <div className="glass rounded-xl p-4 text-center text-slate-500 text-sm animate-pulse" role="status" aria-label="オッズ読み込み中">
        オッズ読み込み中...
      </div>
    );
  }

  const { odds1, odds2 } = formatOdds(pool.totalBetPlayer1, pool.totalBetPlayer2);
  const total = pool.totalBetPlayer1 + pool.totalBetPlayer2;
  const pct1 = total > 0 ? Math.round((pool.totalBetPlayer1 / total) * 100) : 50;
  const pct2 = 100 - pct1;

  return (
    <div className="glass rounded-xl p-4 space-y-3" aria-label="現在のオッズ">
      <h3 className="text-xs text-slate-400 uppercase tracking-wider text-center">ベッティングオッズ</h3>

      <div className="flex gap-3">
        <div className="flex-1 glass-cyan rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400">Player 1</p>
          <p className="text-2xl font-bold text-cyan-300 font-mono">{odds1}x</p>
          <p className="text-xs text-slate-500 mt-1">{formatSol(pool.totalBetPlayer1)} SOL</p>
        </div>
        <div className="flex-1 glass-purple rounded-lg p-3 text-center">
          <p className="text-xs text-slate-400">Player 2</p>
          <p className="text-2xl font-bold text-purple-300 font-mono">{odds2}x</p>
          <p className="text-xs text-slate-500 mt-1">{formatSol(pool.totalBetPlayer2)} SOL</p>
        </div>
      </div>

      {/* Distribution bar */}
      <div className="rounded-full overflow-hidden h-2 flex" role="img" aria-label={`Player1: ${pct1}%, Player2: ${pct2}%`}>
        <motion.div
          className="bg-cyan-400 h-full"
          animate={{ width: `${pct1}%` }}
          transition={{ duration: 0.5 }}
        />
        <motion.div
          className="bg-purple-400 h-full"
          animate={{ width: `${pct2}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <p className="text-xs text-slate-500 text-center">
        総ベット: {formatSol(total)} SOL ({pool.betCount}件)
      </p>

      {pool.isClosed && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-center">
          <span className="text-xs text-red-400 font-semibold">ベット締切済み</span>
        </div>
      )}
    </div>
  );
}
