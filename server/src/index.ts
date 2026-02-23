import WebSocket from 'ws';
import express from 'express';
import { randomBytes } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { config } from 'dotenv';
import { AgentHandler } from './agentHandler';
import { GameMonitor, DecodedGameState } from './gameMonitor';
import { AnchorClient, ActionType } from './anchorClient';
import { SignatureStore } from './signatureStore';
import { createX402Router } from './x402Handler';
import { QueueJoinedMessage, GameJoinedMessage, ServerMessage, OpponentActionMessage, CommunityCardsRevealedMessage, HandCompleteMessage } from './types';

config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const HTTP_PORT = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 3001;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const MAGICBLOCK_ER_URL = process.env.MAGICBLOCK_ER_URL ?? 'https://devnet.magicblock.app';

/** デフォルト参加費 (0.1 SOL in lamports) */
const DEFAULT_ENTRY_FEE = 100_000_000;

/** マッチングキューのエントリー */
interface QueueEntry {
  walletAddress: string;
  entryFeeSignature: string;
  entryFeeAmount: number;
  joinedAt: number;
}

/** 進行中のゲームの管理情報 */
interface ActiveGame {
  gameId: bigint;
  player1Wallet: string;
  player2Wallet: string;
  entryFeeAmount: number;
}

/** アクションタイムアウト（30秒）のタイマー管理 */
const ACTION_TIMEOUT_MS = 30_000;
/** デフォルトPubkey（current_turn=0でベッティング終了を示す）の文字列表現 */
const DEFAULT_PUBKEY = '11111111111111111111111111111111';
/** gameId(string) → timeoutタイマーのマッピング */
const actionTimeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** gameId(string) → 前回のDecodedGameState（フェーズ変化検知・アクション通知用） */
const prevGameStates = new Map<string, DecodedGameState>();

const matchmakingQueue: QueueEntry[] = [];

/** 使用済みのエントリーフィートランザクション署名（ファイル永続化で再起動耐性あり） */
const usedEntryFeeSignatures = new SignatureStore();

/** gameId (bigint) → ゲーム管理情報 */
const activeGames = new Map<bigint, ActiveGame>();

// Initialize components
const agentHandler = new AgentHandler();
const gameMonitor = new GameMonitor();
const anchorClient = new AnchorClient(SOLANA_RPC_URL, MAGICBLOCK_ER_URL);

// ─── WSキュー参加ハンドラ（レガシーフロー）────────────────────────────────────
// x402 HTTPフロー（POST /api/v1/queue/join）がメインのキュー参加フロー。
// このWSハンドラは、x402-fetchを使わない直接SOL送金パターンのフォールバックとして維持。
// 現在のスキルファイル（poker_join_queue.ts）はx402 HTTPフローを使用している。

agentHandler.setOnJoinQueue(async (walletAddress, entryFeeSignature, entryFeeAmount) => {
  // 二重使用チェック
  if (usedEntryFeeSignatures.has(entryFeeSignature)) {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'ENTRY_FEE_INVALID',
      message: 'Entry fee transaction has already been used',
    });
    return;
  }

  // 既にキューに入っているかチェック
  const existing = matchmakingQueue.find((e) => e.walletAddress === walletAddress);
  if (existing) {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'ALREADY_IN_QUEUE',
      message: 'You are already in the matchmaking queue',
    });
    return;
  }

  // オンチェーンでエントリーフィーを検証
  const isValid = await anchorClient.verifyEntryFeeTransaction(
    entryFeeSignature,
    walletAddress,
    entryFeeAmount,
  );

  if (!isValid) {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'ENTRY_FEE_INVALID',
      message: 'Entry fee transaction verification failed. Ensure you called enter_matchmaking_queue with the correct amount.',
    });
    return;
  }

  // 使用済みシグネチャとして登録
  usedEntryFeeSignatures.add(entryFeeSignature);

  // キューに追加
  matchmakingQueue.push({
    walletAddress,
    entryFeeSignature,
    entryFeeAmount,
    joinedAt: Date.now(),
  });

  const queueJoined: QueueJoinedMessage = {
    type: 'queue_joined',
    position: matchmakingQueue.length,
    estimatedWaitSeconds: Math.max(5, matchmakingQueue.length * 10),
  };
  agentHandler.sendToAgent(walletAddress, queueJoined);

  // マッチングを試みる
  await tryMatchPlayers();
});

