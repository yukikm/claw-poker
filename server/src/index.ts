import WebSocket from 'ws';
import express from 'express';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PublicKey } from '@solana/web3.js';
import { config } from 'dotenv';
import { AgentHandler } from './agentHandler';
import { GameMonitor, DecodedGameState } from './gameMonitor';
import { AnchorClient, ActionType } from './anchorClient';
import { SignatureStore } from './signatureStore';
import { createX402Router } from './x402Handler';
import { QueueJoinedMessage, GameJoinedMessage, GameStateMessage, OpponentActionMessage, CommunityCardsRevealedMessage, HandCompleteMessage, HandHistoryEntry } from './types';

config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const HTTP_PORT = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : 3001;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const MAGICBLOCK_ER_URL = process.env.MAGICBLOCK_ER_URL ?? 'https://devnet.magicblock.app';

/** HTTP APIの公開URL（SKILL.mdのURL置換に使用） */
const PUBLIC_HTTP_URL = process.env.PUBLIC_HTTP_URL ?? `http://43.206.193.46:${HTTP_PORT}`;
/** WebSocketの公開URL（SKILL.mdのURL置換に使用） */
const PUBLIC_WS_URL = process.env.PUBLIC_WS_URL ?? `ws://43.206.193.46:${PORT}`;

/** ゲーム開始時の各プレイヤーチップ枚数 */
const STARTING_CHIPS = 1000;
/** ブラインド額 */
const BLINDS = { small: 10, big: 20 } as const;

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

/** 現在のハンド内のアクション履歴（gameId → アクション配列） */
const currentHandActions = new Map<string, HandHistoryEntry[]>();

/**
 * 各ハンド開始時点のチップスタック（gameId → { p1, p2 }）。
 * ショーダウン勝者をチップ差分から判定するために使用する。
 * game.player1_chip_stack / player2_chip_stack はsettle_handでのみ更新されるため、
 * 各ハンド開始（handNumber変化）時点の値がそのハンド中は不変となる。
 */
const handStartChips = new Map<string, { p1: number; p2: number }>();

/**
 * ショーダウン時のホールカード（gameId → { p1, p2 }）。
 * reveal_showdown_cards 命令でゲームアカウントに書き込まれたカードをキャプチャし、
 * settle_hand でクリアされる前にここへ保存する。
 * hand_complete メッセージのshowdownフィールドに使用する。
 */
const capturedShowdownCards = new Map<
  string,
  { p1: [string, string]; p2: [string, string]; communityCards: string[] }
>();
/** Waiting状態でのハンド開始クランク重複実行を防ぐ（gameId → waiting時handNumber） */
const waitingCrankExecutedAtHand = new Map<string, number>();
/** 進行中クランク（gameId） */
const waitingCrankInFlight = new Set<string>();
/** ベッティングラウンド終了クランク進行中フラグ（gameId） */
const bettingEndCrankInFlight = new Set<string>();
/** ベッティングラウンド終了クランク実行済みフラグ（gameId → "phase:handNumber"） */
const bettingEndCrankExecuted = new Map<string, string>();
/** VRFフォールバックタイマー（gameId → setTimeout handle）
 * requestShuffle後にcallback_dealがタイムアウトした場合にフォールバック実行する */
const vrfFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** VRFフォールバック実行済みフラグ（gameId → handNumber）：同一ハンドで重複フォールバック防止 */
const vrfFallbackExecuted = new Map<string, number>();
/** VRFコールバック待機タイムアウト（秒）。この時間内にcallback_dealが来なければフォールバック */
const VRF_CALLBACK_TIMEOUT_MS = 10_000;

const matchmakingQueue: QueueEntry[] = [];

/** 使用済みのエントリーフィートランザクション署名（ファイル永続化で再起動耐性あり） */
const usedEntryFeeSignatures = new SignatureStore();

/** gameId (bigint) → ゲーム管理情報 */
const activeGames = new Map<bigint, ActiveGame>();

// Initialize components
const agentHandler = new AgentHandler();
const gameMonitor = new GameMonitor();
const anchorClient = new AnchorClient(SOLANA_RPC_URL, MAGICBLOCK_ER_URL);

// GameMonitorにTEE接続リフレッシャーを注入する。
// TEE WebSocket購読が切断された場合に新しいTEE接続を取得してGameMonitorが自動復旧できるようにする。
gameMonitor.setTeeConnectionRefresher(async () => {
  return anchorClient.createTeeConnectionForMonitor();
});

