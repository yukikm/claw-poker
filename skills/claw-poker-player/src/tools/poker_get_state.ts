import { getConnectionState } from '../connectionState';
import type { OpenClawPluginApi } from '../types';

interface PendingEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface GameStateInfo {
  gameId: string;
  status: 'waiting' | 'in_progress' | 'completed';
  position: string;
  phase: string;
  holeCards: [string, string];
  communityCards: string[];
  myStack: number;
  opponentStack: number;
  pot: number;
  currentBet: number;
  isMyTurn: boolean;
  validActions: string[];
  minBet: number;
  minRaise: number;
  timeoutSeconds: number;
  handNumber: number;
  blinds: { small: number; big: number };
  dealerPosition: string;
}

interface GetStateResult {
  success: boolean;
  connected: boolean;
  gameState: GameStateInfo | null;
  pendingEvents: PendingEvent[];
  message: string;
}

export function registerPokerGetState(api: OpenClawPluginApi): void {
  api.registerTool({
    name: 'poker_get_state',
    description:
      '現在のゲーム状態を取得する。自分のホールカード、コミュニティカード、チップスタック、ポット額を返す。サーバーからのPushイベントも取得できる。',
    parameters: {
      type: 'object',
      properties: {
        gameId: {
          type: 'string',
          description: '特定のゲームIDの状態を取得。省略時はアクティブなゲームの状態',
        },
      },
      required: [],
    },
    execute: async (params: Record<string, unknown>): Promise<GetStateResult> => {
      const _gameId = params['gameId'] as string | undefined; // 将来的な用途のために受け取るが現在は未使用
      const state = getConnectionState();

      if (!state.connected || !state.ws) {
        return {
          success: false,
          connected: false,
          gameState: null,
          pendingEvents: [],
          message: 'NOT_CONNECTED: poker_connectを先に実行してください',
        };
      }

      // Drain pending events
      const events = [...state.pendingEvents];
      state.pendingEvents = [];

      // Build game state from latest your_turn message
      let gameState: GameStateInfo | null = null;

      if (state.currentGameState && state.gameId) {
        const gs = state.currentGameState as Record<string, unknown>;
        gameState = {
          gameId: state.gameId,
          status: 'in_progress',
          position: (state.position as string) ?? 'player1',
          phase: (gs.phase as string) ?? 'pre_flop',
          holeCards: (gs.holeCards as [string, string]) ?? ['??', '??'],
          communityCards: (gs.communityCards as string[]) ?? [],
          myStack: (gs.myStack as number) ?? 0,
          opponentStack: (gs.opponentStack as number) ?? 0,
          pot: (gs.pot as number) ?? 0,
          currentBet: (gs.currentBet as number) ?? 0,
          isMyTurn: gs.type === 'your_turn',
          validActions: (gs.validActions as string[]) ?? [],
          minBet: (gs.minBet as number) ?? 0,
          minRaise: (gs.minRaise as number) ?? 0,
          timeoutSeconds: (gs.timeoutSeconds as number) ?? 30,
          handNumber: (gs.handNumber as number) ?? 1,
          blinds: (gs.blinds as { small: number; big: number }) ?? { small: 10, big: 20 },
          dealerPosition: (gs.dealerPosition as string) ?? 'player1',
        };
      } else if (state.gameId) {
        // Game exists but no your_turn data yet (waiting for first hand)
        gameState = {
          gameId: state.gameId,
          status: 'waiting',
          position: (state.position as string) ?? 'player1',
          phase: 'pre_flop',
          holeCards: ['??', '??'],
          communityCards: [],
          myStack: 1000,
          opponentStack: 1000,
          pot: 0,
          currentBet: 0,
          isMyTurn: false,
          validActions: [],
          minBet: 0,
          minRaise: 0,
          timeoutSeconds: 30,
          handNumber: 0,
          blinds: { small: 10, big: 20 },
          dealerPosition: 'player1',
        };
      }

      const eventSummary = events.length > 0
        ? `${events.length}件の新しいイベントがあります`
        : 'イベントはありません';

      const stateSummary = gameState
        ? `ゲーム${gameState.gameId}が${gameState.status}中`
        : 'アクティブなゲームはありません';

      return {
        success: true,
        connected: state.connected,
        gameState,
        pendingEvents: events,
        message: `${stateSummary}。${eventSummary}。`,
      };
    },
  });
}
