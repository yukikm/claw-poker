import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnectionState } from '../connectionState';

// x402-fetchのインポート（インストール済みの場合）
type FetchWithPayment = (url: string, options?: RequestInit) => Promise<Response>;

async function createX402Fetch(keypair: Keypair, rpcUrl: string): Promise<FetchWithPayment> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { wrapFetchWithPayment } = require('x402-fetch') as {
      wrapFetchWithPayment: (
        fetchFn: typeof fetch,
        wallet: unknown,
        opts?: { maxValue?: number },
      ) => FetchWithPayment;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSolanaKeypairWallet } = require('x402-fetch/solana') as {
      createSolanaKeypairWallet: (keypair: Keypair, rpcUrl: string) => unknown;
    };

    const wallet = createSolanaKeypairWallet(keypair, rpcUrl);
    return wrapFetchWithPayment(fetch, wallet, { maxValue: 1.0 });
  } catch {
    // x402-fetchが未インストールの場合はネイティブfetchにフォールバック
    console.warn('⚠️  x402-fetch not installed. Falling back to plain fetch (payment will be rejected by server).');
    return (url: string, options?: RequestInit) => fetch(url, options);
  }
}

export function registerPokerJoinQueue(api: { registerTool: (tool: unknown) => void }): void {
  api.registerTool({
    name: 'poker_join_queue',
    description:
      'マッチメイキングキューに参加する。x402プロトコルで参加費（SOL）を自動支払いしてHTTP経由でキューに登録する。poker_connectで接続済みであること。',
    parameters: {
      type: 'object',
      properties: {
        entry_fee_sol: {
          type: 'number',
          description: '参加費（SOL）。デフォルト: 0.1 SOL（最小: 0.001 SOL、最大: 1 SOL）',
        },
      },
      required: [],
    },
    execute: async (params: { entry_fee_sol?: number }) => {
      const state = getConnectionState();

      if (!state.connected || !state.authenticated || !state.ws) {
        return { success: false, message: 'NOT_CONNECTED: poker_connectを先に実行してください' };
      }

      if (state.gameId) {
        return { success: false, message: 'GAME_IN_PROGRESS: 既にゲーム中です' };
      }

      const privateKeyBase58 = process.env.CLAW_POKER_WALLET_PRIVATE_KEY;
      if (!privateKeyBase58) {
        return {
          success: false,
          message: 'WALLET_NOT_CONFIGURED: 環境変数 CLAW_POKER_WALLET_PRIVATE_KEY が未設定です',
        };
      }

      let keypair: Keypair;
      try {
        keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
      } catch {
        return { success: false, message: 'WALLET_NOT_CONFIGURED: 秘密鍵のデコードに失敗しました' };
      }

      const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
      const serverHttpUrl = process.env.CLAW_POKER_SERVER_HTTP_URL ?? 'http://localhost:3001';

      // x402-fetchでHTTPリクエストを送信（402レスポンス時に自動でSolana支払いTXを作成・送信）
      let response: Response;
      try {
        const fetchWithPayment = await createX402Fetch(keypair, rpcUrl);

        // POST /api/v1/queue/join → 402 → 自動支払い → リトライ → 200 OK
        response = await fetchWithPayment(`${serverHttpUrl}/api/v1/queue/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: keypair.publicKey.toBase58(),
          }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `HTTP_ERROR: キュー参加リクエストに失敗しました: ${msg}`,
        };
      }

      if (!response.ok) {
        let errorDetails = '';
        try {
          const body = await response.json() as { error?: string };
          errorDetails = body.error ?? '';
        } catch {
          /* ignore */
        }
        return {
          success: false,
          message: `QUEUE_JOIN_FAILED: サーバーがエラーを返しました (${response.status}): ${errorDetails}`,
        };
      }

      // キュー登録成功 → WebSocketでgame_joinedイベントを待機
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: true,
            status: 'queued',
            entryFeeSol: 0.1,
            message: `マッチメイキングキューに参加しました。参加費 0.1 SOL を支払いました。対戦相手のマッチングをお待ちください。`,
          });
        }, 5_000);

        const messageHandler = (data: Buffer | string): void => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'queue_joined') {
              clearTimeout(timeout);
              state.ws?.removeListener('message', messageHandler);
              resolve({
                success: true,
                status: 'queued',
                entryFeeSol: 0.1,
                message: `マッチメイキングキューに参加しました（位置: ${message.position}）。参加費 0.1 SOL を支払いました。`,
              });
            } else if (message.type === 'error') {
              clearTimeout(timeout);
              state.ws?.removeListener('message', messageHandler);
              resolve({ success: false, message: `${message.code}: ${message.message}` });
            }
          } catch {
            /* ignore */
          }
        };

        state.ws?.on('message', messageHandler);
      });
    },
  });
}
