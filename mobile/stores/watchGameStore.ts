import { create } from 'zustand';
import { PublicKey, Connection } from '@solana/web3.js';
import { type GameState, type BettingPoolState, type CardDisplay } from '../lib/types';
import { type GamePhase, SERVER_API_URL } from '../lib/constants';
import { getReadOnlyProgram } from '../lib/anchor';
import { getConnection } from '../lib/solana';
import { useMyBetsStore } from './myBetsStore';
import { useSettingsStore } from './settingsStore';

interface WatchGameStore {
  game: GameState | null;
  bettingPool: BettingPoolState | null;
  isLoading: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  poolPollTimer: ReturnType<typeof setInterval> | null;

  subscribeToGame: (
    gamePda: PublicKey,
    bettingPoolPda: PublicKey,
    programId: PublicKey,
    gameIdStr: string
  ) => void;
  unsubscribeFromGame: () => void;
  setGame: (game: GameState) => void;
  setBettingPool: (pool: BettingPoolState) => void;
}

function parseServerCard(cardStr: string): CardDisplay {
  if (!cardStr || cardStr === '??') return { suit: 'Spades', rank: 0, isUnknown: true };
  const rankChars: Record<string, number> = {
    '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
    'T': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12,
  };
  const suitChars: Record<string, 'Spades' | 'Hearts' | 'Diamonds' | 'Clubs'> = {
    'S': 'Spades', 'H': 'Hearts', 'D': 'Diamonds', 'C': 'Clubs',
  };
  const rankChar = cardStr.slice(0, -1);
  const suitChar = cardStr.slice(-1);
  const rank = rankChars[rankChar];
  const suit = suitChars[suitChar];
  if (rank === undefined || !suit) return { suit: 'Spades', rank: 0, isUnknown: true };
  return { suit, rank, isUnknown: false };
}

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
  if (prevPhase !== null && prevPhase !== currPhase) return null;
  if (currFolded && !prevPlayer.hasFolded) return 'Fold';
  if (currAllIn && !prevPlayer.isAllIn) {
    const diff = currCommitted - prevPlayer.chipsCommitted;
    return diff > 0 ? `AllIn(${diff})` : 'AllIn';
  }
  const diff = currCommitted - prevPlayer.chipsCommitted;
  if (diff > 0) {
    if (prevOppCommitted > prevPlayer.chipsCommitted && currCommitted === prevOppCommitted) {
      return `Call(${diff})`;
    }
    if (prevOppCommitted > prevPlayer.chipsCommitted && currCommitted > prevOppCommitted) {
      return `Raise(${diff})`;
    }
    return `Bet(${diff})`;
  }
  if (diff === 0 && prevPlayer.chipsCommitted === currCommitted) {
    return 'Check';
  }
  return null;
}

interface ServerGameData {
  phase: string;
  handNumber: number;
  pot: number;
  player1: string;
  player2: string;
  player1Name: string | null;
  player2Name: string | null;
  player1ChipStack: number;
  player2ChipStack: number;
  player1Committed: number;
  player2Committed: number;
  player1HasFolded: boolean;
  player2HasFolded: boolean;
  player1IsAllIn: boolean;
  player2IsAllIn: boolean;
  boardCards: string[];
  currentTurn: string;
  dealerPosition: number;
  lastRaiseAmount: number;
  showdownCardsP1: [string, string] | null;
  showdownCardsP2: [string, string] | null;
  winner: string | null;
  bettingClosed: boolean;
}

const SERVER_PHASE_MAP: Record<string, GamePhase> = {
  Waiting: 'Waiting', Shuffling: 'Shuffling', PreFlop: 'PreFlop',
  Flop: 'Flop', Turn: 'Turn', River: 'River', Showdown: 'Showdown', Finished: 'Finished',
};

const DEFAULT_PUBKEY = '11111111111111111111111111111111';

