import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type GameSummary } from '@/lib/types';
import { type GamePhase } from '@/lib/constants';
import { getReadOnlyProgram } from '@/lib/anchor';
import { getERConnection } from '@/lib/solana';

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
  fetchGames: (connection: Connection, programId: PublicKey) => Promise<void>;
  updateGame: (gamePda: PublicKey, update: Partial<GameSummary>) => void;
  startPolling: (connection: Connection, programId: PublicKey) => void;
  stopPolling: () => void;
}

function gameIdToBuffer(gameId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, gameId, true); // little-endian
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

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const useGamesStore = create<GamesStore>((set, get) => ({
  games: [],
  stats: INITIAL_STATS,
  isLoading: false,
  error: null,

  fetchGames: async (connection: Connection, programId: PublicKey) => {
    set({ isLoading: true, error: null });
    try {
      // ER をまず試し、取得できなければ L1 にフォールバック。
      // デリゲーション後は ER がアクティブなゲームを保持し、L1 は完了ゲームや未デリゲートゲームを保持する。
      const erConnection = getERConnection();
      const erProgram = getReadOnlyProgram(erConnection);
      const l1Program = getReadOnlyProgram(connection);

      const [erGameAccounts, l1GameAccounts, poolAccounts] = await Promise.all([
        erProgram.account.game.all().catch(() => []),
        l1Program.account.game.all().catch(() => []),
        l1Program.account.bettingPool.all().catch(() => []),
      ]);

      // ER と L1 のゲームをマージ（gameId をキーに重複排除。ER を優先）
      const gameMap = new Map<string, typeof erGameAccounts[number]>();
      for (const entry of l1GameAccounts) {
        gameMap.set(entry.account.gameId.toString(), entry);
      }
      for (const entry of erGameAccounts) {
        gameMap.set(entry.account.gameId.toString(), entry);
      }
      const gameAccounts = Array.from(gameMap.values());

      // Map BettingPool data by gameId
      const poolMap = new Map<string, { totalBets: number; betCount: number; isClosed: boolean }>();
      for (const { account } of poolAccounts) {
        const pool = account;
        const gameId = pool.gameId.toString();
        const totalBets = pool.totalBetPlayer1.toNumber() + pool.totalBetPlayer2.toNumber();
        poolMap.set(gameId, {
          totalBets,
          betCount: pool.betCount,
          isClosed: pool.isClosed,
        });
      }

      const games: GameSummary[] = gameAccounts.map(
        ({ publicKey, account }) => {
          const game = account;
          const phase = parsePhase(game.phase as unknown as Record<string, unknown>);
          const gameId: bigint = BigInt(game.gameId.toString());
          const bettingClosed = game.bettingClosed;

          const [bettingPoolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('betting_pool'), gameIdToBuffer(gameId)],
            programId
          );

          const poolData = poolMap.get(game.gameId.toString());
          // Betting not allowed if BettingPool is closed or game.betting_closed
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
            pot: game.pot.toNumber(),
            winner: game.winner,
            bettingPoolPda,
            isBettable,
            bettingClosed,
          };
        }
      );

      // Compute aggregate statistics
      const totalBetsLamports = Array.from(poolMap.values()).reduce((s, p) => s + p.totalBets, 0);
      const totalBettors = Array.from(poolMap.values()).reduce((s, p) => s + p.betCount, 0);
      const activeGames = games.filter((g) => IN_PROGRESS_PHASES.includes(g.phase)).length;
      const stats: GamesStats = {
        totalGames: games.length,
        activeGames,
        totalBetsLamports,
        totalBettors,
      };

      set({ games, stats, isLoading: false });
    } catch (err) {
      console.error('[gamesStore] fetchGames error:', err);
      set({ error: 'Failed to load games. Please try again later.', isLoading: false });
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
    get().fetchGames(connection, programId);
    pollingInterval = setInterval(() => {
      get().fetchGames(connection, programId);
    }, 10_000);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
}));