// ─── TEE認証レスポンスハンドラ ────────────────────────────────────────────────
// プレイヤーが tee_auth_challenge に署名して返答したとき、プレイヤー専用TEEトークンを発行する。
// 以降の getPlayerHoleCards はこのプレイヤー固有トークンを使用し、
// オペレーターではなくプレイヤー自身の鍵で認証したTEEアクセスとなる（公式PERプライバシーモデル準拠）。
agentHandler.setOnTeeAuthResponse(async (walletAddress, challenge, signature) => {
  try {
    const pubkey = new PublicKey(walletAddress);
    await anchorClient.setPlayerTeeToken(pubkey, challenge, signature);
    console.log(`[TEE] Player ${walletAddress} TEE token set successfully`);
  } catch (err) {
    console.error(`[TEE] Failed to set player TEE token for ${walletAddress}:`, err);
  }
});

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
  const entry = index !== -1 ? matchmakingQueue.splice(index, 1)[0] : null;

  // leave_matchmaking_queue Anchor命令を呼び出してオンチェーンQueueから削除する
  let queueLeaveSignature = '';
  try {
    const playerPubkey = new PublicKey(walletAddress);
    queueLeaveSignature = await anchorClient.leaveMatchmakingQueue(playerPubkey);
    if (entry) {
      console.log(`[Queue] Removed ${walletAddress} (${entry.entryFeeAmount} lamports): ${queueLeaveSignature}`);
    } else {
      console.log(`[Queue] Removed stale on-chain entry for ${walletAddress}: ${queueLeaveSignature}`);
    }
  } catch (err) {
    console.error(`[Queue] Failed to remove queue entry for ${walletAddress}:`, err);
  }

  agentHandler.sendToAgent(walletAddress, {
    type: 'queue_left',
    refundSignature: queueLeaveSignature,
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

  // フェーズチェック: Waiting/Shuffling中のアクション送信を防ぐ。
  // VRF callbackがPreFlopへ遷移するまではアクション送信不可。
  // これがないと、initializeGame直後にcurrentTurnが設定されたエージェントが
  // 即座にアクションを送り、ゲーム状態を破壊してVRF callbackが永久に失敗する。
  const currentPhase = prevGameStates.get(gameIdStr);
  if (currentPhase) {
    const playingPhases = new Set(['PreFlop', 'Flop', 'Turn', 'River']);
    if (!playingPhases.has(currentPhase.phase)) {
      agentHandler.sendToAgent(walletAddress, {
        type: 'error',
        code: 'INVALID_ACTION',
        message: `Cannot perform action during ${currentPhase.phase} phase. Wait for cards to be dealt.`,
      });
      return;
    }
  }

  try {
    // TEEオペレーターとしてプレイヤーアクションをER上で実行
    const playerPubkey = new PublicKey(walletAddress);
    await anchorClient.submitPlayerAction(gameId, playerPubkey, action as ActionType, amount);

    // ハンドアクション履歴を記録
    const activeGameForHistory = activeGames.get(gameId);
    if (activeGameForHistory) {
      const playerPosition: 'player1' | 'player2' =
        activeGameForHistory.player1Wallet === walletAddress ? 'player1' : 'player2';
      const actions = currentHandActions.get(gameIdStr) ?? [];
      actions.push({ player: playerPosition, action, amount: amount ?? undefined });
      currentHandActions.set(gameIdStr, actions);
    }

    // アクション後のER上の最新状態を取得（action_accepted/opponent_actionに正確な値を使用）
    const postActionState = await anchorClient.fetchGamePotAndStacks(gameId);
    const isP1 = activeGames.get(gameId)?.player1Wallet === walletAddress;
    // フォールバック: ER読み取り失敗時はprevGameStates（古いがnullよりマシ）
    const fallbackState = prevGameStates.get(gameIdStr);
    const newPot = postActionState?.pot ?? fallbackState?.pot ?? 0;
    const myStack = postActionState
      ? (isP1 ? postActionState.player1ChipStack : postActionState.player2ChipStack)
      : (fallbackState ? (isP1 ? fallbackState.player1ChipStack : fallbackState.player2ChipStack) : 0);

    agentHandler.sendToAgent(walletAddress, {
      type: 'action_accepted',
      gameId: gameIdStr,
      action,
      amount: amount ?? null,
      newPot,
      myStack,
    });

    // 相手プレイヤーにアクション通知
    const activeGameForAction = activeGames.get(gameId);
    if (activeGameForAction) {
      const opponentWallet = activeGameForAction.player1Wallet === walletAddress
        ? activeGameForAction.player2Wallet
        : activeGameForAction.player1Wallet;
      const isActingP1 = activeGameForAction.player1Wallet === walletAddress;
      const opponentStack = postActionState
        ? (isActingP1 ? postActionState.player2ChipStack : postActionState.player1ChipStack)
        : (fallbackState ? (isActingP1 ? fallbackState.player2ChipStack : fallbackState.player1ChipStack) : 0);
      const oppMsg: OpponentActionMessage = {
        type: 'opponent_action',
        gameId: gameIdStr,
        action,
        amount: amount ?? null,
        newPot,
        opponentStack,
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

// ─── 再接続ハンドラ: 切断前にゲーム中だったエージェントにゲーム状態を再送信 ──

agentHandler.setOnReconnect(async (walletAddress: string, gameId: string) => {
  const gameIdBigInt = BigInt(gameId);
  const activeGame = activeGames.get(gameIdBigInt);
  if (!activeGame) return;

  const currentState = prevGameStates.get(gameId);
  if (!currentState) return;

  const isPlayer1 = walletAddress === activeGame.player1Wallet;
  const isPlayer2 = walletAddress === activeGame.player2Wallet;
  if (!isPlayer1 && !isPlayer2) return;

  const myStack = isPlayer1 ? currentState.player1ChipStack : currentState.player2ChipStack;
  const opponentStack = isPlayer1 ? currentState.player2ChipStack : currentState.player1ChipStack;
  const isMyTurn = currentState.currentTurn === walletAddress;

  console.log(`[Reconnect] ${walletAddress} reconnected to game ${gameId}, phase: ${currentState.phase}`);

  // 現在のゲーム状態を再送信
  const gameStateMsg: GameStateMessage = {
    type: 'game_state',
    gameId,
    phase: currentState.phase,
    handNumber: currentState.handNumber,
    myStack,
    opponentStack,
    pot: currentState.pot,
    communityCards: currentState.boardCards,
    currentSmallBlind: currentState.currentSmallBlind,
    currentBigBlind: currentState.currentBigBlind,
    dealerPosition: currentState.dealerPosition === 0 ? 'player1' : 'player2',
    isMyTurn,
  };
  agentHandler.sendToAgent(walletAddress, gameStateMsg);
});

// ─── マッチングロジック ──────────────────────────────────────────────────────

async function tryMatchPlayers(): Promise<void> {
  while (matchmakingQueue.length >= 2) {
    const player1Entry = matchmakingQueue.shift();
    const player2Entry = matchmakingQueue.shift();

    if (!player1Entry || !player2Entry) break;

    // Private ER運用時は、TEE書き込み接続を事前検証してからマッチを成立させる。
    // 認証失敗時にゲームだけ初期化されると Waiting で停止し続けるため、キューに戻して保留する。
    if (anchorClient.isTeeConfigured()) {
      try {
        await anchorClient.ensureTeeReady();
      } catch (err) {
        matchmakingQueue.unshift(player1Entry, player2Entry);
        console.error('[Match] TEE is unavailable. Postponing match and keeping players in queue:', err);
        break;
      }
    }

    // ゲームID: Unixミリ秒 * 65536 + 2バイト乱数で衝突リスクを排除（u64上限内に収まる）
    const rndSuffix = BigInt(randomBytes(2).readUInt16BE(0));
    const gameId = BigInt(Date.now()) * 65536n + rndSuffix;
    const buyIn = BigInt(Math.min(player1Entry.entryFeeAmount, player2Entry.entryFeeAmount));
    const totalPot = player1Entry.entryFeeAmount + player2Entry.entryFeeAmount;
    const startingChips = STARTING_CHIPS;
    const blinds = BLINDS;

    // ゲーム情報を記録
    activeGames.set(gameId, {
      gameId,
      player1Wallet: player1Entry.walletAddress,
      player2Wallet: player2Entry.walletAddress,
      entryFeeAmount: Number(buyIn),
    });

    const gameIdStr = gameId.toString();

    // ハンド開始チップを初期値で初期化（ショーダウン勝者判定用）
    handStartChips.set(gameIdStr, { p1: startingChips, p2: startingChips });

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

    // TEEが設定されている場合、各プレイヤーにTEEチャレンジを送信する。
    // プレイヤーが自分の秘密鍵で署名して返答すると、プレイヤー専用TEEトークンが発行され、
    // 以降のホールカード読み取りが公式PERプライバシーモデル（プレイヤー自身の鍵で認証）に準拠する。
    if (anchorClient.isTeeConfigured()) {
      void sendTeeAuthChallenges(player1Entry.walletAddress, player2Entry.walletAddress);
    }

    // オンチェーンでゲームを初期化（非同期・エラーはログのみ）
    const player1Pubkey = new PublicKey(player1Entry.walletAddress);
    const player2Pubkey = new PublicKey(player2Entry.walletAddress);

    initializeOnChainGame(gameId, player1Pubkey, player2Pubkey, buyIn, player1Entry, player2Entry);
  }
}

/**
 * 両プレイヤーにTEEチャレンジを送信する。
 * 各プレイヤーが自分の秘密鍵で署名して tee_auth_response を返すと、
 * setOnTeeAuthResponse ハンドラがプレイヤー専用TEEトークンをキャッシュする。
 */
async function sendTeeAuthChallenges(wallet1: string, wallet2: string): Promise<void> {
  for (const wallet of [wallet1, wallet2]) {
    try {
      const pubkey = new PublicKey(wallet);
      const challenge = await anchorClient.createTeeChallenge(pubkey);
      if (challenge) {
        agentHandler.sendTeeAuthChallenge(wallet, challenge);
        console.log(`[TEE] Sent auth challenge to ${wallet}`);
      }
    } catch (err) {
      console.warn(`[TEE] Failed to create challenge for ${wallet}:`, err);
    }
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

    // マッチ成立後はオンチェーンQueueから双方を削除する。
    // Queueは参加者トラッキング用途であり、残置すると次回join時にAlreadyInQueueになる。
    await Promise.allSettled([
      anchorClient.leaveMatchmakingQueue(player1),
      anchorClient.leaveMatchmakingQueue(player2),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[OnChain] Queue cleanup failed for player${i + 1} in game ${gameId}:`, r.reason);
        }
      });
    });

    // GameMonitorでゲーム状態を監視開始
    // プライベートERのゲームアカウント変更はTEE WebSocket経由でのみ受信できる。
    // TEE接続をGameMonitorに渡すことで、公開ER（devnet.magicblock.app）ではなく
    // プライベートER（tee.magicblock.app）のアカウント変更を購読する。
    const [gamePda] = anchorClient.deriveGamePda(gameId);
    const teeConnForMonitor = await anchorClient.createTeeConnectionForMonitor();
    gameMonitor.watchGame(
      gameId.toString(),
      gamePda,
      anchorClient.getL1Connection(),
      anchorClient.getERConnection(),
      (state) => onGameStateUpdate(gameId, state, player1Entry.walletAddress, player2Entry.walletAddress),
      teeConnForMonitor ?? undefined,
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

    // オンチェーンQueueの残留エントリをクリーンアップする
    await Promise.allSettled([
      anchorClient.leaveMatchmakingQueue(player1).then((sig) => {
        console.log(`[OnChain] Queue entry removed for ${player1.toBase58()}: ${sig}`);
      }),
      anchorClient.leaveMatchmakingQueue(player2).then((sig) => {
        console.log(`[OnChain] Queue entry removed for ${player2.toBase58()}: ${sig}`);
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

// ─── VRFフォールバック実行 ────────────────────────────────────────────────────

/**
 * VRFコールバック（callback_deal）がタイムアウトした場合のフォールバック。
 * サーバー側で暗号学的乱数を生成し、test_shuffle_and_deal命令を直接呼び出す。
 * フェーズがShufflingのまま停止している場合に呼ばれる。
 */
async function executeVrfFallback(
  gameId: bigint,
  gameIdStr: string,
  player1: PublicKey,
  player2: PublicKey,
): Promise<void> {
  // 同一ハンドで重複フォールバック防止
  const currentState = prevGameStates.get(gameIdStr);
  const handNum = currentState?.handNumber ?? 0;
  if (vrfFallbackExecuted.get(gameIdStr) === handNum) {
    return;
  }

  // フェーズがShuffling以外なら不要（既にcallback_dealが到着済みか、まだrequest_shuffle未実行）
  // Waitingフェーズでのフォールバックはオンチェーン制約でも拒否される（VRFバイパス防止）
  if (currentState && currentState.phase !== 'Shuffling') {
    console.log(`[VRF Fallback] Game ${gameIdStr}: phase is ${currentState.phase}, skipping fallback`);
    return;
  }

  vrfFallbackExecuted.set(gameIdStr, handNum);

  try {
    console.log(`[VRF Fallback] Game ${gameIdStr}: VRF callback timed out, executing fallback shuffle (hand ${handNum})`);
    await anchorClient.fallbackShuffleAndDeal(gameId, player1, player2);
    console.log(`[VRF Fallback] Game ${gameIdStr}: fallback shuffle completed successfully`);
  } catch (err) {
    console.error(`[VRF Fallback] Game ${gameIdStr}: fallback shuffle failed:`, err);
    // フォールバックも失敗した場合、再試行可能にするためフラグをクリア
    vrfFallbackExecuted.delete(gameIdStr);
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

  // Waiting状態: 次ハンド開始クランクを1回だけ実行
  if (state.phase === 'Waiting') {
    const alreadyExecutedAt = waitingCrankExecutedAtHand.get(gameIdStr);
    if (!waitingCrankInFlight.has(gameIdStr) && alreadyExecutedAt !== state.handNumber) {
      waitingCrankInFlight.add(gameIdStr);
      try {
        const isFirstHand = state.handNumber === 0;
        if (!isFirstHand) {
          await anchorClient.startNewHand(gameId);
        }
        const p1 = new PublicKey(player1Wallet);
        const p2 = new PublicKey(player2Wallet);
        const clientSeed = Math.floor(Math.random() * 256);
        try {
          await anchorClient.requestShuffle(gameId, p1, p2, clientSeed);
          // VRFコールバック待機タイマー開始:
          // callback_dealが一定時間内に到着しなければフォールバック実行
          const existingFallbackTimer = vrfFallbackTimers.get(gameIdStr);
          if (existingFallbackTimer) clearTimeout(existingFallbackTimer);
          const fallbackTimer = setTimeout(() => {
            vrfFallbackTimers.delete(gameIdStr);
            void executeVrfFallback(gameId, gameIdStr, p1, p2);
          }, VRF_CALLBACK_TIMEOUT_MS);
          vrfFallbackTimers.set(gameIdStr, fallbackTimer);
          waitingCrankExecutedAtHand.set(gameIdStr, state.handNumber);
        } catch (vrfErr) {
          // VRFリクエスト自体が失敗した場合。
          // request_shuffleが失敗 = オンチェーンでShufflingに遷移していないため、
          // フォールバック(test_shuffle_and_deal)もShuffling制約で拒否される。
          // 次回のonGameStateUpdateループで再度request_shuffleを試行する。
          console.error(`[Crank] VRF request failed for game ${gameIdStr}, will retry on next state update:`, vrfErr);
        }
      } catch (err) {
        console.error(`[Crank] Failed to start next hand for game ${gameIdStr}:`, err);
      } finally {
        waitingCrankInFlight.delete(gameIdStr);
      }
    }
  }

  // Shuffling → PreFlop遷移を検知したらVRFフォールバックタイマーをキャンセル
  // （callback_dealが正常に到着した場合）
  if (prevState?.phase === 'Shuffling' && state.phase === 'PreFlop') {
    const fallbackTimer = vrfFallbackTimers.get(gameIdStr);
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      vrfFallbackTimers.delete(gameIdStr);
      console.log(`[VRF] Game ${gameIdStr}: callback_deal arrived, cancelled VRF fallback timer`);
    }
  }

  // ─── ベッティングラウンド終了クランク ──────────────────────────────────────
  // current_turn === DEFAULT_PUBKEY はベッティングラウンド終了シグナル。
  // player_action が current_turn をゼロアドレスに設定した後、サーバーがクランクとして
  // 次のステップ（settle_hand / reveal_community_cards / reveal_showdown_cards）を実行する。
  const isDefaultTurn = state.currentTurn === DEFAULT_PUBKEY;
  const isPlayPhase = state.phase === 'PreFlop' || state.phase === 'Flop'
    || state.phase === 'Turn' || state.phase === 'River';
  const isShowdown = state.phase === 'Showdown';
  const hasFold = state.player1HasFolded || state.player2HasFolded;
  const crankKey = `${state.phase}:${state.handNumber}`;

  if (isDefaultTurn && (isPlayPhase || isShowdown) && !bettingEndCrankInFlight.has(gameIdStr) && bettingEndCrankExecuted.get(gameIdStr) !== crankKey) {
    bettingEndCrankInFlight.add(gameIdStr);
    try {
      const p1 = new PublicKey(player1Wallet);
      const p2 = new PublicKey(player2Wallet);

      if (hasFold) {
        // Fold → settle_hand でハンド決着
        console.log(`[Crank] Game ${gameIdStr}: fold detected, settling hand`);
        await anchorClient.settleHand(gameId, p1, p2);
      } else if (isShowdown) {
        // Showdown → reveal_showdown_cards → settle_hand
        console.log(`[Crank] Game ${gameIdStr}: showdown, revealing cards and settling`);
        await anchorClient.revealShowdownCards(gameId, p1, p2);
        await anchorClient.settleHand(gameId, p1, p2);
        gameMonitor.triggerBurstPoll(gameIdStr);
      } else if (state.bettingClosed) {
        // AllInランアウト: 残りのコミュニティカードを全公開 → settle_hand
        console.log(`[Crank] Game ${gameIdStr}: all-in runout in ${state.phase}`);
        const dc = state.dealCards; // [burn1, flop0, flop1, flop2, burn2, turn, burn3, river]
        // 現在のフェーズに応じて残りのカードを段階的に公開
        if (state.phase === 'PreFlop') {
          await anchorClient.revealCommunityCards(gameId, p1, p2, 3, [dc[1], dc[2], dc[3]]); // Flop=3
          await anchorClient.revealCommunityCards(gameId, p1, p2, 4, [dc[5]]); // Turn=4
          await anchorClient.revealCommunityCards(gameId, p1, p2, 5, [dc[7]]); // River=5
        } else if (state.phase === 'Flop') {
          await anchorClient.revealCommunityCards(gameId, p1, p2, 4, [dc[5]]); // Turn=4
          await anchorClient.revealCommunityCards(gameId, p1, p2, 5, [dc[7]]); // River=5
        } else if (state.phase === 'Turn') {
          await anchorClient.revealCommunityCards(gameId, p1, p2, 5, [dc[7]]); // River=5
        }
        // River + betting_closed → ショーダウンへ
        await anchorClient.revealShowdownCards(gameId, p1, p2);
        await anchorClient.settleHand(gameId, p1, p2);
        gameMonitor.triggerBurstPoll(gameIdStr);
      } else {
        // 通常のベッティングラウンド終了 → 次のコミュニティカードを公開
        const dc = state.dealCards;
        if (state.phase === 'PreFlop') {
          console.log(`[Crank] Game ${gameIdStr}: PreFlop ended, revealing flop`);
          await anchorClient.revealCommunityCards(gameId, p1, p2, 3, [dc[1], dc[2], dc[3]]); // Flop=3
        } else if (state.phase === 'Flop') {
          console.log(`[Crank] Game ${gameIdStr}: Flop ended, revealing turn`);
          await anchorClient.revealCommunityCards(gameId, p1, p2, 4, [dc[5]]); // Turn=4
        } else if (state.phase === 'Turn') {
          console.log(`[Crank] Game ${gameIdStr}: Turn ended, revealing river`);
          await anchorClient.revealCommunityCards(gameId, p1, p2, 5, [dc[7]]); // River=5
        }
        // River終了は player_action.rs で phase=Showdown に設定されるため、
        // ここではなく isShowdown ブランチで処理される
      }
      // StructErrorで成功扱いされた場合、GameMonitorに状態変化が通知されない可能性がある。
      // バーストポーリングで確実にオンチェーン状態をキャプチャする。
      gameMonitor.triggerBurstPoll(gameIdStr);
      bettingEndCrankExecuted.set(gameIdStr, crankKey);
    } catch (err) {
      console.error(`[Crank] Failed betting-end crank for game ${gameIdStr} (phase=${state.phase}):`, err);
    } finally {
      bettingEndCrankInFlight.delete(gameIdStr);
    }
  }

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

  // ショーダウンカードのキャプチャ
  // reveal_showdown_cards命令実行後、game.showdown_cards_p1/p2が設定される。
  // settle_hand命令でクリアされる前にここでキャプチャしてサーバーメモリに保存する。
  if (state.showdownCardsP1 && state.showdownCardsP2) {
    capturedShowdownCards.set(gameIdStr, {
      p1: state.showdownCardsP1,
      p2: state.showdownCardsP2,
      communityCards: [...state.boardCards],
    });
  }

  // 50ハンドチェックポイント自動コミット
  // settle_handでlast_checkpoint_handが更新された（値が変化した）タイミングでcommit_gameを呼び出す
  if (
    prevState &&
    state.lastCheckpointHand > prevState.lastCheckpointHand &&
    state.phase === 'Waiting'
  ) {
    console.log(`[Checkpoint] Game ${gameIdStr}: hand ${state.handNumber}, checkpoint at ${state.lastCheckpointHand}`);
    void commitWithRetry(gameId, gameIdStr, 3);
  }

  // ハンド完了通知（hand_number が増加した時）
  // ただし、request_shuffleによるhand_numberインクリメント（Waiting→Shuffling遷移）は除外する。
  // hand_completeはsettle_hand後（Waiting遷移時）の正当なハンド完了時のみ送信する。
  // 条件: prevStateのフェーズがWaitingまたはShufflingでないこと
  //       （= settle_handで状態がリセットされた後にhand_numberが増加したケースのみ許可）
  const prevWasPlaying = prevState && prevState.phase !== 'Waiting' && prevState.phase !== 'Shuffling';
  if (prevState && prevWasPlaying && state.handNumber > prevState.handNumber) {
    // 完了したハンドのアクション履歴をクリア
    currentHandActions.delete(gameIdStr);
    const prevP1Folded = prevState.player1HasFolded ?? false;
    const prevP2Folded = prevState.player2HasFolded ?? false;
    let handWinner: 'player1' | 'player2' = 'player1';
    let handReason: 'showdown' | 'opponent_fold' | 'timeout' = 'showdown';
    if (prevP1Folded) { handWinner = 'player2'; handReason = 'opponent_fold'; }
    else if (prevP2Folded) { handWinner = 'player1'; handReason = 'opponent_fold'; }
    else {
      // ショーダウン: game.player1_chip_stack（settle_handでのみ更新）を
      // ハンド開始前のスタックと比較して勝者を判定する。
      // prevState = settle_hand後の状態（pot配分済み、committed=0）
      const starts = handStartChips.get(gameIdStr);
      if (starts) {
        if (prevState.player2ChipStack > starts.p2) handWinner = 'player2';
        // else handWinner は 'player1' のまま（p1勝利またはタイ）
      }
    }
    // 次ハンドのhandStartChipsを更新（settle_hand後のスタックを記録）
    handStartChips.set(gameIdStr, {
      p1: prevState.player1ChipStack,
      p2: prevState.player2ChipStack,
    });

    // キャプチャ済みショーダウンカードを取得してクリア
    const captured = capturedShowdownCards.get(gameIdStr);
    capturedShowdownCards.delete(gameIdStr);

    [player1Wallet, player2Wallet].forEach((wallet) => {
      const isP1 = wallet === player1Wallet;
      const myStack = isP1 ? state.player1ChipStack : state.player2ChipStack;
      const opponentStack = isP1 ? state.player2ChipStack : state.player1ChipStack;

      // ショーダウン時のみshowdownInfoを設定（フォールドまたはタイムアウトの場合はnull）
      let showdownInfo: import('./types').ShowdownInfo | null = null;
      if (handReason === 'showdown' && captured) {
        showdownInfo = {
          myHand: isP1 ? captured.p1 : captured.p2,
          opponentHand: isP1 ? captured.p2 : captured.p1,
          communityCards: captured.communityCards,
          myBestHand: '',
          opponentBestHand: '',
        };
      }

      const handMsg: HandCompleteMessage = {
        type: 'hand_complete',
        gameId: gameIdStr,
        handNumber: prevState.handNumber,
        winner: handWinner,
        winningHand: '',
        potAwarded: prevState.pot,
        myStack,
        opponentStack,
        showdown: showdownInfo,
        reason: handReason,
      };
      agentHandler.sendToAgent(wallet, handMsg);
    });
  }

  if (state.phase === 'Finished') {
    handleGameComplete(gameId, state, player1Wallet, player2Wallet);
    return;
  }

  // ターン変更時のみyour_turnを送信（Waiting/Shuffling/Showdown/Finishedフェーズ中は送信しない）
  // Waiting/Shufflingではカードが配られておらず、アクション送信は不正。
  // initializeGame直後のfetchInitialStateでcurrentTurnが設定済みでも、
  // VRF callback (callback_deal) がPreFlopへ遷移するまで待機する必要がある。
  const turnChanged = prevState?.currentTurn !== state.currentTurn;
  const isPlayingPhase = state.phase === 'PreFlop' || state.phase === 'Flop'
    || state.phase === 'Turn' || state.phase === 'River';
  const prevWasNotPlaying = !prevState || !(
    prevState.phase === 'PreFlop' || prevState.phase === 'Flop'
    || prevState.phase === 'Turn' || prevState.phase === 'River'
  );
  // your_turnを送信する条件:
  // 1. プレイ中フェーズ（PreFlop/Flop/Turn/River）であること
  // 2. 以下のいずれかが成立:
  //    a) ターンが変わった（通常のアクション後）
  //    b) 非プレイ中フェーズからプレイ中フェーズに遷移した（VRF callback後のPreFlop開始時）
  //       initializeGameでcurrentTurn=player1、callback_dealでもcurrentTurn=player1の場合、
  //       turnChangedがfalseになるため、フェーズ遷移でもyour_turnを送信する必要がある
  if ((isPlayer1Turn || isPlayer2Turn) && (turnChanged || prevWasNotPlaying) && isPlayingPhase) {
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
      handHistory: currentHandActions.get(gameIdStr) ?? [],
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
        // StructErrorで確認失敗の可能性があるため、バーストポーリングで状態変化をキャプチャ
        gameMonitor.triggerBurstPoll(gameIdStr);
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

/**
 * commitGameCheckpoint をリトライ付きで呼び出す。
 * ネットワーク一時エラーに備えて最大 maxRetries 回リトライし、指数バックオフを適用する。
 */
async function commitWithRetry(gameId: bigint, gameIdStr: string, maxRetries: number): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await anchorClient.commitGameCheckpoint(gameId);
      console.log(`[Checkpoint] Game ${gameIdStr}: committed (attempt ${attempt}/${maxRetries})`);
      return;
    } catch (err) {
      console.error(`[Checkpoint] Game ${gameIdStr}: attempt ${attempt}/${maxRetries} failed:`, err);
      if (attempt < maxRetries) {
        // 指数バックオフ: 2s, 4s, ...
        await new Promise<void>((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  console.error(`[Checkpoint] Game ${gameIdStr}: all ${maxRetries} attempts failed, skipping commit`);
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

  // ER上の最終状態をL1にコミットしてからresolveGameを呼び出す
  // commit_gameなしでresolveGameを呼ぶとER上の状態がL1に反映されないためゲームが解決できない
  try {
    await anchorClient.commitGameCheckpoint(gameId);
    console.log(`[GameComplete] Game ${gameIdStr}: committed final state to L1`);
  } catch (err) {
    console.error(`[GameComplete] Failed to commit game ${gameIdStr} to L1:`, err);
    // コミット失敗時はresolveGameも続行不可のため早期リターン
    return;
  }

  // resolve_gameを呼び出してpayoutを処理
  let payoutAmount = 0;
  let payoutSignature = '';
  let houseFee = 0;
  try {
    const winnerPubkey = new PublicKey(winnerWallet);
    const result = await anchorClient.resolveGame(gameId, winnerPubkey);
    payoutAmount = result.payout;
    payoutSignature = result.signature;
    houseFee = result.fee;
  } catch (err) {
    console.error(`[GameComplete] Failed to resolve game ${gameIdStr}:`, err);
  }

  // ゲーム終了理由を特定
  // タイムアウト没収（3連続タイムアウト）、切断、通常の勝負を区別する
  let gameEndReason: 'opponent_eliminated' | 'disconnect' | 'timeout_forfeit' = 'opponent_eliminated';
  const p1TimeoutsForfeit = (state.consecutiveTimeoutsP1 ?? 0) >= 3;
  const p2TimeoutsForfeit = (state.consecutiveTimeoutsP2 ?? 0) >= 3;
  if (p1TimeoutsForfeit || p2TimeoutsForfeit) {
    gameEndReason = 'timeout_forfeit';
  } else {
    const p1Connected = agentHandler.isAgentConnected(player1Wallet);
    const p2Connected = agentHandler.isAgentConnected(player2Wallet);
    if (!p1Connected || !p2Connected) {
      gameEndReason = 'disconnect';
    }
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
      reason: gameEndReason,
    });

    agentHandler.setAgentGameId(wallet, null);
  });

  // ゲーム監視停止・クリーンアップ
  gameMonitor.unwatchGame(
    gameIdStr,
    anchorClient.getL1Connection(),
    anchorClient.getERConnection(),
  );
  waitingCrankExecutedAtHand.delete(gameIdStr);
  waitingCrankInFlight.delete(gameIdStr);
  bettingEndCrankInFlight.delete(gameIdStr);
  bettingEndCrankExecuted.delete(gameIdStr);
  const vrfTimer = vrfFallbackTimers.get(gameIdStr);
  if (vrfTimer) { clearTimeout(vrfTimer); vrfFallbackTimers.delete(gameIdStr); }
  vrfFallbackExecuted.delete(gameIdStr);
  prevGameStates.delete(gameIdStr);
  currentHandActions.delete(gameIdStr);
  handStartChips.delete(gameIdStr);
  capturedShowdownCards.delete(gameIdStr);
  activeGames.delete(gameId);
}

// ─── Express HTTPサーバー（x402エントリーポイント）────────────────────────────

const app = express();
app.use(express.json());

// ─── GET /skill ────────────────────────────────────────────────────────────
// SKILL.md をサーブし、{{HTTP_URL}} / {{WS_URL}} を実際のURLに置換して返す。
// OpenClaw など x402 対応エージェントが AgentSkill として読み込む。
//
// 使用方法:
//   curl http://43.206.193.46:3001/skill
//
// 環境変数:
//   PUBLIC_HTTP_URL  HTTP API の公開ベースURL（デフォルト: http://43.206.193.46:3001）
//   PUBLIC_WS_URL    WebSocket の公開URL      （デフォルト: ws://43.206.193.46:8080）
// ────────────────────────────────────────────────────────────────────────────
const SKILL_TEMPLATE_PATH = join(__dirname, '../../skills/claw-poker-player/SKILL.md');

app.get('/skill', (_req: express.Request, res: express.Response) => {
  try {
    let content = readFileSync(SKILL_TEMPLATE_PATH, 'utf-8');
    content = content.split('{{HTTP_URL}}').join(PUBLIC_HTTP_URL);
    content = content.split('{{WS_URL}}').join(PUBLIC_WS_URL);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(content);
  } catch (err) {
    console.error('[Skill] Failed to read SKILL.md:', err);
    res.status(500).json({ error: 'Failed to load skill file' });
  }
});

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

// ─── GET /api/v1/games ──────────────────────────────────────────────────────
// フロントエンドがプライベートER上の進行中ゲームを取得するためのAPI。
// プライベートER（TEE）のゲームアカウントは公開ERに存在しないため、
// フロントエンドが直接取得できない。サーバーのactiveGames + prevGameStatesから返す。
app.get('/api/v1/games', (_req: express.Request, res: express.Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const games = Array.from(activeGames.values()).map((game) => {
    const gameIdStr = game.gameId.toString();
    const state = prevGameStates.get(gameIdStr);
    return {
      gameId: gameIdStr,
      player1: game.player1Wallet,
      player2: game.player2Wallet,
      phase: state?.phase ?? 'Waiting',
      handNumber: state?.handNumber ?? 0,
      pot: state?.pot ?? 0,
      player1ChipStack: state?.player1ChipStack ?? 1000,
      player2ChipStack: state?.player2ChipStack ?? 1000,
      bettingClosed: state?.bettingClosed ?? false,
    };
  });
  res.json({ games });
});

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
  gameMonitor.shutdown();
  wss.close();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