/** Web版と同等の showdownCards 処理: [0,0]初期値は前回状態を保持 */
function resolveShowdownCards(
  rawCards: [string, string] | null,
  phase: GamePhase,
  prevCards: CardDisplay[]
): CardDisplay[] {
  // Showdown/Finished以外は裏面表示
  if (phase !== 'Showdown' && phase !== 'Finished') {
    return [
      { suit: 'Spades', rank: 0, isUnknown: true },
      { suit: 'Spades', rank: 0, isUnknown: true },
    ];
  }
  if (!rawCards) return prevCards.length >= 2 ? prevCards : [
    { suit: 'Spades', rank: 0, isUnknown: true },
    { suit: 'Spades', rank: 0, isUnknown: true },
  ];
  const parsed = rawCards.map(parseServerCard);
  // サーバーが null/未設定を返した場合は前の値を保持
  if (parsed.every((c) => c.isUnknown) && prevCards.length > 0 && prevCards.some((c) => !c.isUnknown)) {
    return prevCards;
  }
  return parsed;
}

function buildGameStateFromServer(
  data: ServerGameData,
  gameIdStr: string,
  gamePda: PublicKey,
  bettingPoolPda: PublicKey,
  prevGame: GameState | null
): GameState {
  const player1Key = new PublicKey(data.player1);
  const player2Key = new PublicKey(data.player2);
  const currentTurnStr = data.currentTurn ?? DEFAULT_PUBKEY;
  const currentTurn: 0 | 1 | 2 = currentTurnStr === DEFAULT_PUBKEY
    ? 0 : (currentTurnStr === data.player1 ? 1 : 2);
  const phase = SERVER_PHASE_MAP[data.phase] ?? 'Waiting';
  const boardCards = (data.boardCards ?? []).map(parseServerCard);
  const winnerKey = data.winner && data.winner !== DEFAULT_PUBKEY ? new PublicKey(data.winner) : null;

  const prevPhase = prevGame?.phase ?? null;
  const phaseChanged = prevPhase !== null && prevPhase !== phase;
  const handChanged = prevGame !== null && prevGame.handNumber !== data.handNumber;

  const p1Action = inferAction(
    prevGame?.player1 ?? null, data.player1Committed, data.player1HasFolded,
    data.player1IsAllIn, prevPhase, phase, data.player2Committed
  );
  const p2Action = inferAction(
    prevGame?.player2 ?? null, data.player2Committed, data.player2HasFolded,
    data.player2IsAllIn, prevPhase, phase, data.player1Committed
  );

  // Clear stale actions on phase/hand change to avoid showing old badges
  const prevP1Action = (phaseChanged || handChanged) ? null : (prevGame?.player1.lastAction ?? null);
  const prevP2Action = (phaseChanged || handChanged) ? null : (prevGame?.player2.lastAction ?? null);

  return {
    gameId: BigInt(gameIdStr),
    gamePda,
    phase,
    handNumber: data.handNumber,
    pot: data.pot,
    currentTurn,
    boardCards,
    player1: {
      address: player1Key,
      chips: data.player1ChipStack,
      chipsCommitted: data.player1Committed,
      hasFolded: data.player1HasFolded,
      isAllIn: data.player1IsAllIn,
      lastAction: p1Action ?? prevP1Action,
    },
    player2: {
      address: player2Key,
      chips: data.player2ChipStack,
      chipsCommitted: data.player2Committed,
      hasFolded: data.player2HasFolded,
      isAllIn: data.player2IsAllIn,
      lastAction: p2Action ?? prevP2Action,
    },
    player1Key,
    player2Key,
    player1Name: data.player1Name ?? prevGame?.player1Name ?? null,
    player2Name: data.player2Name ?? prevGame?.player2Name ?? null,
    winner: winnerKey,
    bettingPoolPda,
    dealerPosition: data.dealerPosition,
    lastRaiseAmount: data.lastRaiseAmount,
    showdownCardsP1: resolveShowdownCards(
      data.showdownCardsP1, phase, prevGame?.showdownCardsP1 ?? [{ suit: 'Spades' as const, rank: 0, isUnknown: true }, { suit: 'Spades' as const, rank: 0, isUnknown: true }]
    ),
    showdownCardsP2: resolveShowdownCards(
      data.showdownCardsP2, phase, prevGame?.showdownCardsP2 ?? [{ suit: 'Spades' as const, rank: 0, isUnknown: true }, { suit: 'Spades' as const, rank: 0, isUnknown: true }]
    ),
  };
}