// ─── キュー離脱ハンドラ ───────────────────────────────────────────────────────

agentHandler.setOnLeaveQueue(async (walletAddress) => {
  const index = matchmakingQueue.findIndex((e) => e.walletAddress === walletAddress);
  if (index === -1) return;

  const entry = matchmakingQueue.splice(index, 1)[0];

  // leave_matchmaking_queue Anchor命令を呼び出して返金する
  let refundSignature = '';
  try {
    const playerPubkey = new PublicKey(walletAddress);
    refundSignature = await anchorClient.leaveMatchmakingQueue(playerPubkey);
    console.log(`[Queue] Refund for ${walletAddress} (${entry.entryFeeAmount} lamports): ${refundSignature}`);
  } catch (err) {
    console.error(`[Queue] Failed to refund ${walletAddress} (${entry.entryFeeAmount} lamports):`, err);
  }

  agentHandler.sendToAgent(walletAddress, {
    type: 'queue_left',
    refundSignature,
  });
});

// ─── アクションハンドラ ───────────────────────────────────────────────────────

agentHandler.setOnAction(async (walletAddress, gameIdStr, action, amount) => {
  // gameIdStr は stringified bigint
  let gameId: bigint;
  try {
    gameId = BigInt(gameIdStr);
  } catch {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'GAME_NOT_FOUND',
      message: `Invalid game ID: ${gameIdStr}`,
    });
    return;
  }

  const game = activeGames.get(gameId);
  if (!game) {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'GAME_NOT_FOUND',
      message: `Game ${gameIdStr} not found`,
    });
    return;
  }

  // プレイヤーがこのゲームの参加者か確認
  if (game.player1Wallet !== walletAddress && game.player2Wallet !== walletAddress) {
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'GAME_NOT_FOUND',
      message: 'You are not a participant in this game',
    });
    return;
  }

  try {
    // TEEオペレーターとしてプレイヤーアクションをER上で実行
    const playerPubkey = new PublicKey(walletAddress);
    await anchorClient.submitPlayerAction(gameId, playerPubkey, action as ActionType, amount);

    // prevGameStatesから現在の状態を取得（直前のGameMonitor更新値）
    const prevState = prevGameStates.get(gameIdStr);
    const isP1 = activeGames.get(gameId)?.player1Wallet === walletAddress;
    agentHandler.sendToAgent(walletAddress, {
      type: 'action_accepted',
      gameId: gameIdStr,
      action,
      amount: amount ?? null,
      newPot: prevState?.pot ?? 0,
      myStack: prevState ? (isP1 ? prevState.player1ChipStack : prevState.player2ChipStack) : 0,
    });

    // 相手プレイヤーにアクション通知
    const activeGameForAction = activeGames.get(gameId);
    if (activeGameForAction) {
      const opponentWallet = activeGameForAction.player1Wallet === walletAddress
        ? activeGameForAction.player2Wallet
        : activeGameForAction.player1Wallet;
      const oppMsg: OpponentActionMessage = {
        type: 'opponent_action',
        gameId: gameIdStr,
        action,
        amount: amount ?? null,
        newPot: 0,
        opponentStack: 0,
      };
      agentHandler.sendToAgent(opponentWallet, oppMsg);
    }
  } catch (err) {
    console.error(`[Action] Failed to submit action for ${walletAddress} in game ${gameIdStr}:`, err);
    agentHandler.sendToAgent(walletAddress, {
      type: 'error',
      code: 'INVALID_ACTION',
      message: `Failed to submit action: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// ─── マッチングロジック ──────────────────────────────────────────────────────

async function tryMatchPlayers(): Promise<void> {
  while (matchmakingQueue.length >= 2) {
    const player1Entry = matchmakingQueue.shift();
    const player2Entry = matchmakingQueue.shift();

    if (!player1Entry || !player2Entry) break;

    // ゲームID: Unixミリ秒 * 65536 + 2バイト乱数で衝突リスクを排除（u64上限内に収まる）
    const rndSuffix = BigInt(randomBytes(2).readUInt16BE(0));
    const gameId = BigInt(Date.now()) * 65536n + rndSuffix;
    const buyIn = BigInt(Math.min(player1Entry.entryFeeAmount, player2Entry.entryFeeAmount));
    const totalPot = player1Entry.entryFeeAmount + player2Entry.entryFeeAmount;
    const startingChips = 1000;
    const blinds = { small: 10, big: 20 };

    // ゲーム情報を記録
    activeGames.set(gameId, {
      gameId,
      player1Wallet: player1Entry.walletAddress,
      player2Wallet: player2Entry.walletAddress,
      entryFeeAmount: Number(buyIn),
    });

    const gameIdStr = gameId.toString();

    // 両プレイヤーに通知
    const p1Msg: GameJoinedMessage = {
      type: 'game_joined',
      gameId: gameIdStr,
      position: 'player1',
      opponentPublicKey: player2Entry.walletAddress,
      startingChips,
      blinds,
      entryFee: player1Entry.entryFeeAmount,
      totalPot,
    };
    const p2Msg: GameJoinedMessage = {
      type: 'game_joined',
      gameId: gameIdStr,
      position: 'player2',
      opponentPublicKey: player1Entry.walletAddress,
      startingChips,
      blinds,
      entryFee: player2Entry.entryFeeAmount,
      totalPot,
    };

    agentHandler.sendToAgent(player1Entry.walletAddress, p1Msg);
    agentHandler.sendToAgent(player2Entry.walletAddress, p2Msg);

    agentHandler.setAgentGameId(player1Entry.walletAddress, gameIdStr);
    agentHandler.setAgentGameId(player2Entry.walletAddress, gameIdStr);

    console.log(`[Match] Game ${gameIdStr}: ${player1Entry.walletAddress} vs ${player2Entry.walletAddress}`);

    // オンチェーンでゲームを初期化（非同期・エラーはログのみ）
    const player1Pubkey = new PublicKey(player1Entry.walletAddress);
    const player2Pubkey = new PublicKey(player2Entry.walletAddress);

    initializeOnChainGame(gameId, player1Pubkey, player2Pubkey, buyIn, player1Entry, player2Entry);
  }
}

async function initializeOnChainGame(
  gameId: bigint,
  player1: PublicKey,
  player2: PublicKey,
  buyIn: bigint,
  player1Entry: QueueEntry,
  player2Entry: QueueEntry,
): Promise<void> {
  try {
    await anchorClient.initializeGame(gameId, player1, player2, buyIn);
    console.log(`[OnChain] Game ${gameId} initialized on-chain`);

    // GameMonitorでゲーム状態を監視開始
    const [gamePda] = anchorClient.deriveGamePda(gameId);
    gameMonitor.watchGame(
      gameId.toString(),
      gamePda,
      anchorClient.getL1Connection(),
      anchorClient.getERConnection(),
      (state) => onGameStateUpdate(gameId, state, player1Entry.walletAddress, player2Entry.walletAddress),
    );
  } catch (err) {
    console.error(`[OnChain] Failed to initialize game ${gameId}:`, err);
    activeGames.delete(gameId);

    // 両プレイヤーにエラーを通知
    const errorMsg = {
      type: 'error' as const,
      code: 'SERVER_ERROR' as const,
      message: 'ゲームの初期化に失敗しました。参加費の返金を試みています。',
    };
    agentHandler.sendToAgent(player1Entry.walletAddress, errorMsg);
    agentHandler.sendToAgent(player2Entry.walletAddress, errorMsg);
    agentHandler.setAgentGameId(player1Entry.walletAddress, null);
    agentHandler.setAgentGameId(player2Entry.walletAddress, null);

    // 参加費の返金を試みる（leave_matchmaking_queue 命令経由）
    await Promise.allSettled([
      anchorClient.leaveMatchmakingQueue(player1).then((sig) => {
        console.log(`[OnChain] Refunded ${player1.toBase58()}: ${sig}`);
      }),
      anchorClient.leaveMatchmakingQueue(player2).then((sig) => {
        console.log(`[OnChain] Refunded ${player2.toBase58()}: ${sig}`);
      }),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[OnChain] Failed to refund player${i + 1}:`, r.reason);
        }
      });
    });
  }
}

