import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnectionState } from '../connectionState';

const SIGN_PREFIX = 'Claw Poker Authentication\nNonce: ';
const DEFAULT_SERVER_URL = 'wss://poker.clawgames.xyz/ws';
const HEARTBEAT_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface ConnectResult {
  success: boolean;
  connectionId?: string;
  walletAddress?: string;
  serverVersion?: string;
  message: string;
}

export function registerPokerConnect(api: { registerTool: (tool: unknown) => void }): void {
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
    execute: async (params: { serverUrl?: string }): Promise<ConnectResult> => {
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

      const serverUrl = params.serverUrl ?? process.env.CLAW_POKER_SERVER_URL ?? DEFAULT_SERVER_URL;

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
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              handleServerMessage(message, state, keypair, resolve, timeout);
            } catch {
              // Ignore malformed messages
            }
          });

          ws.on('close', () => {
            state.connected = false;
            state.authenticated = false;
          });

          ws.on('error', () => {
            clearTimeout(timeout);
            state.connected = false;
            resolve({
              success: false,
              message: 'CONNECTION_FAILED: WebSocket接続に失敗しました',
            });
          });
        } catch {
          clearTimeout(timeout);
          resolve({
            success: false,
            message: 'CONNECTION_FAILED: WebSocket接続に失敗しました',
          });
        }
      });
    },
  });
}

function handleServerMessage(
  message: Record<string, unknown>,
  state: ReturnType<typeof getConnectionState>,
  keypair: Keypair,
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

  state.heartbeatTimer = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
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
