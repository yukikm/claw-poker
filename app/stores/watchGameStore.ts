import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type Program } from '@coral-xyz/anchor';
import { type GameState, type BettingPoolState } from '@/lib/types';
import { decodeCard } from '@/lib/format';
import { type GamePhase } from '@/lib/constants';
import { useMyBetsStore } from '@/stores/myBetsStore';

interface SubscriptionEntry {
  id: number;
  connection: Connection;
}

interface WatchGameStore {
  game: GameState | null;
  bettingPool: BettingPoolState | null;
  subscriptionEntries: SubscriptionEntry[];
  isLoading: boolean;

  subscribeToGame: (
    connection: Connection,       // L1: BettingPool監視用
    erConnection: Connection,     // ER: Gameアカウント監視用
    gamePda: PublicKey,
    bettingPoolPda: PublicKey,
    programId: PublicKey,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: Program<any>         // Anchorコーダーによるデコード用
  ) => void;
  unsubscribeFromGame: () => void;
  setGame: (game: GameState) => void;
  setBettingPool: (pool: BettingPoolState) => void;
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

function mapGameAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawGame: any,
  gamePda: PublicKey,
  programId: PublicKey
): GameState {
  const phase = parsePhase(rawGame.phase as Record<string, unknown>);
  const boardCards = (rawGame.boardCards as number[]).map(decodeCard);
  const gameId: bigint = BigInt(rawGame.gameId.toString());

  const [bettingPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('betting_pool'), Buffer.from(new BigUint64Array([gameId]).buffer)],
    programId
  );

  const player1Key = rawGame.player1 as PublicKey;
  const player2Key = rawGame.player2 as PublicKey;
  const currentTurnKey = rawGame.currentTurn as PublicKey;

  return {
    gameId,
    gamePda,
    phase,
    handNumber: (rawGame.handNumber as { toNumber(): number }).toNumber(),
    pot: (rawGame.pot as { toNumber(): number }).toNumber(),
    currentTurn: currentTurnKey.equals(player1Key) ? 1 : 2,
    boardCards,
    player1: {
      address: player1Key,
      chips: (rawGame.player1ChipStack as { toNumber(): number }).toNumber(),
      chipsCommitted: (rawGame.player1Committed as { toNumber(): number }).toNumber(),
      hasFolded: (rawGame.player1HasFolded as boolean) ?? false,
      isAllIn: (rawGame.player1IsAllIn as boolean) ?? false,
      lastAction: null,
    },
    player2: {
      address: player2Key,
      chips: (rawGame.player2ChipStack as { toNumber(): number }).toNumber(),
      chipsCommitted: (rawGame.player2Committed as { toNumber(): number }).toNumber(),
      hasFolded: (rawGame.player2HasFolded as boolean) ?? false,
      isAllIn: (rawGame.player2IsAllIn as boolean) ?? false,
      lastAction: null,
    },
    player1Key,
    player2Key,
    winner: rawGame.winner as PublicKey | null,
    bettingPoolPda,
    dealerPosition: rawGame.dealerPosition as number,
    lastRaiseAmount: (rawGame.lastRaiseAmount as { toNumber(): number }).toNumber(),
    showdownCardsP1: (rawGame.showdownCardsP1 as number[]).map(decodeCard),
    showdownCardsP2: (rawGame.showdownCardsP2 as number[]).map(decodeCard),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBettingPoolAccount(rawPool: any): BettingPoolState {
  return {
    gameId: BigInt(rawPool.gameId.toString()),
    totalBetPlayer1: (rawPool.totalBetPlayer1 as { toNumber(): number }).toNumber(),
    totalBetPlayer2: (rawPool.totalBetPlayer2 as { toNumber(): number }).toNumber(),
    betCount: rawPool.betCount as number,
    isClosed: rawPool.isClosed as boolean,
    winner: rawPool.winner as PublicKey | null,
    distributed: rawPool.distributed as boolean,
  };
}

export const useWatchGameStore = create<WatchGameStore>((set, get) => ({
  game: null,
  bettingPool: null,
  subscriptionEntries: [],
  isLoading: false,

  subscribeToGame: (connection, erConnection, gamePda, bettingPoolPda, programId, program) => {
    // 既存のサブスクリプションを解除
    const { subscriptionEntries } = get();
    subscriptionEntries.forEach(({ id, connection: conn }) => {
      conn.removeAccountChangeListener(id);
    });
    set({ subscriptionEntries: [], isLoading: true });

    /** BettingPool の winner 確定時に myBetsStore を同期するヘルパー */
    const syncBets = (pool: BettingPoolState) => {
      if (!pool.winner) return;
      const { game } = get();
      if (!game) return;
      useMyBetsStore.getState().syncBetsWithPool(
        bettingPoolPda.toString(),
        pool.winner,
        game.player1Key,
        game.player2Key
      );
    };

    // ERコネクションでGameアカウントを監視
    const gameSubId = erConnection.onAccountChange(
      gamePda,
      (accountInfo) => {
        try {
          const rawGame = program.coder.accounts.decode('Game', Buffer.from(accountInfo.data));
          set({ game: mapGameAccount(rawGame, gamePda, programId) });
        } catch { /* デコードエラーは無視 */ }
      },
      'confirmed'
    );

    // L1コネクションでBettingPoolを監視
    const poolSubId = connection.onAccountChange(
      bettingPoolPda,
      (accountInfo) => {
        try {
          const rawPool = program.coder.accounts.decode('BettingPool', Buffer.from(accountInfo.data));
          const pool = mapBettingPoolAccount(rawPool);
          syncBets(pool);
          set({ bettingPool: pool });
        } catch { /* デコードエラーは無視 */ }
      },
      'confirmed'
    );

    set({
      subscriptionEntries: [
        { id: gameSubId, connection: erConnection },
        { id: poolSubId, connection },
      ],
    });

    // 初期状態を読み込み（Game + BettingPool のみ）
    Promise.all([
      erConnection.getAccountInfo(gamePda),
      connection.getAccountInfo(bettingPoolPda),
    ]).then(([gameInfo, poolInfo]) => {
      let gameState: GameState | null = null;

      if (gameInfo) {
        try {
          const rawGame = program.coder.accounts.decode('Game', Buffer.from(gameInfo.data));
          gameState = mapGameAccount(rawGame, gamePda, programId);
          set({ game: gameState });
        } catch { /* デコードエラーは無視 */ }
      }
      if (poolInfo) {
        try {
          const rawPool = program.coder.accounts.decode('BettingPool', Buffer.from(poolInfo.data));
          const pool = mapBettingPoolAccount(rawPool);
          if (pool.winner && gameState) {
            useMyBetsStore.getState().syncBetsWithPool(
              bettingPoolPda.toString(),
              pool.winner,
              gameState.player1Key,
              gameState.player2Key
            );
          }
          set({ bettingPool: pool });
        } catch { /* デコードエラーは無視 */ }
      }

      set({ isLoading: false });
    }).catch(() => set({ isLoading: false }));
  },

  unsubscribeFromGame: () => {
    const { subscriptionEntries } = get();
    subscriptionEntries.forEach(({ id, connection: conn }) => {
      conn.removeAccountChangeListener(id);
    });
    set({ game: null, bettingPool: null, subscriptionEntries: [] });
  },

  setGame: (game) => set({ game }),
  setBettingPool: (pool) => set({ bettingPool: pool }),
}));