// ─── ゲーム状態更新コールバック ──────────────────────────────────────────────

async function onGameStateUpdate(
  gameId: bigint,
  state: DecodedGameState,
  player1Wallet: string,
  player2Wallet: string,
): Promise<void> {
  const gameIdStr = gameId.toString();
  const prevState = prevGameStates.get(gameIdStr);

  // 既存のタイムアウトタイマーをキャンセル（ターンが変わったためリセット）
  const existingTimer = actionTimeoutTimers.get(gameIdStr);
  if (existingTimer) {
    clearTimeout(existingTimer);
    actionTimeoutTimers.delete(gameIdStr);
  }

  const isPlayer1Turn = state.currentTurn === player1Wallet;
  const isPlayer2Turn = state.currentTurn === player2Wallet;

  // コミュニティカード公開通知（フェーズ変化時）
  if (prevState && prevState.phase !== state.phase) {
    const phaseRevealMap: Record<string, 'flop' | 'turn' | 'river'> = {
      Flop: 'flop',
      Turn: 'turn',
      River: 'river',
    };
    const revealPhase = phaseRevealMap[state.phase];
    if (revealPhase) {
      const newCardCounts: Record<string, number> = { flop: 3, turn: 1, river: 1 };
      const prevCardCount = revealPhase === 'flop' ? 0 : revealPhase === 'turn' ? 3 : 4;
      const count = newCardCounts[revealPhase] ?? 0;
      const communityMsg: CommunityCardsRevealedMessage = {
        type: 'community_cards_revealed',
        gameId: gameIdStr,
        phase: revealPhase,
        newCards: state.boardCards.slice(prevCardCount, prevCardCount + count),
        allCommunityCards: state.boardCards.slice(0, prevCardCount + count),
        pot: state.pot,
      };
      agentHandler.sendToAgent(player1Wallet, communityMsg);
      agentHandler.sendToAgent(player2Wallet, communityMsg);
    }
  }

  // ハンド完了通知（hand_number が増加した時）
  if (prevState && state.handNumber > prevState.handNumber) {
    const prevP1Folded = prevState.player1HasFolded ?? false;
    const prevP2Folded = prevState.player2HasFolded ?? false;
    let handWinner: 'player1' | 'player2' = 'player1';
    let handReason: 'showdown' | 'opponent_fold' | 'timeout' = 'showdown';
    if (prevP1Folded) { handWinner = 'player2'; handReason = 'opponent_fold'; }
    else if (prevP2Folded) { handWinner = 'player1'; handReason = 'opponent_fold'; }

    [player1Wallet, player2Wallet].forEach((wallet) => {
      const isP1 = wallet === player1Wallet;
      const myStack = isP1 ? state.player1ChipStack : state.player2ChipStack;
      const opponentStack = isP1 ? state.player2ChipStack : state.player1ChipStack;
      const handMsg: HandCompleteMessage = {
        type: 'hand_complete',
        gameId: gameIdStr,
        handNumber: prevState.handNumber,
        winner: handWinner,
        winningHand: '',
        potAwarded: prevState.pot,
        myStack,
        opponentStack,
        showdown: null,
        reason: handReason,
      };
      agentHandler.sendToAgent(wallet, handMsg);
    });
  }

  if (state.phase === 'Finished') {
    handleGameComplete(gameId, state, player1Wallet, player2Wallet);
    return;
  }

  // ターン変更時にyour_turnを送信
  if (isPlayer1Turn || isPlayer2Turn) {
    const activeWallet = isPlayer1Turn ? player1Wallet : player2Wallet;
    const myStack = isPlayer1Turn ? state.player1ChipStack : state.player2ChipStack;
    const opponentStack = isPlayer1Turn ? state.player2ChipStack : state.player1ChipStack;
    const myCommitted = isPlayer1Turn ? state.player1Committed : state.player2Committed;
    const oppCommitted = isPlayer1Turn ? state.player2Committed : state.player1Committed;
    const currentBet = Math.max(state.player1Committed, state.player2Committed);

    const validActions = calculateValidActions(state, isPlayer1Turn);
    const minBet = state.currentBigBlind;
    const minRaise = oppCommitted + state.lastRaiseAmount;

    const phaseMap: Record<string, 'pre_flop' | 'flop' | 'turn' | 'river'> = {
      PreFlop: 'pre_flop',
      Flop: 'flop',
      Turn: 'turn',
      River: 'river',
    };
    const phase = phaseMap[state.phase] ?? 'pre_flop';

    // PlayerStateからホールカードを読み取り
    const playerWallet = isPlayer1Turn ? player1Wallet : player2Wallet;
    const playerPubkey = new PublicKey(playerWallet);
    const holeCards = await anchorClient.getPlayerHoleCards(gameId, playerPubkey) ?? ['??', '??'];

    agentHandler.sendToAgent(activeWallet, {
      type: 'your_turn',
      gameId: gameIdStr,
      handNumber: state.handNumber,
      phase,
      holeCards,
      communityCards: state.boardCards,
      myStack,
      opponentStack,
      pot: state.pot,
      currentBet,
      myCurrentBet: myCommitted,
      validActions,
      minBet,
      minRaise,
      maxRaise: myStack,
      timeoutSeconds: 30,
      dealerPosition: state.dealerPosition === 0 ? 'player1' : 'player2',
      handHistory: [],
    });
  }

  // C-3: 30秒アクションタイムアウトタイマーを設定
  // プレイヤーのターン中のみタイマーを起動する（current_turnがデフォルトや終了状態の場合はスキップ）
  if (
    state.phase !== 'Finished' &&
    state.phase !== 'Waiting' &&
    state.phase !== 'Shuffling' &&
    state.currentTurn !== DEFAULT_PUBKEY &&
    (state.currentTurn === player1Wallet || state.currentTurn === player2Wallet)
  ) {
    const currentTurnWallet = state.currentTurn;
    const timeoutTimer = setTimeout(async () => {
      try {
        const timedOutPlayer = new PublicKey(currentTurnWallet);
        console.log(`[Timeout] Game ${gameIdStr}: ${currentTurnWallet} timed out, calling handle_timeout`);
        await anchorClient.handleTimeout(gameId, timedOutPlayer);
      } catch (err) {
        console.error(`[Timeout] Failed to handle timeout for game ${gameIdStr}:`, err);
      } finally {
        actionTimeoutTimers.delete(gameIdStr);
      }
    }, ACTION_TIMEOUT_MS);
    actionTimeoutTimers.set(gameIdStr, timeoutTimer);
  }

  // 次回比較用に現在の状態を保存
  prevGameStates.set(gameIdStr, state);
}

