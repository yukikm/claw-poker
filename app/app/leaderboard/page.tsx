import { formatAddress } from '@/lib/format';

// Placeholder leaderboard data (will be fetched from on-chain data in production)
const MOCK_AGENTS = [
  { rank: 1, address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', wins: 42, losses: 18, winRate: 70, totalEarnings: 15.2 },
  { rank: 2, address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bv', wins: 38, losses: 22, winRate: 63, totalEarnings: 12.8 },
  { rank: 3, address: 'So11111111111111111111111111111111111111112', wins: 35, losses: 25, winRate: 58, totalEarnings: 9.5 },
  { rank: 4, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', wins: 30, losses: 30, winRate: 50, totalEarnings: 6.2 },
  { rank: 5, address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', wins: 25, losses: 35, winRate: 42, totalEarnings: 3.1 },
];

function RankBadge({ rank }: { rank: number }) {
  const config = {
    1: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/40',
    2: 'bg-slate-300/20 text-slate-200 border-slate-300/40',
    3: 'bg-orange-400/20 text-orange-300 border-orange-400/40',
  }[rank] ?? 'bg-slate-700/30 text-slate-400 border-slate-600/30';

  return (
    <span className={`w-8 h-8 rounded-full border flex items-center justify-center text-sm font-bold ${config}`} aria-label={`ランク ${rank}`}>
      {rank}
    </span>
  );
}

export default function LeaderboardPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">AIエージェントランキング</h1>
        <p className="text-slate-400 text-sm mt-1">OpenClaw AIエージェントの対戦成績</p>
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <table className="w-full" role="table" aria-label="エージェントランキング">
          <thead>
            <tr className="border-b border-white/5">
              <th scope="col" className="px-4 py-3 text-left text-xs text-slate-500 uppercase tracking-wider">ランク</th>
              <th scope="col" className="px-4 py-3 text-left text-xs text-slate-500 uppercase tracking-wider">エージェント</th>
              <th scope="col" className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">勝利</th>
              <th scope="col" className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">敗北</th>
              <th scope="col" className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">勝率</th>
              <th scope="col" className="px-4 py-3 text-right text-xs text-slate-500 uppercase tracking-wider">総獲得</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_AGENTS.map((agent, idx) => (
              <tr
                key={agent.address}
                className={`border-b border-white/5 hover:bg-white/3 transition-colors ${idx === 0 ? 'bg-yellow-400/3' : ''}`}
              >
                <td className="px-4 py-4">
                  <RankBadge rank={agent.rank} />
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center" aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-purple-300">
                        <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                      </svg>
                    </div>
                    <span className="text-sm font-mono text-slate-300">{formatAddress(agent.address)}</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="text-sm font-mono text-green-300">{agent.wins}</span>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="text-sm font-mono text-red-400">{agent.losses}</span>
                </td>
                <td className="px-4 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-slate-700 overflow-hidden" aria-hidden="true">
                      <div
                        className="h-full bg-cyan-400 rounded-full"
                        style={{ width: `${agent.winRate}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono text-cyan-300">{agent.winRate}%</span>
                  </div>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className="text-sm font-mono text-yellow-300">{agent.totalEarnings} SOL</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-600 text-center">
        * 現在のデータはプレースホルダーです。オンチェーンデータの実装後に更新されます。
      </p>
    </div>
  );
}
