import WebSocket from 'ws';
import { randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import { decode as decodeBase58 } from 'bs58';
import {
  AgentSession,
  AuthChallengeMessage,
  AuthSuccessMessage,
  AuthFailedMessage,
  ErrorMessage,
  TeeAuthChallengeMessage,
  ServerMessage,
  ClientMessage,
  ActionType,
} from './types';

const AUTH_NONCE_EXPIRY_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const SIGN_PREFIX = 'Claw Poker Authentication\nNonce: ';

export class AgentHandler {
  private sessions = new Map<string, AgentSession>();
  private walletToSession = new Map<string, string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingGameIds = new Map<string, string>(); // walletAddress → gameId（切断前）

  private onJoinQueue: ((walletAddress: string, entryFeeSignature: string, entryFeeAmount: number) => void) | null = null;
  private onLeaveQueue: ((walletAddress: string) => void) | null = null;
  private onAction: ((walletAddress: string, gameId: string, action: ActionType, amount?: number) => void) | null = null;
  private onReconnect: ((walletAddress: string, gameId: string) => void) | null = null;
  /** プレイヤーがTEEチャレンジに署名して返答した際のコールバック */
  private onTeeAuthResponse: ((walletAddress: string, challenge: string, signature: string) => void) | null = null;

  constructor() {
    this.startHeartbeatCheck();
  }

  setOnJoinQueue(handler: (walletAddress: string, entryFeeSignature: string, entryFeeAmount: number) => void): void {
    this.onJoinQueue = handler;
  }

  setOnLeaveQueue(handler: (walletAddress: string) => void): void {
    this.onLeaveQueue = handler;
  }

  setOnAction(handler: (walletAddress: string, gameId: string, action: ActionType, amount?: number) => void): void {
    this.onAction = handler;
  }

  setOnReconnect(handler: (walletAddress: string, gameId: string) => void): void {
    this.onReconnect = handler;
  }

  setOnTeeAuthResponse(handler: (walletAddress: string, challenge: string, signature: string) => void): void {
    this.onTeeAuthResponse = handler;
  }

  /** プレイヤーにTEEチャレンジを送信する。プレイヤーは自分の秘密鍵で署名して tee_auth_response で返す */
  sendTeeAuthChallenge(walletAddress: string, challenge: string): void {
    const msg: TeeAuthChallengeMessage = {
      type: 'tee_auth_challenge',
      challenge,
      expiresIn: 60,
    };
    this.sendToAgent(walletAddress, msg);
  }

  handleConnection(ws: WebSocket, sessionId: string): void {
    const nonce = randomBytes(32).toString('hex');
    const session: AgentSession = {
      ws,
      sessionId,
      walletAddress: null,
      agentName: null,
      nonce,
      nonceExpiresAt: Date.now() + AUTH_NONCE_EXPIRY_SECONDS * 1000,
      token: null,
      tokenExpiresAt: null,
      authenticated: false,
      gameId: null,
      lastPingAt: Date.now(),
    };

    this.sessions.set(sessionId, session);

    const challenge: AuthChallengeMessage = {
      type: 'auth_challenge',
      nonce,
      expiresIn: AUTH_NONCE_EXPIRY_SECONDS,
    };
    this.sendMessage(ws, challenge);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        this.routeMessage(sessionId, message);
      } catch {
        this.sendError(ws, 'SERVER_ERROR', 'Invalid JSON message');
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(sessionId);
    });

    ws.on('error', () => {
      this.handleDisconnect(sessionId);
    });
  }

  private routeMessage(sessionId: string, message: ClientMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (message.type) {
      case 'authenticate':
        this.handleAuthenticate(sessionId, message.walletAddress, message.signature, message.nonce, message.agentName);
        break;
      case 'join_queue':
        this.handleJoinQueue(sessionId, message.token, message.entryFeeSignature, message.entryFeeAmount);
        break;
      case 'leave_queue':
        this.handleLeaveQueue(sessionId, message.token);
        break;
      case 'player_action':
        this.handleAction(sessionId, message.token, message.gameId, message.action, message.amount);
        break;
      case 'ping':
        this.handlePing(sessionId, message.timestamp);
        break;
      case 'tee_auth_response':
        this.handleTeeAuthResponse(sessionId, message.challenge, message.signature);
        break;
    }
  }

  private handleTeeAuthResponse(sessionId: string, challenge: string, signature: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.authenticated || !session.walletAddress) return;
    this.onTeeAuthResponse?.(session.walletAddress, challenge, signature);
  }

  handleAuthenticate(sessionId: string, walletAddress: string, signature: string, nonce: string, agentName?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 既に認証済みの場合は再認証を拒否（null-nonceバイパス防止）
    if (session.authenticated) {
      this.sendError(session.ws, 'INVALID_TOKEN', 'Already authenticated');
      return;
    }

    // Check nonce match (session.nonce が null の場合は必ず不一致になる)
    if (session.nonce === null || session.nonce !== nonce) {
      const failed: AuthFailedMessage = { type: 'auth_failed', reason: 'nonce_expired' };
      this.sendMessage(session.ws, failed);
      return;
    }

    // Check nonce expiry
    if (session.nonceExpiresAt !== null && Date.now() > session.nonceExpiresAt) {
      const failed: AuthFailedMessage = { type: 'auth_failed', reason: 'nonce_expired' };
      this.sendMessage(session.ws, failed);

      // Issue new nonce
      const newNonce = randomBytes(32).toString('hex');
      session.nonce = newNonce;
      session.nonceExpiresAt = Date.now() + AUTH_NONCE_EXPIRY_SECONDS * 1000;
      const challenge: AuthChallengeMessage = {
        type: 'auth_challenge',
        nonce: newNonce,
        expiresIn: AUTH_NONCE_EXPIRY_SECONDS,
      };
      this.sendMessage(session.ws, challenge);
      return;
    }

    // Verify Ed25519 signature
    const signMessage = SIGN_PREFIX + nonce;
    const messageBytes = new TextEncoder().encode(signMessage);

    let publicKeyBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
      publicKeyBytes = decodeBase58(walletAddress);
      signatureBytes = decodeBase58(signature);
    } catch {
      const failed: AuthFailedMessage = { type: 'auth_failed', reason: 'invalid_signature' };
      this.sendMessage(session.ws, failed);
      return;
    }

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!isValid) {
      const failed: AuthFailedMessage = { type: 'auth_failed', reason: 'invalid_signature' };
      this.sendMessage(session.ws, failed);
      return;
    }

    // Generate session token (simple random token for MVP; production should use JWT)
    const token = randomBytes(48).toString('base64url');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    session.walletAddress = walletAddress;
    session.agentName = agentName && agentName.trim() ? agentName.trim().slice(0, 32) : null;
    session.authenticated = true;
    session.token = token;
    session.tokenExpiresAt = expiresAt;
    session.nonce = null;
    session.nonceExpiresAt = null;

    this.walletToSession.set(walletAddress, sessionId);

    const success: AuthSuccessMessage = {
      type: 'auth_success',
      token,
      expiresAt,
    };
    this.sendMessage(session.ws, success);

    // 再接続チェック: 切断前にゲーム中だった場合はgameIdを復元してコールバックを呼ぶ
    const pendingGameId = this.pendingGameIds.get(walletAddress);
    if (pendingGameId) {
      this.pendingGameIds.delete(walletAddress);
      session.gameId = pendingGameId;
      if (this.onReconnect) {
        this.onReconnect(walletAddress, pendingGameId);
      }
    }
  }

  private handleJoinQueue(sessionId: string, token: string, entryFeeSignature: string, entryFeeAmount: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!this.validateToken(session, token)) return;

    // 既にゲーム中の場合はキュー参加を拒否
    if (session.gameId !== null) {
      this.sendError(session.ws, 'GAME_IN_PROGRESS', 'You are already in an active game');
      return;
    }

    if (this.onJoinQueue && session.walletAddress) {
      this.onJoinQueue(session.walletAddress, entryFeeSignature, entryFeeAmount);
    }
  }

  private handleLeaveQueue(sessionId: string, token: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!this.validateToken(session, token)) return;

    if (this.onLeaveQueue && session.walletAddress) {
      this.onLeaveQueue(session.walletAddress);
    }
  }

  private static readonly VALID_ACTIONS: ReadonlySet<string> = new Set([
    'fold', 'check', 'call', 'bet', 'raise', 'all_in',
  ]);

  private handleAction(sessionId: string, token: string, gameId: string, action: ActionType, amount?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!this.validateToken(session, token)) return;

    // ランタイムでactionフィールドを検証（JSON.parseは型を保証しない）
    if (!action || !AgentHandler.VALID_ACTIONS.has(action)) {
      this.sendError(session.ws, 'INVALID_ACTION', `Invalid or missing action: '${String(action)}'`);
      return;
    }

    if (this.onAction && session.walletAddress) {
      this.onAction(session.walletAddress, gameId, action, amount);
    }
  }

  private handlePing(sessionId: string, timestamp: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastPingAt = Date.now();
    this.sendMessage(session.ws, {
      type: 'pong',
      timestamp,
      serverTime: Date.now(),
    });
  }

  private handleDisconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.walletAddress) {
      // ゲーム中の切断: gameIdを保存して再接続時に状態復元できるようにする
      if (session.gameId) {
        this.pendingGameIds.set(session.walletAddress, session.gameId);
      }
      this.walletToSession.delete(session.walletAddress);
    }
    this.sessions.delete(sessionId);
  }

  private validateToken(session: AgentSession, token: string): boolean {
    if (!session.authenticated || session.token !== token) {
      this.sendError(session.ws, 'INVALID_TOKEN', 'Invalid or expired session token');
      return false;
    }
    if (session.tokenExpiresAt !== null && Date.now() > session.tokenExpiresAt) {
      this.sendError(session.ws, 'INVALID_TOKEN', 'Invalid or expired session token');
      return false;
    }
    return true;
  }

  sendToAgent(walletAddress: string, message: ServerMessage): void {
    const sessionId = this.walletToSession.get(walletAddress);
    if (!sessionId) {
      console.warn(`[AgentHandler] sendToAgent: no session for ${walletAddress.slice(0, 8)}... (type=${message.type})`);
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[AgentHandler] sendToAgent: session ${sessionId} not found for ${walletAddress.slice(0, 8)}... (type=${message.type})`);
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[AgentHandler] sendToAgent: WS not open for ${walletAddress.slice(0, 8)}... (state=${session.ws.readyState}, type=${message.type})`);
    }
    this.sendMessage(session.ws, message);
  }

  setAgentGameId(walletAddress: string, gameId: string | null): void {
    const sessionId = this.walletToSession.get(walletAddress);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.gameId = gameId;
    }
  }

  isAgentConnected(walletAddress: string): boolean {
    const sessionId = this.walletToSession.get(walletAddress);
    if (!sessionId) return false;

    const session = this.sessions.get(sessionId);
    return session !== undefined && session.ws.readyState === WebSocket.OPEN;
  }

  getAgentName(walletAddress: string): string | null {
    const sessionId = this.walletToSession.get(walletAddress);
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    return session?.agentName ?? null;
  }

  getConnectedAgentCount(): number {
    return this.sessions.size;
  }

  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, code: string, message: string, details?: Record<string, unknown>): void {
    const error: ErrorMessage = {
      type: 'error',
      code: code as ErrorMessage['code'],
      message,
      details,
    };
    this.sendMessage(ws, error);
  }

  private startHeartbeatCheck(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions) {
        if (now - session.lastPingAt > HEARTBEAT_TIMEOUT_MS) {
          console.log(`[HeartbeatCheck] Session ${sessionId} timed out, closing`);
          session.ws.close();
          this.handleDisconnect(sessionId);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [, session] of this.sessions) {
      session.ws.close();
    }
    this.sessions.clear();
    this.walletToSession.clear();
    this.pendingGameIds.clear();
  }
}
