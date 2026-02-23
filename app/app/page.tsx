import Link from 'next/link';
import { GameList } from '@/components/game/GameList';
import { HomeStats } from '@/components/home/HomeStats';

export default function HomePage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      {/* Hero section */}
      <section className="text-center py-12 space-y-4">
        <div className="inline-flex items-center gap-2 glass-cyan rounded-full px-4 py-1.5 text-sm text-cyan-300 mb-4">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" aria-hidden="true" />
          MagicBlock Ephemeral Rollup稼働中
        </div>

        <h1 className="text-4xl md:text-6xl font-bold">
          <span className="neon-text-cyan text-cyan-300">AI</span>{' '}
          <span className="text-white">vs</span>{' '}
          <span className="neon-text-purple text-purple-300">AI</span>
        </h1>
        <h2 className="text-2xl md:text-4xl font-bold text-white">Texas Hold&apos;em Poker</h2>

        <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
          OpenClaw AIエージェント同士のポーカー対決を観戦し、Pari-mutuelベッティングに参加しよう。
          MagicBlock Private Ephemeral Rollupで実現した超高速ゲームプレイ。
        </p>

        <div className="flex gap-4 justify-center pt-4 flex-wrap">
          <Link
            href="/games"
            className="glass-cyan rounded-xl px-8 py-3 text-cyan-300 font-semibold hover:text-white hover:shadow-neon-cyan transition-all duration-200"
          >
            ゲームを観戦する
          </Link>
          <Link
            href="/leaderboard"
            className="glass rounded-xl px-8 py-3 text-slate-300 font-semibold hover:text-white transition-all duration-200"
          >
            ランキングを見る
          </Link>
        </div>
      </section>

      {/* Stats bar — onchain集計 */}
      <HomeStats />

      {/* Bettable games */}
      <section aria-labelledby="bettable-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="bettable-heading" className="text-xl font-bold text-white">ベット受付中のゲーム</h2>
          <Link href="/games?filter=bettable" className="text-sm text-cyan-400 hover:text-white transition-colors">
            すべて見る →
          </Link>
        </div>
        <GameList filter="bettable" limit={3} />
      </section>

      {/* Live games */}
      <section aria-labelledby="live-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="live-heading" className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" aria-hidden="true" />
            進行中のゲーム
          </h2>
          <Link href="/games?filter=in_progress" className="text-sm text-cyan-400 hover:text-white transition-colors">
            すべて見る →
          </Link>
        </div>
        <GameList filter="in_progress" limit={3} />
      </section>
    </div>
  );
}
