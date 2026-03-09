import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type GameSummary } from '../lib/types';
import { type GamePhase } from '../lib/constants';
import { SERVER_API_URL } from '../lib/constants';
import { getReadOnlyProgram } from '../lib/anchor';
import { getERConnection } from '../lib/solana';
import { useSettingsStore } from './settingsStore';

export interface GamesStats {
  totalGames: number;
  activeGames: number;
  totalBetsLamports: number;
  totalBettors: number;
}

const INITIAL_STATS: GamesStats = {
  totalGames: 0,
  activeGames: 0,
  totalBetsLamports: 0,
  totalBettors: 0,
};

interface GamesStore {
  games: GameSummary[];
  stats: GamesStats;
  isLoading: boolean;
  error: string | null;
  serverConnected: boolean;
  fetchGames: (connection: Connection, programId: PublicKey) => Promise<void>;
  updateGame: (gamePda: PublicKey, update: Partial<GameSummary>) => void;
  startPolling: (connection: Connection, programId: PublicKey) => void;
  stopPolling: () => void;
}

function gameIdToBuffer(gameId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, gameId, true);
  return buf;
}

function parsePhase(phase: Record<string, unknown>): GamePhase {
  const phaseMap: Record<string, GamePhase> = {
    waiting: 'Waiting',
    shuffling: 'Shuffling',
    preFlop: 'PreFlop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
    finished: 'Finished',
  };
  const key = Object.keys(phase)[0] ?? '';
  return phaseMap[key] ?? 'Waiting';
}

const IN_PROGRESS_PHASES: GamePhase[] = ['Shuffling', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown'];

/** Anchor account の動的型 (IDLから生成される型が使えないため) */
interface AnchorBN {
  toNumber(): number;
  toString(): string;
}

interface AnchorGameAccount {
  gameId: AnchorBN;
  phase: Record<string, unknown>;
  handNumber: AnchorBN;
  player1: PublicKey;
  player2: PublicKey;
  pot: AnchorBN;
  winner: PublicKey | null;
  bettingClosed: boolean;
}

interface AnchorPoolAccount {
  gameId: AnchorBN;
  totalBetPlayer1: AnchorBN;
  totalBetPlayer2: AnchorBN;
  betCount: number;
  isClosed: boolean;
}

function isAnchorGameAccount(raw: unknown): raw is AnchorGameAccount {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.gameId != null &&
    typeof (obj.gameId as AnchorBN).toNumber === 'function' &&
    obj.phase != null &&
    typeof obj.phase === 'object' &&
    obj.player1 != null &&
    obj.player2 != null &&
    obj.pot != null &&
    typeof (obj.pot as AnchorBN).toNumber === 'function'
  );
}

function isAnchorPoolAccount(raw: unknown): raw is AnchorPoolAccount {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.gameId != null &&
    typeof (obj.gameId as AnchorBN).toNumber === 'function' &&
    obj.totalBetPlayer1 != null &&
    typeof (obj.totalBetPlayer1 as AnchorBN).toNumber === 'function' &&
    typeof obj.isClosed === 'boolean'
  );
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let rpcBackoffUntil = 0; // Skip RPC calls until this timestamp

const CACHE_KEY = 'claw_poker_games_cache';

interface CachedGame {
  gameId: string;
  gamePda: string;
  phase: GamePhase;
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

function serializeGames(games: GameSummary[]): CachedGame[] {
  return games.map((g) => ({
    gameId: g.gameId.toString(),
    gamePda: g.gamePda.toBase58(),
    phase: g.phase,
    handNumber: g.handNumber,
    player1: g.player1.toBase58(),
    player2: g.player2.toBase58(),
    player1Name: g.player1Name,
    player2Name: g.player2Name,
    pot: g.pot,
    winner: g.winner?.toBase58() ?? null,
    bettingPoolPda: g.bettingPoolPda.toBase58(),
    isBettable: g.isBettable,
    bettingClosed: g.bettingClosed,
  }));
}

function deserializeGames(cached: CachedGame[]): GameSummary[] {
  const results: GameSummary[] = [];
  for (const c of cached) {
    try {
      results.push({
        gameId: BigInt(c.gameId),
        gamePda: new PublicKey(c.gamePda),
        phase: c.phase,
        handNumber: c.handNumber,
        player1: new PublicKey(c.player1),
        player2: new PublicKey(c.player2),
        player1Name: c.player1Name,
        player2Name: c.player2Name,
        pot: c.pot,
        winner: c.winner ? new PublicKey(c.winner) : null,
        bettingPoolPda: new PublicKey(c.bettingPoolPda),
        isBettable: c.isBettable,
        bettingClosed: c.bettingClosed,
      });
    } catch (err) {
      console.warn('[gamesStore] skip corrupt cached game:', c.gameId, err);
    }
  }
  return results;
}

async function persistGamesCache(games: GameSummary[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(serializeGames(games)));
  } catch {
    // Non-critical - silently ignore
  }
}

