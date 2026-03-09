import { PublicKey } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import { useMyBetsStore } from '../stores/myBetsStore';
import { type MyBet } from '../lib/types';

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;

const PLAYER1_KEY = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const PLAYER2_KEY = new PublicKey('6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');
const POOL_PDA = '11111111111111111111111111111111';

function makeBet(overrides: Partial<MyBet> = {}): MyBet {
  return {
    gameId: '42',
    gamePda: '11111111111111111111111111111111',
    bettingPoolPda: POOL_PDA,
    betRecordPda: 'bet-record-pda-1',
    playerChoice: 1,
    amount: 100_000_000,
    timestamp: Date.now(),
    status: 'active',
    payout: null,
    txSignature: 'sig123',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store to empty state
  useMyBetsStore.setState({ bets: [] });
  jest.clearAllMocks();
});

describe('myBetsStore', () => {
  describe('addBet', () => {
    it('adds a bet to the bets array', () => {
      const bet = makeBet();
      useMyBetsStore.getState().addBet(bet);

      const bets = useMyBetsStore.getState().bets;
      expect(bets).toHaveLength(1);
      expect(bets[0]).toEqual(bet);
    });

    it('appends multiple bets', () => {
      const bet1 = makeBet({ betRecordPda: 'pda-1' });
      const bet2 = makeBet({ betRecordPda: 'pda-2', playerChoice: 2 });

      useMyBetsStore.getState().addBet(bet1);
      useMyBetsStore.getState().addBet(bet2);

      const bets = useMyBetsStore.getState().bets;
      expect(bets).toHaveLength(2);
      expect(bets[0].betRecordPda).toBe('pda-1');
      expect(bets[1].betRecordPda).toBe('pda-2');
    });

    it('preserves all bet fields', () => {
      const bet = makeBet({
        gameId: '99',
        playerChoice: 2,
        amount: 500_000_000,
        txSignature: 'unique-sig',
      });
      useMyBetsStore.getState().addBet(bet);

      const stored = useMyBetsStore.getState().bets[0];
      expect(stored.gameId).toBe('99');
      expect(stored.playerChoice).toBe(2);
      expect(stored.amount).toBe(500_000_000);
      expect(stored.txSignature).toBe('unique-sig');
      expect(stored.status).toBe('active');
      expect(stored.payout).toBeNull();
    });
  });

  describe('updateBetStatus', () => {
    it('updates status by betRecordPda', () => {
      useMyBetsStore.getState().addBet(makeBet({ betRecordPda: 'pda-1' }));
      useMyBetsStore.getState().updateBetStatus('pda-1', 'won', 200_000_000);

      const bet = useMyBetsStore.getState().bets[0];
      expect(bet.status).toBe('won');
      expect(bet.payout).toBe(200_000_000);
    });

    it('does not affect other bets', () => {
      useMyBetsStore.getState().addBet(makeBet({ betRecordPda: 'pda-1' }));
      useMyBetsStore.getState().addBet(makeBet({ betRecordPda: 'pda-2' }));
      useMyBetsStore.getState().updateBetStatus('pda-1', 'lost');

      const bets = useMyBetsStore.getState().bets;
      expect(bets[0].status).toBe('lost');
      expect(bets[1].status).toBe('active');
    });

    it('preserves existing payout when not provided', () => {
      useMyBetsStore.getState().addBet(makeBet({ betRecordPda: 'pda-1', payout: 999 }));
      useMyBetsStore.getState().updateBetStatus('pda-1', 'claimed');

      expect(useMyBetsStore.getState().bets[0].payout).toBe(999);
    });

    it('does nothing for non-existent betRecordPda', () => {
      useMyBetsStore.getState().addBet(makeBet({ betRecordPda: 'pda-1' }));
      useMyBetsStore.getState().updateBetStatus('non-existent', 'won');

      expect(useMyBetsStore.getState().bets[0].status).toBe('active');
    });
  });

  describe('getClaimableBets', () => {
    it('returns only bets with status "won"', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'a', status: 'active' }),
          makeBet({ betRecordPda: 'b', status: 'won' }),
          makeBet({ betRecordPda: 'c', status: 'lost' }),
          makeBet({ betRecordPda: 'd', status: 'claimed' }),
          makeBet({ betRecordPda: 'e', status: 'won' }),
        ],
      });

      const claimable = useMyBetsStore.getState().getClaimableBets();
      expect(claimable).toHaveLength(2);
      expect(claimable.map((b) => b.betRecordPda)).toEqual(['b', 'e']);
    });
  });

  describe('getActiveBets', () => {
    it('returns only bets with status "active"', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'a', status: 'active' }),
          makeBet({ betRecordPda: 'b', status: 'won' }),
          makeBet({ betRecordPda: 'c', status: 'active' }),
        ],
      });

      const active = useMyBetsStore.getState().getActiveBets();
      expect(active).toHaveLength(2);
      expect(active.map((b) => b.betRecordPda)).toEqual(['a', 'c']);
    });
  });

  describe('syncBetsWithPool', () => {
    it('marks bets as won when playerChoice matches winner', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', playerChoice: 1, bettingPoolPda: POOL_PDA }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER1_KEY, // winner = player1
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      expect(useMyBetsStore.getState().bets[0].status).toBe('won');
    });

    it('marks bets as lost when playerChoice does not match winner', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', playerChoice: 1, bettingPoolPda: POOL_PDA }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER2_KEY, // winner = player2, but bet was on player1
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      expect(useMyBetsStore.getState().bets[0].status).toBe('lost');
    });

    it('handles playerChoice=2 correctly', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', playerChoice: 2, bettingPoolPda: POOL_PDA }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER2_KEY, // winner = player2
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      expect(useMyBetsStore.getState().bets[0].status).toBe('won');
    });

    it('only updates bets matching the bettingPoolPda', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', bettingPoolPda: POOL_PDA, playerChoice: 1 }),
          makeBet({ betRecordPda: 'bet-2', bettingPoolPda: 'other-pool-pda', playerChoice: 1 }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER1_KEY,
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      expect(useMyBetsStore.getState().bets[0].status).toBe('won');
      expect(useMyBetsStore.getState().bets[1].status).toBe('active'); // unaffected
    });

    it('does not update already settled bets', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', bettingPoolPda: POOL_PDA, playerChoice: 1, status: 'claimed' }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER2_KEY, // would be "lost" if it were active
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      expect(useMyBetsStore.getState().bets[0].status).toBe('claimed'); // unchanged
    });

    it('handles errors gracefully', () => {
      // Force an error by passing something that will cause .equals() to fail
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', bettingPoolPda: POOL_PDA, playerChoice: 1 }),
        ],
      });

      // Passing null as winner would throw in .equals(), but the try-catch should handle it
      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        null as unknown as PublicKey, // invalid
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      // Should have logged the error and not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[myBetsStore] syncBetsWithPool error:'),
        expect.anything()
      );
      // Bets should remain unchanged
      expect(useMyBetsStore.getState().bets[0].status).toBe('active');

      consoleSpy.mockRestore();
    });

    it('handles multiple bets in the same pool', () => {
      useMyBetsStore.setState({
        bets: [
          makeBet({ betRecordPda: 'bet-1', bettingPoolPda: POOL_PDA, playerChoice: 1 }),
          makeBet({ betRecordPda: 'bet-2', bettingPoolPda: POOL_PDA, playerChoice: 2 }),
          makeBet({ betRecordPda: 'bet-3', bettingPoolPda: POOL_PDA, playerChoice: 1 }),
        ],
      });

      useMyBetsStore.getState().syncBetsWithPool(
        POOL_PDA,
        PLAYER1_KEY, // player1 wins
        PLAYER1_KEY,
        PLAYER2_KEY
      );

      const bets = useMyBetsStore.getState().bets;
      expect(bets[0].status).toBe('won');   // choice 1, winner is p1
      expect(bets[1].status).toBe('lost');  // choice 2, winner is p1
      expect(bets[2].status).toBe('won');   // choice 1, winner is p1
    });
  });

  describe('persistence with SecureStore', () => {
    it('uses zustand persist middleware with correct storage key', () => {
      // The persist middleware writes to SecureStore on any state change.
      // addBet triggers a state change, which should persist.
      useMyBetsStore.getState().addBet(makeBet());

      // zustand persist will call setItemAsync with the storage key
      expect(mockSetItem).toHaveBeenCalledWith(
        'claw-poker-my-bets',
        expect.any(String)
      );
    });

    it('persisted data includes bets array', () => {
      const bet = makeBet({ betRecordPda: 'persist-test' });
      useMyBetsStore.getState().addBet(bet);

      const persistedData = mockSetItem.mock.calls.find(
        (call: [string, string]) => call[0] === 'claw-poker-my-bets'
      );
      expect(persistedData).toBeDefined();
      const parsed = JSON.parse(persistedData![1]);
      expect(parsed.state.bets).toHaveLength(1);
      expect(parsed.state.bets[0].betRecordPda).toBe('persist-test');
    });

    it('restores from SecureStore on rehydration', async () => {
      const savedState = {
        state: {
          bets: [
            makeBet({ betRecordPda: 'restored-bet', status: 'won' }),
          ],
        },
        version: 0,
      };
      mockGetItem.mockResolvedValueOnce(JSON.stringify(savedState));

      // Trigger rehydration manually by calling the persist API
      await useMyBetsStore.persist.rehydrate();

      const bets = useMyBetsStore.getState().bets;
      expect(bets).toHaveLength(1);
      expect(bets[0].betRecordPda).toBe('restored-bet');
      expect(bets[0].status).toBe('won');
    });
  });
});
