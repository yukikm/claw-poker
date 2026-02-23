'use client';

import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useAnchorProgram, getProgramId } from '@/lib/anchor';
import { useMyBetsStore } from '@/stores/myBetsStore';
import { type MyBet } from '@/lib/types';

const ANCHOR_ERROR_MESSAGES: Record<number, string> = {
  6000: 'ゲームが開始されていません。',
  6001: 'ベッティングは締め切られています。',
  6002: '残高不足です。',
  6003: '既にベット済みです。',
  6004: '無効なプレイヤー選択です。',
  6005: 'ベット額が不正です。',
};

function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  // Anchorカスタムエラーコード（例: "custom program error: 0x1770"）
  const hexMatch = message.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  // "Error Code: <number>" 形式
  const codeMatch = message.match(/Error Code: (\d+)/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    if (ANCHOR_ERROR_MESSAGES[code]) return ANCHOR_ERROR_MESSAGES[code];
  }

  // 残高不足のSystemProgramエラー
  if (message.includes('insufficient funds') || message.includes('Insufficient funds')) {
    return '残高不足です。';
  }

  // ユーザーがトランザクションを拒否した場合
  if (message.includes('User rejected')) {
    return 'トランザクションがキャンセルされました。';
  }

  return 'ベットの処理に失敗しました。もう一度お試しください。';
}

interface PlaceBetParams {
  gameId: bigint;
  gamePda: PublicKey;
  bettingPoolPda: PublicKey;
  playerChoice: 1 | 2;
  amount: number; // lamports
}

export function usePlaceBet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useAnchorProgram();
  const { addBet } = useMyBetsStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programId = getProgramId();

  const placeBet = async ({ gameId, gamePda, bettingPoolPda, playerChoice, amount }: PlaceBetParams): Promise<string | null> => {
    if (!publicKey || !program) {
      setError('ウォレットを接続してください');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const gameIdBuffer = Buffer.alloc(8);
      const view = new DataView(gameIdBuffer.buffer);
      view.setBigUint64(0, gameId, true);

      const [betRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bet_record'), gameIdBuffer, publicKey.toBuffer()],
        programId
      );

      const txSig = await program.methods
        .placeSpectatorBet(new BN(gameId.toString()), playerChoice, new BN(amount))
        .accounts({
          bettingPool: bettingPoolPda,
          game: gamePda,
          betRecord: betRecordPda,
          bettor: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const newBet: MyBet = {
        gameId: gameId.toString(),
        gamePda: gamePda.toString(),
        bettingPoolPda: bettingPoolPda.toString(),
        betRecordPda: betRecordPda.toString(),
        playerChoice,
        amount,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'active',
        payout: null,
        txSignature: txSig,
      };

      addBet(newBet);
      return txSig;
    } catch (err) {
      setError(sanitizeError(err));
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { placeBet, isLoading, error };
}