async function loadGamesCache(): Promise<GameSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    return deserializeGames(JSON.parse(raw) as CachedGame[]);
  } catch (err) {
    console.warn('[gamesStore] cache load error:', err);
    return [];
  }
}

export const useGamesStore = create<GamesStore>((set, get) => ({
  games: [],
  stats: INITIAL_STATS,
  isLoading: false,
  error: null,
  serverConnected: false,

  fetchGames: async (connection: Connection, programId: PublicKey) => {
    set({ isLoading: true, error: null });
    let serverConnected = false;
    try {
      const erConnection = getERConnection();
      const erProgram = getReadOnlyProgram(erConnection);
      const l1Program = getReadOnlyProgram(connection);

      interface ServerGame {
        gameId: string;
        player1: string;
        player2: string;
        player1Name: string | null;
        player2Name: string | null;
        phase: string;
        handNumber: number;
        pot: number;
        player1ChipStack: number;
        player2ChipStack: number;
        bettingClosed: boolean;
        winner: string | null;
      }
      const serverController = new AbortController();
      const serverTimeout = setTimeout(() => serverController.abort(), 8000);
      const fetchUrl = `${SERVER_API_URL}/api/v1/games`;
      const serverGamesPromise: Promise<ServerGame[]> = fetch(fetchUrl, {
        signal: serverController.signal,
        headers: { 'Accept': 'application/json' },
      })
        .then((r) => {
          serverConnected = true;
          return r.json() as Promise<{ games: ServerGame[] }>;
        })
        .then((data) => { clearTimeout(serverTimeout); return data.games; })
        .catch((err: unknown) => {
          clearTimeout(serverTimeout);
          serverConnected = false;
          return [] as ServerGame[];
        });

      const serverGames = await serverGamesPromise;

      // L1 pool data for stats (Total Bets / Bettors).
      // Game accounts are NOT fetched from L1 - server API is the sole source for games.
      // This avoids expensive getProgramAccounts calls and "variant mismatch" deserialization errors.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l1Access = l1Program.account as any;
      const poolAccounts = Date.now() < rpcBackoffUntil ? [] : await l1Access.bettingPool.all().catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('429')) {
          rpcBackoffUntil = Date.now() + 30_000;
        }
        return [];
      });
      const erGameAccounts: { publicKey: PublicKey; account: unknown }[] = [];
      const l1GameAccounts: { publicKey: PublicKey; account: unknown }[] = [];

      const gameMap = new Map<string, { publicKey: PublicKey; account: AnchorGameAccount }>();
      for (const entry of l1GameAccounts) {
        if (!isAnchorGameAccount(entry.account)) continue;
        gameMap.set(entry.account.gameId.toString(), { publicKey: entry.publicKey, account: entry.account });
      }
      for (const entry of erGameAccounts) {
        if (!isAnchorGameAccount(entry.account)) continue;
        gameMap.set(entry.account.gameId.toString(), { publicKey: entry.publicKey, account: entry.account });
      }
      const gameAccounts = Array.from(gameMap.values());

      const poolMap = new Map<string, { totalBets: number; betCount: number; isClosed: boolean }>();
      for (const { account } of poolAccounts) {
        if (!isAnchorPoolAccount(account)) continue;
        const gameId = account.gameId.toString();
        const totalBets = account.totalBetPlayer1.toNumber() + account.totalBetPlayer2.toNumber();
        poolMap.set(gameId, { totalBets, betCount: account.betCount, isClosed: account.isClosed });
      }

      const games: GameSummary[] = gameAccounts.map(({ publicKey, account }) => {
        const game = account;
        const phase = parsePhase(game.phase as Record<string, unknown>);
        const gameId: bigint = BigInt(game.gameId.toString());
        const bettingClosed = game.bettingClosed;

        const [bettingPoolPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('betting_pool'), gameIdToBuffer(gameId)],
          programId
        );

        const poolData = poolMap.get(game.gameId.toString());
        const isBettable =
          !bettingClosed &&
          !(poolData?.isClosed ?? false) &&
          (phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn' || phase === 'River');

        return {
          gameId,
          gamePda: publicKey,
          phase,
          handNumber: game.handNumber.toNumber(),
          player1: game.player1,
          player2: game.player2,
          player1Name: null,
          player2Name: null,
          pot: game.pot.toNumber(),
          winner: game.winner,
          bettingPoolPda,
          isBettable,
          bettingClosed,
        };
      });

      // Merge server API games (Private ER data)
      const existingGameIdxMap = new Map(games.map((g, idx) => [g.gameId.toString(), idx]));
      for (const sg of serverGames) {
        const gameIdBigInt = BigInt(sg.gameId);
        const phaseMap: Record<string, GamePhase> = {
          Waiting: 'Waiting', Shuffling: 'Shuffling', PreFlop: 'PreFlop',
          Flop: 'Flop', Turn: 'Turn', River: 'River', Showdown: 'Showdown', Finished: 'Finished',
        };
        const phase = phaseMap[sg.phase] ?? 'Waiting';
        const [gamePda] = PublicKey.findProgramAddressSync(
          [Buffer.from('game'), gameIdToBuffer(gameIdBigInt)],
          programId,
        );
        const [bettingPoolPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('betting_pool'), gameIdToBuffer(gameIdBigInt)],
          programId,
        );
        const isBettable = !sg.bettingClosed
          && (phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn' || phase === 'River');
        const serverEntry: GameSummary = {
          gameId: gameIdBigInt,
          gamePda,
          phase,
          handNumber: sg.handNumber,
          player1: new PublicKey(sg.player1),
          player2: new PublicKey(sg.player2),
          player1Name: sg.player1Name ?? null,
          player2Name: sg.player2Name ?? null,
          pot: sg.pot,
          winner: sg.winner ? new PublicKey(sg.winner) : null,
          bettingPoolPda,
          isBettable,
          bettingClosed: sg.bettingClosed,
        };
        const existingIdx = existingGameIdxMap.get(sg.gameId);
        if (existingIdx !== undefined) {
          games[existingIdx] = { ...games[existingIdx], ...serverEntry };
        } else {
          games.push(serverEntry);
        }
      }

      const totalBetsLamports = Array.from(poolMap.values()).reduce((s, p) => s + p.totalBets, 0);
      const totalBettors = Array.from(poolMap.values()).reduce((s, p) => s + p.betCount, 0);
      const activeGames = games.filter((g) => IN_PROGRESS_PHASES.includes(g.phase)).length;
      const stats: GamesStats = { totalGames: games.length, activeGames, totalBetsLamports, totalBettors };

      set({ games, stats, isLoading: false, serverConnected });
      persistGamesCache(games);
    } catch (err) {
      console.error('[gamesStore] fetchGames error:', err);
      set({ error: 'Failed to load games.', isLoading: false, serverConnected });
    }
  },

  updateGame: (gamePda: PublicKey, update: Partial<GameSummary>) => {
    set((state) => ({
      games: state.games.map((g) =>
        g.gamePda.equals(gamePda) ? { ...g, ...update } : g
      ),
    }));
  },

  startPolling: (connection: Connection, programId: PublicKey) => {
    if (pollingInterval) return;
    // Restore cached games instantly, then fetch fresh data
    loadGamesCache().then((cached) => {
      if (cached.length > 0 && get().games.length === 0) {
        const activeGames = cached.filter((g) => IN_PROGRESS_PHASES.includes(g.phase)).length;
        set({
          games: cached,
          stats: { totalGames: cached.length, activeGames, totalBetsLamports: 0, totalBettors: 0 },
        });
      }
    }).catch((err: unknown) => {
      console.warn('[gamesStore] cache restore error:', err);
    });
    get().fetchGames(connection, programId);
    const intervalMs = useSettingsStore.getState().pollingIntervalMs;
    pollingInterval = setInterval(() => {
      get().fetchGames(connection, programId);
    }, intervalMs);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
}));
