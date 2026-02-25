'use client';

import { PublicKey } from '@solana/web3.js';
import { useClaimReward } from '@/hooks/useClaimReward';
import { formatSol } from '@/lib/format';

interface ClaimButtonProps {
  gameId: bigint;
  bettingPoolPda: PublicKey;
  betRecordPda: PublicKey;
  estimatedPayout: number;
}

export function ClaimButton({ gameId, bettingPoolPda, betRecordPda, estimatedPayout }: ClaimButtonProps) {
  const { claimReward, isLoading, error } = useClaimReward();

  const handleClaim = async () => {
    await claimReward(gameId, bettingPoolPda, betRecordPda);
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleClaim}
        disabled={isLoading}
        className="w-full glass-cyan rounded-lg py-3 text-sm font-semibold text-cyan-300 hover:text-white hover:shadow-neon-cyan transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Claim reward ${formatSol(estimatedPayout)} SOL`}
      >
        {isLoading ? 'Claiming...' : `Claim ${formatSol(estimatedPayout)} SOL`}
      </button>
      {error && <p className="text-xs text-red-400 text-center" role="alert">{error}</p>}
    </div>
  );
}