function calculateValidActions(state: DecodedGameState, isPlayer1: boolean): string[] {
  const myCommitted = isPlayer1 ? state.player1Committed : state.player2Committed;
  const oppCommitted = isPlayer1 ? state.player2Committed : state.player1Committed;
  const myStack = isPlayer1 ? state.player1ChipStack : state.player2ChipStack;

  const actions: string[] = ['fold'];

  if (myCommitted === oppCommitted) {
    actions.push('check');
  } else {
    actions.push('call');
  }

  if (!state.bettingClosed && myStack > 0) {
    if (myCommitted === oppCommitted) {
      actions.push('bet');
    } else {
      actions.push('raise');
    }
    actions.push('all_in');
  }

  return actions;
}

async function handleGameComplete(
  gameId: bigint,
  state: DecodedGameState,
  player1Wallet: string,
  player2Wallet: string,
): Promise<void> {
  const gameIdStr = gameId.toString();

  // タイムアウトタイマーをクリーンアップ
  const gameTimer = actionTimeoutTimers.get(gameIdStr);
  if (gameTimer) {
    clearTimeout(gameTimer);
    actionTimeoutTimers.delete(gameIdStr);
  }

  const winnerWallet = state.winner === player1Wallet ? player1Wallet : player2Wallet;
  const winnerPosition = winnerWallet === player1Wallet ? 'player1' : 'player2';

  // resolve_gameを呼び出してpayoutを処理
  let payoutAmount = 0;
  let payoutSignature = '';
  let houseFee = 0;
  try {
    const winnerPubkey = new PublicKey(winnerWallet);
    const result = await anchorClient.resolveGame(gameId, winnerPubkey);
    payoutAmount = result.payout;
    payoutSignature = result.signature;
    // fee = pot * 2% = (buyIn * 2) * 2 / 100
    houseFee = Math.floor((payoutAmount * 2) / 98); // reverse: payout = pot - fee, fee = pot*2/100
  } catch (err) {
    console.error(`[GameComplete] Failed to resolve game ${gameIdStr}:`, err);
  }

  // 両プレイヤーにゲーム終了通知
  [player1Wallet, player2Wallet].forEach((wallet) => {
    const isWinner = wallet === winnerWallet;
    const myFinalStack = wallet === player1Wallet ? state.player1ChipStack : state.player2ChipStack;
    const oppFinalStack = wallet === player1Wallet ? state.player2ChipStack : state.player1ChipStack;

    agentHandler.sendToAgent(wallet, {
      type: 'game_complete',
      gameId: gameIdStr,
      winner: winnerPosition,
      isMe: isWinner,
      finalMyStack: myFinalStack,
      finalOpponentStack: oppFinalStack,
      handsPlayed: state.handNumber,
      payoutAmount: isWinner ? payoutAmount : 0,
      payoutSignature: isWinner ? payoutSignature : '',
      houseFee,
      reason: 'opponent_eliminated',
    });

    agentHandler.setAgentGameId(wallet, null);
  });

  // ゲーム監視停止・クリーンアップ
  gameMonitor.unwatchGame(
    gameIdStr,
    anchorClient.getL1Connection(),
    anchorClient.getERConnection(),
  );
  prevGameStates.delete(gameIdStr);
  activeGames.delete(gameId);
}

