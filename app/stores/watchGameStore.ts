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

/** Anchor BN型の値をnumberに変換する */
function toBN(val: unknown): number {
  if (val != null && typeof (val as { toNumber?: unknown }).toNumber === 'function') {
    return (val as { toNumber(): number }).toNumber();
  }
  return typeof val === 'number' ? val : 0;
}

/** unknown値をbooleanに変換する（undefined/nullはfalse扱い） */
function toBool(val: unknown): boolean {
  return typeof val === 'boolean' ? val : Boolean(val);
}

/** unknown値をPublicKeyとして返す */
function toPubkey(val: unknown): PublicKey {
  return val as PublicKey;
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
  currPhase: GamePhase,
  prevOppCommitted: number
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
    // 相手が既にベットしていて、自分がその額に追いついた場合はCall
    if (prevOppCommitted > prevPlayer.chipsCommitted && currCommitted === prevOppCommitted) {
      return `Call(${diff})`;
    }
    // 相手が既にベットしていて、自分がそれを上回った場合はRaise
    if (prevOppCommitted > prevPlayer.chipsCommitted && currCommitted > prevOppCommitted) {
      return `Raise(${diff})`;
    }
    // 対称状態（相手と同額）からの増加はBet
    return `Bet(${diff})`;
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

  const player1Key = toPubkey(rawGame.player1);
  const player2Key = toPubkey(rawGame.player2);
  const currentTurnKey = toPubkey(rawGame.currentTurn);
  // Pubkey::default() (SystemProgram = 11111...1111) はターンなし状態を示す
  const DEFAULT_PUBKEY = '11111111111111111111111111111111';
  const currentTurnBase58 = currentTurnKey.toBase58();

  const p1Committed = toBN(rawGame.player1Committed);
  const p2Committed = toBN(rawGame.player2Committed);
  const p1Folded = toBool(rawGame.player1HasFolded);
  const p2Folded = toBool(rawGame.player2HasFolded);
  const p1AllIn = toBool(rawGame.player1IsAllIn);
  const p2AllIn = toBool(rawGame.player2IsAllIn);

  const prevPhase = prevGame?.phase ?? null;
  const prevP2Committed = prevGame?.player2.chipsCommitted ?? 0;
  const prevP1Committed = prevGame?.player1.chipsCommitted ?? 0;
  const p1Action = inferAction(prevGame?.player1 ?? null, p1Committed, p1Folded, p1AllIn, prevPhase, phase, prevP2Committed);
  const p2Action = inferAction(prevGame?.player2 ?? null, p2Committed, p2Folded, p2AllIn, prevPhase, phase, prevP1Committed);

  return {
    gameId,
    gamePda,
    phase,
    handNumber: toBN(rawGame.handNumber),
    pot: toBN(rawGame.pot),
    currentTurn: currentTurnBase58 === DEFAULT_PUBKEY ? 0 : (currentTurnKey.equals(player1Key) ? 1 : 2),
    boardCards,
    player1: {
      address: player1Key,
      chips: toBN(rawGame.player1ChipStack),
      chipsCommitted: p1Committed,
      hasFolded: p1Folded,
      isAllIn: p1AllIn,
      lastAction: p1Action,
    },
    player2: {
      address: player2Key,
      chips: toBN(rawGame.player2ChipStack),
      chipsCommitted: p2Committed,
      hasFolded: p2Folded,
      isAllIn: p2AllIn,
      lastAction: p2Action,
    },
    player1Key,
    player2Key,
    winner: (() => {
      const w = rawGame.winner as PublicKey | null;
      // Pubkey::default()（SystemProgram = 11111...1）はwinner未確定を示す
      if (w == null || w.toBase58() === '11111111111111111111111111111111') return null;
      return w;
    })(),
    bettingPoolPda,
    dealerPosition: rawGame.dealerPosition as number,
    lastRaiseAmount: toBN(rawGame.lastRaiseAmount),
    showdownCardsP1: (rawGame.showdownCardsP1 as number[]).map(decodeCard),
    showdownCardsP2: (rawGame.showdownCardsP2 as number[]).map(decodeCard),
  };
}

function mapBettingPoolAccount(rawPool: Record<string, unknown>): BettingPoolState {
  return {
    gameId: BigInt(String(rawPool.gameId)),
    totalBetPlayer1: toBN(rawPool.totalBetPlayer1),
    totalBetPlayer2: toBN(rawPool.totalBetPlayer2),
    betCount: rawPool.betCount as number,
    isClosed: toBool(rawPool.isClosed),
    winner: (() => {
      const w = rawPool.winner as PublicKey | null;
      if (w == null || w.toBase58() === '11111111111111111111111111111111') return null;
      return w;
    })(),
    distributed: toBool(rawPool.distributed),
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

    const handleGameAccountChange = (accountInfo: import('@solana/web3.js').AccountInfo<Buffer>): void => {
      try {
        const prevGame = get().game;
        const rawGame = program.coder.accounts.decode('Game', Buffer.from(accountInfo.data));
        set({ game: mapGameAccount(rawGame as Record<string, unknown>, gamePda, programId, prevGame) });
      } catch (err) { console.error('[watchGameStore] Game decode error:', err); }
    };

    // ERコネクションでGameアカウントを監視（ER にデリゲート済みの場合はリアルタイム更新）
    const gameErSubId = erConnection.onAccountChange(gamePda, handleGameAccountChange, 'confirmed');
    // L1コネクションでも監視（ER 未デリゲート時や undelegation 時の状態変化をキャッチ）
    const gameL1SubId = connection.onAccountChange(gamePda, handleGameAccountChange, 'confirmed');

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
        { id: gameErSubId, connection: erConnection },
        { id: gameL1SubId, connection },
        { id: poolSubId, connection },
      ],
    });

    // 初期状態を読み込み（Game + BettingPool のみ）
    // ER にアカウントがない場合（デリゲーション伝播遅延・L1 のみ存在）は L1 にフォールバック
    Promise.all([
      erConnection.getAccountInfo(gamePda).then((info) => info ?? connection.getAccountInfo(gamePda)),
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
