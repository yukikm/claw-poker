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
  pollTimer: ReturnType<typeof setInterval> | null;

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

/** サーバーAPIが返すカード文字列 (e.g. "2S", "AH", "TD") を CardDisplay に変換 */
function parseServerCard(cardStr: string): import('@/lib/types').CardDisplay {
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
    player1Name: prevGame?.player1Name ?? null,
    player2Name: prevGame?.player2Name ?? null,
    winner: (() => {
      const w = rawGame.winner as PublicKey | null;
      // Pubkey::default()（SystemProgram = 11111...1）はwinner未確定を示す
      if (w == null || w.toBase58() === '11111111111111111111111111111111') return null;
      return w;
    })(),
    bettingPoolPda,
    dealerPosition: rawGame.dealerPosition as number,
    lastRaiseAmount: toBN(rawGame.lastRaiseAmount),
    showdownCardsP1: (() => {
      const cards = (rawGame.showdownCardsP1 as number[]).map(decodeCard);
      // Showdown/Finished以外、または全てunknown(255)や初期値(0,0)の場合はnull扱い
      if (phase !== 'Showdown' && phase !== 'Finished') return cards.map(() => ({ suit: 'Spades' as const, rank: 0, isUnknown: true }));
      return cards;
    })(),
    showdownCardsP2: (() => {
      const cards = (rawGame.showdownCardsP2 as number[]).map(decodeCard);
      if (phase !== 'Showdown' && phase !== 'Finished') return cards.map(() => ({ suit: 'Spades' as const, rank: 0, isUnknown: true }));
      return cards;
    })(),
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
  pollTimer: null,

  subscribeToGame: (connection, erConnection, gamePda, bettingPoolPda, programId, program) => {
    // 既存のサブスクリプションとポーリングを解除
    const { subscriptionEntries, pollTimer: existingTimer } = get();
    subscriptionEntries.forEach(({ id, connection: conn }) => {
      conn.removeAccountChangeListener(id);
    });
    if (existingTimer) {
      clearInterval(existingTimer);
    }
    set({ subscriptionEntries: [], isLoading: true, pollTimer: null });

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
        const rawGame = program.coder.accounts.decode('game', Buffer.from(accountInfo.data));
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
          const rawPool = program.coder.accounts.decode('bettingPool', Buffer.from(accountInfo.data));
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

    // gameIdをPDAから逆算（ポーリングURL用）
    // PDA seeds = [b'game', gameIdBuffer] なので直接は取れない。
    // ページURLのgameIdStrを使うため、gamePdaからではなくサーバーAPI一覧から特定する。

    const SERVER_API_URL = process.env.NEXT_PUBLIC_SERVER_API_URL ?? 'http://43.206.193.46:3001';

    /** サーバーAPIからゲーム初期データを取得し GameState を構築する */
    const fetchFromServerApi = async (gIdStr: string): Promise<GameState | null> => {
      try {
        const resp = await fetch(`${SERVER_API_URL}/api/v1/games/${gIdStr}`);
        if (!resp.ok) return null;
        const data = await resp.json() as {
          phase: string; handNumber: number; pot: number;
          player1: string; player2: string;
          player1Name: string | null; player2Name: string | null;
          player1ChipStack: number; player2ChipStack: number;
          player1Committed: number; player2Committed: number;
          player1HasFolded: boolean; player2HasFolded: boolean;
          player1IsAllIn: boolean; player2IsAllIn: boolean;
          boardCards: string[]; currentTurn: string;
          dealerPosition: number; lastRaiseAmount: number;
          showdownCardsP1: [string, string] | null;
          showdownCardsP2: [string, string] | null;
          winner: string | null; bettingClosed: boolean;
        };
        const DEFAULT_PUBKEY = '11111111111111111111111111111111';
        const player1Key = new PublicKey(data.player1);
        const player2Key = new PublicKey(data.player2);
        const currentTurnStr = data.currentTurn ?? DEFAULT_PUBKEY;
        const currentTurn: 0 | 1 | 2 = currentTurnStr === DEFAULT_PUBKEY
          ? 0 : (currentTurnStr === data.player1 ? 1 : 2);
        const serverPhaseMap: Record<string, GamePhase> = {
          Waiting: 'Waiting', Shuffling: 'Shuffling', PreFlop: 'PreFlop',
          Flop: 'Flop', Turn: 'Turn', River: 'River', Showdown: 'Showdown', Finished: 'Finished',
        };
        const phase = serverPhaseMap[data.phase] ?? 'Waiting';
        const boardCards = (data.boardCards ?? []).map(parseServerCard);
        const showdownCardsP1 = data.showdownCardsP1 ? data.showdownCardsP1.map(parseServerCard) : [];
        const showdownCardsP2 = data.showdownCardsP2 ? data.showdownCardsP2.map(parseServerCard) : [];
        const winnerKey = data.winner && data.winner !== DEFAULT_PUBKEY ? new PublicKey(data.winner) : null;
        return {
          gameId: BigInt(gIdStr),
          gamePda,
          phase, handNumber: data.handNumber, pot: data.pot, currentTurn, boardCards,
          player1: { address: player1Key, chips: data.player1ChipStack, chipsCommitted: data.player1Committed, hasFolded: data.player1HasFolded, isAllIn: data.player1IsAllIn, lastAction: null },
          player2: { address: player2Key, chips: data.player2ChipStack, chipsCommitted: data.player2Committed, hasFolded: data.player2HasFolded, isAllIn: data.player2IsAllIn, lastAction: null },
          player1Key, player2Key,
          player1Name: data.player1Name ?? null, player2Name: data.player2Name ?? null,
          winner: winnerKey, bettingPoolPda,
          dealerPosition: data.dealerPosition, lastRaiseAmount: data.lastRaiseAmount,
          showdownCardsP1, showdownCardsP2,
        };
      } catch { return null; }
    };

    // 初期状態を読み込み（Game + BettingPool のみ）
    // ER にアカウントがない場合（デリゲーション伝播遅延・L1 のみ存在）は L1 にフォールバック
    Promise.all([
      erConnection.getAccountInfo(gamePda).then((info) => info ?? connection.getAccountInfo(gamePda)),
      connection.getAccountInfo(bettingPoolPda),
    ]).then(async ([gameInfo, poolInfo]) => {
      let gameState: GameState | null = null;

      if (gameInfo) {
        try {
          const rawGame = program.coder.accounts.decode('game', Buffer.from(gameInfo.data));
          gameState = mapGameAccount(rawGame as Record<string, unknown>, gamePda, programId, null);
          set({ game: gameState });
        } catch (err) { console.error('[watchGameStore] Initial Game decode error:', err); }
      }

      // オンチェーンから取得できなかった場合、サーバーAPIからフォールバック取得
      // Private ER (TEE) にdelegateされたゲームはER/L1どちらからも直接読めないため
      if (!gameState) {
        // サーバーAPIのゲーム一覧からgamePdaに一致するゲームIDを探す
        try {
          const listResp = await fetch(`${SERVER_API_URL}/api/v1/games`);
          if (listResp.ok) {
            const listData = await listResp.json() as { games: Array<{ gameId: string; player1: string; player2: string }> };
            // PDAを再導出して一致するgameIdを特定
            for (const g of listData.games) {
              const gId = BigInt(g.gameId);
              const buf = gameIdToBuffer(gId);
              const [derivedPda] = PublicKey.findProgramAddressSync([Buffer.from('game'), buf], programId);
              if (derivedPda.equals(gamePda)) {
                gameState = await fetchFromServerApi(g.gameId);
                if (gameState) {
                  set({ game: gameState });
                }
                break;
              }
            }
          }
        } catch (err) { console.error('[watchGameStore] Server API fallback error:', err); }
      }

      if (poolInfo) {
        try {
          const rawPool = program.coder.accounts.decode('bettingPool', Buffer.from(poolInfo.data));
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

      // サーバーAPIポーリング開始: オンチェーン/サーバーAPIどちらかでゲームが見つかった場合
      if (gameState) {
        const gameIdStr = gameState.gameId.toString();
        const timer = setInterval(async () => {
          try {
            const resp = await fetch(`${SERVER_API_URL}/api/v1/games/${gameIdStr}`);
            if (!resp.ok) return;
            const data = await resp.json() as {
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
            };
            const prevGame = get().game;
            if (!prevGame) return;

            const serverPhaseMap: Record<string, GamePhase> = {
              Waiting: 'Waiting', Shuffling: 'Shuffling', PreFlop: 'PreFlop',
              Flop: 'Flop', Turn: 'Turn', River: 'River', Showdown: 'Showdown', Finished: 'Finished',
            };
            const serverPhase = serverPhaseMap[data.phase] ?? 'Waiting';

            // 状態が変わっている場合のみ更新
            if (
              prevGame.phase !== serverPhase ||
              prevGame.handNumber !== data.handNumber ||
              prevGame.pot !== data.pot ||
              prevGame.player1.chipsCommitted !== data.player1Committed ||
              prevGame.player2.chipsCommitted !== data.player2Committed ||
              prevGame.player1.hasFolded !== data.player1HasFolded ||
              prevGame.player2.hasFolded !== data.player2HasFolded
            ) {
              const DEFAULT_PUBKEY = '11111111111111111111111111111111';
              const player1Key = new PublicKey(data.player1);
              const player2Key = new PublicKey(data.player2);
              const currentTurnStr = data.currentTurn;
              const currentTurn: 0 | 1 | 2 = currentTurnStr === DEFAULT_PUBKEY
                ? 0
                : (currentTurnStr === data.player1 ? 1 : 2);
              const boardCards = (data.boardCards ?? []).map(parseServerCard);
              const showdownCardsP1 = data.showdownCardsP1
                ? data.showdownCardsP1.map(parseServerCard)
                : [];
              const showdownCardsP2 = data.showdownCardsP2
                ? data.showdownCardsP2.map(parseServerCard)
                : [];
              const winnerKey = data.winner && data.winner !== DEFAULT_PUBKEY
                ? new PublicKey(data.winner)
                : null;

              // アクションを推測
              const p1Action = inferAction(
                prevGame.player1, data.player1Committed, data.player1HasFolded,
                data.player1IsAllIn, prevGame.phase, serverPhase, data.player2Committed
              );
              const p2Action = inferAction(
                prevGame.player2, data.player2Committed, data.player2HasFolded,
                data.player2IsAllIn, prevGame.phase, serverPhase, data.player1Committed
              );

              set({
                game: {
                  ...prevGame,
                  phase: serverPhase,
                  handNumber: data.handNumber,
                  pot: data.pot,
                  currentTurn,
                  boardCards,
                  player1: {
                    ...prevGame.player1,
                    address: player1Key,
                    chips: data.player1ChipStack,
                    chipsCommitted: data.player1Committed,
                    hasFolded: data.player1HasFolded,
                    isAllIn: data.player1IsAllIn,
                    lastAction: p1Action ?? prevGame.player1.lastAction,
                  },
                  player2: {
                    ...prevGame.player2,
                    address: player2Key,
                    chips: data.player2ChipStack,
                    chipsCommitted: data.player2Committed,
                    hasFolded: data.player2HasFolded,
                    isAllIn: data.player2IsAllIn,
                    lastAction: p2Action ?? prevGame.player2.lastAction,
                  },
                  player1Key,
                  player2Key,
                  player1Name: data.player1Name ?? prevGame.player1Name,
                  player2Name: data.player2Name ?? prevGame.player2Name,
                  winner: winnerKey,
                  dealerPosition: data.dealerPosition,
                  lastRaiseAmount: data.lastRaiseAmount,
                  showdownCardsP1,
                  showdownCardsP2,
                },
              });
            }
          } catch {
            // ポーリングエラーは静かに無視
          }
        }, 2000);
        set({ pollTimer: timer });
      }
    }).catch(() => set({ isLoading: false }));
  },

  unsubscribeFromGame: () => {
    const { subscriptionEntries, pollTimer } = get();
    subscriptionEntries.forEach(({ id, connection: conn }) => {
      conn.removeAccountChangeListener(id);
    });
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    set({ game: null, bettingPool: null, subscriptionEntries: [], pollTimer: null });
  },

  setGame: (game) => set({ game }),
  setBettingPool: (pool) => set({ bettingPool: pool }),
}));
