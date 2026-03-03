import express from 'express';
import { PublicKey, SendTransactionError, TransactionExpiredBlockheightExceededError } from '@solana/web3.js';
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

  // x402は solana:devnet を未サポート（getNetworkIdがリクエスト処理時にthrowしサーバーがクラッシュする）。
  // devnet環境ではx402をスキップして無支払いキュー参加モードで動作させる。
  const solanaNetwork = process.env.SOLANA_NETWORK ?? 'solana:devnet';
  if (solanaNetwork.includes('devnet')) {
    console.log('[x402] Devnet detected — payment middleware disabled (x402 does not support solana:devnet)');
  } else try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { paymentMiddleware } = require('x402-express');

    // x402の受取先はオペレーターウォレットを指定する。
    // PDA（matchmakingQueue）は署名可能なウォレットではないため、x402の受取先には使えない。
    // オペレーターウォレットで支払いを受け取り、enterMatchmakingQueueでキューPDAへの
    // 送金はプログラムが処理する。
    const recipient = anchorClient.getOperatorPublicKey().toString();

    // Coinbase CDP facilitator設定（環境変数から読み込み）
    // @coinbase/x402 の package.json の types フィールドが壊れているため inline import 型は使わない
    type FacilitatorConfig = { url: string; createAuthHeaders?: unknown };
    let facilitatorConfig: FacilitatorConfig | undefined;
    const hasCdpKeys = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
    if (hasCdpKeys) {
      // APIキーが設定されている場合はCDPファシリテーターを使用
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createFacilitatorConfig } = require('@coinbase/x402');
        facilitatorConfig = createFacilitatorConfig({
          apiKeyId: process.env.CDP_API_KEY_ID,
          apiKeySecret: process.env.CDP_API_KEY_SECRET,
        });
        console.log('[x402] CDP facilitator configured');
      } catch (cdpErr) {
        // モジュール未インストールの場合は警告のみ
        const isModuleNotFound =
          cdpErr instanceof Error && cdpErr.message.includes('Cannot find module');
        if (isModuleNotFound) {
          console.warn('⚠️  @coinbase/x402 not installed but CDP keys are set. Run: npm install @coinbase/x402');
        } else {
          // APIキー設定ミスなど設定エラーは本番環境では致命的
          if (process.env.NODE_ENV === 'production') {
            throw new Error(
              `[x402] CRITICAL: CDP facilitator configuration failed: ${cdpErr instanceof Error ? cdpErr.message : String(cdpErr)}`,
            );
          }
          console.error('[x402] CDP facilitator configuration failed (using default):', cdpErr);
        }
      }
    } else {
      console.log('[x402] CDP_API_KEY_ID/CDP_API_KEY_SECRET not set, using default facilitator');
    }

    // M-x402-1: SignatureStore（リプレイ攻撃防止）について
    // x402-expressのpaymentMiddlewareは、signatureStoreオプション未指定時に
    // デフォルトでインメモリSignatureStoreを使用する。
    // これにより同一署名の再利用（リプレイ攻撃）は単一プロセス内で防止される。
    // 注意: サーバー再起動やマルチインスタンス構成ではインメモリストアがリセットされるため、
    // 本番環境ではRedis等の永続SignatureStoreへの切り替えを検討すること。
    router.use(
      paymentMiddleware(
        recipient,
        {
          '/api/v1/queue/join': {
            price: `${DEFAULT_ENTRY_FEE_SOL} SOL`,
            network: (process.env.SOLANA_NETWORK ?? 'solana:devnet') as 'solana:devnet' | 'solana:mainnet',
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
    if (solanaNetwork.includes('devnet')) {
      console.warn('⚠️  x402 payment disabled on devnet. Queue join is free for testing.');
    } else {
      console.warn('⚠️  x402 middleware not active. Run: npm install x402-express @coinbase/x402');
    }
  }

  // devnetではx402無しが正常動作なので production チェックをスキップする
  if (!middlewareApplied && !solanaNetwork.includes('devnet') && process.env.NODE_ENV === 'production') {
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

      // 既にオンチェーンキューに存在する場合は、再参加の冪等リクエストとして扱う。
      // サーバー再起動などでメモリキューとオンチェーンキューがズレるケースを吸収する。
      const maybeAnchorErr = err as {
        error?: { errorCode?: { code?: string } };
      } | null;
      const isAlreadyInQueue =
        maybeAnchorErr?.error?.errorCode?.code === 'AlreadyInQueue' ||
        (err instanceof Error && err.message.includes('Error Code: AlreadyInQueue'));
      if (isAlreadyInQueue) {
        console.warn(`[x402] ${walletAddress} already exists on-chain queue. Restoring server queue state.`);
        await onQueueJoined(walletAddress, entryFeeLamports);
        res.json({
          success: true,
          message: 'Already in queue on-chain; waiting state restored.',
          walletAddress,
        });
        return;
      }

      // C-x402-2: エラー種別を区別し、「送信後結果不明」エラーでは返金をスキップする。
      // SendTransactionError / TransactionExpiredBlockheightExceededError は
      // トランザクションがオンチェーンで成功している可能性があるため、
      // 返金すると二重返金（キュー登録済み＋SOL返金済み）になるリスクがある。
      const isAmbiguousError =
        err instanceof SendTransactionError ||
        err instanceof TransactionExpiredBlockheightExceededError;

      if (isAmbiguousError) {
        console.error(
          `[x402] AMBIGUOUS TX ERROR for ${walletAddress}: ` +
          'Transaction may have succeeded on-chain. Skipping refund to prevent double-refund. ' +
          'Manual investigation required.',
        );
        res.status(500).json({
          error: 'Queue join status unknown. Transaction may have succeeded. Please check your queue status.',
          details: err instanceof Error ? err.message : String(err),
        });
      } else {
        // AnchorError（プログラムエラー）等、明確に失敗した場合のみ返金を実行
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
    }
  });

  return { router, isPaymentEnabled: middlewareApplied };
}
