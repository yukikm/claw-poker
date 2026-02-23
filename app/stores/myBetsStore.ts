import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PublicKey } from '@solana/web3.js';
import { type MyBet } from '@/lib/types';

interface MyBetsStore {
  bets: MyBet[];
  addBet: (bet: MyBet) => void;
  updateBetStatus: (betRecordPda: string, status: MyBet['status'], payout?: number) => void;
  getClaimableBets: () => MyBet[];
  getActiveBets: () => MyBet[];
  /** BettingPool の winner 確定時に active ベットを won / lost へ自動遷移 */
  syncBetsWithPool: (
    bettingPoolPda: string,
    winner: PublicKey,
    player1Key: PublicKey,
    player2Key: PublicKey
  ) => void;
}

export const useMyBetsStore = create<MyBetsStore>()(
  persist(
    (set, get) => ({
      bets: [],

      addBet: (bet) =>
        set((state) => ({ bets: [...state.bets, bet] })),

      updateBetStatus: (betRecordPda, status, payout) =>
        set((state) => ({
          bets: state.bets.map((b) =>
            b.betRecordPda === betRecordPda
              ? { ...b, status, payout: payout ?? b.payout }
              : b
          ),
        })),

      getClaimableBets: () => get().bets.filter((b) => b.status === 'won'),

      getActiveBets: () => get().bets.filter((b) => b.status === 'active'),

      syncBetsWithPool: (bettingPoolPda, winner, player1Key, player2Key) =>
        set((state) => ({
          bets: state.bets.map((b) => {
            if (b.bettingPoolPda !== bettingPoolPda || b.status !== 'active') return b;
            const won =
              b.playerChoice === 1
                ? winner.equals(player1Key)
                : winner.equals(player2Key);
            return { ...b, status: won ? 'won' : 'lost' };
          }),
        })),
    }),
    {
      name: 'claw-poker-my-bets',
    }
  )
);
