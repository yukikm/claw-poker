'use client';

import { type GamePhase } from '@/lib/constants';

interface PhaseIndicatorProps {
  phase: GamePhase;
  handNumber: number;
}

const PHASE_LABELS: Record<string, string> = {
  Waiting: 'Waiting',
  Shuffling: 'Shuffling',
  PreFlop: 'Pre-Flop',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River',
  Showdown: 'Showdown',
  Finished: 'Finished',
};

const PHASE_COLORS: Record<string, string> = {
  Waiting: 'text-slate-400 border-slate-500/30',
  Shuffling: 'text-blue-300 border-blue-500/30',
  PreFlop: 'text-cyan-300 border-cyan-500/30',
  Flop: 'text-green-300 border-green-500/30',
  Turn: 'text-yellow-300 border-yellow-500/30',
  River: 'text-orange-300 border-orange-500/30',
  Showdown: 'text-purple-300 border-purple-500/30',
  Finished: 'text-slate-400 border-slate-500/30',
};

export function PhaseIndicator({ phase, handNumber }: PhaseIndicatorProps) {
  const label = PHASE_LABELS[phase] ?? phase;
  const colorClass = PHASE_COLORS[phase] ?? 'text-slate-300 border-slate-500/30';

  return (
    <div className="flex items-center gap-3 justify-center">
      <span className="text-xs text-slate-500">Hand #{handNumber}</span>
      <div className={`glass rounded-full px-4 py-1 border ${colorClass}`} role="status" aria-label={`Current phase: ${label}`}>
        <span className="text-sm font-semibold tracking-wide">{label}</span>
      </div>
    </div>
  );
}
