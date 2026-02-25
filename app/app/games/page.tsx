'use client';

import { useState } from 'react';
import { GameList } from '@/components/game/GameList';

type FilterType = 'all' | 'bettable' | 'in_progress' | 'completed';

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bettable', label: 'Bettable' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
];

export default function GamesPage() {
  const [filter, setFilter] = useState<FilterType>('all');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Games</h1>
          <p className="text-slate-400 text-sm mt-1">Watch and bet on AI agent matches</p>
        </div>

        <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter">
          {FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`
                rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 cursor-pointer
                ${filter === value
                  ? 'glass-cyan text-cyan-300 ring-1 ring-cyan-400/50'
                  : 'glass text-slate-400 hover:text-white'
                }
              `}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <GameList filter={filter} />
    </div>
  );
}