/** BettingPool の winner 確定時に myBetsStore を同期する */
function syncBetsIfWinner(
  bettingPoolPda: PublicKey,
  winnerKey: PublicKey | null,
  game: GameState | null
): void {
  if (!winnerKey || !game) return;
  useMyBetsStore.getState().syncBetsWithPool(
    bettingPoolPda.toString(),
    winnerKey,
    game.player1Key,
    game.player2Key
  );
}

/** Anchor BettingPool account の動的型 */
interface AnchorBN {
  toNumber(): number;
  toString(): string;
}

interface AnchorBettingPoolAccount {
  gameId: AnchorBN;
  totalBetPlayer1: AnchorBN;
  totalBetPlayer2: AnchorBN;
  betCount: number;
  isClosed: boolean;
  winner: PublicKey | null;
  distributed: boolean;
}

function isAnchorBettingPool(raw: unknown): raw is AnchorBettingPoolAccount {
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

/** L1からBettingPoolをフェッチしてdecode */
async function fetchBettingPool(
  bettingPoolPda: PublicKey
): Promise<BettingPoolState | null> {
  try {
    const connection = getConnection();
    const program = getReadOnlyProgram(connection);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (program.account as any).bettingPool.fetchNullable(bettingPoolPda);
    if (!raw) return null;
    if (!isAnchorBettingPool(raw)) {
      console.warn('[watchGameStore] BettingPool account has unexpected shape');
      return null;
    }
    const winner = (() => {
      const w = raw.winner;
      if (!w || w.toBase58() === DEFAULT_PUBKEY) return null;
      return w;
    })();
    return {
      gameId: BigInt(raw.gameId.toString()),
      totalBetPlayer1: raw.totalBetPlayer1.toNumber(),
      totalBetPlayer2: raw.totalBetPlayer2.toNumber(),
      betCount: raw.betCount,
      isClosed: raw.isClosed,
      winner,
      distributed: raw.distributed,
    };
  } catch {
    return null;
  }
}

// Module-scoped guards to prevent concurrent fetches across subscriptions
let gameFetchInProgress = false;
let poolFetchInProgress = false;
// AbortController for in-flight game fetch (cancelled on unsubscribe)
let activeAbortController: AbortController | null = null;
// Subscription generation counter to discard stale fetch results
let subscriptionGeneration = 0;

export const useWatchGameStore = create<WatchGameStore>((set, get) => ({
  game: null,
  bettingPool: null,
  isLoading: false,
  pollTimer: null,
  poolPollTimer: null,

  subscribeToGame: (gamePda, bettingPoolPda, programId, gameIdStr) => {
    // Clean up existing
    const { pollTimer: existingTimer, poolPollTimer: existingPoolTimer } = get();
    if (existingTimer) clearInterval(existingTimer);
    if (existingPoolTimer) clearInterval(existingPoolTimer);
    // Cancel any in-flight fetch from previous subscription
    if (activeAbortController) activeAbortController.abort();
    // Reset guards
    gameFetchInProgress = false;
    poolFetchInProgress = false;
    // Increment generation to invalidate stale callbacks
    const generation = ++subscriptionGeneration;
    set({ isLoading: true, pollTimer: null, poolPollTimer: null, game: null, bettingPool: null });

    const fetchGameState = async () => {
      if (gameFetchInProgress || generation !== subscriptionGeneration) return;
      gameFetchInProgress = true;
      const controller = new AbortController();
      activeAbortController = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(`${SERVER_API_URL}/api/v1/games/${gameIdStr}`, {
          signal: controller.signal,
        });
        if (!resp.ok || generation !== subscriptionGeneration) return;
        const data = await resp.json() as ServerGameData;
        if (generation !== subscriptionGeneration) return;
        const prevGame = get().game;

        // Check if state changed (expanded comparison)
        if (prevGame) {
          const serverPhase = SERVER_PHASE_MAP[data.phase] ?? 'Waiting';
          if (
            prevGame.phase === serverPhase &&
            prevGame.handNumber === data.handNumber &&
            prevGame.pot === data.pot &&
            prevGame.player1.chipsCommitted === data.player1Committed &&
            prevGame.player2.chipsCommitted === data.player2Committed &&
            prevGame.player1.hasFolded === data.player1HasFolded &&
            prevGame.player2.hasFolded === data.player2HasFolded &&
            prevGame.player1.isAllIn === data.player1IsAllIn &&
            prevGame.player2.isAllIn === data.player2IsAllIn &&
            prevGame.player1.chips === data.player1ChipStack &&
            prevGame.player2.chips === data.player2ChipStack &&
            (prevGame.winner?.toBase58() ?? null) === data.winner
          ) {
            return; // No change
          }
        }

        const gameState = buildGameStateFromServer(data, gameIdStr, gamePda, bettingPoolPda, prevGame);
        set({ game: gameState });

        // Winner確定時にベット同期
        if (gameState.winner) {
          syncBetsIfWinner(bettingPoolPda, gameState.winner, gameState);
        }
      } catch {
        // Polling error - silently ignore (includes AbortError)
      } finally {
        clearTimeout(timeout);
        gameFetchInProgress = false;
        if (activeAbortController === controller) activeAbortController = null;
      }
    };

    // BettingPool polling (L1 onchain, 5s interval)
    const fetchPool = async () => {
      if (poolFetchInProgress || generation !== subscriptionGeneration) return;
      poolFetchInProgress = true;
      try {
        const pool = await fetchBettingPool(bettingPoolPda);
        if (generation !== subscriptionGeneration) return;
        if (pool) {
          const prevPool = get().bettingPool;
          if (
            !prevPool ||
            prevPool.totalBetPlayer1 !== pool.totalBetPlayer1 ||
            prevPool.totalBetPlayer2 !== pool.totalBetPlayer2 ||
            prevPool.isClosed !== pool.isClosed ||
            (prevPool.winner?.toBase58() ?? null) !== (pool.winner?.toBase58() ?? null)
          ) {
            set({ bettingPool: pool });
            syncBetsIfWinner(bettingPoolPda, pool.winner, get().game);
          }
        }
      } catch {
        // Pool fetch error - silently ignore
      } finally {
        poolFetchInProgress = false;
      }
    };

    // Use settings-based interval (clamped: game detail uses half the list interval, min 1s)
    const settingsInterval = useSettingsStore.getState().pollingIntervalMs;
    const gameInterval = Math.max(1000, Math.floor(settingsInterval / 2));
    const poolInterval = Math.max(3000, settingsInterval);

    // Start polling BEFORE initial fetch (prevents race where navigate-away misses timer setup)
    const timer = setInterval(fetchGameState, gameInterval);
    const poolTimer = setInterval(fetchPool, poolInterval);
    set({ pollTimer: timer, poolPollTimer: poolTimer });

    // Initial fetch
    Promise.all([
      fetchGameState(),
      fetchPool(),
    ]).finally(() => {
      if (generation === subscriptionGeneration) {
        set({ isLoading: false });
      }
    });
  },

  unsubscribeFromGame: () => {
    const { pollTimer, poolPollTimer } = get();
    if (pollTimer) clearInterval(pollTimer);
    if (poolPollTimer) clearInterval(poolPollTimer);
    // Cancel in-flight fetch and invalidate stale callbacks
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = null;
    subscriptionGeneration++;
    gameFetchInProgress = false;
    poolFetchInProgress = false;
    set({ game: null, bettingPool: null, pollTimer: null, poolPollTimer: null });
  },

  setGame: (game) => set({ game }),
  setBettingPool: (pool) => set({ bettingPool: pool }),
}));
