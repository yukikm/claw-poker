import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type GameState, type BettingPoolState } from '@/lib/types';
import { type ClawPokerProgram } from '@/lib/anchor';
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
    program: ClawPokerProgram     // Anchorコーダーによるデコード用
  ) => void;
  unsubscribeFromGame: () => void;
  setGame: (game: GameState) => void;
  setBettingPool: (pool: BettingPoolState) => void;
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

/** 前回の状態と比較してプレイヤーのアクションを推測する */
function inferAction(
  prevPlayer: { chipsCommitted: number; hasFolded: boolean; isAllIn: boolean } | null,
  currCommitted: number,
  currFolded: boolean,
  currAllIn: boolean,
  prevPhase: GamePhase | null,
  currPhase: GamePhase
): string | null {
  if (!prevPlayer) return null;

  // フェーズが変わった場合はリセット（新ストリート開始）
  if (prevPhase !== null && prevPhase !== currPhase) return null;

  if (currFolded && !prevPlayer.hasFolded) return 'Fold';
  if (currAllIn && !prevPlayer.isAllIn) {
    const diff = currCommitted - prevPlayer.chipsCommitted;
    return diff > 0 ? `AllIn(${diff})` : 'AllIn';
  }
  const diff = currCommitted - prevPlayer.chipsCommitted;
  if (diff > 0) {
    // 相手のコミットと同額ならCall、それ以上ならRaise/Bet
    // ここでは単純にdiff > 0で区別
    return prevPlayer.chipsCommitted === 0 && diff > 0 ? `Bet(${diff})` : `Raise(${diff})`;
  }
  if (diff === 0 && prevPlayer.chipsCommitted === currCommitted) {
    // コミット額が変わらず、ターンが移っていれば Check
    return 'Check';
  }
  return null;
}

function mapGameAccount(
  rawGame: Record<string, unknown>,
  gamePda: PublicKey,
  programId: PublicKey,
  prevGame: GameState | null
): GameState {
  const phase = parsePhase(rawGame.phase as Record<string, unknown>);
  const boardCards = (rawGame.boardCards as number[]).map(decodeCard);
  const gameId: bigint = BigInt(String(rawGame.gameId));

  const [bettingPoolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('betting_pool'), gameIdToBuffer(gameId)],
    programId
  );

  const player1Key = rawGame.player1 as PublicKey;
  const player2Key = rawGame.player2 as PublicKey;
  const currentTurnKey = rawGame.currentTurn as PublicKey;
  // Pubkey::default() (SystemProgram = 11111...1111) はターンなし状態を示す
  const DEFAULT_PUBKEY = '11111111111111111111111111111111';
  const currentTurnBase58 = currentTurnKey.toBase58();

  const p1Committed = (rawGame.player1Committed as { toNumber(): number }).toNumber();
  const p2Committed = (rawGame.player2Committed as { toNumber(): number }).toNumber();
  const p1Folded = (rawGame.player1HasFolded as boolean) ?? false;
  const p2Folded = (rawGame.player2HasFolded as boolean) ?? false;
  const p1AllIn = (rawGame.player1IsAllIn as boolean) ?? false;
  const p2AllIn = (rawGame.player2IsAllIn as boolean) ?? false;

  const prevPhase = prevGame?.phase ?? null;
  const p1Action = inferAction(prevGame?.player1 ?? null, p1Committed, p1Folded, p1AllIn, prevPhase, phase);
  const p2Action = inferAction(prevGame?.player2 ?? null, p2Committed, p2Folded, p2AllIn, prevPhase, phase);

  return {
    gameId,
    gamePda,
    phase,
    handNumber: (rawGame.handNumber as { toNumber(): number }).toNumber(),
    pot: (rawGame.pot as { toNumber(): number }).toNumber(),
    currentTurn: currentTurnBase58 === DEFAULT_PUBKEY ? 0 : (currentTurnKey.equals(player1Key) ? 1 : 2),
    boardCards,
    player1: {
      address: player1Key,
      chips: (rawGame.player1ChipStack as { toNumber(): number }).toNumber(),
      chipsCommitted: p1Committed,
      hasFolded: p1Folded,
      isAllIn: p1AllIn,
      lastAction: p1Action,
    },
    player2: {
      address: player2Key,
      chips: (rawGame.player2ChipStack as { toNumber(): number }).toNumber(),
      chipsCommitted: p2Committed,
      hasFolded: p2Folded,
      isAllIn: p2AllIn,
      lastAction: p2Action,
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

function mapBettingPoolAccount(rawPool: Record<string, unknown>): BettingPoolState {
  return {
    gameId: BigInt(String(rawPool.gameId)),
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
          const prevGame = get().game;
          const rawGame = program.coder.accounts.decode('Game', Buffer.from(accountInfo.data));
          set({ game: mapGameAccount(rawGame as Record<string, unknown>, gamePda, programId, prevGame) });
        } catch (err) { console.error('[watchGameStore] Game decode error:', err); }
      },
      'confirmed'
    );

    // L1コネクションでBettingPoolを監視
    const poolSubId = connection.onAccountChange(
      bettingPoolPda,
      (accountInfo) => {
        try {
          const rawPool = program.coder.accounts.decode('BettingPool', Buffer.from(accountInfo.data));
          const pool = mapBettingPoolAccount(rawPool as Record<string, unknown>);
          syncBets(pool);
          set({ bettingPool: pool });
        } catch (err) { console.error('[watchGameStore] BettingPool decode error:', err); }
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
          gameState = mapGameAccount(rawGame as Record<string, unknown>, gamePda, programId, null);
          set({ game: gameState });
        } catch (err) { console.error('[watchGameStore] Initial Game decode error:', err); }
      }
      if (poolInfo) {
        try {
          const rawPool = program.coder.accounts.decode('BettingPool', Buffer.from(poolInfo.data));
          const pool = mapBettingPoolAccount(rawPool as Record<string, unknown>);
          if (pool.winner && gameState) {
            useMyBetsStore.getState().syncBetsWithPool(
              bettingPoolPda.toString(),
              pool.winner,
              gameState.player1Key,
              gameState.player2Key
            );
          }
          set({ bettingPool: pool });
        } catch (err) { console.error('[watchGameStore] Initial BettingPool decode error:', err); }
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
