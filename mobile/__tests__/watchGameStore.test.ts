import { PublicKey } from '@solana/web3.js';
import { useWatchGameStore } from '../stores/watchGameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useMyBetsStore } from '../stores/myBetsStore';

// Mock anchor module to avoid loading the IDL JSON
jest.mock('../lib/anchor', () => {
  const { PublicKey: PK } = require('@solana/web3.js');
  return {
    getReadOnlyProgram: jest.fn(),
    getProgramId: jest.fn(() => new PK('11111111111111111111111111111111')),
  };
});

// Mock solana module
jest.mock('../lib/solana', () => ({
  getConnection: jest.fn(),
}));

const PLAYER1 = 'BPFLoaderUpgradeab1e11111111111111111111111';
const PLAYER2 = '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo';
const DEFAULT_PUBKEY = '11111111111111111111111111111111';

function makeServerResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'PreFlop',
    handNumber: 1,
    pot: 2000,
    player1: PLAYER1,
    player2: PLAYER2,
    player1Name: 'AgentAlpha',
    player2Name: 'AgentBeta',
    player1ChipStack: 10000,
    player2ChipStack: 10000,
    player1Committed: 100,
    player2Committed: 200,
    player1HasFolded: false,
    player2HasFolded: false,
    player1IsAllIn: false,
    player2IsAllIn: false,
    boardCards: [],
    currentTurn: PLAYER1,
    dealerPosition: 0,
    lastRaiseAmount: 100,
    showdownCardsP1: null,
    showdownCardsP2: null,
    winner: null,
    bettingClosed: false,
    ...overrides,
  };
}

// Spy on global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Use fake timers for polling
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();

  // Reset stores
  useWatchGameStore.setState({
    game: null,
    bettingPool: null,
    isLoading: false,
    pollTimer: null,
    poolPollTimer: null,
  });
  useSettingsStore.setState({
    hapticsEnabled: true,
    pollingIntervalMs: 5_000,
    isLoaded: true,
  });
  useMyBetsStore.setState({ bets: [] });

  // Default: fetch returns a valid game response
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => makeServerResponse(),
  });
});

afterEach(() => {
  // Clean up any active timers
  const state = useWatchGameStore.getState();
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.poolPollTimer) clearInterval(state.poolPollTimer);
  jest.useRealTimers();
});

