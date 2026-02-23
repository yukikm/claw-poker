import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type GameSummary } from '@/lib/types';
import { type GamePhase } from '@/lib/constants';
import { getReadOnlyProgram } from '@/lib/anchor';

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
}

function parsePhase(phase: Record<string, unknown>): GamePhase {
  const phaseMap: Record<string, GamePhase> = {
    waiting: 'Waiting',
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

const IN_PROGRESS_PHASES: GamePhase[] = ['PreFlop', 'Flop', 'Turn', 'River', 'Showdown'];

export const useGamesStore = create<GamesStore>((set) => ({
  games: [],
  stats: INITIAL_STATS,
  isLoading: false,
  error: null,

  fetchGames: async (connection: Connection, programId: PublicKey) => {
    set({ isLoading: true, error: null });
    try {
      const program = getReadOnlyProgram(connection);

      // Game と BettingPool を並列取得
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [gameAccounts, poolAccounts] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).game.all(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (program.account as any).bettingPool.all(),
      ]);

      // gameId をキーに BettingPool データをマップ化
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolMap = new Map<string, { totalBets: number; betCount: number; isClosed: boolean }>();
      for (const { account } of poolAccounts as { account: unknown }[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pool = account as any;
        const gameId = pool.gameId.toString() as string;
        const totalBets =
          (pool.totalBetPlayer1 as { toNumber(): number }).toNumber() +
          (pool.totalBetPlayer2 as { toNumber(): number }).toNumber();
        poolMap.set(gameId, {
          totalBets,
          betCount: pool.betCount as number,
          isClosed: pool.isClosed as boolean,
        });
      }

      const games: GameSummary[] = (gameAccounts as { publicKey: PublicKey; account: unknown }[]).map(
        ({ publicKey, account }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const game = account as any;
          const phase = parsePhase(game.phase as Record<string, unknown>);
          const gameId: bigint = BigInt(game.gameId.toString());
          const bettingClosed = game.bettingClosed as boolean;

          const [bettingPoolPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('betting_pool'), Buffer.from(new BigUint64Array([gameId]).buffer)],
            programId
          );

          const poolData = poolMap.get(game.gameId.toString() as string);
          // BettingPool が締め切り済み or game.betting_closed の場合はベット不可
          const isBettable =
            !bettingClosed &&
            !(poolData?.isClosed ?? false) &&
            (phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn');

          return {
            gameId,
            gamePda: publicKey,
            phase,
            handNumber: (game.handNumber as { toNumber(): number }).toNumber(),
            player1: game.player1 as PublicKey,
            player2: game.player2 as PublicKey,
            pot: (game.pot as { toNumber(): number }).toNumber(),
            winner: game.winner as PublicKey | null,
            bettingPoolPda,
            isBettable,
            bettingClosed,
          };
        }
      );

      // 集計統計を計算
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
      set({ error: String(err), isLoading: false });
    }
  },

  updateGame: (gamePda: PublicKey, update: Partial<GameSummary>) => {
    set((state) => ({
      games: state.games.map((g) =>
        g.gamePda.equals(gamePda) ? { ...g, ...update } : g
      ),
    }));
  },
}));
