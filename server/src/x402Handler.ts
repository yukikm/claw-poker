import express from 'express';
import { PublicKey } from '@solana/web3.js';
import { AnchorClient } from './anchorClient';

const DEFAULT_ENTRY_FEE_SOL = 0.1;
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface X402RouterResult {
  router: express.Router;
  isPaymentEnabled: boolean;
}

/**
 * x402プロトコルを使用したキュー参加エンドポイントを提供するExpressルーター。
 *
 * フロー:
 * 1. クライアントが POST /api/v1/queue/join を送信
 * 2. x402ミドルウェアが 402 Payment Required を返す
 * 3. クライアント（x402-fetch）が自動的にSolana支払いTXを作成・送信
 * 4. x402ミドルウェアが支払いを検証してリクエストを続行
 * 5. ハンドラーがenterMatchmakingQueueを呼び出してキューに登録
 */
export function createX402Router(
  anchorClient: AnchorClient,
  onQueueJoined: (walletAddress: string, entryFeeLamports: bigint) => Promise<void>,
): X402RouterResult {
  const router = express.Router();

  // x402ミドルウェアを試みるが、パッケージ未インストール時はスキップ
  let middlewareApplied = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { paymentMiddleware } = require('x402-express') as {
      paymentMiddleware: (
        recipient: string,
        routes: Record<string, { price: string; network: string; config?: Record<string, string> }>,
        options?: { facilitator?: unknown },
      ) => express.RequestHandler;
    };

    // x402の受取先はオペレーターウォレットを指定する。
    // PDA（matchmakingQueue）は署名可能なウォレットではないため、x402の受取先には使えない。
    // オペレーターウォレットで支払いを受け取り、enterMatchmakingQueueでキューPDAへの
    // 送金はプログラムが処理する。
    const recipient = anchorClient.getOperatorPublicKey().toString();

    // Coinbase CDP facilitator設定（環境変数から読み込み）
    let facilitatorConfig: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createFacilitatorConfig } = require('@coinbase/x402') as {
        createFacilitatorConfig: (opts: { apiKeyId?: string; apiKeySecret?: string }) => unknown;
      };
      facilitatorConfig = createFacilitatorConfig({
        apiKeyId: process.env.CDP_API_KEY_ID,
        apiKeySecret: process.env.CDP_API_KEY_SECRET,
      });
    } catch {
      console.warn('⚠️  @coinbase/x402 not installed, using default facilitator');
    }

    router.use(
      paymentMiddleware(
        recipient,
        {
          '/api/v1/queue/join': {
            price: `${DEFAULT_ENTRY_FEE_SOL} SOL`,
            network: 'solana:devnet',
            config: { description: 'Claw Poker Entry Fee' },
          },
        },
        facilitatorConfig ? { facilitator: facilitatorConfig } : undefined,
      ),
    );
    middlewareApplied = true;
    console.log('[x402] Payment middleware applied, recipient:', recipient);
  } catch {
    console.warn('⚠️  x402-express not installed, /api/v1/queue/join will not require payment');
  }

  if (!middlewareApplied) {
    console.warn('⚠️  x402 middleware not active. Run: npm install x402-express @coinbase/x402');
  }

  if (!middlewareApplied && process.env.NODE_ENV === 'production') {
    throw new Error(
      'x402-express must be installed in production. Run: npm install x402-express @coinbase/x402',
    );
  }

  /**
   * POST /api/v1/queue/join
   * x402支払い検証後にキューへ登録する。
   * Body: { walletAddress: string }
   */
  router.post('/api/v1/queue/join', async (req: express.Request, res: express.Response) => {
    const { walletAddress } = req.body as {
      walletAddress?: string;
    };

    if (!walletAddress) {
      res.status(400).json({ error: 'walletAddress is required' });
      return;
    }

    let playerPubkey: PublicKey;
    try {
      playerPubkey = new PublicKey(walletAddress);
    } catch {
      res.status(400).json({ error: 'Invalid walletAddress' });
      return;
    }

    // x402ミドルウェアが検証した支払い額と一致する固定値を使用
    // クライアントからのentryFeeSolは受け付けず、サーバー設定値を優先する
    const entryFeeLamports = BigInt(Math.floor(DEFAULT_ENTRY_FEE_SOL * LAMPORTS_PER_SOL));

    try {
      await anchorClient.enterMatchmakingQueue(playerPubkey, entryFeeLamports);

      // C-4: WS経由でqueue_joinedを送信し、マッチングを起動する
      await onQueueJoined(walletAddress, entryFeeLamports);

      res.json({ success: true, message: 'Queue joined successfully', walletAddress });
    } catch (err) {
      console.error('[x402] enterMatchmakingQueue failed:', err);

      // C-2: キュー登録失敗時、x402で受け取ったSOLをプレイヤーに返金する
      try {
        await anchorClient.refundEntryFee(playerPubkey, entryFeeLamports);
        console.log(`[x402] Entry fee refunded to ${walletAddress}: ${entryFeeLamports} lamports`);
      } catch (refundErr) {
        console.error('[x402] CRITICAL: Refund failed for', walletAddress, ':', refundErr);
      }

      res.status(500).json({
        error: 'Failed to join queue. Entry fee refund attempted.',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { router, isPaymentEnabled: middlewareApplied };
}
