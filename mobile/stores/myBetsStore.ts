import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { PublicKey } from '@solana/web3.js';
import { type MyBet } from '../lib/types';

/** SecureStore adapter for Zustand persist — encrypts data at rest on Android */
const secureStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(name);
  },
};

interface MyBetsStore {
  bets: MyBet[];
  addBet: (bet: MyBet) => void;
  updateBetStatus: (betRecordPda: string, status: MyBet['status'], payout?: number) => void;
  getClaimableBets: () => MyBet[];
  getActiveBets: () => MyBet[];
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

      syncBetsWithPool: (bettingPoolPda, winner, player1Key, player2Key) => {
        try {
          set((state) => ({
            bets: state.bets.map((b) => {
              if (b.bettingPoolPda !== bettingPoolPda || b.status !== 'active') return b;
              const won =
                b.playerChoice === 1
                  ? winner.equals(player1Key)
                  : winner.equals(player2Key);
              return { ...b, status: won ? 'won' : 'lost' };
            }),
          }));
        } catch (err) {
          console.error('[myBetsStore] syncBetsWithPool error:', err);
        }
      },
    }),
    {
      name: 'claw-poker-my-bets',
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
