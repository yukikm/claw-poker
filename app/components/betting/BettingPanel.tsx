'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { type BettingPoolState } from '@/lib/types';
import { usePlaceBet } from '@/hooks/usePlaceBet';
import { OddsDisplay } from './OddsDisplay';
import { formatSol, formatOdds } from '@/lib/format';
import { LAMPORTS_PER_SOL, MIN_BET_LAMPORTS, MAX_BET_LAMPORTS } from '@/lib/constants';

interface BettingPanelProps {
  gameId: bigint;
  gamePda?: PublicKey;
  bettingPoolPda: PublicKey;
  pool: BettingPoolState | null;
  phase: string;
}

const BET_PRESETS = [0.1, 0.5, 1, 2];

export function BettingPanel({ gameId, gamePda, bettingPoolPda, pool, phase }: BettingPanelProps) {
  const { publicKey } = useWallet();
  const { placeBet, isLoading, error } = usePlaceBet();
  const [playerChoice, setPlayerChoice] = useState<1 | 2>(1);
  const [betSol, setBetSol] = useState('0.1');
  const [txSig, setTxSig] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isBettable = pool && !pool.isClosed && (phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn' || phase === 'River');
  const betLamports = Math.floor(parseFloat(betSol || '0') * LAMPORTS_PER_SOL);

  const { odds1, odds2 } = formatOdds(pool?.totalBetPlayer1 ?? 0, pool?.totalBetPlayer2 ?? 0);
  const selectedOdds = playerChoice === 1 ? odds1 : odds2;
  const parsedOdds = parseFloat(selectedOdds);
  const estimatedPayout = isFinite(parsedOdds) && parsedOdds > 0
    ? betLamports * parsedOdds
    : null;

  const handleConfirm = () => {
    setValidationError(null);
    if (!publicKey || !isBettable) return;
    if (isNaN(betLamports) || betLamports <= 0) {
      setValidationError('Please enter a valid bet amount');
      return;
    }
    if (betLamports < MIN_BET_LAMPORTS) {
      setValidationError(`Minimum bet is ${MIN_BET_LAMPORTS / LAMPORTS_PER_SOL} SOL`);
      return;
    }
    if (betLamports > MAX_BET_LAMPORTS) {
      setValidationError(`Maximum bet is ${MAX_BET_LAMPORTS / LAMPORTS_PER_SOL} SOL`);
      return;
    }
    setConfirming(true);
  };

  const handleBet = async () => {
    const sig = await placeBet({
      gameId,
      bettingPoolPda,
      playerChoice,
      amount: betLamports,
    });

    if (sig) {
      setTxSig(sig);
      setBetSol('0.1');
    }
    setConfirming(false);
  };

  return (
    <div className="space-y-4">
      <OddsDisplay pool={pool} />

      {!publicKey ? (
        <div className="glass rounded-xl p-4 text-center text-slate-400 text-sm">
          Connect your wallet to place a bet
        </div>
      ) : !isBettable ? (
        <div className="glass rounded-xl p-4 text-center text-slate-400 text-sm">
          {pool?.isClosed ? 'Betting closed' : 'Betting not available'}
        </div>
      ) : (
        <div className="glass rounded-xl p-4 space-y-4">
          <h3 className="text-sm text-slate-300 font-semibold">Place a Bet</h3>

          {/* Player selection */}
          <div className="flex gap-2" role="group" aria-label="Select player to bet on">
            {([1, 2] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlayerChoice(p)}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer
                  ${playerChoice === p
                    ? p === 1 ? 'glass-cyan text-cyan-300 ring-1 ring-cyan-400/50' : 'glass-purple text-purple-300 ring-1 ring-purple-400/50'
                    : 'glass text-slate-400 hover:text-white'
                  }
                `}
                aria-pressed={playerChoice === p}
              >
                Player {p}
              </button>
            ))}
          </div>

          {/* Bet amount */}
          <div>
            <label htmlFor="bet-amount" className="text-xs text-slate-400">Bet Amount (SOL)</label>
            <input
              id="bet-amount"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={betSol}
              onChange={(e) => setBetSol(e.target.value)}
              className="mt-1 w-full glass rounded-lg px-3 py-2 text-white text-sm bg-transparent focus:ring-1 focus:ring-cyan-500/50 outline-none"
            />
          </div>

          {/* Bet slider */}
          <div>
            <input
              type="range"
              min={MIN_BET_LAMPORTS / LAMPORTS_PER_SOL}
              max={MAX_BET_LAMPORTS / LAMPORTS_PER_SOL}
              step="0.1"
              value={parseFloat(betSol) || MIN_BET_LAMPORTS / LAMPORTS_PER_SOL}
              onChange={(e) => setBetSol(e.target.value)}
              className="w-full h-1.5 rounded-full appearance-none bg-slate-700 accent-cyan-400 cursor-pointer"
              aria-label="Bet amount slider"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
              <span>{MIN_BET_LAMPORTS / LAMPORTS_PER_SOL} SOL</span>
              <span>{MAX_BET_LAMPORTS / LAMPORTS_PER_SOL} SOL</span>
            </div>
          </div>

          {/* Presets */}
          <div className="flex gap-2" role="group" aria-label="Bet amount presets">
            {BET_PRESETS.map((sol) => (
              <button
                key={sol}
                onClick={() => setBetSol(sol.toString())}
                className="flex-1 glass rounded py-1 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                aria-label={`${sol} SOL`}
              >
                {sol}
              </button>
            ))}
          </div>

          {/* Payout estimate */}
          <div className="flex justify-between text-xs text-slate-500">
            <span>Est. Payout</span>
            <span className="text-green-300 font-mono">
              {estimatedPayout !== null ? `${formatSol(estimatedPayout, 4)} SOL` : '--'}
            </span>
          </div>

          {validationError && (
            <p className="text-xs text-red-400" role="alert">{validationError}</p>
          )}

          {error && (
            <p className="text-xs text-red-400" role="alert">{error}</p>
          )}

          {txSig && (
            <p className="text-xs text-green-400" role="status">Bet placed! TX: {txSig.slice(0, 8)}...</p>
          )}

          {confirming ? (
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 glass rounded-lg py-3 text-sm text-slate-400 hover:text-white transition-all duration-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleBet}
                disabled={isLoading}
                className="flex-1 glass-cyan rounded-lg py-3 text-sm font-semibold text-cyan-300 hover:text-white hover:shadow-neon-cyan transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Confirm ${betSol} SOL bet`}
              >
                {isLoading ? 'Submitting...' : `Confirm ${betSol} SOL`}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={isLoading || isNaN(betLamports) || betLamports < MIN_BET_LAMPORTS || betLamports > MAX_BET_LAMPORTS}
              className="w-full glass-cyan rounded-lg py-3 text-sm font-semibold text-cyan-300 hover:text-white hover:shadow-neon-cyan transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={`Bet ${betSol} SOL on Player ${playerChoice}`}
            >
              {`Bet ${betSol} SOL on Player ${playerChoice}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
