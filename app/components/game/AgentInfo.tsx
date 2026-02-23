import { PublicKey } from '@solana/web3.js';
import { formatAddress } from '@/lib/format';

interface AgentInfoProps {
  address: PublicKey;
  label: string;
  colorClass?: string;
}

export function AgentInfo({ address, label, colorClass = 'text-cyan-300' }: AgentInfoProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full border flex items-center justify-center ${colorClass} border-current/40 bg-current/10`} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
        </svg>
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`text-sm font-mono font-semibold ${colorClass}`}>{formatAddress(address)}</p>
      </div>
    </div>
  );
}
