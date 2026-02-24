import WebSocket from 'ws';
import { Keypair } from '@solana/web3.js';

interface PendingEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface ConnectionState {
  ws: WebSocket | null;
  connected: boolean;
  authenticated: boolean;
  token: string | null;
  walletAddress: string | null;
  gameId: string | null;
  position: string | null;
  currentGameState: Record<string, unknown> | null;
  pendingEvents: PendingEvent[];
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  serverUrl: string | null;
  keypair: Keypair | null;
}

// Singleton connection state shared across all tools
let connectionState: ConnectionState | null = null;

export function getConnectionState(): ConnectionState {
  if (!connectionState) {
    connectionState = {
      ws: null,
      connected: false,
      authenticated: false,
      token: null,
      walletAddress: null,
      gameId: null,
      position: null,
      currentGameState: null,
      pendingEvents: [],
      heartbeatTimer: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      serverUrl: null,
      keypair: null,
    };
  }
  return connectionState;
}

export function resetConnectionState(): void {
  if (connectionState) {
    if (connectionState.heartbeatTimer) {
      clearInterval(connectionState.heartbeatTimer);
    }
    if (connectionState.ws && connectionState.ws.readyState === WebSocket.OPEN) {
      connectionState.ws.close();
    }
  }
  connectionState = null;
}
