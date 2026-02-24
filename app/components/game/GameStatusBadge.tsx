import { type GamePhase } from '@/lib/constants';

interface GameStatusBadgeProps {
  phase: GamePhase;
}

const PHASE_CONFIG: Record<string, { label: string; className: string }> = {
  Waiting: { label: 'ウェイティング', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  Shuffling: { label: 'シャッフル中', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  PreFlop: { label: 'プリフロップ', className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  Flop: { label: 'フロップ', className: 'bg-green-500/20 text-green-300 border-green-500/30' },
  Turn: { label: 'ターン', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  River: { label: 'リバー', className: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  Showdown: { label: 'ショーダウン', className: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  Finished: { label: '終了', className: 'bg-slate-700/40 text-slate-500 border-slate-600/30' },
};

export function GameStatusBadge({ phase }: GameStatusBadgeProps) {
  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.Waiting;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${config.className}`}
      role="status"
      aria-label={`ゲーム状態: ${config.label}`}
    >
      {config.label}
    </span>
  );
}
