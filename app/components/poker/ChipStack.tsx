'use client';

interface ChipStackProps {
  chips: number; // chip units (1000 total per player start)
  label?: string;
}

export function ChipStack({ chips, label }: ChipStackProps) {
  const percentage = Math.min(100, (chips / 1000) * 100);
  const colorClass = percentage > 60 ? 'text-green-400' : percentage > 30 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="flex flex-col items-center gap-1" aria-label={`チップ: ${chips}`}>
      {label && <span className="text-xs text-slate-500">{label}</span>}
      <div className="flex items-center gap-1">
        <div className="w-4 h-4 rounded-full bg-blue-500/80 border border-blue-300/50" aria-hidden="true" />
        <span className={`text-sm font-bold font-mono ${colorClass}`}>{chips}</span>
      </div>
    </div>
  );
}