// ─── Express HTTPサーバー（x402エントリーポイント）────────────────────────────

const app = express();
app.use(express.json());

// x402ルーターをマウント（/api/v1/queue/join）
// createX402RouterはisPaymentEnabledフラグも返す（本番環境で未インストール時は例外をスロー）
const { router: x402Router, isPaymentEnabled } = createX402Router(
  anchorClient,
  async (walletAddress: string, entryFeeLamports: bigint) => {
    // 二重登録チェック
    const existing = matchmakingQueue.find((e) => e.walletAddress === walletAddress);
    if (existing) {
      console.warn(`[x402] ${walletAddress} is already in queue, skipping duplicate entry`);
      return;
    }

    // サーバー側のキューに追加
    matchmakingQueue.push({
      walletAddress,
      entryFeeSignature: `x402-${walletAddress}-${Date.now()}`,
      entryFeeAmount: Number(entryFeeLamports),
      joinedAt: Date.now(),
    });

    // WS経由でqueue_joinedを送信
    const queueJoined: QueueJoinedMessage = {
      type: 'queue_joined',
      position: matchmakingQueue.length,
      estimatedWaitSeconds: Math.max(5, matchmakingQueue.length * 10),
    };
    agentHandler.sendToAgent(walletAddress, queueJoined);
    console.log(`[x402] ${walletAddress} joined queue via x402, position: ${matchmakingQueue.length}`);

    // マッチングを試みる
    await tryMatchPlayers();
  },
);
app.use(x402Router);

