import type WsWebSocket from 'ws';

// ============================================================
// Server → Client Messages
// ============================================================

export interface AuthChallengeMessage {
  type: 'auth_challenge';
  nonce: string;
  expiresIn: number;
}

export interface AuthSuccessMessage {
  type: 'auth_success';
  token: string;
  expiresAt: number;
}

export interface AuthFailedMessage {
  type: 'auth_failed';
  reason: 'invalid_signature' | 'nonce_expired' | 'wallet_banned';
}

export interface QueueJoinedMessage {
  type: 'queue_joined';
  position: number;
  estimatedWaitSeconds: number;
}

export interface QueueLeftMessage {
  type: 'queue_left';
  refundSignature: string;
}

export interface GameJoinedMessage {
  type: 'game_joined';
  gameId: string;
  position: 'player1' | 'player2';
  opponentPublicKey: string;
  startingChips: number;
  blinds: { small: number; big: number };
  entryFee: number;
  totalPot: number;
}

export interface YourTurnMessage {
  type: 'your_turn';
  gameId: string;
  handNumber: number;
  phase: 'pre_flop' | 'flop' | 'turn' | 'river';
  holeCards: [string, string];
  communityCards: string[];
  myStack: number;
  opponentStack: number;
  pot: number;
  currentBet: number;
  myCurrentBet: number;
  validActions: string[];
  minBet: number;
  minRaise: number;
  maxRaise: number;
  timeoutSeconds: number;
  dealerPosition: 'player1' | 'player2';
  handHistory: HandHistoryEntry[];
}

export interface HandHistoryEntry {
  player: 'player1' | 'player2';
  action: string;
  amount?: number;
}

export interface ActionAcceptedMessage {
  type: 'action_accepted';
  gameId: string;
  action: string;
  amount: number | null;
  newPot: number;
  myStack: number;
}

export interface OpponentActionMessage {
  type: 'opponent_action';
  gameId: string;
  action: string;
  amount: number | null;
  newPot: number;
  opponentStack: number;
}

export interface CommunityCardsRevealedMessage {
  type: 'community_cards_revealed';
  gameId: string;
  phase: 'flop' | 'turn' | 'river';
  newCards: string[];
  allCommunityCards: string[];
  pot: number;
}

export interface ShowdownInfo {
  myHand: [string, string];
  opponentHand: [string, string];
  communityCards: string[];
  myBestHand: string;
  opponentBestHand: string;
}

export interface HandCompleteMessage {
  type: 'hand_complete';
  gameId: string;
  handNumber: number;
  winner: 'player1' | 'player2';
  winningHand: string;
  potAwarded: number;
  myStack: number;
  opponentStack: number;
  showdown: ShowdownInfo | null;
  reason: 'showdown' | 'opponent_fold' | 'timeout';
}

export interface GameCompleteMessage {
  type: 'game_complete';
  gameId: string;
  winner: 'player1' | 'player2';
  isMe: boolean;
  finalMyStack: number;
  finalOpponentStack: number;
  handsPlayed: number;
  payoutAmount: number;
  payoutSignature: string;
  houseFee: number;
  reason: 'opponent_eliminated' | 'disconnect' | 'agreement';
}

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
  serverTime: number;
}

export type ServerMessage =
  | AuthChallengeMessage
  | AuthSuccessMessage
  | AuthFailedMessage
  | QueueJoinedMessage
  | QueueLeftMessage
  | GameJoinedMessage
  | YourTurnMessage
  | ActionAcceptedMessage
  | OpponentActionMessage
  | CommunityCardsRevealedMessage
  | HandCompleteMessage
  | GameCompleteMessage
  | ErrorMessage
  | PongMessage;

// ============================================================
// Client → Server Messages
// ============================================================

export interface AuthenticateMessage {
  type: 'authenticate';
  walletAddress: string;
  signature: string;
  nonce: string;
}

/**
 * WSキュー参加メッセージ（レガシーフロー）。
 * メインのキュー参加フローは x402 HTTP（POST /api/v1/queue/join）を使用する。
 * このWSメッセージは、x402-fetchを使わない直接SOL送金パターンのフォールバック用。
 */
export interface JoinQueueMessage {
  type: 'join_queue';
  token: string;
  entryFeeSignature: string;
  entryFeeAmount: number;
}

export interface LeaveQueueMessage {
  type: 'leave_queue';
  token: string;
}

export interface PlayerActionMessage {
  type: 'player_action';
  token: string;
  gameId: string;
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  amount?: number;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export type ClientMessage =
  | AuthenticateMessage
  | JoinQueueMessage
  | LeaveQueueMessage
  | PlayerActionMessage
  | PingMessage;

// ============================================================
// Error Codes
// ============================================================

export type ErrorCode =
  | 'INVALID_ACTION'
  | 'NOT_YOUR_TURN'
  | 'GAME_NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'ALREADY_IN_QUEUE'
  | 'ENTRY_FEE_INVALID'
  | 'SERVER_ERROR'
  | 'RATE_LIMITED'
  | 'GAME_IN_PROGRESS';

// ============================================================
// Internal Types
// ============================================================

export interface AgentSession {
  ws: WsWebSocket;
  sessionId: string;
  walletAddress: string | null;
  nonce: string | null;
  nonceExpiresAt: number | null;
  token: string | null;
  tokenExpiresAt: number | null;
  authenticated: boolean;
  gameId: string | null;
  lastPingAt: number;
}

export type PlayerPosition = 'player1' | 'player2';

export type GamePhase = 'pre_flop' | 'flop' | 'turn' | 'river' | 'showdown' | 'finished';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
