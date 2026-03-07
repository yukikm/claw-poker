import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type GameSummary } from '@/lib/types';
import { type GamePhase } from '@/lib/constants';
import { getReadOnlyProgram } from '@/lib/anchor';
import { getERConnection } from '@/lib/solana';

/** サーバーHTTP APIのベースURL（プライベートERゲーム取得用） */
const SERVER_API_URL = process.env.NEXT_PUBLIC_SERVER_API_URL ?? 'http://43.206.193.46:3001';

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
  serverConnected: false,

  fetchGames: async (connection: Connection, programId: PublicKey) => {
    set({ isLoading: true, error: null });
    let serverConnected = false;
    try {
      // ER をまず試し、取得できなければ L1 にフォールバック。
      // デリゲーション後は ER がアクティブなゲームを保持し、L1 は完了ゲームや未デリゲートゲームを保持する。
      const erConnection = getERConnection();
      const erProgram = getReadOnlyProgram(erConnection);
      const l1Program = getReadOnlyProgram(connection);

      // サーバーAPIからプライベートER上のアクティブゲームを取得
      // プライベートERにデリゲーションされたゲームは公開ERに存在しないため、
      // サーバーが保持するactiveGames情報をマージする。
      interface ServerGame {
        gameId: string;
        player1: string;
        player2: string;
        phase: string;
        handNumber: number;
        pot: number;
        player1ChipStack: number;
        player2ChipStack: number;
        bettingClosed: boolean;
        winner: string | null;
      }
      const serverGamesPromise: Promise<ServerGame[]> = fetch(`${SERVER_API_URL}/api/v1/games`)
        .then((r) => {
          serverConnected = true;
          return r.json() as Promise<{ games: ServerGame[] }>;
        })
        .then((data) => data.games)
        .catch(() => {
          serverConnected = false;
          return [] as ServerGame[];
        });

      const [erGameAccounts, l1GameAccounts, poolAccounts, serverGames] = await Promise.all([
        erProgram.account.game.all().catch(() => []),
        l1Program.account.game.all().catch(() => []),
        l1Program.account.bettingPool.all().catch(() => []),
        serverGamesPromise,
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

      // サーバーAPIのプライベートERゲームをマージ
      // Private ER (TEE) にdelegateされたゲームはER/L1上のデータが古い（phase=Waiting等）ため、
      // サーバーAPIのデータで上書きする。存在しないゲームは新規追加。
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
          pot: sg.pot,
          winner: sg.winner ? new PublicKey(sg.winner) : null,
          bettingPoolPda,
          isBettable,
          bettingClosed: sg.bettingClosed,
        };
        const existingIdx = existingGameIdxMap.get(sg.gameId);
        if (existingIdx !== undefined) {
          // サーバーAPIのデータで上書き（TEE上の最新状態を反映）
          games[existingIdx] = { ...games[existingIdx], ...serverEntry };
        } else {
          games.push(serverEntry);
        }
      }

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

      set({ games, stats, isLoading: false, serverConnected });
    } catch (err) {
      console.error('[gamesStore] fetchGames error:', err);
      set({ error: 'Failed to load games. Please try again later.', isLoading: false, serverConnected });
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
    }, 3_000);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
}));
