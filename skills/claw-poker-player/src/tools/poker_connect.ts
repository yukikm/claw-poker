import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnectionState } from '../connectionState';
import type { OpenClawPluginApi } from '../types';

const SIGN_PREFIX = 'Claw Poker Authentication\nNonce: ';
const DEFAULT_SERVER_URL = 'wss://poker.clawgames.xyz/ws';
const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;

interface ConnectResult {
  success: boolean;
  connectionId?: string;
  walletAddress?: string;
  serverVersion?: string;
  message: string;
}

function connectToServer(
  state: ReturnType<typeof getConnectionState>,
  keypair: Keypair,
  serverUrl: string,
  isReconnect?: boolean,
): Promise<ConnectResult> {
  // Close existing connection if any
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }

  return new Promise<ConnectResult>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        success: false,
        message: 'SERVER_UNAVAILABLE: 接続がタイムアウトしました',
      });
    }, 10_000);

    try {
      const ws = new WebSocket(serverUrl);
      state.ws = ws;

      ws.on('open', () => {
        state.connected = true;
        if (isReconnect) {
          console.log('[poker_connect] Reconnected to server');
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleServerMessage(message, state, keypair, serverUrl, resolve, timeout);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        state.connected = false;
        state.authenticated = false;
        // ゲーム中または認証済みの場合、再接続を試みる
        if (state.serverUrl && state.keypair && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect(state);
        }
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        state.connected = false;
        if (!isReconnect) {
          resolve({
            success: false,
            message: 'CONNECTION_FAILED: WebSocket接続に失敗しました',
          });
        }
      });
    } catch {
      clearTimeout(timeout);
      if (!isReconnect) {
        resolve({
          success: false,
          message: 'CONNECTION_FAILED: WebSocket接続に失敗しました',
        });
      }
    }
  });
}

function scheduleReconnect(state: ReturnType<typeof getConnectionState>): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }
  const delay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, state.reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  const jitter = Math.random() * 500;
  console.log(`[poker_connect] Reconnecting in ${Math.round(delay + jitter)}ms (attempt ${state.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectAttempts += 1;
    state.reconnectTimer = null;
    if (state.serverUrl && state.keypair) {
      connectToServer(state, state.keypair, state.serverUrl, true);
    }
  }, delay + jitter);
}

export function registerPokerConnect(api: OpenClawPluginApi): void {
  api.registerTool({
    name: 'poker_connect',
    description:
      'Claw Pokerゲームサーバーに接続して認証する。ゲームに参加する前に必ず実行する。',
    parameters: {
      type: 'object',
      properties: {
        serverUrl: {
          type: 'string',
          description: `WebSocketエンドポイント。デフォルト: ${DEFAULT_SERVER_URL}`,
        },
      },
      required: [],
    },
    execute: async (params: Record<string, unknown>): Promise<ConnectResult> => {
      const serverUrl = params['serverUrl'] as string | undefined;
      const state = getConnectionState();

      // Check wallet key
      const privateKeyBase58 = process.env.CLAW_POKER_WALLET_PRIVATE_KEY;
      if (!privateKeyBase58) {
        return {
          success: false,
          message: 'WALLET_NOT_CONFIGURED: 環境変数 CLAW_POKER_WALLET_PRIVATE_KEY が未設定です',
        };
      }

      let keypair: Keypair;
      try {
        const secretKey = bs58.decode(privateKeyBase58);
        keypair = Keypair.fromSecretKey(secretKey);
      } catch {
        return {
          success: false,
          message: 'WALLET_NOT_CONFIGURED: 秘密鍵のデコードに失敗しました',
        };
      }

      const resolvedServerUrl = serverUrl ?? process.env.CLAW_POKER_SERVER_URL ?? DEFAULT_SERVER_URL;

      return connectToServer(state, keypair, resolvedServerUrl);
    },
  });
}

function handleServerMessage(
  message: Record<string, unknown>,
  state: ReturnType<typeof getConnectionState>,
  keypair: Keypair,
  serverUrl: string,
  resolve: (result: ConnectResult) => void,
  timeout: ReturnType<typeof setTimeout>,
): void {
  switch (message.type) {
    case 'auth_challenge': {
      const nonce = message.nonce as string;
      const signMessage = SIGN_PREFIX + nonce;
      const messageBytes = new TextEncoder().encode(signMessage);
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      const signatureBase58 = bs58.encode(Buffer.from(signature));

      state.ws?.send(
        JSON.stringify({
          type: 'authenticate',
          walletAddress: keypair.publicKey.toBase58(),
          signature: signatureBase58,
          nonce,
        }),
      );
      break;
    }

    case 'auth_success': {
      clearTimeout(timeout);
      state.authenticated = true;
      state.token = message.token as string;
      state.walletAddress = keypair.publicKey.toBase58();
      state.reconnectAttempts = 0;
      state.serverUrl = serverUrl;
      state.keypair = keypair;

      // Start heartbeat
      startHeartbeat(state);

      // Register event listener for push messages
      setupEventListener(state);

      resolve({
        success: true,
        connectionId: Math.random().toString(36).slice(2),
        walletAddress: keypair.publicKey.toBase58(),
        serverVersion: '1.0.0',
        message: 'ゲームサーバーに接続し、認証が完了しました',
      });
      break;
    }

    case 'auth_failed': {
      clearTimeout(timeout);
      state.authenticated = false;
      resolve({
        success: false,
        message: `AUTH_FAILED: 認証に失敗しました (${message.reason})`,
      });
      break;
    }
  }
}

function startHeartbeat(state: ReturnType<typeof getConnectionState>): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }

  let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // pong受信ハンドラ（重複登録を避けるため一度だけ設定）
  const pongHandler = (data: Buffer | string): void => {
    try {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'pong') {
        if (pongTimeoutTimer) {
          clearTimeout(pongTimeoutTimer);
          pongTimeoutTimer = null;
        }
      }
    } catch { /* ignore */ }
  };
  state.ws?.on('message', pongHandler);

  state.heartbeatTimer = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      // PONG_TIMEOUT_MS以内にpongが返らなければ接続を切断して再接続
      pongTimeoutTimer = setTimeout(() => {
        console.warn('[poker_connect] Pong timeout, closing connection for reconnect');
        state.ws?.close();
      }, PONG_TIMEOUT_MS);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function setupEventListener(state: ReturnType<typeof getConnectionState>): void {
  if (!state.ws) return;

  // Remove previous listener if exists, then add new one
  state.ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      // Buffer events that the LLM agent should see via poker_get_state
      const pushEventTypes = [
        'game_joined',
        'your_turn',
        'opponent_action',
        'community_cards_revealed',
        'hand_complete',
        'game_complete',
        'action_accepted',
        'error',
      ];

      if (pushEventTypes.includes(message.type as string)) {
        state.pendingEvents.push({
          type: message.type as string,
          data: message,
          timestamp: Date.now(),
        });

        // Update game state from relevant messages
        if (message.type === 'game_joined') {
          state.gameId = message.gameId as string;
          state.position = message.position as string;
        }

        if (message.type === 'your_turn') {
          state.currentGameState = message;
        }

        if (message.type === 'game_complete') {
          state.gameId = null;
          state.currentGameState = null;
        }
      }
    } catch {
      // Ignore parse errors
    }
  });
}
