import { getConnectionState } from '../connectionState';
import type { OpenClawPluginApi } from '../types';

type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';

interface ActionResult {
  success: boolean;
  action?: string;
  amount?: number | null;
  message: string;
}

const VALID_ACTIONS: ActionType[] = ['fold', 'check', 'call', 'bet', 'raise', 'all_in'];
const SAFETY_TIMEOUT_MS = 28_000; // 28 seconds (2 seconds safety margin from 30s limit)

export function registerPokerAction(api: OpenClawPluginApi): void {
  api.registerTool({
    name: 'poker_action',
    description:
      'ポーカーのアクションを実行する。your_turnイベントを受け取った後に呼び出す。fold: 降りる / check: チェック / call: コール / bet: ベット / raise: レイズ / all_in: 全賭け。bet/raiseの場合はamountを指定する。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['fold', 'check', 'call', 'bet', 'raise', 'all_in'],
          description:
            'fold: 降りる / check: チェック（ベットなし時） / call: コール / bet: ベット（金額指定） / raise: レイズ（金額指定） / all_in: 全賭け',
        },
        amount: {
          type: 'number',
          description: 'bet/raiseの場合の金額（チップ単位）',
        },
      },
      required: ['action'],
    },
    execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
      const action = params['action'] as ActionType;
      const amount = params['amount'] as number | undefined;
      const state = getConnectionState();

      if (!state.connected || !state.authenticated || !state.ws) {
        return {
          success: false,
          message: 'NOT_CONNECTED: poker_connectを先に実行してください',
        };
      }

      if (!state.gameId) {
        return {
          success: false,
          message: 'GAME_NOT_FOUND: アクティブなゲームがありません',
        };
      }

      if (!VALID_ACTIONS.includes(action)) {
        return {
          success: false,
          message: `INVALID_ACTION: 無効なアクションです。有効なアクション: ${VALID_ACTIONS.join(', ')}`,
        };
      }

      // Validate amount for bet/raise
      if ((action === 'bet' || action === 'raise') && amount === undefined) {
        return {
          success: false,
          message: `INVALID_AMOUNT: ${action}にはamount（金額）の指定が必要です`,
        };
      }

      return new Promise<ActionResult>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            message: 'TIMEOUT: アクションのレスポンスがタイムアウトしました',
          });
        }, SAFETY_TIMEOUT_MS);

        const messageHandler = (data: Buffer | string): void => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'action_accepted' && message.gameId === state.gameId) {
              clearTimeout(timeout);
              state.ws?.removeListener('message', messageHandler);
              resolve({
                success: true,
                action: message.action,
                amount: message.amount ?? null,
                message: `${message.action}を送信しました${message.amount ? `（${message.amount}チップ）` : ''}`,
              });
            } else if (message.type === 'error') {
              clearTimeout(timeout);
              state.ws?.removeListener('message', messageHandler);
              resolve({
                success: false,
                message: `${message.code}: ${message.message}`,
              });
            }
          } catch {
            // Ignore parse errors
          }
        };

        state.ws?.on('message', messageHandler);

        const payload: Record<string, unknown> = {
          type: 'player_action',
          token: state.token,
          gameId: state.gameId,
          action,
        };

        if (amount !== undefined) {
          payload.amount = amount;
        }

        state.ws?.send(JSON.stringify(payload));
      });
    },
  });
}