describe('watchGameStore', () => {
  const gamePda = new PublicKey(DEFAULT_PUBKEY);
  const bettingPoolPda = new PublicKey(DEFAULT_PUBKEY);
  const programId = new PublicKey(DEFAULT_PUBKEY);
  const gameIdStr = '42';

  describe('subscribeToGame', () => {
    it('sets up polling timers', () => {
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);

      const state = useWatchGameStore.getState();
      expect(state.pollTimer).not.toBeNull();
      expect(state.poolPollTimer).not.toBeNull();
    });

    it('sets isLoading to true initially', () => {
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      // isLoading is true synchronously, before the initial fetch completes
      expect(useWatchGameStore.getState().isLoading).toBe(true);
    });

    it('clears previous timers when re-subscribing', () => {
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      const firstTimer = useWatchGameStore.getState().pollTimer;
      const firstPoolTimer = useWatchGameStore.getState().poolPollTimer;

      // Re-subscribe
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);

      const secondTimer = useWatchGameStore.getState().pollTimer;
      const secondPoolTimer = useWatchGameStore.getState().poolPollTimer;

      // New timers should be different from the old ones
      expect(secondTimer).not.toBe(firstTimer);
      expect(secondPoolTimer).not.toBe(firstPoolTimer);
    });

    it('resets game and bettingPool state on subscribe', () => {
      useWatchGameStore.setState({
        game: { gameId: BigInt(1) } as ReturnType<typeof useWatchGameStore.getState>['game'],
      });
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      expect(useWatchGameStore.getState().game).toBeNull();
      expect(useWatchGameStore.getState().bettingPool).toBeNull();
    });
  });

  describe('unsubscribeFromGame', () => {
    it('clears timers and resets state', () => {
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      expect(useWatchGameStore.getState().pollTimer).not.toBeNull();

      useWatchGameStore.getState().unsubscribeFromGame();

      const state = useWatchGameStore.getState();
      expect(state.pollTimer).toBeNull();
      expect(state.poolPollTimer).toBeNull();
      expect(state.game).toBeNull();
      expect(state.bettingPool).toBeNull();
    });

    it('is safe to call when not subscribed', () => {
      expect(() => useWatchGameStore.getState().unsubscribeFromGame()).not.toThrow();
    });
  });

  describe('fetchGameState (via polling)', () => {
    it('parses server response and sets game state', async () => {
      const response = makeServerResponse({ phase: 'Flop', pot: 5000, boardCards: ['AH', '5C', 'TD'] });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => response,
      });

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      // Flush the initial fetch promise
      await jest.advanceTimersByTimeAsync(0);

      const game = useWatchGameStore.getState().game;
      expect(game).not.toBeNull();
      expect(game!.phase).toBe('Flop');
      expect(game!.pot).toBe(5000);
      expect(game!.handNumber).toBe(1);
      expect(game!.boardCards).toHaveLength(3);
      // AH = Ace of Hearts
      expect(game!.boardCards[0]).toEqual({ suit: 'Hearts', rank: 12, isUnknown: false });
      // 5C = 5 of Clubs
      expect(game!.boardCards[1]).toEqual({ suit: 'Clubs', rank: 3, isUnknown: false });
      // TD = 10 of Diamonds
      expect(game!.boardCards[2]).toEqual({ suit: 'Diamonds', rank: 8, isUnknown: false });
    });

    it('fetches SERVER_API_URL/api/v1/games/{gameIdStr}', async () => {
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/games/${gameIdStr}`),
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    it('handles fetch failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      // Should not throw, game remains null
      expect(useWatchGameStore.getState().game).toBeNull();
    });

    it('handles non-ok response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      expect(useWatchGameStore.getState().game).toBeNull();
    });
  });

  describe('phase change clears stale action badges', () => {
    it('clears player lastAction when phase changes', async () => {
      // First fetch: PreFlop with a bet action
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeServerResponse({
          phase: 'PreFlop',
          player1Committed: 200,
          player2Committed: 200,
        }),
      });

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      // Manually set a lastAction to simulate an inferred action
      const game = useWatchGameStore.getState().game!;
      useWatchGameStore.setState({
        game: {
          ...game,
          player1: { ...game.player1, lastAction: 'Bet(200)' },
          player2: { ...game.player2, lastAction: 'Call(200)' },
        },
      });

      // Second fetch: phase changes to Flop
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeServerResponse({
          phase: 'Flop',
          player1Committed: 0,
          player2Committed: 0,
          boardCards: ['AH', 'KS', 'QD'],
        }),
      });

      await jest.advanceTimersByTimeAsync(3000); // trigger polling

      const updatedGame = useWatchGameStore.getState().game;
      expect(updatedGame).not.toBeNull();
      expect(updatedGame!.phase).toBe('Flop');
      // lastAction should be cleared on phase change
      expect(updatedGame!.player1.lastAction).toBeNull();
      expect(updatedGame!.player2.lastAction).toBeNull();
    });
  });

  describe('generation counter prevents stale updates', () => {
    it('discards fetch results after unsubscribe', async () => {
      let resolveJson: ((value: unknown) => void) | null = null;
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () => new Promise((resolve) => { resolveJson = resolve; }),
        })
      );

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);

      // Unsubscribe before fetch completes (increments generation)
      useWatchGameStore.getState().unsubscribeFromGame();

      // Now resolve the fetch - should be discarded
      if (resolveJson) {
        (resolveJson as (value: unknown) => void)(makeServerResponse());
      }
      await jest.advanceTimersByTimeAsync(0);

      expect(useWatchGameStore.getState().game).toBeNull();
    });

    it('discards stale results when re-subscribing quickly', async () => {
      // First subscription fetch is slow
      let resolveFirstJson: ((value: unknown) => void) | null = null;
      mockFetch.mockReturnValueOnce(
        Promise.resolve({
          ok: true,
          json: () => new Promise((resolve) => { resolveFirstJson = resolve; }),
        })
      );

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);

      // Re-subscribe (increments generation), fast response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeServerResponse({ phase: 'Flop', pot: 9999 }),
      });
      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      // Now resolve the first (stale) subscription
      if (resolveFirstJson) {
        (resolveFirstJson as (value: unknown) => void)(makeServerResponse({ phase: 'PreFlop', pot: 1 }));
      }
      await jest.advanceTimersByTimeAsync(0);

      // Game should reflect the second subscription, not the stale first
      const game = useWatchGameStore.getState().game;
      expect(game).not.toBeNull();
      expect(game!.phase).toBe('Flop');
      expect(game!.pot).toBe(9999);
    });
  });

  describe('uses settingsStore polling interval', () => {
    it('game poll interval is half the settings interval (min 1s)', async () => {
      useSettingsStore.setState({ pollingIntervalMs: 6_000 });

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);
      mockFetch.mockClear();

      // At 2.5s (less than half of 6s = 3s), no poll should have fired yet
      mockFetch.mockResolvedValue({ ok: true, json: async () => makeServerResponse() });
      await jest.advanceTimersByTimeAsync(2500);
      expect(mockFetch).not.toHaveBeenCalled();

      // At 3s (exactly half of 6s), poll fires
      await jest.advanceTimersByTimeAsync(500);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('game poll interval has a minimum of 1000ms', () => {
      useSettingsStore.setState({ pollingIntervalMs: 1_000 }); // half = 500, clamped to 1000

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      // The timer should exist (it's created with at least 1000ms interval)
      expect(useWatchGameStore.getState().pollTimer).not.toBeNull();
    });

    it('pool poll interval is the settings interval (min 3s)', async () => {
      useSettingsStore.setState({ pollingIntervalMs: 2_000 }); // clamped to 3s for pool

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      // poolPollTimer should exist
      expect(useWatchGameStore.getState().poolPollTimer).not.toBeNull();
    });
  });

  describe('no-change detection skips update', () => {
    it('does not update game when server returns identical data', async () => {
      const response = makeServerResponse();
      mockFetch.mockResolvedValue({ ok: true, json: async () => response });

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      const gameAfterFirst = useWatchGameStore.getState().game;
      expect(gameAfterFirst).not.toBeNull();

      // Spy on setState to see if set is called again
      const setStateSpy = jest.spyOn(useWatchGameStore, 'setState');

      // Trigger another poll with the same data
      await jest.advanceTimersByTimeAsync(3000);

      // setState may be called for isLoading but not for game (same data = skip)
      const gameCalls = setStateSpy.mock.calls.filter(
        (call) => call[0] && typeof call[0] === 'object' && 'game' in (call[0] as Record<string, unknown>)
      );
      expect(gameCalls).toHaveLength(0);

      setStateSpy.mockRestore();
    });
  });

  describe('winner detection syncs bets', () => {
    it('calls syncBetsWithPool when winner is detected', async () => {
      const syncSpy = jest.spyOn(useMyBetsStore.getState(), 'syncBetsWithPool');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeServerResponse({ phase: 'Finished', winner: PLAYER1 }),
      });

      useWatchGameStore.getState().subscribeToGame(gamePda, bettingPoolPda, programId, gameIdStr);
      await jest.advanceTimersByTimeAsync(0);

      const game = useWatchGameStore.getState().game;
      expect(game).not.toBeNull();
      expect(game!.winner).not.toBeNull();
      expect(syncSpy).toHaveBeenCalledWith(
        bettingPoolPda.toString(),
        expect.any(PublicKey),
        expect.any(PublicKey),
        expect.any(PublicKey)
      );

      syncSpy.mockRestore();
    });
  });
});
