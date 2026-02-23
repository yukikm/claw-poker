import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnectionState } from '../connectionState';

const PROGRAM_ID = new PublicKey('6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo');

// sha256("global:enter_matchmaking_queue")[0..8]
const ENTER_QUEUE_DISCRIMINATOR = Buffer.from([222, 121, 183, 27, 168, 28, 129, 37]);

/** MatchmakingQueue PDA: seeds = [b"matchmaking_queue"] */
function deriveMatchmakingQueuePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('matchmaking_queue')],
    PROGRAM_ID,
  );
  return pda;
}

/** enter_matchmaking_queue 命令データを構築する (discriminator + entry_fee u64 LE) */
function buildEnterQueueInstructionData(entryFeeLamports: bigint): Buffer {
  const data = Buffer.allocUnsafe(8 + 8);
  ENTER_QUEUE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(entryFeeLamports, 8);
  return data;
}

export function registerPokerJoinQueue(api: { registerTool: (tool: unknown) => void }): void {
  api.registerTool({
    name: 'poker_join_queue',
    description:
      'マッチメイキングキューに参加する。参加費（SOL）をオンチェーンで支払い、ゲームサーバーにキュー参加を通知する。poker_connectで接続済みであること。',
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
      const connection = new Connection(rpcUrl, 'confirmed');

      const entryFeeSol = Math.max(0.001, Math.min(1.0, params.entry_fee_sol ?? 0.1));
      const entryFeeLamports = BigInt(Math.floor(entryFeeSol * 1_000_000_000));

      // ウォレット残高チェック（参加費 + トランザクション手数料）
      let balance: number;
      try {
        balance = await connection.getBalance(keypair.publicKey, 'confirmed');
      } catch {
        return { success: false, message: 'RPC_ERROR: ウォレット残高の取得に失敗しました' };
      }

      const requiredLamports = Number(entryFeeLamports) + 10_000; // +0.00001 SOL for fees
      if (balance < requiredLamports) {
        return {
          success: false,
          message: `INSUFFICIENT_BALANCE: 残高不足。必要: ${entryFeeSol} SOL + 手数料、現在: ${balance / 1e9} SOL`,
        };
      }

      // オンチェーンで enter_matchmaking_queue を呼び出す
      let txSignature: string;
      try {
        const matchmakingQueuePda = deriveMatchmakingQueuePda();
        const instructionData = buildEnterQueueInstructionData(entryFeeLamports);

        const ix = new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: matchmakingQueuePda, isSigner: false, isWritable: true },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: instructionData,
        });

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({
          recentBlockhash: blockhash,
          feePayer: keypair.publicKey,
        }).add(ix);
        tx.sign(keypair);

        txSignature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        // トランザクション確認を待つ
        await connection.confirmTransaction(
          { signature: txSignature, blockhash, lastValidBlockHeight },
          'confirmed',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `ONCHAIN_ERROR: enter_matchmaking_queueの呼び出しに失敗しました: ${msg}`,
        };
      }

      // WebSocket経由でサーバーにキュー参加を通知
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            success: false,
            message: 'TIMEOUT: キュー参加のレスポンスがタイムアウトしました',
          });
        }, 30_000);

        const messageHandler = (data: Buffer | string): void => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'queue_joined') {
              clearTimeout(timeout);
              state.ws?.removeListener('message', messageHandler);
              resolve({
                success: true,
                status: 'queued',
                txSignature,
                entryFeeSol,
                message: `マッチメイキングキューに参加しました（位置: ${message.position}）。参加費 ${entryFeeSol} SOL を支払いました（tx: ${txSignature}）。`,
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

        // WebSocketでキュー参加を通知（トランザクション署名を含む）
        state.ws?.send(
          JSON.stringify({
            type: 'join_queue',
            token: state.token,
            entryFeeSignature: txSignature,
            entryFeeAmount: Number(entryFeeLamports),
          }),
        );
      });
    },
  });
}