const httpServer = app.listen(HTTP_PORT, () => {
  console.log(`Claw Poker HTTP server running on port ${HTTP_PORT}`);
  console.log(`  x402 endpoint: POST http://localhost:${HTTP_PORT}/api/v1/queue/join`);
  console.log(`  x402 payment: ${isPaymentEnabled ? 'enabled' : 'disabled (dev mode)'}`);
});

// ─── WebSocketサーバー起動 ───────────────────────────────────────────────────

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws: WebSocket) => {
  const sessionId = randomBytes(16).toString('hex');
  console.log(`[WS] New connection: ${sessionId}`);
  agentHandler.handleConnection(ws, sessionId);
});

wss.on('error', (error: Error) => {
  console.error('[WS] Server error:', error);
});

console.log(`Claw Poker WebSocket server running on port ${PORT}`);
console.log(`  Solana RPC: ${SOLANA_RPC_URL}`);
console.log(`  MagicBlock ER: ${MAGICBLOCK_ER_URL}`);
console.log(`  Operator: ${anchorClient.getOperatorPublicKey().toBase58()}`);

// ─── グレースフルシャットダウン ──────────────────────────────────────────────

function shutdown(): void {
  console.log('\nShutting down...');
  agentHandler.shutdown();
  wss.close();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
