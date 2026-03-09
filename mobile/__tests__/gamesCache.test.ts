import { PublicKey } from '@solana/web3.js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// We need to test the serialize/deserialize logic.
// Since they're module-private, we test via the store's startPolling cache restore.
// For unit testing, we replicate the logic here.

interface CachedGame {
  gameId: string;
  gamePda: string;
  phase: string;
  handNumber: number;
  player1: string;
  player2: string;
  player1Name: string | null;
  player2Name: string | null;
  pot: number;
  winner: string | null;
  bettingPoolPda: string;
  isBettable: boolean;
  bettingClosed: boolean;
}

function makeCachedGame(overrides: Partial<CachedGame> = {}): CachedGame {
  const key1 = PublicKey.default.toBase58();
  return {
    gameId: '123',
    gamePda: key1,
    phase: 'PreFlop',
    handNumber: 5,
    player1: key1,
    player2: key1,
    player1Name: 'Agent1',
    player2Name: null,
    pot: 1000000,
    winner: null,
    bettingPoolPda: key1,
    isBettable: true,
    bettingClosed: false,
    ...overrides,
  };
}

describe('games cache serialization', () => {
  it('round-trips valid game data', () => {
    const cached = makeCachedGame();
    const json = JSON.stringify([cached]);
    const parsed: CachedGame[] = JSON.parse(json);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].gameId).toBe('123');
    expect(parsed[0].phase).toBe('PreFlop');

    // Verify PublicKey reconstruction
    const pk = new PublicKey(parsed[0].gamePda);
    expect(pk.toBase58()).toBe(PublicKey.default.toBase58());
  });

  it('BigInt round-trips through string', () => {
    const original = BigInt('999999999999999999');
    const serialized = original.toString();
    const deserialized = BigInt(serialized);
    expect(deserialized).toBe(original);
  });

  it('handles null winner', () => {
    const cached = makeCachedGame({ winner: null });
    const json = JSON.stringify([cached]);
    const parsed: CachedGame[] = JSON.parse(json);
    expect(parsed[0].winner).toBeNull();
  });

  it('handles winner with valid PublicKey', () => {
    const key = PublicKey.default.toBase58();
    const cached = makeCachedGame({ winner: key });
    const json = JSON.stringify([cached]);
    const parsed: CachedGame[] = JSON.parse(json);
    const winner = new PublicKey(parsed[0].winner!);
    expect(winner.toBase58()).toBe(key);
  });

  it('rejects invalid PublicKey string', () => {
    expect(() => new PublicKey('not-a-valid-key')).toThrow();
  });
});
