/**
 * init-onchain.ts
 *
 * MatchmakingQueue PDA をオンチェーンで一度だけ初期化するスクリプト。
 * 新しいクラスターへのデプロイ後や、ローカル開発環境のセットアップ時に実行する。
 *
 * 使い方:
 *   cd server
 *   npx ts-node scripts/init-onchain.ts
 *
 * 前提条件:
 *   - server/.env に OPERATOR_PRIVATE_KEY と SOLANA_RPC_URL が設定済み
 *   - プログラムが対象クラスターにデプロイ済み
 */

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { AnchorProvider, Program, Idl, Wallet } from '@coral-xyz/anchor';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const IDL = require(path.join(__dirname, '../../app/lib/claw_poker_idl.json')) as Idl;

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? '6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo',
);
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

async function main(): Promise<void> {
  // オペレーターキーペアの読み込み
  const operatorPrivKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivKey) {
    throw new Error('OPERATOR_PRIVATE_KEY が server/.env に設定されていません');
  }

  let operatorKeypair: Keypair;
  try {
    operatorKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(operatorPrivKey) as number[]),
    );
  } catch {
    throw new Error('OPERATOR_PRIVATE_KEY のパースに失敗しました。JSON配列形式 [1,2,...,64] で設定してください');
  }

  console.log('オペレーター:', operatorKeypair.publicKey.toBase58());
  console.log('RPC:', SOLANA_RPC_URL);
  console.log('プログラムID:', PROGRAM_ID.toBase58());

  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

  // AnchorProvider 作成
  const wallet: Wallet = {
    payer: operatorKeypair,
    publicKey: operatorKeypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.partialSign(operatorKeypair);
      else (tx as VersionedTransaction).sign([operatorKeypair]);
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      txs.forEach((tx) => {
        if (tx instanceof Transaction) tx.partialSign(operatorKeypair);
        else (tx as VersionedTransaction).sign([operatorKeypair]);
      });
      return txs;
    },
  };

  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL, provider);

  // MatchmakingQueue PDA 導出
  const [queuePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('matchmaking_queue')],
    PROGRAM_ID,
  );
  console.log('MatchmakingQueue PDA:', queuePda.toBase58());

  // 既に初期化済みか確認
  const existing = await connection.getAccountInfo(queuePda);
  if (existing) {
    console.log('✅ MatchmakingQueue は既に初期化済みです（スキップ）');
    return;
  }

  // initialize_matchmaking_queue を呼び出す
  console.log('MatchmakingQueue を初期化中...');
  try {
    const txSig = await (program.methods as unknown as {
      initializeMatchmakingQueue: (operator: PublicKey) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    })
      .initializeMatchmakingQueue(operatorKeypair.publicKey)
      .accounts({
        matchmakingQueue: queuePda,
        authority: operatorKeypair.publicKey,
        operator: operatorKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✅ 初期化完了！');
    console.log('   トランザクション:', txSig);
    console.log('   PDA:', queuePda.toBase58());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already in use')) {
      console.log('✅ MatchmakingQueue は既に初期化済みです（スキップ）');
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('❌ エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
